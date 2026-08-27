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
}

const SERVIDORES: ServidorSemente[] = [
  { matricula: '100001', nome: 'Ana Ribeiro Alves',      email: 'ana.alves@orgao.gov.br',     perfil: 'ADMIN',    grupo: null, regime: 'INTEGRAL',   admissao: '2018-03-12' },
  { matricula: '100002', nome: 'Carlos Menezes Prado',   email: 'carlos.prado@orgao.gov.br',  perfil: 'CHEFE',    grupo: 'Análise de contratos', regime: 'INTEGRAL',   admissao: '2015-08-01' },
  { matricula: '100003', nome: 'Beatriz Souza Lima',     email: 'beatriz.lima@orgao.gov.br',  perfil: 'SERVIDOR', grupo: 'Análise de contratos', regime: 'INTEGRAL',   admissao: '2019-05-20' },
  { matricula: '100004', nome: 'Diego Fontes Araujo',    email: 'diego.araujo@orgao.gov.br',  perfil: 'SERVIDOR', grupo: 'Análise de contratos', regime: 'INTEGRAL',   admissao: '2021-02-15' },
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
  await pool.query('DELETE FROM tarefas');
  await pool.query('ALTER SEQUENCE tarefas_id_seq RESTART WITH 1');
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
    `INSERT INTO setores (nome, sigla) VALUES ($1, $2) RETURNING id`,
    ['Divisão de Contratos e Pagamentos', 'DICOP'],
  );
  const setorId = setor.rows[0].id;

  const grupos = new Map<string, number>();
  for (const [nome, descricao, meta] of [
    ['Análise de contratos', 'Instrução e análise de processos de contratação.', null],
    ['Pagamentos', 'Liquidação e pagamento de notas fiscais.', 0.55],
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

  // Catalogo de tarefas por grupo: e dele que sai o nivel sugerido no lancamento.
  const TAREFAS: Record<string, Array<[string, number, string]>> = {
    'Análise de contratos': [
      ['Conferência documental e juntada', 1, 'Recebimento, conferência e juntada de documentos ao processo.'],
      ['Instrução de aditivo de prazo', 2, 'Instrução de prorrogação contratual sem alteração de valor.'],
      ['Análise de renovação contratual', 2, 'Verificação de vantajosidade e regularidade para renovar.'],
      ['Análise de habilitação e minuta', 3, 'Exame de habilitação e elaboração ou revisão da minuta.'],
      ['Contratação direta com parecer', 4, 'Dispensa ou inexigibilidade que exige consulta à assessoria jurídica.'],
    ],
    Pagamentos: [
      ['Liquidação de nota fiscal', 1, 'Ateste e liquidação de nota fiscal sem intercorrência.'],
      ['Conferência de retenções', 2, 'Conferência de retenções tributárias e previdenciárias.'],
      ['Conferência de planilha de custos', 2, 'Verificação da planilha de formação de preços do contrato.'],
      ['Regularização de pagamento com glosa', 3, 'Apuração de glosa e recomposição do valor a pagar.'],
      ['Ajuste de empenho e reprocessamento', 3, 'Correção de empenho e reprocessamento do pagamento.'],
    ],
  };

  const tarefasPorGrupo = new Map<string, Array<{ id: number; nome: string; nivel: number }>>();
  let totalTarefas = 0;
  for (const [nomeGrupo, lista] of Object.entries(TAREFAS)) {
    const doGrupo: Array<{ id: number; nome: string; nivel: number }> = [];
    for (const [nome, nivel, descricao] of lista) {
      const inserida = await pool.query<{ id: number }>(
        `INSERT INTO tarefas (grupo_id, nome, descricao, nivel_sugerido)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [grupos.get(nomeGrupo), nome, descricao, nivel],
      );
      doGrupo.push({ id: inserida.rows[0].id, nome, nivel });
      totalTarefas += 1;
    }
    tarefasPorGrupo.set(nomeGrupo, doGrupo);
  }
  console.log(`Tarefas cadastradas: ${totalTarefas}`);

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
     VALUES ($1, 'FERIAS', '2026-08-01', '2026-08-31', 'Férias regulamentares do mês inteiro', $2),
            ($3, 'LICENCA', '2026-08-10', '2026-08-14', 'Licença para tratamento de saúde', $2)`,
    [idsPorMatricula.get('100007'), idsPorMatricula.get('100002'), idsPorMatricula.get('100005')],
  );
  console.log('Ausências cadastradas: 2');

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
  const PRODUCAO: Record<string, { porMes: number; ordem: number[]; prefixo: number }> = {
    '100002': { porMes: 4, ordem: [1, 3, 1], prefixo: 860 },
    '100003': { porMes: 11, ordem: [3, 1, 4, 1, 3, 0], prefixo: 861 },
    '100004': { porMes: 9, ordem: [1, 3, 2, 0, 3], prefixo: 862 },
    '100005': { porMes: 10, ordem: [0, 1, 0, 2, 3], prefixo: 863 },
    '100006': { porMes: 12, ordem: [1, 0, 3, 0, 2], prefixo: 864 },
    '100007': { porMes: 10, ordem: [1, 0, 2, 4], prefixo: 865 },
  };

  const grupoDoServidor = new Map(SERVIDORES.map((s) => [s.matricula, s.grupo]));

  interface LancamentoSemente {
    servidorId: number;
    processo: string;
    nivel: number;
    papel: 'EXECUCAO' | 'REVISAO' | 'HOMOLOGACAO';
    conclusao: string;
    descricao: string;
    tarefaId: number | null;
  }

  const semente: LancamentoSemente[] = [];

  for (const competencia of ['2026-07-01', '2026-08-01']) {
    const uteis = listarDiasDoMes(competencia).filter((dia) => ehDiaUtil(dia, feriados));
    const mes = Number(competencia.slice(5, 7));

    for (const [matricula, plano] of Object.entries(PRODUCAO)) {
      // Gabriela esta de ferias em agosto: nao produz nada na competencia.
      if (matricula === '100007' && competencia === '2026-08-01') continue;
      const servidorId = idsPorMatricula.get(matricula)!;
      const catalogo = tarefasPorGrupo.get(grupoDoServidor.get(matricula) ?? '') ?? [];

      for (let indice = 0; indice < plano.porMes; indice += 1) {
        // Espalha os lancamentos ao longo dos dias uteis do mes.
        const dia = uteis[Math.floor((indice * uteis.length) / plano.porMes)];
        const tarefa = catalogo[plano.ordem[indice % plano.ordem.length] % catalogo.length];
        const nivel = tarefa.nivel;
        const processo = `${plano.prefixo}${String(mes * 100 + indice).padStart(3, '0')}/2026`;
        semente.push({
          servidorId,
          processo,
          nivel,
          papel: 'EXECUCAO',
          conclusao: dia,
          descricao: tarefa.nome,
          tarefaId: tarefa.id,
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
            descricao: `Revisão de: ${tarefa.nome}`,
            tarefaId: null,
          });
          semente.push({
            servidorId: chefeId,
            processo,
            nivel,
            papel: 'HOMOLOGACAO',
            conclusao: diaRevisao,
            descricao: `Homologação de: ${tarefa.nome}`,
            tarefaId: null,
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
          validado_por, validado_em, tarefa_id)
       VALUES ($1, $2, $3, $4, $5, 1, $6, 'CONCLUIDO', $7, $4, $8, $1, $9, $10, $11)
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
        item.tarefaId,
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
     VALUES ($1, '861899/2026', 'Conferência de planilha de custos', 4, 'EXECUCAO', 1,
             '2026-08-13', 'CONCLUIDO', 'DEVOLVIDO', 4, 100, $1,
             'O processo seguiu o rito padrão, sem retenção ou consulta jurídica. Reclassifique como nível 2.',
             $2, '2026-08-14 15:20:00-03', NULL)`,
    [idsPorMatricula.get('100004'), chefeId],
  );

  // Um lancamento em andamento, que aparece no painel mas fica fora da media.
  await pool.query(
    `INSERT INTO lancamentos
       (servidor_id, processo, descricao, nivel, papel, quantidade, data_conclusao,
        periodo_inicio, status, situacao, nivel_aplicado, percentual_papel, criado_por)
     VALUES ($1, '861950/2026', 'Análise em curso, aguardando parecer jurídico', 3, 'EXECUCAO', 1,
             '2026-08-31', '2026-08-20', 'EM_ANDAMENTO', 'PENDENTE', 3, 100, $1)`,
    [idsPorMatricula.get('100003')],
  );

  const total = inseridos + 2;
  console.log(`Lançamentos cadastrados: ${total} (${pendentes} aguardando validação)`);
  console.log(
    [
      '',
      'Dados de acesso (todos com a mesma senha):',
      `  senha: ${SENHA_PADRAO}`,
      '  100001  Ana Ribeiro Alves      ADMIN',
      '  100002  Carlos Menezes Prado   CHEFE',
      '  100003  Beatriz Souza Lima     SERVIDOR',
      '  100005  Elaine Castro Moreira  SERVIDOR (com licença em agosto)',
      '  100007  Gabriela Pinto Rocha   SERVIDOR (férias o mês inteiro: SEM_APURACAO)',
      '',
      `Pontos conferidos pelo núcleo de cálculo: nível 3 em revisão vale ${calcularPontos(3, 1, 40)}.`,
    ].join('\n'),
  );
}

semear()
  .catch((erro) => {
    console.error('Falha ao semear:', erro);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
