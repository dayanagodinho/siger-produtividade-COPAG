require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

// Feriados nacionais de 2026 (lei 662/1949, 6.802/1980, 14.759/2023) e os dois
// pontos facultativos que o servico publico costuma observar. A chefia pode
// apagar qualquer um em "Feriados"; o ajuste so roda uma vez, entao o que ela
// apagar nao volta na proxima subida.
const FERIADOS_2026 = [
  ['2026-01-01', 'Confraternização Universal'],
  ['2026-02-16', 'Carnaval (ponto facultativo)'],
  ['2026-02-17', 'Carnaval (ponto facultativo)'],
  ['2026-04-03', 'Sexta-feira Santa'],
  ['2026-04-21', 'Tiradentes'],
  ['2026-05-01', 'Dia do Trabalho'],
  ['2026-06-04', 'Corpus Christi (ponto facultativo)'],
  ['2026-09-07', 'Independência do Brasil'],
  ['2026-10-12', 'Nossa Senhora Aparecida'],
  ['2026-11-02', 'Finados'],
  ['2026-11-15', 'Proclamação da República'],
  ['2026-11-20', 'Dia da Consciência Negra'],
  ['2026-12-25', 'Natal'],
];

/**
 * Ajustes de dados que rodam UMA vez por banco, marcados na tabela config com
 * a chave "ajuste.<nome>". O schema.sql so cria estrutura e valores iniciais;
 * o que precisa mudar dado ja existente (regra antiga gravada, carga de
 * feriados) vive aqui, para nao ressuscitar o que a chefia mudou depois.
 */
const AJUSTES = [
  {
    chave: 'ajuste.expediente_ate_18h',
    // A regra nasceu com 19:00; a chefia definiu que alguem precisa ficar
    // presencial ate as 18:00. Quem ja tiver mudado para outro valor nao e tocado.
    aplicar: (c) => c.query(`UPDATE config SET valor = '18:00' WHERE chave = 'cobertura_fim' AND valor = '19:00'`),
  },
  {
    chave: 'ajuste.feriados_nacionais_2026',
    aplicar: async (c) => {
      for (const [data, descricao] of FERIADOS_2026) {
        await c.query('INSERT INTO feriados (data, descricao) VALUES ($1,$2) ON CONFLICT (data) DO NOTHING', [data, descricao]);
      }
    },
  },
];

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
    for (const ajuste of AJUSTES) {
      const feito = await cliente.query('SELECT 1 FROM config WHERE chave = $1', [ajuste.chave]);
      if (feito.rows.length) continue;
      await ajuste.aplicar(cliente);
      await cliente.query('INSERT INTO config (chave, valor) VALUES ($1, $2)', [ajuste.chave, new Date().toISOString()]);
      console.log(`Ajuste aplicado: ${ajuste.chave}`);
    }
  } finally {
    cliente.release();
  }
}

module.exports = { migrar, FERIADOS_2026, AJUSTES };

if (require.main === module) {
  migrar()
    .then(() => { console.log('Banco criado/atualizado com sucesso.'); return db.pool.end(); })
    .catch((e) => {
      console.error('Falha ao migrar:', e.message);
      process.exit(1);
    });
}
