const { Pool, types } = require('pg');

const conexao = process.env.DATABASE_URL;
if (!conexao) {
  console.error('DATABASE_URL nao definida. Copie .env.example para .env ou configure a variavel no Railway.');
}

// DATE (oid 1082) chega como texto 'YYYY-MM-DD', e nao como Date em fuso local.
// Sem isto, um servidor em fuso positivo devolveria o dia anterior ao converter
// a Date para ISO, e a escala inteira andaria um dia para tras.
types.setTypeParser(1082, (valor) => valor);

// Railway/Heroku exigem SSL; local nao.
const precisaSsl = /railway|render|heroku|amazonaws/.test(conexao || '');

const pool = new Pool({
  connectionString: conexao,
  ssl: precisaSsl ? { rejectUnauthorized: false } : false,
});

module.exports = {
  pool,
  query: (texto, params) => pool.query(texto, params),
};
