const express = require('express');
const db = require('../db');
const { autenticar, exigirSenhaDefinitiva } = require('../auth');
const { ehData, ehInteiro } = require('../validar');
const { iso } = require('../cobertura');

// Mural da tela inicial: recados curtos que qualquer pessoa do setor
// escreve e todo mundo vê ao entrar. Alterar ou apagar: quem escreveu, ou a chefia. Cada um tem validade opcional; vencido, some da lista.
const router = express.Router();
router.use(autenticar, exigirSenhaDefinitiva);

const SQL = `
  SELECT m.id, m.criado_em, m.texto, m.valido_ate, m.fixado, m.autor_id, s.nome AS autor
    FROM mural m LEFT JOIN servidores s ON s.id = m.autor_id`;
const limpar = (m) => ({ ...m, valido_ate: m.valido_ate ? iso(m.valido_ate) : null });

router.get('/', async (req, res) => {
  const { rows } = await db.query(`${SQL} WHERE m.valido_ate IS NULL OR m.valido_ate >= CURRENT_DATE ORDER BY m.fixado DESC, m.criado_em DESC LIMIT 50`);
  res.json(rows.map(limpar));
});

function validar(corpo) {
  const texto = String(corpo?.texto || '').trim();
  if (!texto) return { erro: 'Escreva a mensagem' };
  if (texto.length > 2000) return { erro: 'A mensagem pode ter no máximo 2000 caracteres' };
  const valido_ate = corpo?.valido_ate ? String(corpo.valido_ate) : null;
  if (valido_ate && !ehData(valido_ate)) return { erro: `Validade inválida: "${valido_ate}". Use o formato YYYY-MM-DD ou deixe vazio` };
  return { texto, valido_ate, fixado: Boolean(corpo?.fixado) };
}

router.post('/', async (req, res) => {
  const v = validar(req.body);
  if (v.erro) return res.status(400).json({ erro: v.erro });
  // Fixar no topo e coisa da chefia; recado comum de servidor entra sem destaque.
  if (req.usuario.perfil !== 'chefia') v.fixado = false;
  const { rows } = await db.query(
    'INSERT INTO mural (texto, valido_ate, fixado, autor_id) VALUES ($1,$2,$3,$4) RETURNING id',
    [v.texto, v.valido_ate, v.fixado, req.usuario.id]
  );
  const { rows: novo } = await db.query(`${SQL} WHERE m.id = $1`, [rows[0].id]);
  res.status(201).json(limpar(novo[0]));
});

async function podeMexer(req, res) {
  const { rows } = await db.query('SELECT autor_id FROM mural WHERE id = $1', [req.params.id]);
  if (!rows[0]) { res.status(404).json({ erro: 'Mensagem não encontrada' }); return false; }
  if (req.usuario.perfil !== 'chefia' && Number(rows[0].autor_id) !== Number(req.usuario.id)) {
    res.status(403).json({ erro: 'Só quem escreveu o recado, ou a chefia, pode alterar ou apagar' });
    return false;
  }
  return true;
}

router.put('/:id', async (req, res) => {
  if (!ehInteiro(req.params.id, { min: 1 })) return res.status(400).json({ erro: 'id inválido' });
  if (!(await podeMexer(req, res))) return;
  const v = validar(req.body);
  if (v.erro) return res.status(400).json({ erro: v.erro });
  if (req.usuario.perfil !== 'chefia') v.fixado = false;
  const { rowCount } = await db.query('UPDATE mural SET texto = $2, valido_ate = $3, fixado = $4 WHERE id = $1', [req.params.id, v.texto, v.valido_ate, v.fixado]);
  if (!rowCount) return res.status(404).json({ erro: 'Mensagem não encontrada' });
  const { rows } = await db.query(`${SQL} WHERE m.id = $1`, [req.params.id]);
  res.json(limpar(rows[0]));
});

router.delete('/:id', async (req, res) => {
  if (!ehInteiro(req.params.id, { min: 1 })) return res.status(400).json({ erro: 'id inválido' });
  if (!(await podeMexer(req, res))) return;
  await db.query('DELETE FROM mural WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
