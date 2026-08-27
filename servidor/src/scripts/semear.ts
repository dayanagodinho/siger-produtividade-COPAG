import { pool } from '../infra/banco';
import { gerarHashDeSenha } from '../infra/senha';
import { aplicarMigracoes } from './migrar';
import { calcularPontos } from '../dominio/calculo';
import { ehDiaUtil, listarDiasDoMes } from '../dominio/datas';

/**
 * Popula o banco com um setor completo para testes: cadastros, feriados,
 * ausencias e lancamentos em duas competencias. Use --recriar para limpar os
 * dados operacionais antes de semear.
 */

const FERIADOS_2026: Array<[string, string]> = [
  ['2026-01-01', 'Confraternizacao Universal'],
  ['2026-02-16', 'Carnaval'],
  ['2026-02-17', 'Carnaval'],
  ['2026-04-03', 'Sexta-feira Santa'],
  ['2026-04-21', 'Tiradentes'],
  ['2026-05-01', 'Dia do Trabalho'],
  ['2026-06-04', 'Corpus Christi'],
  ['2026-09-07', 'Independencia do Brasil'],
  ['2026-10-12', 'Nossa Senhora Aparecida'],
  ['2026-11-02', 'Finados'],
  ['2026-11-15', 'Proclamacao da Republica'],
  ['2026-11-20', 'Dia Nacional de Zumbi e da Consciencia Negra'],
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
}

const SERVIDORES: ServidorSemente[] = [
  { matricula: '100001', nome: 'Ana Ribeiro Alves',      email: 'ana.alves@orgao.gov.br',     perfil: 'ADMIN',    grupo: null, regime: 'INTEGRAL',   admissao: '2018-03-12' },
  { matricula: '100002', nome: 'Carlos Menezes Prado',   email: 'carlos.prado@orgao.gov.br',  perfil: 'CHEFE',    grupo: 'Analise de contratos', regime: 'INTEGRAL',   admissao: '2015-08-01' },
  { matricula: '100003', nome: 'Beatriz Souza Lima',     email: 'beatriz.lima@orgao.gov.br',  perfil: 'SERVIDOR', grupo: 'Analise de contratos', regime: 'INTEGRAL',   admissao: '2019-05-20' },
  { matricula: '100004', nome: 'Diego Fontes Araujo',    email: 'diego.araujo@orgao.gov.br',  perfil: 'SERVIDOR', grupo: 'Analise de contratos', regime: 'INTEGRAL',   admissao: '2021-02-15' },
  { matricula: '100005', nome: 'Elaine Castro Moreira',  email: 'elaine.moreira@orgao.gov.br',perfil: 'SERVIDOR', grupo: 'Pagamentos',           regime: 'PARCIAL',    admissao: '2020-09-01' },
  { matricula: '100006', nome: 'Fabio Nunes Teixeira',   email: 'fabio.teixeira@orgao.gov.br',perfil: 'SERVIDOR', grupo: 'Pagamentos',           regime: 'PRESENCIAL', admissao: '2017-11-10' },
  { matricula: '100007', nome: 'Gabriela Pinto Rocha',   email: 'gabriela.rocha@orgao.gov.br',perfil: 'SERVIDOR', grupo: 'Pagamentos',           regime: 'INTEGRAL',   admissao: '2022-07-04' },
];

const SENHA_PADRAO = 'produtividade2026';

async function limpar(): Promise<void> {
  await pool.query(`
    TRUNCATE fechamento_servidores, fechamento_grupos, fechamentos,
             lancamentos, ausencias, auditoria, sessoes RESTART IDENTITY CASCADE
  `);
  await pool.query('UPDATE setores SET chefe_servidor_id = NULL');
  await pool.query('DELETE FROM servidores');
  await pool.query('DELETE FROM grupos');
  await pool.query('DELETE FROM setores');
  await pool.query('DELETE FROM feriados');
  await pool.query('ALTER SEQUENCE setores_id_seq RESTART WITH 1');
  await pool.query('ALTER SEQUENCE grupos_id_seq RESTART WITH 1');
  await pool.query('ALTER SEQUENCE servidores_id_seq RESTART WITH 1');
}

