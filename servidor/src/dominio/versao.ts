/**
 * Identificacao da versao que esta no ar.
 *
 * O numero em package.json muda quando alguma coisa muda de verdade, mas
 * depender so dele nao responde a pergunta que a Coordenacao faz na pratica:
 * "o que eu pedi ja subiu?". Por isso a marca carrega tambem a data da
 * publicacao e o commit — esses mudam a cada deploy, sem ninguem lembrar de
 * nada.
 */
export interface Versao {
  numero: string;
  commit: string | null;
  publicado_em: string | null;
}

/** "1.1 · 28/08 às 23:40" — o que aparece no rodape do menu. */
export function versaoLegivel(versao: Versao): string {
  if (!versao.publicado_em) return versao.numero;
  const data = new Date(versao.publicado_em);
  if (Number.isNaN(data.getTime())) return versao.numero;

  const quando = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(data);

  return `${versao.numero} · ${quando.replace(', ', ' às ')}`;
}
