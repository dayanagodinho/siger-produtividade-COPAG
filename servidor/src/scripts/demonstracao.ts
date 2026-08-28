import type { PoolClient } from 'pg';
import { emTransacao, consultar, consultarUm } from '../infra/banco';
import { gerarHashDeSenha } from '../infra/senha';
import { erroDeRequisicao } from '../infra/erros';

/**
 * Povoa o sistema com um setor ficticio em funcionamento, para a chefia ver
 * como tudo se comporta antes de a equipe comecar a lancar de verdade.
 *
 * As pessoas criadas aqui levam a marca `demonstracao`, e e so ela que
 * permite desfazer tudo depois com uma limpeza exata. Nada do que a equipe
 * cadastrar e tocado, nem na criacao nem na remocao.
 *
 * A producao gerada tem de contar uma historia legivel: gente acima e abaixo
 * da referencia, uma fila esperando a chefia, um lancamento devolvido e umas
 * ferias que zeram a apuracao do mes. E o que faz os paineis mostrarem algo.
 */

const SENHA_DEMO = 'demonstracao2026';

interface PessoaDemo {
  nome: string;
  perfil: 'SERVIDOR' | 'CHEFE_GRUPO';
  regime: 'INTEGRAL' | 'PARCIAL' | 'PRESENCIAL';
  /** Quantos lancamentos por mes e os niveis que a pessoa costuma declarar. */
  porMes: number;
  niveis: number[];
  ferias?: boolean;
}

const PESSOAS: PessoaDemo[] = [
  { nome: 'Carlos Menezes Prado', perfil: 'CHEFE_GRUPO', regime: 'INTEGRAL', porMes: 5, niveis: [2, 3] },
  { nome: 'Beatriz Souza Lima', perfil: 'SERVIDOR', regime: 'INTEGRAL', porMes: 11, niveis: [3, 2, 4, 2, 3, 1] },
  { nome: 'Diego Fontes Araujo', perfil: 'SERVIDOR', regime: 'INTEGRAL', porMes: 9, niveis: [2, 3, 2, 1, 3] },
  { nome: 'Elaine Castro Moreira', perfil: 'SERVIDOR', regime: 'PARCIAL', porMes: 10, niveis: [1, 2, 1, 2, 3] },
  { nome: 'Fabio Nunes Teixeira', perfil: 'SERVIDOR', regime: 'PRESENCIAL', porMes: 12, niveis: [2, 1, 3, 1, 2] },
  { nome: 'Helena Duarte Campos', perfil: 'SERVIDOR', regime: 'INTEGRAL', porMes: 9, niveis: [3, 2, 3, 4] },
  { nome: 'Igor Barreto Salles', perfil: 'SERVIDOR', regime: 'INTEGRAL', porMes: 8, niveis: [2, 2, 3, 1], ferias: true },
  { nome: 'Juliana Moraes Vieira', perfil: 'SERVIDOR', regime: 'INTEGRAL', porMes: 6, niveis: [1, 2, 1, 1] },
];

const PESO_DO_PAPEL: Record<string, number> = { EXECUCAO: 100, REVISAO: 40, HOMOLOGACAO: 20 };

export interface ResumoDemonstracao {
  pessoas: number;
  lancamentos: number;
  ausencias: number;
  competencias: string[];
}

export async function situacaoDaDemonstracao(): Promise<{ pessoas: number; lancamentos: number }> {
  const linha = await consultarUm<{ pessoas: number; lancamentos: number }>(
    `SELECT
       (SELECT count(*) FROM servidores WHERE demonstracao)::int AS pessoas,
       (SELECT count(*) FROM lancamentos l
          JOIN servidores s ON s.id = l.servidor_id
         WHERE s.demonstracao AND l.excluido_em IS NULL)::int AS lancamentos`,
  );
  return linha ?? { pessoas: 0, lancamentos: 0 };
}

