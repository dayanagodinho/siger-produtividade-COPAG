import * as fs from 'fs';
import * as path from 'path';
import { pool } from '../infra/banco';

const PASTA_MIGRACOES = path.resolve(__dirname, '..', '..', 'migracoes');

export async function aplicarMigracoes(): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migracoes_aplicadas (
      nome        TEXT PRIMARY KEY,
      aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const aplicadas = new Set(
    (await pool.query<{ nome: string }>('SELECT nome FROM migracoes_aplicadas')).rows.map(
      (linha) => linha.nome,
    ),
  );

  const arquivos = fs
    .readdirSync(PASTA_MIGRACOES)
    .filter((arquivo) => arquivo.endsWith('.sql'))
    .sort();

  const executadas: string[] = [];

  for (const arquivo of arquivos) {
    if (aplicadas.has(arquivo)) continue;

    const sql = fs.readFileSync(path.join(PASTA_MIGRACOES, arquivo), 'utf8');
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query(sql);
      await cliente.query('INSERT INTO migracoes_aplicadas (nome) VALUES ($1)', [arquivo]);
      await cliente.query('COMMIT');
      executadas.push(arquivo);
      console.log(`  aplicada: ${arquivo}`);
    } catch (erro) {
      await cliente.query('ROLLBACK');
      console.error(`  FALHOU: ${arquivo}`);
      throw erro;
    } finally {
      cliente.release();
    }
  }

  return executadas;
}

if (require.main === module) {
  aplicarMigracoes()
    .then((executadas) => {
      console.log(
        executadas.length === 0
          ? 'Banco ja estava atualizado. Nenhuma migracao pendente.'
          : `${executadas.length} migracao(oes) aplicada(s).`,
      );
      return pool.end();
    })
    .catch((erro) => {
      console.error('Erro ao aplicar as migracoes:', erro.message);
      process.exitCode = 1;
      return pool.end();
    });
}
