import { Router } from 'express';
import { z } from 'zod';
import { consultar, consultarUm, emTransacao } from '../infra/banco';
import { registrarAuditoria } from '../infra/auditoria';
import { erroDeConflito, erroNaoEncontrado, rota } from '../infra/erros';
import {
  exigirAdmin,
  exigirAutenticacao,
  exigirChefia,
  garantirSetorSobGestao,
} from '../infra/autorizacao';
import { competenciaValida, idNumerico, textoObrigatorio, validar } from '../infra/validacao';
import { competenciaAtual, rotularCompetencia } from '../dominio/datas';
import { apurarCompetencia } from '../dominio/apuracao';
import {
  buscarFechamentoVigente,
  gravarFechamento,
  lerConsolidado,
} from '../dominio/fechamento';

export const rotasDeFechamentos = Router();
rotasDeFechamentos.use(exigirAutenticacao);

/** Historico de consolidados, inclusive as versoes substituidas por reabertura. */
rotasDeFechamentos.get(
  '/',
  rota(async (req, res) => {
    const usuario = req.usuario!;
    const setorId =
      usuario.perfil === 'ADMIN' && req.query.setor_id
        ? Number(req.query.setor_id)
        : usuario.setor_id;
    if (usuario.perfil !== 'ADMIN') garantirSetorSobGestao(usuario, setorId);

    const fechamentos = await consultar(
      `SELECT f.id, f.setor_id, f.competencia, f.versao, f.vigente,
              f.media_setor_oficial, f.media_setor_contraprova, f.total_pontos,
              f.total_dias_efetivos, f.processos_distintos, f.servidores_apurados,
              f.servidores_sem_apuracao, f.fechado_em, f.reaberto_em,
              f.justificativa_reabertura,
              st.nome AS setor_nome, st.sigla AS setor_sigla,
              fp.nome AS fechado_por_nome, rp.nome AS reaberto_por_nome
         FROM fechamentos f
         JOIN setores st ON st.id = f.setor_id
         JOIN servidores fp ON fp.id = f.fechado_por
         LEFT JOIN servidores rp ON rp.id = f.reaberto_por
        WHERE ($1::int IS NULL OR f.setor_id = $1)
        ORDER BY f.competencia DESC, f.versao DESC`,
      [usuario.perfil === 'ADMIN' && !req.query.setor_id ? null : setorId],
    );
    res.json({ fechamentos });
  }),
);

/** Previa: mostra o que sera congelado antes de fechar de fato. */
rotasDeFechamentos.get(
  '/previa',
  exigirChefia,
  rota(async (req, res) => {
    const usuario = req.usuario!;
    const setorId = req.query.setor_id ? Number(req.query.setor_id) : usuario.setor_id;
    garantirSetorSobGestao(usuario, setorId);
    const competencia = req.query.competencia
      ? validar(competenciaValida, req.query.competencia)
      : competenciaAtual();

    const apuracao = await apurarCompetencia(setorId, competencia);
    const pendentes = apuracao.servidores.reduce((soma, s) => soma + s.lancamentos_pendentes, 0);
    const emAndamento = apuracao.servidores.reduce(
      (soma, s) => soma + s.lancamentos_em_andamento,
      0,
    );

    res.json({
      ...apuracao,
      competencia_rotulo: rotularCompetencia(competencia),
      pendentes_de_validacao: pendentes,
      em_andamento: emAndamento,
      pronto_para_fechar: pendentes === 0,
      alerta:
        pendentes > 0
          ? `Ha ${pendentes} lancamento(s) aguardando validacao. Eles nao entram na media e ficam congelados assim. Valide a fila antes de fechar ou confirme o fechamento assim mesmo.`
          : null,
    });
  }),
);

rotasDeFechamentos.get(
  '/:id',
  rota(async (req, res) => {
    const consolidado = await lerConsolidado(Number(req.params.id));
    if (!consolidado) throw erroNaoEncontrado('Consolidado nao encontrado.');
    const usuario = req.usuario!;
    if (usuario.perfil === 'SERVIDOR' || usuario.perfil === 'CHEFE') {
      garantirSetorSobGestao(
        { ...usuario, perfil: usuario.perfil === 'SERVIDOR' ? 'CHEFE' : usuario.perfil },
        consolidado.setor_id,
      );
    }
    res.json({
      consolidado: {
        ...consolidado,
        competencia_rotulo: rotularCompetencia(consolidado.competencia),
      },
    });
  }),
);

const esquemaFechamento = z.object({
  setor_id: idNumerico('o setor').optional(),
  competencia: competenciaValida,
  confirmar_pendentes: z.boolean().optional().default(false),
});

/**
 * Regra 6: bloqueia a competencia, congela o consolidado e gera o historico.
 * Executado pela chefia do setor ou pela administracao.
 */
