const express = require('express');
const db = require('../db');
const { autenticar, exigirChefia, exigirSenhaDefinitiva } = require('../auth');
const { ehInteiro } = require('../validar');
const { iso } = require('../cobertura');

// Avisos de horario descoberto, so para a chefia. Sao gravados por
// src/avisos.js quando uma mudanca abre faixa sem presencial.
const router = express.Router();
router.use(autenticar, exigirSenhaDefinitiva, exigirChefia);

const SQL = `
  SELECT a.id, a.criado_em, a.data, a.mensagem, a.origem, a.lido, a.resolvido_em, s.nome AS autor
    FROM avisos a LEFT JOIN servidores s ON s.id = a.autor_id`;

router.get('/', async (req, res) => {
  const todos = req.query.todos === '1';
  const { rows } = await db.query(`${SQL} ${todos ? '' : 'WHERE NOT a.lido'} ORDER BY a.criado_em DESC LIMIT 200`);
  res.json(rows.map((a) => ({ ...a, data: iso(a.data) })));
});

router.get('/contagem', async (req, res) => {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM avisos WHERE NOT lido');
  res.json({ nao_lidos: rows[0].n });
});

router.post('/:id/lido', async (req, res) => {
  if (!ehInteiro(req.params.id, { min: 1 })) return res.status(400).json({ erro: 'id inválido' });
  const { rows } = await db.query('UPDATE avisos SET lido = TRUE WHERE id = $1 RETURNING id', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ erro: 'Aviso não encontrado' });
  res.json({ ok: true });
});

router.post('/lidos', async (req, res) => {
  const { rowCount } = await db.query('UPDATE avisos SET lido = TRUE WHERE NOT lido');
  res.json({ ok: true, marcados: rowCount });
});

module.exports = router;
