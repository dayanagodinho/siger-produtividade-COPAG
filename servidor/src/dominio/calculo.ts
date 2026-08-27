/**
 * Nucleo de calculo da produtividade. Tudo aqui e funcao pura: nao acessa
 * banco, nao le relogio e nao depende de requisicao. O calculo oficial roda
 * exclusivamente no servidor.
 */

export type Papel = 'EXECUCAO' | 'REVISAO' | 'HOMOLOGACAO';
export type SituacaoValidacao = 'PENDENTE' | 'VALIDADO' | 'DEVOLVIDO';
export type StatusLancamento = 'EM_ANDAMENTO' | 'CONCLUIDO';
export type Faixa = 'ABAIXO' | 'DENTRO' | 'ACIMA';
export type OrigemReferencia = 'META_FIXA' | 'MEDIANA_APURADA' | 'INDISPONIVEL';
export type SituacaoApuracao = 'APURADO' | 'SEM_APURACAO';

export interface PesosPorPapel {
  EXECUCAO: number;
  REVISAO: number;
  HOMOLOGACAO: number;
}

export interface LimitesDeFaixa {
  abaixo: number; // percentual; abaixo disso e "Abaixo da referencia"
  acima: number;  // percentual; acima disso e "Acima da referencia"
}

export const PESOS_PADRAO: PesosPorPapel = { EXECUCAO: 100, REVISAO: 40, HOMOLOGACAO: 20 };
export const LIMITES_PADRAO: LimitesDeFaixa = { abaixo: 85, acima: 115 };

export function arredondar(valor: number, casas = 4): number {
  const fator = 10 ** casas;
  return Math.round((valor + Number.EPSILON) * fator) / fator;
}

export function percentualDoPapel(papel: Papel, pesos: PesosPorPapel): number {
  return pesos[papel];
}

/** Regra 2.5: pontos = nivel x quantidade x percentual do papel. */
export function calcularPontos(nivel: number, quantidade: number, percentualPapel: number): number {
  return arredondar((nivel * quantidade * percentualPapel) / 100);
}

/** Mediana de uma lista. Devolve null para lista vazia. */
export function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 1
    ? arredondar(ordenados[meio])
    : arredondar((ordenados[meio - 1] + ordenados[meio]) / 2);
}

export function mediaSimples(valores: number[]): number | null {
  if (valores.length === 0) return null;
  return arredondar(valores.reduce((soma, valor) => soma + valor, 0) / valores.length);
}

export function faixaDeAtingimento(
  atingimento: number,
  limites: LimitesDeFaixa = LIMITES_PADRAO,
): Faixa {
  const percentual = atingimento * 100;
  if (percentual < limites.abaixo) return 'ABAIXO';
  if (percentual > limites.acima) return 'ACIMA';
  return 'DENTRO';
}

export const ROTULO_DA_FAIXA: Record<Faixa, string> = {
  ABAIXO: 'Abaixo da referência',
  DENTRO: 'Dentro da referência',
  ACIMA: 'Acima da referência',
};

// ---------------------------------------------------------------------------
// Apuracao individual
// ---------------------------------------------------------------------------

export interface LancamentoParaApuracao {
  servidor_id: number;
  processo: string | null;
  papel: Papel;
  status: StatusLancamento;
  situacao: SituacaoValidacao;
  pontos: number;
  nivel: number;
}

export interface ApuracaoServidor {
  servidor_id: number;
  situacao: SituacaoApuracao;
  pontos_total: number;
  pontos_base: number;
  pontos_pendentes: number;
  dias_uteis: number;
  dias_ausencia: number;
  dias_efetivos: number;
  media: number | null;
  media_base: number | null;
  lancamentos_validados: number;
  lancamentos_pendentes: number;
  lancamentos_em_andamento: number;
}

/** Regra 2.2: so lancamento CONCLUIDO e VALIDADO entra na media oficial. */
export function pontuaNaMedia(lancamento: LancamentoParaApuracao): boolean {
  return lancamento.status === 'CONCLUIDO' && lancamento.situacao === 'VALIDADO';
}

/**
 * Regra 5.1 e 4: media = pontos validados e concluidos / dias efetivos.
 * Com dias efetivos igual a zero o servidor fica SEM_APURACAO e nunca zerado.
 */