rotasDeFechamentos.post(
  '/',
  exigirChefia,
  rota(async (req, res) => {
    const usuario = req.usuario!;
    const dados = validar(esquemaFechamento, req.body);
    const setorId = dados.setor_id ?? usuario.setor_id;
    garantirSetorSobGestao(usuario, setorId);

    const jaFechado = await buscarFechamentoVigente(setorId, dados.competencia);
    if (jaFechado) {
      throw erroDeConflito(
        `A competencia de ${rotularCompetencia(dados.competencia)} ja esta fechada desde ${new Date(jaFechado.fechado_em).toLocaleDateString('pt-BR')}. Reabra o mes antes de fechar de novo.`,
      );
    }

    const apuracao = await apurarCompetencia(setorId, dados.competencia);
    const pendentes = apuracao.servidores.reduce((soma, s) => soma + s.lancamentos_pendentes, 0);
    if (pendentes > 0 && !dados.confirmar_pendentes) {
      throw erroDeConflito(
        `Ha ${pendentes} lancamento(s) na fila de validacao. Eles nao entram na media e ficarao congelados fora da apuracao. Valide a fila ou confirme o fechamento assim mesmo.`,
        { pendentes_de_validacao: pendentes },
      );
    }

    const fechamentoId = await emTransacao(async (cliente) => {
      const id = await gravarFechamento(cliente, apuracao, usuario);
      await registrarAuditoria(
        {
          entidade: 'fechamento',
          entidadeId: id,
          acao: 'CRIACAO',
          usuario,
          valorNovo: {
            setor_id: setorId,
            competencia: dados.competencia,
            resumo: apuracao.resumo,
            pendentes_congelados: pendentes,
          },
          contexto: `Fechamento de ${rotularCompetencia(dados.competencia)}`,
        },
        cliente,
      );
      return id;
    });

    const consolidado = await lerConsolidado(fechamentoId);
    res.status(201).json({
      consolidado,
      mensagem: `Competencia de ${rotularCompetencia(dados.competencia)} fechada. Novos lancamentos e edicoes nesse mes ficam bloqueados.`,
    });
  }),
);

const esquemaReabertura = z.object({
  justificativa: textoObrigatorio('a justificativa da reabertura', 1000),
});

/** Reabertura e ato exclusivo do administrador, com justificativa registrada. */
rotasDeFechamentos.post(
  '/:id/reabrir',
  exigirAdmin,
  rota(async (req, res) => {
    const id = Number(req.params.id);
    const dados = validar(esquemaReabertura, req.body);
    const usuario = req.usuario!;

    const fechamento = await consultarUm<{
      id: number;
      setor_id: number;
      competencia: string;
      reaberto_em: string | null;
      vigente: boolean;
    }>('SELECT id, setor_id, competencia, reaberto_em, vigente FROM fechamentos WHERE id = $1', [id]);
    if (!fechamento) throw erroNaoEncontrado('Consolidado nao encontrado.');
    if (fechamento.reaberto_em) {
      throw erroDeConflito('Este consolidado ja foi reaberto.');
    }
    if (!fechamento.vigente) {
      throw erroDeConflito(
        'Esta e uma versao antiga do consolidado. Reabra a versao vigente da competencia.',
      );
    }

    await emTransacao(async (cliente) => {
      await cliente.query(
        `UPDATE fechamentos
            SET reaberto_por = $1, reaberto_em = now(), justificativa_reabertura = $2
          WHERE id = $3`,
        [usuario.id, dados.justificativa, id],
      );
      await registrarAuditoria(
        {
          entidade: 'fechamento',
          entidadeId: id,
          acao: 'ALTERACAO',
          usuario,
          valorAnterior: { reaberto_em: null },
          valorNovo: { reaberto_em: 'agora', justificativa: dados.justificativa },
          contexto: `Reabertura de ${rotularCompetencia(fechamento.competencia)}`,
        },
        cliente,
      );
    });

    res.json({
      mensagem: `Competencia de ${rotularCompetencia(fechamento.competencia)} reaberta. O consolidado anterior fica preservado no historico; ao fechar de novo sera criada a versao seguinte.`,
    });
  }),
);

/** Comparacao entre competencias fechadas, para a tela de historico. */
rotasDeFechamentos.get(
  '/comparar/serie',
  exigirChefia,
  rota(async (req, res) => {
    const usuario = req.usuario!;
    const setorId = req.query.setor_id ? Number(req.query.setor_id) : usuario.setor_id;
    garantirSetorSobGestao(usuario, setorId);

    const serie = await consultar(
      `SELECT f.competencia, f.versao, f.media_setor_oficial, f.media_setor_contraprova,
              f.total_pontos, f.total_dias_efetivos, f.processos_distintos,
              f.servidores_apurados, f.servidores_sem_apuracao, f.fechado_em
         FROM fechamentos f
        WHERE f.setor_id = $1 AND f.vigente
        ORDER BY f.competencia`,
      [setorId],
    );

    const porServidor = await consultar(
      `SELECT f.competencia, s.id AS servidor_id, s.nome, fs.media, fs.referencia,
              fs.atingimento, fs.faixa, fs.situacao, fs.pontos_total, fs.dias_efetivos
         FROM fechamentos f
         JOIN fechamento_servidores fs ON fs.fechamento_id = f.id
         JOIN servidores s ON s.id = fs.servidor_id
        WHERE f.setor_id = $1 AND f.vigente
        ORDER BY s.nome, f.competencia`,
      [setorId],
    );

    res.json({ serie, por_servidor: porServidor });
  }),
);
