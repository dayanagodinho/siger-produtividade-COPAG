// Validacao de entrada. Cada porta que recebe data, hora ou numero passa por
// aqui ANTES de chegar ao banco: lixo vira 400 com motivo, nunca 500 generico.
//
// O caso: "data": "ontem" e "inicio": "abc" derrubavam a rota com "Erro
// interno no servidor" — e "ate": "abc" no repetir-semana virava laco infinito,
// porque '2026-09-15' > 'abc' e falso em comparacao de texto.

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_HORA = /^\d{2}:\d{2}$/;

function ehData(valor) {
  if (typeof valor !== 'string' || !RE_DATA.test(valor)) return false;
  const [a, m, d] = valor.split('-').map(Number);
  const data = new Date(Date.UTC(a, m - 1, d));
  return data.getUTCFullYear() === a && data.getUTCMonth() === m - 1 && data.getUTCDate() === d;
}

function ehHora(valor) {
  if (typeof valor !== 'string' || !RE_HORA.test(valor)) return false;
  const [h, m] = valor.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

// Aceita numero ou texto numerico; recusa NaN, Infinity, vazio e texto solto.
function numeroOuNulo(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = typeof valor === 'number' ? valor : Number(String(valor).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

function ehInteiro(valor, { min = -Infinity, max = Infinity } = {}) {
  const n = numeroOuNulo(valor);
  return Number.isInteger(n) && n >= min && n <= max;
}

function normalizarEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function ehEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizarEmail(email));
}

// Lista "1,2,3,4,5" -> [1,2,3,4,5]; qualquer item fora de 0..6 invalida tudo.
function diasUteisOuNulo(texto) {
  const partes = String(texto ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  if (!partes.length) return null;
  const dias = partes.map(Number);
  if (dias.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return null;
  return [...new Set(dias)].sort();
}

module.exports = { ehData, ehHora, numeroOuNulo, ehInteiro, normalizarEmail, ehEmail, diasUteisOuNulo };