async function semear(): Promise<void> {
  await aplicarMigracoes();

  if (process.argv.includes('--recriar')) {
    console.log('Limpando dados existentes...');
    await limpar();
  }

  const jaTem = await pool.query('SELECT 1 FROM servidores LIMIT 1');
  if (jaTem.rowCount) {
    console.log(
      'O banco ja possui servidores cadastrados. Rode "npm run semear -- --recriar" para recomeçar do zero.',
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
    `INSERT INTO setores (nome, sigla) VALUES ($1, $2) RETURNING id`,
    ['Divisao de Contratos e Pagamentos', 'DICOP'],
  );
  const setorId = setor.rows[0].id;

  const grupos = new Map<string, number>();
  for (const [nome, descricao, meta] of [
    ['Analise de contratos', 'Instrucao e analise de processos de contratacao.', null],
    ['Pagamentos', 'Liquidacao e pagamento de notas fiscais.', 0.55],
  ] as Array<[string, string, number | null]>) {
    const grupo = await pool.query<{ id: number }>(
      `INSERT INTO grupos (setor_id, nome, descricao, meta_referencia, meta_definida_em)
       VALUES ($1, $2, $3, $4, CASE WHEN $4::numeric IS NULL THEN NULL ELSE now() END)
       RETURNING id`,
      [setorId, nome, descricao, meta],
    );
    grupos.set(nome, grupo.rows[0].id);
  }
  console.log(`Grupos cadastrados: ${grupos.size}`);

  const senhaHash = await gerarHashDeSenha(SENHA_PADRAO);
  const idsPorMatricula = new Map<string, number>();

  for (const pessoa of SERVIDORES) {
    const inserido = await pool.query<{ id: number }>(
      `INSERT INTO servidores
         (matricula, nome, email, senha_hash, setor_id, grupo_id, perfil, regime, data_admissao)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        pessoa.matricula,
        pessoa.nome,
        pessoa.email,
        senhaHash,
        setorId,
        pessoa.grupo ? grupos.get(pessoa.grupo) : null,
        pessoa.perfil,
        pessoa.regime,
        pessoa.admissao,
      ],
    );
    idsPorMatricula.set(pessoa.matricula, inserido.rows[0].id);
  }

  await pool.query('UPDATE setores SET chefe_servidor_id = $1 WHERE id = $2', [
    idsPorMatricula.get('100002'),
    setorId,
  ]);
  console.log(`Servidores cadastrados: ${SERVIDORES.length}`);

  // Ausencias: ferias que zeram a apuracao de um servidor e uma licenca parcial.
  await pool.query(
    `INSERT INTO ausencias (servidor_id, tipo, data_inicio, data_fim, observacao, criado_por)
     VALUES ($1, 'FERIAS', '2026-08-01', '2026-08-31', 'Ferias regulamentares do mes inteiro', $2),
            ($3, 'LICENCA', '2026-08-10', '2026-08-14', 'Licenca para tratamento de saude', $2)`,
    [idsPorMatricula.get('100007'), idsPorMatricula.get('100002'), idsPorMatricula.get('100005')],
  );
  console.log('Ausencias cadastradas: 2');

  const pesos = new Map<string, number>();
  const linhasParametros = await pool.query<{ chave: string; valor: number }>(
    'SELECT chave, valor FROM parametros',
  );
  for (const linha of linhasParametros.rows) pesos.set(linha.chave, Number(linha.valor));
  const pesoDoPapel = (papel: string) =>
    pesos.get(`PESO_${papel}`) ?? (papel === 'EXECUCAO' ? 100 : papel === 'REVISAO' ? 40 : 20);

  const chefeId = idsPorMatricula.get('100002')!;
  const feriados = new Set(FERIADOS_2026.map(([data]) => data));

  // Volume mensal por servidor. Os niveis giram em ciclo para render uma
  // distribuicao plausivel entre 1 e 4, sem sorteio: o seed precisa ser
  // reproduzivel para conferir os numeros a mao.
  const PRODUCAO: Record<string, { porMes: number; niveis: number[]; prefixo: number }> = {
    '100002': { porMes: 4, niveis: [2, 3, 2], prefixo: 860 },
    '100003': { porMes: 11, niveis: [3, 2, 4, 2, 3, 1], prefixo: 861 },
    '100004': { porMes: 9, niveis: [2, 3, 2, 1, 3], prefixo: 862 },
    '100005': { porMes: 10, niveis: [1, 2, 1, 2, 3], prefixo: 863 },
    '100006': { porMes: 12, niveis: [2, 1, 3, 1, 2], prefixo: 864 },
    '100007': { porMes: 10, niveis: [2, 1, 2, 3], prefixo: 865 },
  };

  const DESCRICOES = [
    'Analise de habilitacao e minuta contratual',
    'Instrucao de aditivo de prazo',
    'Conferencia documental e juntada',
    'Analise de renovacao contratual',
    'Liquidacao de nota fiscal',
    'Conferencia de retencoes',
    'Regularizacao de pagamento com glosa',
    'Contratacao direta com parecer da assessoria',
  ];

  interface LancamentoSemente {
    servidorId: number;
    processo: string;
    nivel: number;
    papel: 'EXECUCAO' | 'REVISAO' | 'HOMOLOGACAO';
    conclusao: string;
    descricao: string;
  }

  const semente: LancamentoSemente[] = [];

  for (const competencia of ['2026-07-01', '2026-08-01']) {
    const uteis = listarDiasDoMes(competencia).filter((dia) => ehDiaUtil(dia, feriados));
    const mes = Number(competencia.slice(5, 7));

    for (const [matricula, plano] of Object.entries(PRODUCAO)) {
      // Gabriela esta de ferias em agosto: nao produz nada na competencia.
      if (matricula === '100007' && competencia === '2026-08-01') continue;
      const servidorId = idsPorMatricula.get(matricula)!;
      for (let indice = 0; indice < plano.porMes; indice += 1) {
        // Espalha os lancamentos ao longo dos dias uteis do mes.
        const dia = uteis[Math.floor((indice * uteis.length) / plano.porMes)];
        const nivel = plano.niveis[indice % plano.niveis.length];
        const processo = `${plano.prefixo}${String(mes * 100 + indice).padStart(3, '0')}/2026`;
        semente.push({
          servidorId,
          processo,
          nivel,
          papel: 'EXECUCAO',
          conclusao: dia,
          descricao: DESCRICOES[(indice + mes) % DESCRICOES.length],
        });

        // Um em cada quatro processos passa por revisao de um colega e por
        // homologacao da chefia: e assim que o mesmo processo gera ate tres
        // lancamentos e o total de pontos sobe sem entrega adicional.
        if (indice % 4 === 0) {
          const revisor = matricula === '100003' ? '100004' : '100003';
          const diaRevisao = uteis[Math.min(uteis.length - 1, uteis.indexOf(dia) + 1)];
          semente.push({
            servidorId: idsPorMatricula.get(revisor)!,
            processo,
            nivel,
            papel: 'REVISAO',
            conclusao: diaRevisao,
            descricao: 'Revisao do processo instruido pelo colega',
          });
          semente.push({
            servidorId: chefeId,
            processo,
            nivel,
            papel: 'HOMOLOGACAO',
            conclusao: diaRevisao,
            descricao: 'Homologacao do processo',
          });
        }
      }
    }
  }

  // A competencia anterior chega toda validada; o mes corrente deixa fila.
  const CORTE_VALIDACAO = '2026-08-20';
  let inseridos = 0;
  let pendentes = 0;

  for (const item of semente) {
    const percentual = pesoDoPapel(item.papel);
    const jaValidado = item.conclusao < CORTE_VALIDACAO;
    if (!jaValidado) pendentes += 1;
    const resultado = await pool.query(
      `INSERT INTO lancamentos
         (servidor_id, processo, descricao, nivel, papel, quantidade, data_conclusao,
          status, situacao, nivel_aplicado, percentual_papel, criado_por,
          validado_por, validado_em)
       VALUES ($1, $2, $3, $4, $5, 1, $6, 'CONCLUIDO', $7, $4, $8, $1, $9, $10)
       ON CONFLICT DO NOTHING`,
      [
        item.servidorId,
        item.processo,
        item.descricao,
        item.nivel,
        item.papel,
        item.conclusao,
        jaValidado ? 'VALIDADO' : 'PENDENTE',
        percentual,
        jaValidado ? chefeId : null,
        jaValidado ? `${item.conclusao} 17:00:00-03` : null,
      ],
    );
    inseridos += resultado.rowCount ?? 0;
  }

  // Um lancamento devolvido, para a tela do servidor mostrar a justificativa.
  await pool.query(
    `INSERT INTO lancamentos
       (servidor_id, processo, descricao, nivel, papel, quantidade, data_conclusao,
        status, situacao, nivel_aplicado, percentual_papel, criado_por,
        justificativa, validado_por, validado_em, nivel_original)
     VALUES ($1, '861899/2026', 'Conferencia de planilha de custos', 4, 'EXECUCAO', 1,
             '2026-08-13', 'CONCLUIDO', 'DEVOLVIDO', 4, 100, $1,
             'O processo seguiu o rito padrao, sem retencao ou consulta juridica. Reclassifique como nivel 2.',
             $2, '2026-08-14 15:20:00-03', NULL)`,
    [idsPorMatricula.get('100004'), chefeId],
  );

  // Um lancamento em andamento, que aparece no painel mas fica fora da media.
  await pool.query(
    `INSERT INTO lancamentos
       (servidor_id, processo, descricao, nivel, papel, quantidade, data_conclusao,
        periodo_inicio, status, situacao, nivel_aplicado, percentual_papel, criado_por)
     VALUES ($1, '861950/2026', 'Analise em curso, aguardando parecer juridico', 3, 'EXECUCAO', 1,
             '2026-08-31', '2026-08-20', 'EM_ANDAMENTO', 'PENDENTE', 3, 100, $1)`,
    [idsPorMatricula.get('100003')],
  );

  const total = inseridos + 2;
  console.log(`Lancamentos cadastrados: ${total} (${pendentes} aguardando validacao)`);
  console.log(
    [
      '',
      'Dados de acesso (todos com a mesma senha):',
      `  senha: ${SENHA_PADRAO}`,
      '  100001  Ana Ribeiro Alves      ADMIN',
      '  100002  Carlos Menezes Prado   CHEFE',
      '  100003  Beatriz Souza Lima     SERVIDOR',
      '  100005  Elaine Castro Moreira  SERVIDOR (com licenca em agosto)',
      '  100007  Gabriela Pinto Rocha   SERVIDOR (ferias o mes inteiro: SEM_APURACAO)',
      '',
      `Pontos conferidos pelo nucleo de calculo: nivel 3 em revisao vale ${calcularPontos(3, 1, 40)}.`,
    ].join('\n'),
  );
}

semear()
  .catch((erro) => {
    console.error('Falha ao semear:', erro);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
