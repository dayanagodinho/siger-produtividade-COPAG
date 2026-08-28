import { pool } from '../infra/banco';
import { gerarHashDeSenha } from '../infra/senha';
import { aplicarMigracoes } from './migrar';
import { importarCatalogo } from './catalogo';
import { criarDemonstracao } from './demonstracao';

/**
 * Monta um ambiente completo do zero, para desenvolvimento e conferencia:
 * o setor da COPAG, os quatro grupos, a lista de atividades do plano de
 * trabalho e um administrador, mais dois meses de producao ficticia.
 *
 * Reaproveita a mesma carga que sobe sozinha em producao e o mesmo gerador de
 * demonstracao que a Coordenacao aciona pela tela — nao ha uma segunda versao
 * dos dados para divergir da primeira.
 *
 * Use --recriar para limpar tudo antes. Nao rode com dado real no banco.
 */

const ADMIN = {
  matricula: '100001',
  nome: 'Ana Ribeiro Alves',
  email: 'ana.alves@camara.leg.br',
  senha: 'produtividade2026',
};

async function limpar(): Promise<void> {
  await pool.query(`
    TRUNCATE fechamento_servidores, fechamento_grupos, fechamentos,
             lancamentos, ausencias, auditoria, sessoes RESTART IDENTITY CASCADE
  `);
  await pool.query('DELETE FROM atividades');
  await pool.query('UPDATE setores SET chefe_servidor_id = NULL');
  await pool.query('UPDATE parametros SET atualizado_por = NULL');
  await pool.query('DELETE FROM servidores');
  await pool.query('DELETE FROM grupos');
  await pool.query('DELETE FROM setores');
  await pool.query('DELETE FROM feriados');
  for (const sequencia of ['setores', 'grupos', 'servidores', 'atividades']) {
    await pool.query(`ALTER SEQUENCE ${sequencia}_id_seq RESTART WITH 1`);
  }
}

async function semear(): Promise<void> {
  await aplicarMigracoes();

  if (process.argv.includes('--recriar')) {
    console.log('Limpando dados existentes...');
    await limpar();
  }

  if ((await pool.query('SELECT 1 FROM servidores LIMIT 1')).rowCount) {
    console.log(
      'O banco já possui servidores cadastrados. Rode "npm run semear -- --recriar" para recomeçar do zero.',
    );
    return;
  }

  const catalogo = await importarCatalogo();
  console.log(
    `Setor ${catalogo.setor}: ${catalogo.gruposCriados} grupos, ${catalogo.criadas} atividades ` +
      `(${catalogo.lancaveis} lançáveis, ${catalogo.agrupadores} agrupadoras) e ` +
      `${catalogo.feriadosCriados} feriados.`,
  );

  const setor = await pool.query<{ id: number }>(
    'SELECT id FROM setores WHERE excluido_em IS NULL ORDER BY id LIMIT 1',
  );
  const administrador = await pool.query<{ id: number }>(
    `INSERT INTO servidores
       (matricula, nome, email, senha_hash, setor_id, perfil, regime, data_admissao)
     VALUES ($1, $2, $3, $4, $5, 'ADMIN', 'INTEGRAL', '2018-03-12') RETURNING id`,
    [
      ADMIN.matricula,
      ADMIN.nome,
      ADMIN.email,
      await gerarHashDeSenha(ADMIN.senha),
      setor.rows[0].id,
    ],
  );

  const demonstracao = await criarDemonstracao(administrador.rows[0].id);
  console.log(
    `Demonstração: ${demonstracao.pessoas} pessoas, ${demonstracao.lancamentos} lançamentos ` +
      `em ${demonstracao.competencias.join(' e ')} e ${demonstracao.ausencias} ausência(s).`,
  );

  const chefe = await pool.query<{ id: number }>(
    "SELECT id FROM servidores WHERE perfil = 'CHEFE' ORDER BY id LIMIT 1",
  );
  if (chefe.rowCount) {
    await pool.query('UPDATE setores SET chefe_servidor_id = $1 WHERE id = $2', [
      chefe.rows[0].id,
      setor.rows[0].id,
    ]);
  }

  console.log();
  console.log('Acesso de administrador:');
  console.log(`  ${ADMIN.matricula}  ${ADMIN.nome}  senha: ${ADMIN.senha}`);
  console.log('As pessoas de demonstração entram com a senha demonstracao2026.');
  console.log();
  console.log('O peso de cada lançamento é indicado pelo servidor: as atividades entram sem nível fixo.');
}

semear()
  .catch((erro) => {
    console.error('Falha ao semear:', erro);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
