import { consultarUm } from '../infra/banco';
import { erroDeConflito } from '../infra/erros';
import { rotularCompetencia, type DataIso } from './datas';

export interface FechamentoVigente {
  id: number;
  versao: number;
  fechado_em: string;
  fechado_por_nome: string;
}

/** Devolve o fechamento em vigor da competencia, ou null se o mes esta aberto. */
export async function buscarFechamentoVigente(
  setorId: number,
  competencia: DataIso,
): Promise<FechamentoVigente | null> {
  return consultarUm<FechamentoVigente>(
    `SELECT f.id, f.versao, f.fechado_em, s.nome AS fechado_por_nome
       FROM fechamentos f
       JOIN servidores s ON s.id = f.fechado_por
      WHERE f.setor_id = $1 AND f.competencia = $2
        AND f.vigente AND f.reaberto_em IS NULL`,
    [setorId, competencia],
  );
}

/**
 * Regra 6.1: com o mes fechado, nenhum lancamento daquela competencia pode
 * ser criado, alterado ou excluido. Reabertura e ato do administrador.
 */
export async function garantirCompetenciaAberta(
  setorId: number,
  competencia: DataIso,
): Promise<void> {
  const fechamento = await buscarFechamentoVigente(setorId, competencia);
  if (fechamento) {
    throw erroDeConflito(
      `A competencia de ${rotularCompetencia(competencia)} ja foi fechada e nao aceita mais alteracoes. ` +
        'Peca a reabertura do mes a administracao do sistema.',
    );
  }
}
