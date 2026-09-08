import './infra/tipos';
import * as path from 'path';
import express from 'express';
import session from 'express-session';
import conectarPgSimple from 'connect-pg-simple';
import { configuracao } from './infra/configuracao';
import { pool } from './infra/banco';
import { carregarUsuario } from './infra/autorizacao';
import { tratadorDeErros } from './infra/erros';
import { rotasDaApi } from './rotas';
import { aplicarMigracoes } from './scripts/migrar';
import { criarPrimeiroAdministrador } from './scripts/primeiro-acesso';
import { importarCatalogoNaPrimeiraSubida } from './scripts/catalogo';

const PASTA_CLIENTE = path.resolve(__dirname, '..', '..', 'cliente', 'dist');

export function criarAplicacao(): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  const ArmazemDeSessao = conectarPgSimple(session);
  app.use(
    session({
      store: new ArmazemDeSessao({ pool, tableName: 'sessoes', createTableIfMissing: false }),
      name: 'produtividade.sid',
      secret: configuracao.segredoSessao,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: configuracao.producao,
        maxAge: 1000 * 60 * 60 * 8,
      },
    }),
  );

  app.use(carregarUsuario);
  app.use('/api', rotasDaApi);

  app.use('/api', (_req, res) => {
    res.status(404).json({ mensagem: 'Endereço de API inexistente.' });
  });

  app.use(express.static(PASTA_CLIENTE));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(PASTA_CLIENTE, 'index.html'), (erro) => {
      if (erro) {
        res
          .status(200)
          .type('text/plain')
          .send('Interface ainda não compilada. Rode "npm run build" na raiz do projeto.');
      }
    });
  });

  app.use(tratadorDeErros);
  return app;
}

async function iniciar(): Promise<void> {
  if (configuracao.migrarAoIniciar) {
    console.log('Verificando migrações pendentes...');
    await aplicarMigracoes();
  }

  // Preparo da primeira subida: o administrador e, com o setor no lugar, a
  // lista de atividades da COPAG. Uma vez feitos, as subidas seguintes passam
  // direto. Um tropeco aqui e quase sempre variavel mal preenchida, e derrubar
  // o servidor por isso so esconde a mensagem que diz o que corrigir: o sistema
  // sobe, o log explica, e a proxima subida tenta de novo.
  await prepararPrimeiraSubida();

  const app = criarAplicacao();
  app.listen(configuracao.porta, () => {
    console.log(
      `SIGAP no ar em http://localhost:${configuracao.porta} (${configuracao.ambiente})`,
    );
  });
}

async function prepararPrimeiraSubida(): Promise<void> {
  try {
    const primeiroAcesso = await criarPrimeiroAdministrador();
    if (primeiroAcesso) console.log(primeiroAcesso);

    const catalogo = await importarCatalogoNaPrimeiraSubida();
    if (catalogo) console.log(catalogo);
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    console.error(
      'Preparo da primeira subida não concluído:',
      motivo,
      '\nO sistema sobe assim mesmo. Confira as variáveis ADMIN_* e SETOR_* e reinicie.',
    );
  }
}

if (require.main === module) {
  iniciar().catch((erro) => {
    console.error('Falha ao iniciar o servidor:', erro);
    process.exit(1);
  });
}
