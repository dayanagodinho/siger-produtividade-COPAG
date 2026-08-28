import * as fs from 'fs';
import * as path from 'path';
import type { Versao } from '../dominio/versao';

/**
 * A versao vista do lado do servidor. O commit vem da variavel que o Railway
 * define na publicacao; fora dele fica nulo, e o numero sozinho ja basta.
 *
 * Lida uma vez e guardada: nada disso muda enquanto o processo vive.
 */
let guardada: Versao | null = null;

export function versaoDoServidor(): Versao {
  if (guardada) return guardada;

  const pacote = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'package.json'), 'utf8'),
  ) as { version: string };

  const commit = process.env.RAILWAY_GIT_COMMIT_SHA ?? null;
  guardada = {
    numero: pacote.version.replace(/\.0$/, ''),
    commit: commit ? commit.slice(0, 7) : null,
    // O processo sobe junto com a publicacao, entao a hora em que ele comecou
    // e a hora em que esta versao entrou no ar.
    publicado_em: new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString(),
  };
  return guardada;
}
