require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

async function migrar() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await db.query(sql);
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