export async function criarDemonstracao(criadoPor: number): Promise<ResumoDemonstracao> {
  const jaTem = await situacaoDaDemonstracao();
  if (jaTem.pessoas) {
    throw erroDeRequisicao(
      'A demonstração já está carregada. Remova a atual antes de gerar outra.',
    );
  }

  const grupos = await consultar<{ id: number; setor_id: number }>(
    `SELECT g.id, g.setor_id FROM grupos g
      WHERE g.excluido_em IS NULL
      ORDER BY g.id`,
  );
  if (!grupos.length) {
    throw erroDeRequisicao('Cadastre ao menos um grupo antes de gerar a demonstração.');
  }

  const atividades = await consultar<{ id: number; grupo_id: number }>(
    'SELECT id, grupo_id FROM atividades WHERE excluido_em IS NULL AND ativa ORDER BY id',
  );

  const competencias = ultimasCompetencias(2);
  const senhaHash = await gerarHashDeSenha(SENHA_DEMO);
  const resumo: ResumoDemonstracao = {
    pessoas: 0,
    lancamentos: 0,
    ausencias: 0,
    competencias: competencias.map(([ano, mes]) => `${String(mes).padStart(2, '0')}/${ano}`),
  };

  await emTransacao(async (cliente) => {
    const criadas: Array<{ id: number; grupoId: number; pessoa: PessoaDemo }> = [];

    for (const [indice, pessoa] of PESSOAS.entries()) {
      const grupo = grupos[indice % grupos.length];
      const inserida = await cliente.query<{ id: number }>(
        `INSERT INTO servidores
           (matricula, nome, email, senha_hash, setor_id, grupo_id, perfil, regime,
            situacao, data_admissao, demonstracao)
         VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, 'ATIVO', $8, TRUE)
         RETURNING id`,
        [
          `DEMO${String(indice + 1).padStart(3, '0')}`,
          `${pessoa.nome} (demonstração)`,
          senhaHash,
          grupo.setor_id,
          grupo.id,
          pessoa.perfil,
          pessoa.regime,
          `20${18 + (indice % 8)}-03-12`,
        ],
      );
      criadas.push({ id: inserida.rows[0].id, grupoId: grupo.id, pessoa });
      resumo.pessoas += 1;
    }

    const chefe = criadas.find((c) => c.pessoa.perfil === 'CHEFE_GRUPO') ?? criadas[0];

    for (const [indice, criada] of criadas.entries()) {
      const doGrupo = atividades.filter((a) => a.grupo_id === criada.grupoId);

      for (const [ordemDoMes, [ano, mes]] of competencias.entries()) {
        // Ferias no mes corrente: a pessoa fica sem dias efetivos e o
        // sistema mostra SEM APURACAO, que e a regra que mais gera duvida.
        if (criada.pessoa.ferias && ordemDoMes === competencias.length - 1) continue;

        for (let n = 0; n < criada.pessoa.porMes; n += 1) {
          const nivel = criada.pessoa.niveis[n % criada.pessoa.niveis.length];
          const papel = n % 9 === 4 ? 'REVISAO' : n % 9 === 8 ? 'HOMOLOGACAO' : 'EXECUCAO';
          const dia = diaUtilDoMes(ano, mes, n);
          const situacao = escolherSituacao(indice, n);

          await cliente.query(
            `INSERT INTO lancamentos
               (servidor_id, atividade_id, processo, nivel, papel, quantidade,
                data_conclusao, status, situacao, nivel_aplicado, percentual_papel,
                justificativa, validado_por, validado_em, criado_por)
             VALUES ($1, $2, $3, $4, $5, 1, $6, 'CONCLUIDO', $7, $4, $8, $9, $10, $11, $1)`,
            [
              criada.id,
              doGrupo.length ? doGrupo[(indice * 3 + n) % doGrupo.length].id : null,
              `${800000 + criada.id * 500 + ordemDoMes * 50 + n}/${ano}`,
              nivel,
              papel,
              `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`,
              situacao,
              PESO_DO_PAPEL[papel],
              situacao === 'DEVOLVIDO' ? 'Sem evidência anexada. Reenviar com o comprovante.' : null,
              situacao === 'PENDENTE' ? null : chefe.id,
              situacao === 'PENDENTE' ? null : new Date(),
            ],
          );
          resumo.lancamentos += 1;
        }
      }

      if (criada.pessoa.ferias) {
        const [ano, mes] = competencias[competencias.length - 1];
        await cliente.query(
          `INSERT INTO ausencias (servidor_id, tipo, data_inicio, data_fim, observacao, criado_por)
           VALUES ($1, 'FERIAS', $2, $3, 'Férias integrais no mês (dados de demonstração).', $4)`,
          [
            criada.id,
            `${ano}-${String(mes).padStart(2, '0')}-01`,
            `${ano}-${String(mes).padStart(2, '0')}-${ultimoDia(ano, mes)}`,
            chefe.id,
          ],
        );
        resumo.ausencias += 1;
      }
    }

    await registrarNaAuditoria(
      cliente,
      criadoPor,
      'CRIACAO',
      `Demonstração carregada: ${resumo.pessoas} pessoas e ${resumo.lancamentos} lançamentos.`,
    );
  });

  return resumo;
}

