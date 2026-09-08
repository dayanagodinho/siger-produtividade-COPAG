/**
 * Funcoes puras de calendario. Todas as datas trafegam como texto ISO
 * (AAAA-MM-DD) para nao sofrer deslocamento de fuso horario.
 */

export type DataIso = string;

const DIAS_DA_SEMANA_UTEIS = new Set([1, 2, 3, 4, 5]); // segunda a sexta

export function ehDataIso(valor: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(valor);
}

export function paraNumeroDeDias(data: DataIso): number {
  return Math.floor(Date.UTC(...decompor(data)) / 86400000);
}

function decompor(data: DataIso): [number, number, number] {
  const [ano, mes, dia] = data.split('-').map(Number);
  return [ano, mes - 1, dia];
}

export function formatarIso(instante: Date): DataIso {
  return instante.toISOString().slice(0, 10);
}

export function diaDaSemana(data: DataIso): number {
  return new Date(Date.UTC(...decompor(data))).getUTCDay();
}

export function ehDiaUtil(data: DataIso, feriados: Set<DataIso>): boolean {
  return DIAS_DA_SEMANA_UTEIS.has(diaDaSemana(data)) && !feriados.has(data);
}

/** Primeiro dia da competencia (mes de referencia) de uma data. */
export function competenciaDe(data: DataIso): DataIso {
  return `${data.slice(0, 7)}-01`;
}

export function primeiroDiaDoMes(competencia: DataIso): DataIso {
  return competenciaDe(competencia);
}

export function ultimoDiaDoMes(competencia: DataIso): DataIso {
  const [ano, mes] = competencia.split('-').map(Number);
  const ultimo = new Date(Date.UTC(ano, mes, 0));
  return formatarIso(ultimo);
}

export function listarDiasDoMes(competencia: DataIso): DataIso[] {
  const inicio = primeiroDiaDoMes(competencia);
  const fim = ultimoDiaDoMes(competencia);
  return listarIntervalo(inicio, fim);
}

export function listarIntervalo(inicio: DataIso, fim: DataIso): DataIso[] {
  const dias: DataIso[] = [];
  const primeiro = Date.UTC(...decompor(inicio));
  const ultimo = Date.UTC(...decompor(fim));
  for (let instante = primeiro; instante <= ultimo; instante += 86400000) {
    dias.push(formatarIso(new Date(instante)));
  }
  return dias;
}

/** Dias uteis do mes, descontados sabados, domingos e feriados. */
export function contarDiasUteisDoMes(competencia: DataIso, feriados: Iterable<DataIso>): number {
  const conjunto = new Set(feriados);
  return listarDiasDoMes(competencia).filter((dia) => ehDiaUtil(dia, conjunto)).length;
}

export interface Ausencia {
  data_inicio: DataIso;
  data_fim: DataIso;
}

/**
 * Dias uteis de ausencia dentro da competencia. Periodos sobrepostos sao
 * contados uma unica vez: duas licencas no mesmo dia nao descontam dois dias.
 */
export function contarDiasUteisDeAusencia(
  competencia: DataIso,
  ausencias: Ausencia[],
  feriados: Iterable<DataIso>,
): number {
  const conjuntoFeriados = new Set(feriados);
  const inicioMes = primeiroDiaDoMes(competencia);
  const fimMes = ultimoDiaDoMes(competencia);
  const ausentes = new Set<DataIso>();

  for (const ausencia of ausencias) {
    const inicio = ausencia.data_inicio > inicioMes ? ausencia.data_inicio : inicioMes;
    const fim = ausencia.data_fim < fimMes ? ausencia.data_fim : fimMes;
    if (inicio > fim) continue;
    for (const dia of listarIntervalo(inicio, fim)) {
      if (ehDiaUtil(dia, conjuntoFeriados)) ausentes.add(dia);
    }
  }

  return ausentes.size;
}

export function competenciaAtual(hoje: Date = new Date()): DataIso {
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`;
}

export function rotularCompetencia(competencia: DataIso): string {
  const meses = [
    'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];
  const [ano, mes] = competencia.split('-').map(Number);
  return `${meses[mes - 1]} de ${ano}`;
}
