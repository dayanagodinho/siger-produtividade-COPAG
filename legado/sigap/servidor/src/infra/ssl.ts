/**
 * Decide se a conexao com o PostgreSQL usa TLS.
 *
 * A hospedagem do Railway liga o aplicativo ao banco pela rede interna do
 * projeto (`...railway.internal`), que ja e privada e nao atende em TLS:
 * exigir SSL ali derruba a conexao logo na subida. Fora dela — banco publico,
 * endereco de proxy, qualquer servidor de terceiro — o TLS e obrigatorio.
 *
 * A ordem de decisao e sempre da vontade explicita para o palpite:
 * 1. DATABASE_SSL, quando alguem quer mandar na mao;
 * 2. o `sslmode` escrito na propria URL;
 * 3. o endereco: rede interna e maquina local dispensam TLS;
 * 4. o ambiente: em producao, TLS.
 */
export type OpcaoSsl = { rejectUnauthorized: boolean } | undefined;

const SEM_TLS = ['localhost', '127.0.0.1', '::1'];

export function definirSsl(url: string, producao: boolean, escolha?: string): OpcaoSsl {
  const pedido = escolha?.trim().toLowerCase();
  if (pedido === 'true' || pedido === 'require') return { rejectUnauthorized: false };
  if (pedido === 'false' || pedido === 'disable') return undefined;

  const modo = /[?&]sslmode=([a-z-]+)/i.exec(url)?.[1]?.toLowerCase();
  if (modo === 'disable') return undefined;
  if (modo) return { rejectUnauthorized: false };

  const anfitriao = hospedeiro(url);
  if (SEM_TLS.includes(anfitriao) || anfitriao.endsWith('.internal')) return undefined;

  return producao ? { rejectUnauthorized: false } : undefined;
}

function hospedeiro(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}
