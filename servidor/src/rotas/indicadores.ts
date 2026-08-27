import { Router } from 'express';
import { consultarUm } from '../infra/banco';
import { erroDePermissao, erroNaoEncontrado, rota } from '../infra/erros';
import {
  ehAdmin,
  exigirAutenticacao,
  exigirChefia,
  garantirAcessoAoServidor,
  garantirSetorSobGestao,
} from '../infra/autorizacao';
import { competenciaValida, validar } from '../infra/validacao';
import { competenciaAtual, rotularCompetencia, type DataIso } from '../dominio/datas';
import { apurarCompetencia } from '../dominio/apuracao';
import { lerConsolidadoVigente } from '../dominio/fechamento';
import { ROTULO_DA_FAIXA } from '../dominio/calculo';

export const rotasDeIndicadores = Router();
rotasDeIndicadores.use(exigirAutenticacao);

function competenciaDaConsulta(valor: unknown): string {
  return valor ? validar(competenciaValida, valor) : competenciaAtual();
}

/** Painel do servidor: a propria producao do mes, com a referencia do grupo. */
rotasDeIndicadores.get(
  '/meu-painel',
  rota(async (req, res) => {
    const usuario = req.usuario!;
    const competencia = competenciaDaConsulta(req.query.competencia);
    const apuracao = await apurarCompetencia(usuario.setor_id, competencia);
    const meu = apuracao.servidores.find((s) => s.servidor_id === usuario.id);

    if (!meu) {
      res.json({
        competencia,
        competencia_rotulo: rotularCompetencia(competencia),
        painel: null,
        mensagem:
          'Você ainda não tem apuração neste mês. Registre seus processos concluídos para acompanhar a média.',
      });
      return;
    }

    res.json({
      competencia,
      competencia_rotulo: rotularCompetencia(competencia),
      fechado: apuracao.fechado,
      fechamento: apuracao.fechamento,
      dias_uteis: apuracao.dias_uteis,
      painel: montarPainel(meu, apuracao.grupos),
      limites: apuracao.limites,
      grupo: montarComparacao(meu, apuracao),
      setor: {
        nome: apuracao.setor.nome,
        sigla: apuracao.setor.sigla,
        media_oficial: apuracao.resumo.media_oficial,
        media_contraprova: apuracao.resumo.media_contraprova,
        processos_distintos: apuracao.resumo.processos_distintos,
        total_pontos: apuracao.resumo.total_pontos,
        servidores_apurados: apuracao.resumo.servidores_apurados,
        servidores_sem_apuracao: apuracao.resumo.servidores_sem_apuracao,
      },
    });
  }),
);

/**
 * Onde a pessoa esta em relacao ao grupo, sem expor quem e quem: as medias
 * dos colegas vao anonimas e ordenadas. O objetivo e a pessoa saber o que
 * falta para acompanhar o grupo, nao montar um ranking com nomes.
 */
function montarComparacao(
  meu: Servidor,
  apuracao: Awaited<ReturnType<typeof apurarCompetencia>>,
) {
  const grupo = apuracao.grupos.find((g) => g.grupo_id === meu.grupo_id);
  if (!grupo) return null;

  const colegas = apuracao.servidores.filter(
    (s) => s.grupo_id === meu.grupo_id && s.situacao === 'APURADO' && s.media !== null,
  );

  const ordenadas = [...colegas].sort((a, b) => (b.media ?? 0) - (a.media ?? 0));
  const posicao = ordenadas.findIndex((s) => s.servidor_id === meu.servidor_id) + 1;

  // Quanto falta, em pontos, para a media alcancar a referencia neste mes.
  const faltamPontos =
    grupo.referencia !== null && meu.media !== null && meu.dias_efetivos > 0
      ? Math.max(0, Math.round((grupo.referencia - meu.media) * meu.dias_efetivos * 100) / 100)
      : null;

  return {
    grupo_id: grupo.grupo_id,
    nome: grupo.nome,
    referencia: grupo.referencia,
    origem: grupo.origem,
    servidores_considerados: grupo.servidores_considerados,
    posicao: posicao > 0 ? posicao : null,
    total_no_grupo: ordenadas.length,
    melhor_media: ordenadas.length ? ordenadas[0].media : null,
    faltam_pontos: faltamPontos,
    medias: ordenadas.map((servidor, indice) => ({
      chave: `colega-${indice}`,
      rotulo: servidor.servidor_id === meu.servidor_id ? 'Você' : `Colega ${indice + 1}`,
      media: servidor.media,
      sou_eu: servidor.servidor_id === meu.servidor_id,
      faixa: servidor.faixa,
    })),
  };
}

