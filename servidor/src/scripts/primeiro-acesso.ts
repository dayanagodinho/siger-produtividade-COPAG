import type { PoolClient } from 'pg';
import { pool } from '../infra/banco';
import { gerarHashDeSenha, validarForcaDaSenha } from '../infra/senha';
import { aplicarMigracoes } from './migrar';

/**
 * Cria o primeiro administrador do sistema a partir de variaveis de ambiente.
 * So age quando ainda nao existe nenhum servidor cadastrado, entao rodar de
 * novo depois nao altera nada nem sobrescreve senha de ninguem.
 */
export async function criarPrimeiroAdministrador(): Promise<string | null> {
  const email = process.env.ADMIN_EMAIL?.trim();
  const senha = process.env.ADMIN_SENHA;

  if (!email || !senha) return null;

  const existentes = await pool.query('SELECT 1 FROM servidores LIMIT 1');
  if (existentes.rowCount) return null;

  const problema = validarForcaDaSenha(senha);
  if (problema) {
    return `Primeiro acesso não criado: ${problema} Ajuste a variável ADMIN_SENHA e reinicie.`;
  }

  const nome = process.env.ADMIN_NOME?.trim() || 'Administrador do sistema';
  const matricula = process.env.ADMIN_MATRICULA?.trim() || '000001';
  const setorNome = process.env.SETOR_NOME?.trim() || 'Setor inicial';
  const setorSigla = process.env.SETOR_SIGLA?.trim() || 'GERAL';

  let setorEscolhido = setorNome;
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');

    const setor = await garantirSetor(cliente, setorNome, setorSigla);
    setorEscolhido = setor.nome;

    const administrador = await cliente.query<{ id: number }>(
      `INSERT INTO servidores
         (matricula, nome, email, senha_hash, setor_id, perfil, regime, situacao, data_admissao)
       VALUES ($1, $2, $3, $4, $5, 'ADMIN', 'INTEGRAL', 'ATIVO', CURRENT_DATE)
       RETURNING id`,
      [matricula, nome, email, await gerarHashDeSenha(senha), setor.id],
    );

    await cliente.query(
      `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, usuario_nome, contexto)
       VALUES ('servidor', $1::text, 'CRIACAO', $2::int, $3, $4)`,
      [
        String(administrador.rows[0].id),
        administrador.rows[0].id,
        nome,
        'Primeiro administrador criado automaticamente na primeira subida do SIGAP',
      ],
    );

    await cliente.query('COMMIT');
  } catch (erro) {
    await cliente.query('ROLLBACK');
    throw erro;
  } finally {
    cliente.release();
  }

  return (
    `Primeiro administrador criado em ${setorEscolhido}: entre com a matrícula ${matricula} ` +
    `(ou o e-mail ${email}) e a senha definida em ADMIN_SENHA. Troque a senha no primeiro acesso.`
  );
}

/**
 * Encontra o setor onde o administrador entra.
 *
 * Na subida limpa ele ainda nao existe e nasce aqui. Mas se a criacao do
 * administrador ja falhou uma vez — uma ADMIN_SENHA fraca basta — a lista de
 * atividades entrou sozinha e criou o setor antes. Na tentativa seguinte o
 * administrador tem de entrar nesse mesmo setor, senao esbarra na sigla
 * repetida e derruba a subida. E entrar num setor novo, ao lado do que ja tem
 * as atividades, seria pior que o erro: o sistema subiria partido em dois.
 *
 * A regra e a mesma da importacao do catalogo: o setor de mesma sigla, o unico
 * setor que existir, e so entao um setor novo.
 */
async function garantirSetor(
  cliente: PoolClient,
  nome: string,
  sigla: string,
): Promise<{ id: number; nome: string }> {
  const porSigla = await cliente.query<{ id: number; nome: string }>(
    'SELECT id, nome FROM setores WHERE upper(sigla) = upper($1) AND excluido_em IS NULL',
    [sigla],
  );
  if (porSigla.rowCount) return porSigla.rows[0];

  const existentes = await cliente.query<{ id: number; nome: string }>(
    'SELECT id, nome FROM setores WHERE excluido_em IS NULL ORDER BY id',
  );
  if (existentes.rowCount === 1) return existentes.rows[0];

  const criado = await cliente.query<{ id: number; nome: string }>(
    'INSERT INTO setores (nome, sigla) VALUES ($1, $2) RETURNING id, nome',
    [nome, sigla],
  );
  return criado.rows[0];
}

if (require.main === module) {
  aplicarMigracoes()
    .then(criarPrimeiroAdministrador)
    .then((mensagem) => {
      console.log(
        mensagem ??
          'Nada a fazer: o banco já tem servidores cadastrados, ou ADMIN_EMAIL e ADMIN_SENHA não foram definidos.',
      );
      return pool.end();
    })
    .catch((erro) => {
      console.error('Falha ao criar o primeiro administrador:', erro.message);
      process.exitCode = 1;
      return pool.end();
    });
}