export function apurarServidor(
  servidorId: number,
  lancamentos: LancamentoParaApuracao[],
  diasUteis: number,
  diasAusencia: number,
): ApuracaoServidor {
  const meus = lancamentos.filter((lancamento) => lancamento.servidor_id === servidorId);
  const diasEfetivos = Math.max(0, diasUteis - diasAusencia);

  let pontosTotal = 0;
  let pontosBase = 0;
  let pontosPendentes = 0;
  let validados = 0;
  let pendentes = 0;
  let emAndamento = 0;

  for (const lancamento of meus) {
    if (lancamento.status === 'EM_ANDAMENTO') {
      emAndamento += 1;
      continue;
    }
    if (pontuaNaMedia(lancamento)) {
      validados += 1;
      pontosTotal += lancamento.pontos;
      // Regra 5.4: homologacao conta para o individuo, mas fica fora da base
      // que forma a referencia do grupo.
      if (lancamento.papel !== 'HOMOLOGACAO') pontosBase += lancamento.pontos;
    } else if (lancamento.situacao === 'PENDENTE') {
      pendentes += 1;
      pontosPendentes += lancamento.pontos;
    }
  }

  const semApuracao = diasEfetivos === 0;

  return {
    servidor_id: servidorId,
    situacao: semApuracao ? 'SEM_APURACAO' : 'APURADO',
    pontos_total: arredondar(pontosTotal),
    pontos_base: arredondar(pontosBase),
    pontos_pendentes: arredondar(pontosPendentes),
    dias_uteis: diasUteis,
    dias_ausencia: diasAusencia,
    dias_efetivos: diasEfetivos,
    media: semApuracao ? null : arredondar(pontosTotal / diasEfetivos),
    media_base: semApuracao ? null : arredondar(pontosBase / diasEfetivos),
    lancamentos_validados: validados,
    lancamentos_pendentes: pendentes,
    lancamentos_em_andamento: emAndamento,
  };
}

// ---------------------------------------------------------------------------
// Referencia do grupo
// ---------------------------------------------------------------------------

export interface ReferenciaDoGrupo {
  referencia: number | null;
  origem: OrigemReferencia;
  servidores_considerados: number;
}

/**
 * Regra 5.2. Meta fixa quando o grupo tem meta_referencia preenchida;
 * senao mediana das medias dos servidores apurados no mes.
 */
export function calcularReferenciaDoGrupo(
  metaFixa: number | null | undefined,
  mediasBaseDosServidores: (number | null)[],
): ReferenciaDoGrupo {
  const consideradas = mediasBaseDosServidores.filter(
    (media): media is number => media !== null && media !== undefined,
  );

  if (metaFixa !== null && metaFixa !== undefined && metaFixa > 0) {
    return {
      referencia: arredondar(metaFixa),
      origem: 'META_FIXA',
      servidores_considerados: consideradas.length,
    };
  }

  const apurada = mediana(consideradas);
  return {
    referencia: apurada,
    origem: apurada === null ? 'INDISPONIVEL' : 'MEDIANA_APURADA',
    servidores_considerados: consideradas.length,
  };
}

export function calcularAtingimento(
  media: number | null,
  referencia: number | null,
): number | null {
  if (media === null || referencia === null || referencia === 0) return null;
  return arredondar(media / referencia);
}

// ---------------------------------------------------------------------------
// Apuracao do setor
// ---------------------------------------------------------------------------

export interface ApuracaoSetor {
  media_oficial: number | null;
  media_contraprova: number | null;
  total_pontos: number;
  total_dias_efetivos: number;
  processos_distintos: number;
  servidores_apurados: number;
  servidores_sem_apuracao: number;
}

/** Regra 5.5: media oficial e a media simples das medias; contraprova e a razao dos totais. */
export function apurarSetor(
  apuracoes: ApuracaoServidor[],
  lancamentos: LancamentoParaApuracao[],
): ApuracaoSetor {
  const apurados = apuracoes.filter((apuracao) => apuracao.situacao === 'APURADO');
  const totalPontos = apurados.reduce((soma, apuracao) => soma + apuracao.pontos_total, 0);
  const totalDias = apurados.reduce((soma, apuracao) => soma + apuracao.dias_efetivos, 0);

  // Lancamento sem numero de processo nao entra na contagem de distintos:
  // ele nao identifica uma entrega que possa ser contada uma vez so.
  const processos = new Set(
    lancamentos
      .filter(pontuaNaMedia)
      .map((lancamento) => lancamento.processo?.trim().toUpperCase())
      .filter((processo): processo is string => Boolean(processo)),
  );

  return {
    media_oficial: mediaSimples(
      apurados.map((apuracao) => apuracao.media).filter((media): media is number => media !== null),
    ),
    media_contraprova: totalDias === 0 ? null : arredondar(totalPontos / totalDias),
    total_pontos: arredondar(totalPontos),
    total_dias_efetivos: totalDias,
    processos_distintos: processos.size,
    servidores_apurados: apurados.length,
    servidores_sem_apuracao: apuracoes.length - apurados.length,
  };
}

// ---------------------------------------------------------------------------
// Distribuicao de niveis e taxa de correcao (painel do setor)
// ---------------------------------------------------------------------------

export function distribuirNiveis(lancamentos: LancamentoParaApuracao[]): Record<number, number> {
  const distribuicao: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const lancamento of lancamentos) {
    if (lancamento.nivel >= 1 && lancamento.nivel <= 4) distribuicao[lancamento.nivel] += 1;
  }
  return distribuicao;
}

/** Regra 3: percentual de lancamentos avaliados que a chefia teve de corrigir. */
export function taxaDeCorrecao(avaliados: number, corrigidos: number): number | null {
  if (avaliados === 0) return null;
  return arredondar(corrigidos / avaliados);
}
