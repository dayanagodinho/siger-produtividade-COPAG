require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
require('express-async-errors'); // faz erros de rotas async cairem no tratador abaixo

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/servidores', require('./src/routes/servidores'));
app.use('/api/escala', require('./src/routes/escala'));
app.use('/api/cobertura', require('./src/routes/cobertura'));

app.get('/api/saude', (req, res) => res.json({ ok: true, versao: '1.0.0' }));

// Tratador de erro unico: nenhuma rota precisa repetir try/catch
app.use((erro, req, res, next) => {
  console.error(erro);
  res.status(500).json({ erro: 'Erro interno no servidor' });
});

module.exports = app;

if (require.main === module) {
  const porta = process.env.PORT || 3000;
  app.listen(porta, () => console.log(`Escala Hibrida rodando em http://localhost:${porta}`));
}
