import { consultar, consultarUm } from '../infra/banco';
import { erroNaoEncontrado } from '../infra/erros';
import {
  apurarServidor,
  apurarSetor,
  calcularAtingimento,
  calcularReferenciaDoGrupo,
  distribuirNiveis,
  faixaDeAtingimento,
  taxaDeCorrecao,
  type ApuracaoSetor,
  type Faixa,
  type LancamentoParaApuracao,
  type OrigemReferencia,
  type SituacaoApuracao,
} from './calculo';
import { contarDiasUteisDeAusencia, contarDiasUteisDoMes, type DataIso } from './datas';
import { carregarParametros } from './parametros';
import { buscarFechamentoVigente } from './fechamento';

/**
 * Apuracao mensal de um setor, calculada inteiramente no servidor.
 * O cliente recebe numeros prontos; nao ha calculo de pontuacao no navegador.
 */

export interface ServidorApurado {
  servidor_id: number;
  nome: string;
  matricula: string;
  grupo_id: number | null;
  grupo_nome: string | null;
  situacao: SituacaoApuracao;
  pontos_total: number;
  pontos_base: number;
  pontos_pendentes: number;
  dias_uteis: number;
  dias_ausencia: number;
  dias_efetivos: number;
  media: number | null;
  media_base: number | null;
  referencia: number | null;
  origem_referencia: OrigemReferencia;
  atingimento: number | null;
  faixa: Faixa | null;
  lancamentos_validados: number;
  lancamentos_pendentes: number;
  lancamentos_em_andamento: number;
  lancamentos_devolvidos: number;
  distribuicao_niveis: Record<number, number>;
  lancamentos_avaliados: number;
  lancamentos_corrigidos: number;
  taxa_correcao: number | null;
}

export interface GrupoApurado {
  grupo_id: number;
  nome: string;
  referencia: number | null;
  origem: OrigemReferencia;
  meta_definida_em: string | null;
  servidores_considerados: number;
}

export interface ApuracaoDoSetor {
  competencia: DataIso;
  setor: { id: number; nome: string; sigla: string };
  dias_uteis: number;
  feriados: Array<{ data: string; descricao: string }>;
  grupos: GrupoApurado[];
  servidores: ServidorApurado[];
  resumo: ApuracaoSetor;
  fechado: boolean;
  fechamento: { id: number; versao: number; fechado_em: string; fechado_por_nome: string } | null;
  limites: { abaixo: number; acima: number };
}

interface LinhaLancamento extends LancamentoParaApuracao {
  id: number;
  nivel_original: number | null;
}

