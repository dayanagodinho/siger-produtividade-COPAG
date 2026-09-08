const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { gerarToken, definirCookie, limparCookie, autenticar } = require('../auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, senha } = req.body || {};
  if (!email || !senha) return res.status(400).json({ erro: 'Informe email e senha' });
  const { rows } = await db.query('SELECT * FROM servidores WHERE lower(email) = lower($1) AND ativo', [email]);
  const servidor = rows[0];
  if (!servidor || !(await bcrypt.compare(senha, servidor.senha_hash))) {
    return res.status(401).json({ erro: 'Email ou senha invalidos' });
  }
  definirCookie(res, gerarToken(servidor));
  res.json({ id: servidor.id, nome: servidor.nome, email: servidor.email, perfil: servidor.perfil });
});

router.post('/logout', (req, res) => {
  limparCookie(res);
  res.json({ ok: true });
});

router.get('/eu', autenticar, async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, nome, email, perfil, meta_presencial_semanal, meta_distancia_semanal FROM servidores WHERE id = $1',
    [req.usuario.id]
  );
  if (!rows[0]) return res.status(401).json({ erro: 'Usuario nao encontrado' });
  res.json(rows[0]);
});

router.post('/senha', autenticar, async (req, res) => {
  const { senha_atual, senha_nova } = req.body || {};
  if (!senha_nova || senha_nova.length < 6) {
    return res.status(400).json({ erro: 'A nova senha precisa ter ao menos 6 caracteres' });
  }
  const { rows } = await db.query('SELECT * FROM servidores WHERE id = $1', [req.usuario.id]);
  if (!rows[0] || !(await bcrypt.compare(senha_atual || '', rows[0].senha_hash))) {
    return res.status(401).json({ erro: 'Senha atual incorreta' });
  }
  await db.query('UPDATE servidores SET senha_hash = $1 WHERE id = $2', [await bcrypt.hash(senha_nova, 10), req.usuario.id]);
  res.json({ ok: true });
});

module.exports = router;