/**
 * Serie mensal de um servidor: media do mes e referencia do grupo aplicada.
 * Alimenta o grafico de evolucao no painel. Mes fechado vem do consolidado
 * congelado; mes aberto e apurado na hora.
 */
async function montarSerie(
  setorId: number,
  servidorId: number,
  ate: DataIso,
  meses: number,
): Promise<Array<{
  competencia: string;
  competencia_rotulo: string;
  media: number | null;
  referencia: number | null;
  situacao: string;
  fechado: boolean;
  sem_registro: boolean;
}>> {
  const [ano, mes] = ate.split('-').map(Number);
  const serie = [];

  for (let recuo = meses - 1; recuo >= 0; recuo -= 1) {
    const referencia = new Date(Date.UTC(ano, mes - 1 - recuo, 1));
    const competencia = `${referencia.getUTCFullYear()}-${String(
      referencia.getUTCMonth() + 1,
    ).padStart(2, '0')}-01`;

    const consolidado = await lerConsolidadoVigente(setorId, competencia);
    const congelado = consolidado?.servidores?.find((s) => s.servidor_id === servidorId);

    if (congelado) {
      serie.push({
        competencia,
        competencia_rotulo: rotularCompetencia(competencia),
        media: congelado.media === null ? null : Number(congelado.media),
        referencia: congelado.referencia === null ? null : Number(congelado.referencia),
        situacao: congelado.situacao,
        fechado: true,
        sem_registro: Number(congelado.pontos_total) === 0 && Number(congelado.pontos_pendentes) === 0,
      });
      continue;
    }

    const apuracao = await apurarCompetencia(setorId, competencia);
    const linha = apuracao.servidores.find((s) => s.servidor_id === servidorId);
    // Mes em que a pessoa nao lancou nada e mes zerado sao coisas diferentes na
    // leitura do grafico: um nao tem registro, o outro tem media zero.
    const semRegistro =
      !linha ||
      (linha.lancamentos_validados === 0 &&
        linha.lancamentos_pendentes === 0 &&
        linha.lancamentos_em_andamento === 0);

    serie.push({
      competencia,
      competencia_rotulo: rotularCompetencia(competencia),
      media: linha?.media ?? null,
      referencia: linha?.referencia ?? null,
      situacao: linha?.situacao ?? 'SEM_APURACAO',
      fechado: false,
      sem_registro: semRegistro,
    });
  }

  return serie;
}

rotasDeIndicadores.get(
  '/minha-serie',
  rota(async (req, res) => {
    const usuario = req.usuario!;
    const competencia = competenciaDaConsulta(req.query.competencia);
    const meses = Math.min(12, Math.max(3, Number(req.query.meses ?? 6)));
    res.json({ serie: await montarSerie(usuario.setor_id, usuario.id, competencia, meses) });
  }),
);

/** Painel de um servidor especifico: proprio, do setor da chefia ou qualquer um para o admin. */
rotasDeIndicadores.get(
  '/servidor/:id',
  rota(async (req, res) => {
    const usuario = req.usuario!;
    const servidorId = Number(req.params.id);
    const alvo = await garantirAcessoAoServidor(usuario, servidorId);
    const competencia = competenciaDaConsulta(req.query.competencia);

    const apuracao = await apurarCompetencia(alvo.setor_id, competencia);
    const linha = apuracao.servidores.find((s) => s.servidor_id === servidorId);
    if (!linha) throw erroNaoEncontrado('Não há apuração deste servidor no mês escolhido.');

    res.json({
      competencia,
      competencia_rotulo: rotularCompetencia(competencia),
      fechado: apuracao.fechado,
      dias_uteis: apuracao.dias_uteis,
      painel: montarPainel(linha, apuracao.grupos),
      limites: apuracao.limites,
    });
  }),
);

