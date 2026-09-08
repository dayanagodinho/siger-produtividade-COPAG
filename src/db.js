const { Pool, types } = require('pg');

const conexao = process.env.DATABASE_URL;
if (!conexao) {
  console.error('DATABASE_URL nao definida. Copie .env.example para .env ou configure a variavel no Railway.');
}

// O Escala Hibrida mora num schema proprio dentro do Postgres que era do SIGAP.
// O SIGAP tem tabelas `servidores` e `feriados` com outras colunas; no mesmo
// schema, uma passaria por cima da outra. Com search_path fixo no schema
// `escala`, as tabelas antigas ficam intactas e invisiveis para este app.
const SCHEMA = (process.env.DB_SCHEMA || 'escala').replace(/[^a-z0-9_]/gi, '');

// DATE (oid 1082) chega como texto 'YYYY-MM-DD', e nao como Date em fuso local.
// Sem isto, um servidor em fuso positivo devolveria o dia anterior ao converter
// a Date para ISO, e a escala inteira andaria um dia para tras.
types.setTypeParser(1082, (valor) => valor);

const SEM_TLS = ['localhost', '127.0.0.1', '::1'];

/**
 * Mesma decisao de TLS do SIGAP, que ja rodou meses nesse Railway:
 * 1. DATABASE_SSL, quando alguem quer mandar na mao;
 * 2. o `sslmode` escrito na propria URL;
 * 3. o endereco: rede interna (*.internal) e maquina local dispensam TLS;
 * 4. o ambiente: em producao, TLS.
 * A versao anterior ligava TLS por regex em "railway" na URL — e a URL
 * interna do Railway (postgres.railway.internal) nao fala TLS.
 */
function definirSsl(url, producao, escolha) {
  const pedido = String(escolha || '').trim().toLowerCase();
  if (pedido === 'true' || pedido === 'require') return { rejectUnauthorized: false };
  if (pedido === 'false' || pedido === 'disable') return false;
  const modo = /[?&]sslmode=([a-z-]+)/i.exec(url || '')?.[1]?.toLowerCase();
  if (modo === 'disable') return false;
  if (modo) return { rejectUnauthorized: false };
  let anfitriao = '';
  try { anfitriao = new URL(url).hostname; } catch { /* URL quebrada: decide pelo ambiente */ }
  if (SEM_TLS.includes(anfitriao) || anfitriao.endsWith('.internal')) return false;
  return producao ? { rejectUnauthorized: false } : false;
}

const pool = new Pool({
  connectionString: conexao,
  ssl: definirSsl(conexao, process.env.NODE_ENV === 'production', process.env.DATABASE_SSL),
  max: 10,
});

// Toda conexao nova do pool nasce olhando so para o schema do app.
pool.on('connect', (cliente) => {
  cliente.query(`SET search_path TO ${SCHEMA}`).catch((e) => console.error('Falha ao fixar search_path:', e.message));
});

module.exports = {
  pool,
  SCHEMA,
  definirSsl,
  query: (texto, params) => pool.query(texto, params),
};