export async function apurarCompetencia(
  setorId: number,
  competencia: DataIso,
): Promise<ApuracaoDoSetor> {
  const setor = await consultarUm<{ id: number; nome: string; sigla: string }>(
    'SELECT id, nome, sigla FROM setores WHERE id = $1 AND excluido_em IS NULL',
    [setorId],
  );
  if (!setor) throw erroNaoEncontrado('Setor nao encontrado.');

  const { limites } = await carregarParametros();

  const feriados = await consultar<{ data: string; descricao: string }>(
    `SELECT data, descricao FROM feriados
      WHERE data >= $1::date AND data < ($1::date + INTERVAL '1 month')
      ORDER BY data`,
    [competencia],
  );
  const diasUteis = contarDiasUteisDoMes(competencia, feriados.map((f) => f.data));

  // Entram na apuracao os servidores ativos do setor e quem lancou no mes,
  // mesmo que tenha sido inativado depois.
  const servidores = await consultar<{
    id: number;
    nome: string;
    matricula: string;
    grupo_id: number | null;
    grupo_nome: string | null;
  }>(
    `SELECT DISTINCT s.id, s.nome, s.matricula, s.grupo_id, g.nome AS grupo_nome
       FROM servidores s
       LEFT JOIN grupos g ON g.id = s.grupo_id
      WHERE s.excluido_em IS NULL AND s.setor_id = $1
        AND (
          s.situacao = 'ATIVO'
          OR EXISTS (
            SELECT 1 FROM lancamentos l
             WHERE l.servidor_id = s.id AND l.excluido_em IS NULL AND l.competencia = $2
          )
        )
      ORDER BY s.nome`,
    [setorId, competencia],
  );
  const idsServidores = servidores.map((s) => s.id);

  const lancamentos = idsServidores.length
    ? await consultar<LinhaLancamento>(
        `SELECT l.id, l.servidor_id, l.processo, l.papel, l.status, l.situacao,
                l.pontos, l.nivel, l.nivel_original
           FROM lancamentos l
          WHERE l.excluido_em IS NULL AND l.competencia = $1
            AND l.servidor_id = ANY($2::int[])`,
        [competencia, idsServidores],
      )
    : [];

  const ausencias = idsServidores.length
    ? await consultar<{ servidor_id: number; data_inicio: string; data_fim: string }>(
        `SELECT servidor_id, data_inicio, data_fim
           FROM ausencias
          WHERE excluido_em IS NULL
            AND servidor_id = ANY($1::int[])
            AND data_inicio < ($2::date + INTERVAL '1 month')
            AND data_fim >= $2::date`,
        [idsServidores, competencia],
      )
    : [];

  const listaFeriados = feriados.map((f) => f.data);

  const apurados: ServidorApurado[] = servidores.map((servidor) => {
    const minhasAusencias = ausencias.filter((a) => a.servidor_id === servidor.id);
    const diasAusencia = contarDiasUteisDeAusencia(competencia, minhasAusencias, listaFeriados);
    const base = apurarServidor(servidor.id, lancamentos, diasUteis, diasAusencia);
    const meus = lancamentos.filter((l) => l.servidor_id === servidor.id);
    const avaliados = meus.filter((l) => l.situacao !== 'PENDENTE');
    const corrigidos = meus.filter((l) => l.nivel_original !== null);

    return {
      servidor_id: servidor.id,
      nome: servidor.nome,
      matricula: servidor.matricula,
      grupo_id: servidor.grupo_id,
      grupo_nome: servidor.grupo_nome,
      situacao: base.situacao,
      pontos_total: base.pontos_total,
      pontos_base: base.pontos_base,
      pontos_pendentes: base.pontos_pendentes,
      dias_uteis: base.dias_uteis,
      dias_ausencia: base.dias_ausencia,
      dias_efetivos: base.dias_efetivos,
      media: base.media,
      media_base: base.media_base,
      referencia: null,
      origem_referencia: 'INDISPONIVEL',
      atingimento: null,
      faixa: null,
      lancamentos_validados: base.lancamentos_validados,
      lancamentos_pendentes: base.lancamentos_pendentes,
      lancamentos_em_andamento: base.lancamentos_em_andamento,
      lancamentos_devolvidos: meus.filter((l) => l.situacao === 'DEVOLVIDO').length,
      distribuicao_niveis: distribuirNiveis(meus.filter((l) => l.status === 'CONCLUIDO')),
      lancamentos_avaliados: avaliados.length,
      lancamentos_corrigidos: corrigidos.length,
      taxa_correcao: taxaDeCorrecao(avaliados.length, corrigidos.length),
    };
  });

  // Referencia por grupo: meta fixa quando houver, senao mediana das medias
  // dos servidores apurados, sem os pontos de homologacao (regras 5.2 e 5.4).
  const gruposDoSetor = await consultar<{
    id: number;
    nome: string;
    meta_referencia: number | null;
    meta_definida_em: string | null;
  }>(
    `SELECT id, nome, meta_referencia, meta_definida_em
       FROM grupos WHERE setor_id = $1 AND excluido_em IS NULL ORDER BY nome`,
    [setorId],
  );

  const grupos: GrupoApurado[] = gruposDoSetor.map((grupo) => {
    const medias = apurados
      .filter((a) => a.grupo_id === grupo.id && a.situacao === 'APURADO')
      .map((a) => a.media_base);
    const referencia = calcularReferenciaDoGrupo(grupo.meta_referencia, medias);
    return {
      grupo_id: grupo.id,
      nome: grupo.nome,
      referencia: referencia.referencia,
      origem: referencia.origem,
      meta_definida_em: grupo.meta_definida_em,
      servidores_considerados: referencia.servidores_considerados,
    };
  });

  for (const servidor of apurados) {
    const grupo = grupos.find((g) => g.grupo_id === servidor.grupo_id);
    servidor.referencia = grupo?.referencia ?? null;
    servidor.origem_referencia = grupo?.origem ?? 'INDISPONIVEL';
    servidor.atingimento = calcularAtingimento(servidor.media, servidor.referencia);
    servidor.faixa =
      servidor.atingimento === null ? null : faixaDeAtingimento(servidor.atingimento, limites);
  }

  const fechamento = await buscarFechamentoVigente(setorId, competencia);

  return {
    competencia,
    setor,
    dias_uteis: diasUteis,
    feriados,
    grupos,
    servidores: apurados,
    resumo: apurarSetor(
      apurados.map((a) => ({
        servidor_id: a.servidor_id,
        situacao: a.situacao,
        pontos_total: a.pontos_total,
        pontos_base: a.pontos_base,
        pontos_pendentes: a.pontos_pendentes,
        dias_uteis: a.dias_uteis,
        dias_ausencia: a.dias_ausencia,
        dias_efetivos: a.dias_efetivos,
        media: a.media,
        media_base: a.media_base,
        lancamentos_validados: a.lancamentos_validados,
        lancamentos_pendentes: a.lancamentos_pendentes,
        lancamentos_em_andamento: a.lancamentos_em_andamento,
      })),
      lancamentos,
    ),
    fechado: fechamento !== null,
    fechamento,
    limites,
  };
}
