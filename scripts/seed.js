require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../src/db');

// Carrega os servidores e a escala importados da planilha CONTROLE ESCALA HIBRIDO 2026.
const dados = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'db', 'seed-escala.json'), 'utf8'));
const SENHA = process.env.SENHA_PADRAO || 'mudar123';
const CHEFIA = ['Dayana']; // ajuste se a chefia for outra pessoa

function email(nome) {
  return `${nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '.')}@setor.local`;
}

/**
 * Carrega servidores e turnos. Idempotente: roda de novo sem duplicar.
 * Com `soSeVazio`, so age quando ainda nao ha servidor nenhum — e assim que o
 * deploy chama, para a escala entrar sozinha no primeiro boot sem que alguem
 * precise lembrar de abrir um terminal. Depois disso nao toca em nada, para
 * nao ressuscitar turno que a chefia apagou.
 */
async function semear({ soSeVazio = false } = {}) {
  if (soSeVazio) {
    const { rows } = await db.query('SELECT count(*)::int AS n FROM servidores');
    if (rows[0].n > 0) {
      console.log(`Seed pulado: ja existem ${rows[0].n} servidores.`);
      return { pulado: true, servidores: rows[0].n, turnos: 0 };
    }
  }
  const hash = await bcrypt.hash(SENHA, 10);
  const ids = new Map();

  for (const nome of dados.servidores) {
    const perfil = CHEFIA.includes(nome) ? 'chefia' : 'servidor';
    const { rows } = await db.query(
      `INSERT INTO servidores (nome, email, senha_hash, perfil) VALUES ($1,$2,$3,$4)
       ON CONFLICT (email) DO UPDATE SET nome = EXCLUDED.nome RETURNING id`,
      [nome, email(nome), hash, perfil]
    );
    ids.set(nome, rows[0].id);
  }

  let inseridos = 0;
  for (const t of dados.turnos) {
    const servidorId = ids.get(t.servidor);
    if (!servidorId) continue;
    const jaTem = await db.query(
      'SELECT 1 FROM turnos WHERE servidor_id = $1 AND data = $2 AND inicio = $3 AND fim = $4',
      [servidorId, t.data, t.inicio, t.fim]
    );
    if (jaTem.rows.length) continue;
    await db.query(
      'INSERT INTO turnos (servidor_id, data, inicio, fim, modalidade) VALUES ($1,$2,$3,$4,$5)',
      [servidorId, t.data, t.inicio, t.fim, t.modalidade]
    );
    inseridos++;
  }

  console.log(`${ids.size} servidores e ${inseridos} turnos carregados.`);
  console.log(`Senha inicial de todos: ${SENHA} (peca para cada um trocar no primeiro acesso).`);
  console.log('Emails gerados:', [...ids.keys()].map(email).join(', '));
  return { pulado: false, servidores: ids.size, turnos: inseridos };
}

module.exports = { semear, email };

if (require.main === module) {
  semear({ soSeVazio: process.argv.includes('--so-se-vazio') })
    .then(() => db.pool.end())
    .catch((e) => {
      console.error('Falha ao popular:', e.message);
      process.exit(1);
    });
}
