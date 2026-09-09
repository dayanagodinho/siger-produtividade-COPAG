const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { gerarToken, definirCookie, limparCookie, autenticar } = require('../auth');
const { normalizarEmail, ehLogin } = require('../validar');

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
  res.json({ id: servidor.id, nome: servidor.nome, email: servidor.email, perfil: servidor.perfil, senha_provisoria: Boolean(servidor.senha_provisoria) });
});

router.post('/logout', (req, res) => {
  limparCookie(res);
  res.json({ ok: true });
});

router.get('/eu', autenticar, async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, nome, email, perfil, meta_presencial_semanal, meta_distancia_semanal, senha_provisoria FROM servidores WHERE id = $1',
    [req.usuario.id]
  );
  if (!rows[0]) return res.status(401).json({ erro: 'Usuario nao encontrado' });
  res.json(rows[0]);
});

/**
 * "Minha conta": cada pessoa escolhe como entra (e-mail ou nome de usuario),
 * o proprio nome e a senha. Tudo exige a senha atual, para que uma aba
 * esquecida aberta nao sirva para tomar a conta.
 */
router.put('/conta', autenticar, async (req, res) => {
  const { senha_atual, senha_nova, nome } = req.body || {};
  const login = req.body?.login === undefined ? undefined : normalizarEmail(req.body.login);
  const { rows } = await db.query('SELECT * FROM servidores WHERE id = $1', [req.usuario.id]);
  const atual = rows[0];
  if (!atual) return res.status(401).json({ erro: 'Usuario nao encontrado' });
  if (!(await bcrypt.compare(senha_atual || '', atual.senha_hash))) return res.status(401).json({ erro: 'Senha atual incorreta' });
  if (login !== undefined && !ehLogin(login)) {
    return res.status(400).json({ erro: `Login invalido: "${login}". Use um e-mail ou um nome de usuario (letras, numeros, ponto), com 3 a 40 caracteres` });
  }
  if (nome !== undefined && !String(nome).trim()) return res.status(400).json({ erro: 'O nome nao pode ficar vazio' });
  if (senha_nova !== undefined && senha_nova !== '' && senha_nova.length < 6) {
    return res.status(400).json({ erro: 'A nova senha precisa ter ao menos 6 caracteres' });
  }
  if (atual.senha_provisoria && !senha_nova) return res.status(400).json({ erro: 'Defina uma senha nova: a atual foi dada pela chefia e e provisoria' });
  const hash = senha_nova ? await bcrypt.hash(senha_nova, 10) : atual.senha_hash;
  try {
    const r = await db.query(
      `UPDATE servidores SET email = COALESCE($2, email), nome = COALESCE($3, nome), senha_hash = $4,
              senha_provisoria = CASE WHEN $5 THEN FALSE ELSE senha_provisoria END
        WHERE id = $1 RETURNING id, nome, email, perfil, senha_provisoria`,
      [atual.id, login ?? null, nome ? String(nome).trim() : null, hash, Boolean(senha_nova)]
    );
    // O cookie carrega o nome; renova para a tela nao mostrar o antigo.
    definirCookie(res, gerarToken(r.rows[0]));
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ erro: 'Esse login ja esta em uso por outra pessoa' });
    throw e;
  }
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
  const r = await db.query(
    'UPDATE servidores SET senha_hash = $1, senha_provisoria = FALSE WHERE id = $2 RETURNING id, nome, perfil, senha_provisoria',
    [await bcrypt.hash(senha_nova, 10), req.usuario.id]
  );
  definirCookie(res, gerarToken(r.rows[0]));
  res.json({ ok: true });
});

module.exports = router;
