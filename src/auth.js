const jwt = require('jsonwebtoken');
// O bloco do Railway herdado do SIGAP ja tem SESSION_SECRET; serve igual.
const SEGREDO = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'dev-secret-trocar';
if (SEGREDO === 'dev-secret-trocar' && process.env.NODE_ENV === 'production') {
  console.error('AVISO: nem JWT_SECRET nem SESSION_SECRET definidos; a sessao esta assinada com um segredo publico.');
}
const COOKIE = 'escala_token';

function gerarToken(servidor) {
  return jwt.sign(
    { id: servidor.id, nome: servidor.nome, perfil: servidor.perfil, provisoria: Boolean(servidor.senha_provisoria) },
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

// Senha dada pela chefia: a pessoa entra, ve o pedido de senha nova e mais
// nada. Toda rota de dados passa por aqui; so /api/auth fica de fora.
function exigirSenhaDefinitiva(req, res, next) {
  if (req.usuario?.provisoria) return res.status(403).json({ erro: 'Defina a sua senha antes de continuar', codigo: 'senha_provisoria' });
  next();
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

module.exports = { gerarToken, definirCookie, limparCookie, autenticar, exigirChefia, exigirSenhaDefinitiva, podeEditar, COOKIE };
