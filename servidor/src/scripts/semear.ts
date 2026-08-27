import { pool } from '../infra/banco';
import { gerarHashDeSenha } from '../infra/senha';
import { aplicarMigracoes } from './migrar';
import { calcularPontos } from '../dominio/calculo';

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
  { matricula: '100001', nome: 'Ana Ribeiro Alves',      email: 'ana.alves@orgao.gov.br',     perfil: 'ADMIN',    grupo: 'Analise de contratos', regime: 'INTEGRAL',   admissao: '2018-03-12' },
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
    ['Pagamentos', 'Liquidacao e pagamento de notas fiscais.', 2.2],
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

  type Semeadura = [string, string, number, 'EXECUCAO' | 'REVISAO' | 'HOMOLOGACAO', string, string];
  const lancamentos: Semeadura[] = [
    // matricula, processo, nivel, papel, data_conclusao, descricao
    ['100003', '856481/2026', 3, 'EXECUCAO', '2026-07-08', 'Analise de habilitacao e minuta contratual'],
    ['100003', '856502/2026', 2, 'EXECUCAO', '2026-07-15', 'Instrucao de aditivo de prazo'],
    ['100003', '856517/2026', 4, 'EXECUCAO', '2026-07-29', 'Contratacao direta com parecer da assessoria'],
    ['100004', '856481/2026', 3, 'REVISAO',  '2026-07-10', 'Revisao da minuta contratual'],
    ['100004', '856533/2026', 2, 'EXECUCAO', '2026-07-21', 'Analise de renovacao'],
    ['100002', '856481/2026', 3, 'HOMOLOGACAO', '2026-07-11', 'Homologacao do processo'],
    ['100005', '901220/2026', 1, 'EXECUCAO', '2026-07-06', 'Liquidacao de nota fiscal'],
    ['100005', '901221/2026', 2, 'EXECUCAO', '2026-07-20', 'Conferencia de retencoes'],
    ['100006', '901230/2026', 3, 'EXECUCAO', '2026-07-23', 'Regularizacao de pagamento com glosa'],

    ['100003', '857001/2026', 3, 'EXECUCAO', '2026-08-05', 'Analise de contratacao de servico continuado'],
    ['100003', '857014/2026', 2, 'EXECUCAO', '2026-08-12', 'Aditivo de reajuste'],
    ['100003', '857020/2026', 1, 'EXECUCAO', '2026-08-19', 'Juntada e conferencia documental'],
    ['100004', '857001/2026', 3, 'REVISAO',  '2026-08-07', 'Revisao da analise'],
    ['100004', '857033/2026', 4, 'EXECUCAO', '2026-08-24', 'Processo com impugnacao e consulta juridica'],
    ['100004', '857040/2026', 2, 'EXECUCAO', '2026-08-26', 'Instrucao de prorrogacao'],
    ['100002', '857001/2026', 3, 'HOMOLOGACAO', '2026-08-10', 'Homologacao do processo'],
    ['100002', '857100/2026', 2, 'EXECUCAO', '2026-08-18', 'Despacho de encaminhamento e analise'],
    ['100005', '902110/2026', 2, 'EXECUCAO', '2026-08-06', 'Liquidacao com retencao previdenciaria'],
    ['100005', '902118/2026', 1, 'EXECUCAO', '2026-08-25', 'Pagamento de servico contratado'],
    ['100006', '902130/2026', 3, 'EXECUCAO', '2026-08-11', 'Ajuste de empenho e reprocessamento'],
    ['100006', '902141/2026', 2, 'EXECUCAO', '2026-08-21', 'Conferencia de planilha de custos'],
  ];

  const chefeId = idsPorMatricula.get('100002')!;

  for (const [matricula, processo, nivel, papel, conclusao, descricao] of lancamentos) {
    const servidorId = idsPorMatricula.get(matricula)!;
    const percentual = pesoDoPapel(papel);
    // Competencias fechadas ja nascem validadas; o mes corrente fica com fila.
    const jaValidado = conclusao < '2026-08-01' || conclusao <= '2026-08-19';
    await pool.query(
      `INSERT INTO lancamentos
         (servidor_id, processo, descricao, nivel, papel, quantidade, data_conclusao,
          status, situacao, nivel_aplicado, percentual_papel, criado_por,
          validado_por, validado_em)
       VALUES ($1, $2, $3, $4, $5, 1, $6, 'CONCLUIDO', $7, $4, $8, $1, $9, $10)`,
      [
        servidorId,
        processo,
        descricao,
        nivel,
        papel,
        conclusao,
        jaValidado ? 'VALIDADO' : 'PENDENTE',
        percentual,
        jaValidado ? chefeId : null,
        jaValidado ? `${conclusao} 17:00:00-03` : null,
      ],
    );
  }

  // Um lancamento em andamento, que aparece no painel mas fica fora da media.
  await pool.query(
    `INSERT INTO lancamentos
       (servidor_id, processo, descricao, nivel, papel, quantidade, data_conclusao,
        periodo_inicio, status, situacao, nivel_aplicado, percentual_papel, criado_por)
     VALUES ($1, '857055/2026', 'Analise em curso, aguardando parecer', 3, 'EXECUCAO', 1,
             '2026-08-31', '2026-08-20', 'EM_ANDAMENTO', 'PENDENTE', 3, 100, $1)`,
    [idsPorMatricula.get('100003')],
  );

  const total = lancamentos.length + 1;
  console.log(`Lancamentos cadastrados: ${total}`);
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
