const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { autenticar, exigirChefia, exigirSenhaDefinitiva } = require('../auth');
const { normalizarEmail, ehLogin, numeroOuNulo, ehInteiro } = require('../validar');

// Meta semanal em horas: numero finito entre 0 e 60, ou nulo (mantem/padrao).
function metaOuErro(valor, nome) {
  const n = numeroOuNulo(valor);
  if (n === null) return { valor: null };
  if (!Number.isFinite(n) || n < 0 || n > 60) return { erro: `${nome} precisa ser um numero de horas entre 0 e 60 (recebido "${valor}")` };
  return { valor: n };
}

const router = express.Router();
router.use(autenticar, exigirSenhaDefinitiva);

router.get('/', async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, nome, email, perfil, meta_presencial_semanal, meta_distancia_semanal, ativo
       FROM servidores WHERE ativo OR $1 = 'chefia' ORDER BY nome`,
    [req.usuario.perfil]
  );
  res.json(rows);
});

router.post('/', exigirChefia, async (req, res) => {
  const { nome, senha, perfil, meta_presencial_semanal, meta_distancia_semanal } = req.body || {};
  const email = normalizarEmail(req.body?.email);
  if (!nome || !String(nome).trim() || !email) return res.status(400).json({ erro: 'Informe nome e login (e-mail ou usuario)' });
  if (!ehLogin(email)) return res.status(400).json({ erro: `Login invalido: "${email}". Use um e-mail ou um nome de usuario (letras, numeros, ponto), com 3 a 40 caracteres` });
  const metaP = metaOuErro(meta_presencial_semanal, 'meta_presencial_semanal');
  const metaD = metaOuErro(meta_distancia_semanal, 'meta_distancia_semanal');
  if (metaP.erro || metaD.erro) return res.status(400).json({ erro: metaP.erro || metaD.erro });
  const hash = await bcrypt.hash(senha || process.env.SENHA_PADRAO || '12345678', 10);
  try {
    const { rows } = await db.query(
      `INSERT INTO servidores (nome, email, senha_hash, perfil, meta_presencial_semanal, meta_distancia_semanal, senha_provisoria)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE) RETURNING id, nome, email, perfil, meta_presencial_semanal, meta_distancia_semanal, ativo`,
      [String(nome).trim(), email, hash, perfil === 'chefia' ? 'chefia' : 'servidor', metaP.valor ?? 20, metaD.valor ?? 20]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ erro: 'Ja existe servidor com esse email' });
    throw e;
  }
});

router.put('/:id', exigirChefia, async (req, res) => {
  const { nome, perfil, ativo, meta_presencial_semanal, meta_distancia_semanal } = req.body || {};
  if (!ehInteiro(req.params.id, { min: 1 })) return res.status(400).json({ erro: 'id invalido' });
  const email = req.body?.email === undefined ? null : normalizarEmail(req.body.email);
  if (email !== null && !ehLogin(email)) return res.status(400).json({ erro: `Login invalido: "${email}". Use um e-mail ou um nome de usuario (letras, numeros, ponto), com 3 a 40 caracteres` });
  if (perfil !== undefined && perfil !== null && !['servidor', 'chefia'].includes(perfil)) {
    return res.status(400).json({ erro: 'perfil precisa ser "servidor" ou "chefia"' });
  }
  if (ativo !== undefined && ativo !== null && typeof ativo !== 'boolean') return res.status(400).json({ erro: 'ativo precisa ser true ou false' });
  const metaP = metaOuErro(meta_presencial_semanal, 'meta_presencial_semanal');
  const metaD = metaOuErro(meta_distancia_semanal, 'meta_distancia_semanal');
  if (metaP.erro || metaD.erro) return res.status(400).json({ erro: metaP.erro || metaD.erro });

  // Ninguem tira a propria chefia nem se tira do acompanhamento, e a ultima
  // chefia nao pode ser rebaixada: sem chefia, ninguem abre Configuracoes e
  // o sistema fica trancado por fora. Aconteceu em 09/09/2026.
  const proprio = Number(req.params.id) === Number(req.usuario.id);
  if (proprio && (perfil === 'servidor' || ativo === false)) {
    return res.status(409).json({ erro: 'Voce nao pode tirar a propria chefia nem se tirar do acompanhamento. Peca a outra chefia' });
  }
  if (perfil === 'servidor' || ativo === false) {
    const { rows: chefias } = await db.query("SELECT id FROM servidores WHERE perfil = 'chefia' AND ativo");
    if (chefias.length === 1 && Number(chefias[0].id) === Number(req.params.id)) {
      return res.status(409).json({ erro: 'Essa e a unica chefia ativa. Promova outra pessoa a chefia antes' });
    }
  }
  let rows;
  try {
    ({ rows } = await db.query(
    `UPDATE servidores SET
       nome = COALESCE($2, nome), email = COALESCE($3, email), perfil = COALESCE($4, perfil),
       ativo = COALESCE($5, ativo), meta_presencial_semanal = COALESCE($6, meta_presencial_semanal),
       meta_distancia_semanal = COALESCE($7, meta_distancia_semanal)
     WHERE id = $1
     RETURNING id, nome, email, perfil, meta_presencial_semanal, meta_distancia_semanal, ativo`,
    [req.params.id, nome ? String(nome).trim() : null, email, perfil ?? null, ativo ?? null, metaP.valor, metaD.valor]
    ));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ erro: 'Ja existe servidor com esse email' });
    throw e;
  }
  if (!rows[0]) return res.status(404).json({ erro: 'Servidor nao encontrado' });
  res.json(rows[0]);
});

router.post('/:id/senha', exigirChefia, async (req, res) => {
  if (!ehInteiro(req.params.id, { min: 1 })) return res.status(400).json({ erro: 'id invalido' });
  const nova = req.body?.senha || process.env.SENHA_PADRAO || '12345678';
  await db.query('UPDATE servidores SET senha_hash = $1, senha_provisoria = TRUE WHERE id = $2', [await bcrypt.hash(nova, 10), req.params.id]);
  res.json({ ok: true, senha: nova });
});

module.exports = router;
