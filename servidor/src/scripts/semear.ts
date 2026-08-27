import * as fs from 'fs';
import * as path from 'path';
import { pool } from '../infra/banco';
import { gerarHashDeSenha } from '../infra/senha';
import { aplicarMigracoes } from './migrar';
import { ehDiaUtil, listarDiasDoMes } from '../dominio/datas';

/**
 * Popula o banco com a COPAG: os quatro grupos de folha e a lista de
 * atividades de cada um, extraída da planilha do Programa de Resultados.
 * A pontuação é por atividade; o detalhamento fica pendurado nela apenas
 * como apoio na hora de lançar. O peso de cada lançamento é indicado pelo
 * servidor, então as atividades entram sem nível fixo.
 *
 * Use --recriar para limpar os dados operacionais antes de semear.
 */

interface Detalhamento {
  numero: string;
  texto: string;
}

interface AtividadeImportada {
  numero: string;
  nome: string;
  entrega: string;
  detalhamentos: Detalhamento[];
}

interface GrupoImportado {
  nome: string;
  descricao: string;
  atividades: AtividadeImportada[];
}

interface Catalogo {
  setor: { nome: string; sigla: string };
  grupos: GrupoImportado[];
}

const CATALOGO: Catalogo = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'dados', 'atividades-copag.json'),
    'utf8',
  ),
);

const FERIADOS_2026: Array<[string, string]> = [
  ['2026-01-01', 'Confraternização Universal'],
  ['2026-02-16', 'Carnaval'],
  ['2026-02-17', 'Carnaval'],
  ['2026-04-03', 'Sexta-feira Santa'],
  ['2026-04-21', 'Tiradentes'],
  ['2026-05-01', 'Dia do Trabalho'],
  ['2026-06-04', 'Corpus Christi'],
  ['2026-09-07', 'Independência do Brasil'],
  ['2026-10-12', 'Nossa Senhora Aparecida'],
  ['2026-11-02', 'Finados'],
  ['2026-11-15', 'Proclamação da República'],
  ['2026-11-20', 'Dia Nacional de Zumbi e da Consciência Negra'],
  ['2026-12-25', 'Natal'],
];

interface ServidorSemente {
  matricula: string;
  nome: string;
  email: string;
  perfil: 'SERVIDOR' | 'CHEFE' | 'ADMIN';
  grupo: string | null;
  regime: 'INTEGRAL' | 'PARCIAL' | 'PRESENCIAL';
  admissao: string;
  /** Quantos lançamentos por mês e os níveis que a pessoa costuma declarar. */
  producao?: { porMes: number; niveis: number[] };
}

const EFETIVOS = 'Pagamento dos Servidores Efetivos';
const INATIVOS = 'Pagamento de Inativos, Pensionistas e Benefícios Externos';
const PARLAMENTARES = 'Pagamento dos Parlamentares';
const COMISSIONADOS = 'Pagamento dos Comissionados';

const SERVIDORES: ServidorSemente[] = [
  { matricula: '100001', nome: 'Ana Ribeiro Alves', email: 'ana.alves@camara.leg.br', perfil: 'ADMIN', grupo: null, regime: 'INTEGRAL', admissao: '2018-03-12' },
  { matricula: '100002', nome: 'Carlos Menezes Prado', email: 'carlos.prado@camara.leg.br', perfil: 'CHEFE', grupo: EFETIVOS, regime: 'INTEGRAL', admissao: '2015-08-01', producao: { porMes: 5, niveis: [2, 3] } },
  { matricula: '100003', nome: 'Beatriz Souza Lima', email: 'beatriz.lima@camara.leg.br', perfil: 'SERVIDOR', grupo: EFETIVOS, regime: 'INTEGRAL', admissao: '2019-05-20', producao: { porMes: 11, niveis: [3, 2, 4, 2, 3, 1] } },
  { matricula: '100004', nome: 'Diego Fontes Araujo', email: 'diego.araujo@camara.leg.br', perfil: 'SERVIDOR', grupo: EFETIVOS, regime: 'INTEGRAL', admissao: '2021-02-15', producao: { porMes: 9, niveis: [2, 3, 2, 1, 3] } },
  { matricula: '100005', nome: 'Elaine Castro Moreira', email: 'elaine.moreira@camara.leg.br', perfil: 'SERVIDOR', grupo: INATIVOS, regime: 'PARCIAL', admissao: '2020-09-01', producao: { porMes: 10, niveis: [1, 2, 1, 2, 3] } },
  { matricula: '100006', nome: 'Fabio Nunes Teixeira', email: 'fabio.teixeira@camara.leg.br', perfil: 'SERVIDOR', grupo: INATIVOS, regime: 'PRESENCIAL', admissao: '2017-11-10', producao: { porMes: 12, niveis: [2, 1, 3, 1, 2] } },
  { matricula: '100007', nome: 'Gabriela Pinto Rocha', email: 'gabriela.rocha@camara.leg.br', perfil: 'SERVIDOR', grupo: INATIVOS, regime: 'INTEGRAL', admissao: '2022-07-04', producao: { porMes: 10, niveis: [2, 1, 2, 3] } },
  { matricula: '100008', nome: 'Helena Duarte Campos', email: 'helena.campos@camara.leg.br', perfil: 'SERVIDOR', grupo: PARLAMENTARES, regime: 'INTEGRAL', admissao: '2016-04-18', producao: { porMes: 9, niveis: [3, 2, 3, 4] } },
  { matricula: '100009', nome: 'Igor Barreto Salles', email: 'igor.salles@camara.leg.br', perfil: 'SERVIDOR', grupo: PARLAMENTARES, regime: 'INTEGRAL', admissao: '2023-01-09', producao: { porMes: 8, niveis: [2, 2, 3, 1] } },
  { matricula: '100010', nome: 'Juliana Moraes Vieira', email: 'juliana.vieira@camara.leg.br', perfil: 'SERVIDOR', grupo: COMISSIONADOS, regime: 'INTEGRAL', admissao: '2019-10-22', producao: { porMes: 11, niveis: [2, 3, 1, 2] } },
  { matricula: '100011', nome: 'Lucas Peixoto Ramos', email: 'lucas.ramos@camara.leg.br', perfil: 'SERVIDOR', grupo: COMISSIONADOS, regime: 'PARCIAL', admissao: '2021-06-14', producao: { porMes: 8, niveis: [1, 2, 2, 3] } },
];