export async function removerDemonstracao(removidoPor: number): Promise<{ pessoas: number; lancamentos: number }> {
  const antes = await situacaoDaDemonstracao();
  if (!antes.pessoas) return antes;

  await emTransacao(async (cliente) => {
    const demo = 'SELECT id FROM servidores WHERE demonstracao';

    // Solta primeiro tudo o que apenas aponta para a gente ficticia, para
    // que a exclusao nao esbarre em referencia nenhuma.
    await cliente.query(
      `UPDATE lancamentos SET validado_por = NULL, nivel_alterado_por = NULL
        WHERE (validado_por IN (${demo}) OR nivel_alterado_por IN (${demo}))
          AND servidor_id NOT IN (${demo})`,
    );
    await cliente.query(`UPDATE setores SET chefe_servidor_id = NULL WHERE chefe_servidor_id IN (${demo})`);
    await cliente.query(`UPDATE parametros SET atualizado_por = NULL WHERE atualizado_por IN (${demo})`);
    await cliente.query(`UPDATE auditoria SET usuario_id = NULL WHERE usuario_id IN (${demo})`);

    await cliente.query(`DELETE FROM fechamento_servidores WHERE servidor_id IN (${demo})`);
    await cliente.query(`DELETE FROM ausencias WHERE servidor_id IN (${demo}) OR criado_por IN (${demo})`);
    await cliente.query(`DELETE FROM lancamentos WHERE servidor_id IN (${demo}) OR criado_por IN (${demo})`);
    await cliente.query('DELETE FROM servidores WHERE demonstracao');

    await registrarNaAuditoria(
      cliente,
      removidoPor,
      'EXCLUSAO',
      `Demonstração removida: ${antes.pessoas} pessoas e ${antes.lancamentos} lançamentos.`,
    );
  });

  return antes;
}

async function registrarNaAuditoria(
  cliente: PoolClient,
  usuarioId: number,
  acao: string,
  contexto: string,
): Promise<void> {
  const autor = await cliente.query<{ nome: string }>(
    'SELECT nome FROM servidores WHERE id = $1',
    [usuarioId],
  );
  await cliente.query(
    `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, usuario_nome, contexto)
     VALUES ('demonstracao', 'demonstracao', $1, $2::int, $3, $4)`,
    [acao, usuarioId, autor.rows[0]?.nome ?? 'Administrador', contexto],
  );
}

/** As N competencias que terminam no mes corrente, da mais antiga para a atual. */
function ultimasCompetencias(quantas: number): Array<[number, number]> {
  const hoje = new Date();
  const lista: Array<[number, number]> = [];
  for (let recuo = quantas - 1; recuo >= 0; recuo -= 1) {
    const data = new Date(hoje.getFullYear(), hoje.getMonth() - recuo, 1);
    lista.push([data.getFullYear(), data.getMonth() + 1]);
  }
  return lista;
}

function ultimoDia(ano: number, mes: number): number {
  return new Date(ano, mes, 0).getDate();
}

/** Espalha os lancamentos por dias uteis, sem passar do fim do mes. */
function diaUtilDoMes(ano: number, mes: number, indice: number): number {
  const limite = ultimoDia(ano, mes);
  let dia = 1;
  let uteis = 0;
  while (dia <= limite) {
    const semana = new Date(ano, mes - 1, dia).getDay();
    if (semana !== 0 && semana !== 6) {
      if (uteis === indice % 20) return dia;
      uteis += 1;
    }
    dia += 1;
  }
  return Math.min(limite, 28);
}

/**
 * Deixa a maior parte pendente, para a fila da chefia ter o que mostrar; uma
 * fatia ja conferida; e um devolvido, que e o unico caso em que o ponto
 * deixa de contar.
 */
function escolherSituacao(pessoa: number, lancamento: number): 'PENDENTE' | 'VALIDADO' | 'DEVOLVIDO' {
  if (pessoa === 1 && lancamento === 3) return 'DEVOLVIDO';
  if ((pessoa + lancamento) % 3 === 0) return 'VALIDADO';
  return 'PENDENTE';
}
