import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';
import { configuracao } from './configuracao';
import { definirSsl } from './ssl';

// O driver devolve DATE como objeto Date no fuso local, o que desloca o dia.
// Para apuracao mensal o dia precisa chegar exatamente como esta gravado.
types.setTypeParser(1082, (valor: string) => valor);
// NUMERIC chega como texto por padrao; convertemos para numero nas leituras.
types.setTypeParser(1700, (valor: string) => Number(valor));
// BIGINT tambem chega como texto; os identificadores deste sistema cabem em number.
types.setTypeParser(20, (valor: string) => Number(valor));

export const pool = new Pool({
  connectionString: configuracao.urlBanco,
  ssl: definirSsl(configuracao.urlBanco, configuracao.producao, process.env.DATABASE_SSL),
  max: 10,
});

export async function consultar<T extends QueryResultRow = QueryResultRow>(
  texto: string,
  parametros: unknown[] = [],
): Promise<T[]> {
  const resultado = await pool.query<T>(texto, parametros as never[]);
  return resultado.rows;
}

export async function consultarUm<T extends QueryResultRow = QueryResultRow>(
  texto: string,
  parametros: unknown[] = [],
): Promise<T | null> {
  const linhas = await consultar<T>(texto, parametros);
  return linhas[0] ?? null;
}

export async function emTransacao<T>(acao: (cliente: PoolClient) => Promise<T>): Promise<T> {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await acao(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (erro) {
    await cliente.query('ROLLBACK');
    throw erro;
  } finally {
    cliente.release();
  }
}
