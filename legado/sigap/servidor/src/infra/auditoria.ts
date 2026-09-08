import type { PoolClient } from 'pg';
import { pool } from './banco';
import type { UsuarioAutenticado } from './tipos';

export type AcaoAuditoria = 'CRIACAO' | 'ALTERACAO' | 'EXCLUSAO';

export interface RegistroDeAuditoria {
  entidade: string;
  entidadeId?: number | string | null;
  acao: AcaoAuditoria;
  usuario?: UsuarioAutenticado | null;
  valorAnterior?: unknown;
  valorNovo?: unknown;
  contexto?: string;
}

/**
 * Trilha de auditoria de toda criacao, alteracao e exclusao. Em controle de
 * produtividade de servidor publico o registro e requisito, nao melhoria.
 * Recebe o cliente da transacao quando houver, para gravar junto com o dado.
 */
export async function registrarAuditoria(
  registro: RegistroDeAuditoria,
  cliente?: PoolClient,
): Promise<void> {
  const executor = cliente ?? pool;
  await executor.query(
    `INSERT INTO auditoria
       (entidade, entidade_id, acao, usuario_id, usuario_nome, valor_anterior, valor_novo, contexto)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      registro.entidade,
      registro.entidadeId === null || registro.entidadeId === undefined
        ? null
        : String(registro.entidadeId),
      registro.acao,
      registro.usuario?.id ?? null,
      registro.usuario?.nome ?? null,
      registro.valorAnterior === undefined ? null : JSON.stringify(registro.valorAnterior),
      registro.valorNovo === undefined ? null : JSON.stringify(registro.valorNovo),
      registro.contexto ?? null,
    ],
  );
}

/** Remove campos que nunca devem ir para a trilha em texto claro. */
export function semSegredos<T extends Record<string, unknown>>(objeto: T): Partial<T> {
  const copia: Record<string, unknown> = { ...objeto };
  delete copia.senha;
  delete copia.senha_hash;
  return copia as Partial<T>;
}
