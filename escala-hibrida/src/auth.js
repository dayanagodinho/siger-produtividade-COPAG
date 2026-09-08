const jwt = require('jsonwebtoken');
const SEGREDO = process.env.JWT_SECRET || 'dev-secret-trocar';
const COOKIE = 'escala_token';

function gerarToken(servidor) {
  return jwt.sign(
    { id: servidor.id, nome: servidor.nome, perfil: servidor.perfil },
    SEGREDO,
    { expiresIn: '30d' }
  );
}

function definirCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function limparCookie(res) {
  res.clearCookie(COOKIE);
}

function autenticar(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ erro: 'Nao autenticado' });
  try {
    req.usuario = jwt.verify(token, SEGREDO);
    next();
  } catch {
    return res.status(401).json({ erro: 'Sessao expirada' });
  }
}

function exigirChefia(req, res, next) {
  if (req.usuario?.perfil !== 'chefia') {
    return res.status(403).json({ erro: 'Acao permitida apenas a chefia' });
  }
  next();
}

// O proprio servidor edita a sua escala; a chefia edita a de qualquer um.
function podeEditar(usuario, servidorId) {
  return usuario.perfil === 'chefia' || Number(usuario.id) === Number(servidorId);
}

module.exports = { gerarToken, definirCookie, limparCookie, autenticar, exigirChefia, podeEditar, COOKIE };