/** Painel do setor: exige chefia do proprio setor ou administracao. */
rotasDeIndicadores.get(
  '/setor',
  exigirChefia,
  rota(async (req, res) => {
    const usuario = req.usuario!;
    const setorId = req.query.setor_id ? Number(req.query.setor_id) : usuario.setor_id;
    garantirSetorSobGestao(usuario, setorId);
    const competencia = competenciaDaConsulta(req.query.competencia);

    const apuracao = await apurarCompetencia(setorId, competencia);
    res.json({
      ...apuracao,
      competencia_rotulo: rotularCompetencia(competencia),
      servidores: apuracao.servidores.map((servidor) => ({
        ...servidor,
        faixa_rotulo: servidor.faixa ? ROTULO_DA_FAIXA[servidor.faixa] : null,
        referencia_rotulo: rotularOrigem(servidor.origem_referencia, apuracao.grupos, servidor.grupo_id),
      })),
    });
  }),
);

/** Relatorio de aderencia: quanto a chefia precisou corrigir por servidor (regra 3). */
rotasDeIndicadores.get(
  '/aderencia',
  exigirChefia,
  rota(async (req, res) => {
    const usuario = req.usuario!;
    const setorId = req.query.setor_id ? Number(req.query.setor_id) : usuario.setor_id;
    garantirSetorSobGestao(usuario, setorId);
    const competencia = competenciaDaConsulta(req.query.competencia);
    const apuracao = await apurarCompetencia(setorId, competencia);

    const linhas = apuracao.servidores
      .map((servidor) => ({
        servidor_id: servidor.servidor_id,
        nome: servidor.nome,
        matricula: servidor.matricula,
        grupo_nome: servidor.grupo_nome,
        lancamentos_avaliados: servidor.lancamentos_avaliados,
        lancamentos_corrigidos: servidor.lancamentos_corrigidos,
        taxa_correcao: servidor.taxa_correcao,
        distribuicao_niveis: servidor.distribuicao_niveis,
      }))
      .sort((a, b) => (b.taxa_correcao ?? -1) - (a.taxa_correcao ?? -1));

    const comTaxa = linhas.filter((l) => l.taxa_correcao !== null);
    const taxaMedia =
      comTaxa.length === 0
        ? null
        : comTaxa.reduce((soma, l) => soma + (l.taxa_correcao ?? 0), 0) / comTaxa.length;

    res.json({
      competencia,
      competencia_rotulo: rotularCompetencia(competencia),
      taxa_media: taxaMedia,
      servidores: linhas,
    });
  }),
);

/** Setores que o usuario pode acompanhar, para alimentar o seletor das telas. */
rotasDeIndicadores.get(
  '/meus-setores',
  rota(async (req, res) => {
    const usuario = req.usuario!;
    if (ehAdmin(usuario)) {
      const { consultar } = await import('../infra/banco');
      const setores = await consultar(
        'SELECT id, nome, sigla FROM setores WHERE excluido_em IS NULL ORDER BY nome',
      );
      res.json({ setores });
      return;
    }
    if (usuario.perfil !== 'CHEFE') throw erroDePermissao('Área restrita a chefia.');
    const setor = await consultarUm(
      'SELECT id, nome, sigla FROM setores WHERE id = $1 AND excluido_em IS NULL',
      [usuario.setor_id],
    );
    res.json({ setores: setor ? [setor] : [] });
  }),
);

type Servidor = Awaited<ReturnType<typeof apurarCompetencia>>['servidores'][number];
type Grupo = Awaited<ReturnType<typeof apurarCompetencia>>['grupos'][number];

function montarPainel(servidor: Servidor, grupos: Grupo[]) {
  const grupo = grupos.find((g) => g.grupo_id === servidor.grupo_id) ?? null;
  return {
    ...servidor,
    faixa_rotulo: servidor.faixa ? ROTULO_DA_FAIXA[servidor.faixa] : null,
    referencia_rotulo: rotularOrigem(servidor.origem_referencia, grupos, servidor.grupo_id),
    grupo: grupo,
  };
}

/**
 * A tela precisa deixar explicito de onde veio a referencia: media isolada
 * nao informa nada sem o parametro de comparacao ao lado.
 */
function rotularOrigem(
  origem: Servidor['origem_referencia'],
  grupos: Grupo[],
  grupoId: number | null,
): string {
  if (origem === 'META_FIXA') {
    const grupo = grupos.find((g) => g.grupo_id === grupoId);
    const data = grupo?.meta_definida_em
      ? new Date(grupo.meta_definida_em).toLocaleDateString('pt-BR')
      : null;
    return data ? `Meta fixa definida em ${data}` : 'Meta fixa definida pelo grupo';
  }
  if (origem === 'MEDIANA_APURADA') return 'Referência apurada no mês';
  return 'Sem referência definida para o grupo';
}