const SENHA_PADRAO = 'produtividade2026';
const COMPETENCIAS = ['2026-07-01', '2026-08-01'];
const CORTE_VALIDACAO = '2026-08-20';

async function limpar(): Promise<void> {
  await pool.query(`
    TRUNCATE fechamento_servidores, fechamento_grupos, fechamentos,
             lancamentos, ausencias, auditoria, sessoes RESTART IDENTITY CASCADE
  `);
  await pool.query('DELETE FROM detalhamentos');
  await pool.query('DELETE FROM atividades');
  await pool.query('UPDATE setores SET chefe_servidor_id = NULL');
  await pool.query('DELETE FROM servidores');
  await pool.query('DELETE FROM grupos');
  await pool.query('DELETE FROM setores');
  await pool.query('DELETE FROM feriados');
  for (const sequencia of ['setores', 'grupos', 'servidores', 'atividades', 'detalhamentos']) {
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

  for (const [data, descricao] of FERIADOS_2026) {
    await pool.query(
      'INSERT INTO feriados (data, descricao) VALUES ($1, $2) ON CONFLICT (data) DO NOTHING',
      [data, descricao],
    );
  }
  console.log(`Feriados cadastrados: ${FERIADOS_2026.length}`);

  const setor = await pool.query<{ id: number }>(
    'INSERT INTO setores (nome, sigla) VALUES ($1, $2) RETURNING id',
    [CATALOGO.setor.nome, CATALOGO.setor.sigla],
  );
  const setorId = setor.rows[0].id;
  console.log(`Setor: ${CATALOGO.setor.sigla} — ${CATALOGO.setor.nome}`);

  // Grupos e atividades saem da planilha do Programa de Resultados.
  const grupos = new Map<string, number>();
  const atividadesPorGrupo = new Map<string, Array<{ id: number; nome: string }>>();
  let totalAtividades = 0;
  let totalDetalhamentos = 0;

  for (const grupo of CATALOGO.grupos) {
    const inserido = await pool.query<{ id: number }>(
      `INSERT INTO grupos (setor_id, nome, descricao) VALUES ($1, $2, $3) RETURNING id`,
      [setorId, grupo.nome, grupo.descricao],
    );
    const grupoId = inserido.rows[0].id;
    grupos.set(grupo.nome, grupoId);

    const doGrupo: Array<{ id: number; nome: string }> = [];
    for (const atividade of grupo.atividades) {
      // Sem nivel_sugerido: o peso é indicado pelo servidor no lançamento.
      const criada = await pool.query<{ id: number }>(
        `INSERT INTO atividades (grupo_id, numero, nome, entrega, nivel_sugerido)
         VALUES ($1, $2, $3, $4, NULL) RETURNING id`,
        [grupoId, atividade.numero, atividade.nome, atividade.entrega || null],
      );
      doGrupo.push({ id: criada.rows[0].id, nome: atividade.nome });
      totalAtividades += 1;

      for (const [ordem, detalhe] of atividade.detalhamentos.entries()) {
        await pool.query(
          'INSERT INTO detalhamentos (atividade_id, numero, texto, ordem) VALUES ($1, $2, $3, $4)',
          [criada.rows[0].id, detalhe.numero || null, detalhe.texto, ordem],
        );
        totalDetalhamentos += 1;
      }
    }
    atividadesPorGrupo.set(grupo.nome, doGrupo);
    console.log(
      `  ${grupo.nome}: ${grupo.atividades.length} atividades, ` +
        `${grupo.atividades.reduce((soma, a) => soma + a.detalhamentos.length, 0)} detalhamentos`,
    );
  }
  console.log(`Total: ${totalAtividades} atividades e ${totalDetalhamentos} detalhamentos`);

  const senhaHash = await gerarHashDeSenha(SENHA_PADRAO);
  const idsPorMatricula = new Map<string, number>();

  for (const pessoa of SERVIDORES) {
    const inserido = await pool.query<{ id: number }>(
      `INSERT INTO servidores
         (matricula, nome, email, senha_hash, setor_id, grupo_id, perfil, regime, data_admissao)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        pessoa.matricula, pessoa.nome, pessoa.email, senhaHash, setorId,
        pessoa.grupo ? grupos.get(pessoa.grupo) : null, pessoa.perfil,
        pessoa.regime, pessoa.admissao,
      ],
    );
    idsPorMatricula.set(pessoa.matricula, inserido.rows[0].id);
  }

  const chefeId = idsPorMatricula.get('100002')!;
  await pool.query('UPDATE setores SET chefe_servidor_id = $1 WHERE id = $2', [chefeId, setorId]);
  console.log(`Servidores cadastrados: ${SERVIDORES.length}`);

  await pool.query(
    `INSERT INTO ausencias (servidor_id, tipo, data_inicio, data_fim, observacao, criado_por)
     VALUES ($1, 'FERIAS', '2026-08-01', '2026-08-31', 'Férias regulamentares do mês inteiro', $2),
            ($3, 'LICENCA', '2026-08-10', '2026-08-14', 'Licença para tratamento de saúde', $2)`,
    [idsPorMatricula.get('100009'), chefeId, idsPorMatricula.get('100005')],
  );
  console.log('Ausências cadastradas: 2');

  const pesos = new Map<string, number>();
  for (const linha of (await pool.query<{ chave: string; valor: number }>(
    'SELECT chave, valor FROM parametros',
  )).rows) {
    pesos.set(linha.chave, Number(linha.valor));
  }
  const pesoDoPapel = (papel: string) => pesos.get(`PESO_${papel}`) ?? 100;

  const feriados = new Set(FERIADOS_2026.map(([data]) => data));
  let inseridos = 0;
  let pendentes = 0;

  for (const competencia of COMPETENCIAS) {
    const uteis = listarDiasDoMes(competencia).filter((dia) => ehDiaUtil(dia, feriados));
    const mes = Number(competencia.slice(5, 7));

    for (const pessoa of SERVIDORES) {
      if (!pessoa.producao || !pessoa.grupo) continue;
      // Gabriela está de férias em agosto: não produz nada na competência.
      if (pessoa.matricula === '100009' && competencia === '2026-08-01') continue;

      const catalogo = atividadesPorGrupo.get(pessoa.grupo) ?? [];
      if (catalogo.length === 0) continue;

      for (let indice = 0; indice < pessoa.producao.porMes; indice += 1) {
        const dia = uteis[Math.floor((indice * uteis.length) / pessoa.producao.porMes)];
        const atividade = catalogo[(indice * 3 + mes) % catalogo.length];
        const nivel = pessoa.producao.niveis[indice % pessoa.producao.niveis.length];
        const processo = `${1000 + Number(pessoa.matricula.slice(-3))}${String(mes * 100 + indice).padStart(3, '0')}/2026`;
        const jaValidado = dia < CORTE_VALIDACAO;
        if (!jaValidado) pendentes += 1;

        const resultado = await pool.query(
          `INSERT INTO lancamentos
             (servidor_id, processo, descricao, nivel, papel, quantidade, data_conclusao,
              status, situacao, nivel_aplicado, percentual_papel, criado_por,
              validado_por, validado_em, atividade_id)
           VALUES ($1, $2, NULL, $3, 'EXECUCAO', 1, $4, 'CONCLUIDO', $5, $3, $6, $1, $7, $8, $9)
           ON CONFLICT DO NOTHING`,
          [
            idsPorMatricula.get(pessoa.matricula), processo, nivel, dia,
            jaValidado ? 'VALIDADO' : 'PENDENTE', pesoDoPapel('EXECUCAO'),
            jaValidado ? chefeId : null, jaValidado ? `${dia} 17:00:00-03` : null,
            atividade.id,
          ],
        );
        inseridos += resultado.rowCount ?? 0;

        // Um em cada quatro processos passa por revisão de um colega do mesmo
        // grupo e por homologação da chefia: é assim que o mesmo processo gera
        // até três lançamentos e o total de pontos sobe sem entrega adicional.
        if (indice % 4 === 0) {
          const colega = SERVIDORES.find(
            (s) => s.grupo === pessoa.grupo && s.matricula !== pessoa.matricula && s.producao,
          );
          const diaSeguinte = uteis[Math.min(uteis.length - 1, uteis.indexOf(dia) + 1)];
          const revisado = diaSeguinte < CORTE_VALIDACAO;

          for (const [papel, quem] of [
            ['REVISAO', colega ? idsPorMatricula.get(colega.matricula) : null],
            ['HOMOLOGACAO', chefeId],
          ] as Array<[string, number | null | undefined]>) {
            if (!quem) continue;
            if (!revisado) pendentes += 1;
            const extra = await pool.query(
              `INSERT INTO lancamentos
                 (servidor_id, processo, descricao, nivel, papel, quantidade, data_conclusao,
                  status, situacao, nivel_aplicado, percentual_papel, criado_por,
                  validado_por, validado_em, atividade_id)
               VALUES ($1, $2, $3, $4, $5, 1, $6, 'CONCLUIDO', $7, $4, $8, $1, $9, $10, NULL)
               ON CONFLICT DO NOTHING`,
              [
                quem, processo,
                papel === 'REVISAO'
                  ? `Revisão de: ${atividade.nome.slice(0, 120)}`
                  : `Homologação de: ${atividade.nome.slice(0, 120)}`,
                nivel, papel, diaSeguinte,
                revisado ? 'VALIDADO' : 'PENDENTE', pesoDoPapel(papel),
                revisado ? chefeId : null, revisado ? `${diaSeguinte} 17:00:00-03` : null,
              ],
            );
            inseridos += extra.rowCount ?? 0;
          }
        }
      }
    }
  }

  // Um lançamento devolvido e um em andamento, para as telas mostrarem os dois estados.
  const beatriz = idsPorMatricula.get('100003')!;
  const primeiraAtividade = (atividadesPorGrupo.get(EFETIVOS) ?? [])[0];
  await pool.query(
    `INSERT INTO lancamentos
       (servidor_id, processo, descricao, nivel, papel, quantidade, data_conclusao,
        status, situacao, nivel_aplicado, percentual_papel, criado_por,
        justificativa, validado_por, validado_em, atividade_id)
     VALUES ($1, '1003899/2026', NULL, 4, 'EXECUCAO', 1, '2026-08-13', 'CONCLUIDO', 'DEVOLVIDO',
             4, 100, $1,
             'Esta atividade seguiu o rito padrão, sem intercorrência. Reclassifique como nível 2.',
             $2, '2026-08-14 15:20:00-03', $3)`,
    [beatriz, chefeId, primeiraAtividade?.id ?? null],
  );
  await pool.query(
    `INSERT INTO lancamentos
       (servidor_id, processo, descricao, nivel, papel, quantidade, data_conclusao,
        periodo_inicio, status, situacao, nivel_aplicado, percentual_papel, criado_por, atividade_id)
     VALUES ($1, '1003950/2026', 'Aguardando retorno da assessoria', 3, 'EXECUCAO', 1,
             '2026-08-31', '2026-08-20', 'EM_ANDAMENTO', 'PENDENTE', 3, 100, $1, $2)`,
    [beatriz, primeiraAtividade?.id ?? null],
  );

  console.log(`Lançamentos cadastrados: ${inseridos + 2} (${pendentes} aguardando validação)`);
  console.log(
    [
      '',
      'Dados de acesso (todos com a mesma senha):',
      `  senha: ${SENHA_PADRAO}`,
      '  100001  Ana Ribeiro Alves       ADMIN',
      '  100002  Carlos Menezes Prado    CHEFE     · Efetivos',
      '  100003  Beatriz Souza Lima      SERVIDOR  · Efetivos',
      '  100005  Elaine Castro Moreira   SERVIDOR  · Inativos (licença de 5 dias em agosto)',
      '  100008  Helena Duarte Campos    SERVIDOR  · Parlamentares',
      '  100009  Igor Barreto Salles     SERVIDOR  · Parlamentares (férias: sem apuração em agosto)',
      '  100010  Juliana Moraes Vieira   SERVIDOR  · Comissionados',
      '',
      'O peso de cada lançamento é indicado pelo servidor: as atividades entram sem nível fixo.',
    ].join('\n'),
  );
}

semear()
  .catch((erro) => {
    console.error('Falha ao semear:', erro);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
