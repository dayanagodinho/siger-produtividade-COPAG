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

// ---------------------------------------------------------------------------
// Consolidado congelado
// ---------------------------------------------------------------------------

import type { PoolClient } from 'pg';
import { consultar } from '../infra/banco';
import { apurarCompetencia, type ApuracaoDoSetor } from './apuracao';
import type { UsuarioAutenticado } from '../infra/tipos';

export interface ConsolidadoServidor {
  servidor_id: number;
  nome: string;
  matricula: string;
  grupo_id: number | null;
  grupo_nome: string | null;
  situacao: string;
  pontos_total: number;
  pontos_base: number;
  pontos_pendentes: number;
  dias_uteis: number;
  dias_ausencia: number;
  dias_efetivos: number;
  media: number | null;
  media_base: number | null;
  referencia: number | null;
  origem_referencia: string;
  atingimento: number | null;
  faixa: string | null;
}

export interface Consolidado {
  id: number;
  setor_id: number;
  setor_nome: string;
  setor_sigla: string;
  competencia: string;
  versao: number;
  vigente: boolean;
  media_setor_oficial: number | null;
  media_setor_contraprova: number | null;
  total_pontos: number | null;
  total_dias_efetivos: number | null;
  processos_distintos: number | null;
  servidores_apurados: number | null;
  servidores_sem_apuracao: number | null;
  fechado_em: string;
  fechado_por_nome: string;
  reaberto_em: string | null;
  reaberto_por_nome: string | null;
  justificativa_reabertura: string | null;
  servidores?: ConsolidadoServidor[];
  grupos?: Array<{
    grupo_id: number;
    nome: string;
    referencia: number | null;
    origem: string;
    meta_definida_em: string | null;
    servidores_considerados: number;
  }>;
}

/**
 * Congela a apuracao do mes. A referencia do grupo gravada aqui nao pode ser
 * recalculada depois: e ela que sustenta o resultado do periodo.
 */
export async function gravarFechamento(
  cliente: PoolClient,
  apuracao: ApuracaoDoSetor,
  usuario: UsuarioAutenticado,
): Promise<number> {
  const anteriores = await cliente.query<{ versao: number }>(
    'SELECT max(versao) AS versao FROM fechamentos WHERE setor_id = $1 AND competencia = $2',
    [apuracao.setor.id, apuracao.competencia],
  );
  const versao = Number(anteriores.rows[0]?.versao ?? 0) + 1;

  await cliente.query(
    'UPDATE fechamentos SET vigente = FALSE WHERE setor_id = $1 AND competencia = $2',
    [apuracao.setor.id, apuracao.competencia],
  );

  const inserido = await cliente.query<{ id: number }>(
    `INSERT INTO fechamentos
       (setor_id, competencia, versao, vigente, media_setor_oficial, media_setor_contraprova,
        total_pontos, total_dias_efetivos, processos_distintos, servidores_apurados,
        servidores_sem_apuracao, fechado_por)
     VALUES ($1, $2, $3, TRUE, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      apuracao.setor.id, apuracao.competencia, versao,
      apuracao.resumo.media_oficial, apuracao.resumo.media_contraprova,
      apuracao.resumo.total_pontos, apuracao.resumo.total_dias_efetivos,
      apuracao.resumo.processos_distintos, apuracao.resumo.servidores_apurados,
      apuracao.resumo.servidores_sem_apuracao, usuario.id,
    ],
  );
  const fechamentoId = inserido.rows[0].id;

  for (const grupo of apuracao.grupos) {
    await cliente.query(
      `INSERT INTO fechamento_grupos
         (fechamento_id, grupo_id, referencia, origem, meta_definida_em, servidores_considerados)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        fechamentoId, grupo.grupo_id, grupo.referencia, grupo.origem,
        grupo.meta_definida_em, grupo.servidores_considerados,
      ],
    );
  }

  for (const servidor of apuracao.servidores) {
    await cliente.query(
      `INSERT INTO fechamento_servidores
         (fechamento_id, servidor_id, grupo_id, situacao, pontos_total, pontos_base,
          pontos_pendentes, dias_uteis, dias_ausencia, dias_efetivos, media, media_base,
          referencia, origem_referencia, atingimento, faixa)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        fechamentoId, servidor.servidor_id, servidor.grupo_id, servidor.situacao,
        servidor.pontos_total, servidor.pontos_base, servidor.pontos_pendentes,
        servidor.dias_uteis, servidor.dias_ausencia, servidor.dias_efetivos,
        servidor.media, servidor.media_base, servidor.referencia,
        servidor.origem_referencia, servidor.atingimento, servidor.faixa,
      ],
    );
  }

  return fechamentoId;
}

export async function lerConsolidado(id: number): Promise<Consolidado | null> {
  const cabecalho = await consultar<Consolidado>(
    `SELECT f.*, st.nome AS setor_nome, st.sigla AS setor_sigla,
            fp.nome AS fechado_por_nome, rp.nome AS reaberto_por_nome
       FROM fechamentos f
       JOIN setores st ON st.id = f.setor_id
       JOIN servidores fp ON fp.id = f.fechado_por
       LEFT JOIN servidores rp ON rp.id = f.reaberto_por
      WHERE f.id = $1`,
    [id],
  );
  if (cabecalho.length === 0) return null;

  const servidores = await consultar<ConsolidadoServidor>(
    `SELECT fs.*, s.nome, s.matricula, g.nome AS grupo_nome
       FROM fechamento_servidores fs
       JOIN servidores s ON s.id = fs.servidor_id
       LEFT JOIN grupos g ON g.id = fs.grupo_id
      WHERE fs.fechamento_id = $1
      ORDER BY s.nome`,
    [id],
  );

  const grupos = await consultar<{
    grupo_id: number;
    nome: string;
    referencia: number | null;
    origem: string;
    meta_definida_em: string | null;
    servidores_considerados: number;
  }>(
    `SELECT fg.grupo_id, g.nome, fg.referencia, fg.origem, fg.meta_definida_em,
            fg.servidores_considerados
       FROM fechamento_grupos fg
       JOIN grupos g ON g.id = fg.grupo_id
      WHERE fg.fechamento_id = $1
      ORDER BY g.nome`,
    [id],
  );

  return { ...cabecalho[0], servidores, grupos };
}

/** Consolidado em vigor de uma competencia, se o mes estiver fechado. */
export async function lerConsolidadoVigente(
  setorId: number,
  competencia: DataIso,
): Promise<Consolidado | null> {
  const fechamento = await buscarFechamentoVigente(setorId, competencia);
  return fechamento ? lerConsolidado(fechamento.id) : null;
}

export async function apurarOuLerConsolidado(
  setorId: number,
  competencia: DataIso,
): Promise<{ fechado: boolean; apuracao: ApuracaoDoSetor; consolidado: Consolidado | null }> {
  const consolidado = await lerConsolidadoVigente(setorId, competencia);
  const apuracao = await apurarCompetencia(setorId, competencia);
  return { fechado: consolidado !== null, apuracao, consolidado };
}
