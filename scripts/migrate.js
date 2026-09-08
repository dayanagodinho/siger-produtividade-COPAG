require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

async function migrar() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  // O schema proprio precisa existir antes do search_path apontar para ele;
  // criar e fixar na MESMA conexao, porque o pool fixa o search_path so no
  // "connect" e a conexao ja pode ter nascido antes do schema existir.
  const cliente = await db.pool.connect();
  try {
    await cliente.query(`CREATE SCHEMA IF NOT EXISTS ${db.SCHEMA}`);
    await cliente.query(`SET search_path TO ${db.SCHEMA}`);
    await cliente.query(sql);
  } finally {
    cliente.release();
  }
}

module.exports = { migrar };

if (require.main === module) {
  migrar()
    .then(() => { console.log('Banco criado/atualizado com sucesso.'); return db.pool.end(); })
    .catch((e) => {
      console.error('Falha ao migrar:', e.message);
      process.exit(1);
    });
}
