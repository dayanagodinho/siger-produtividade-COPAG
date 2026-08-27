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

  // Na primeira subida, cria o administrador a partir das variaveis de
  // ambiente. Com o banco ja povoado, nao faz nada.
  const primeiroAcesso = await criarPrimeiroAdministrador();
  if (primeiroAcesso) console.log(primeiroAcesso);

  const app = criarAplicacao();
  app.listen(configuracao.porta, () => {
    console.log(
      `Controle de Produtividade no ar em http://localhost:${configuracao.porta} (${configuracao.ambiente})`,
    );
  });
}

if (require.main === module) {
  iniciar().catch((erro) => {
    console.error('Falha ao iniciar o servidor:', erro);
    process.exit(1);
  });
}
