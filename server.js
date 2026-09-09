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
app.use('/api/avisos', require('./src/routes/avisos'));

// A saude diz QUAL sistema esta no ar e o que este build sabe fazer. O SIGAP
// respondia {situacao:'no ar'} no mesmo endereco: pela chave `sistema` se
// distingue um do outro sem deduzir nada.
const { version } = require('./package.json');
app.get('/api/saude', (req, res) => res.json({
  ok: true,
  sistema: 'escala-hibrida',
  versao: version,
  schema: require('./src/db').SCHEMA,
  capacidades: {
    schema_proprio: true,
    seed_no_primeiro_boot: true,
    validacao_de_entrada: true,
    teto_repetir_semana: true,
    editar_turno_e_afastamento: true,
    feriados_nacionais_2026: true,
    expediente_ate_18h: true,
    tema_escuro: true,
    periodo_hibrido: true,
    configuracoes_em_abas: true,
    minha_conta: true,
    avisos_para_chefia: true,
    email_por_resend: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_REMETENTE),
  },
}));

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
