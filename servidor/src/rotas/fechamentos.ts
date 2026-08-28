import { Router } from 'express';
import { z } from 'zod';
import { consultar, consultarUm, emTransacao } from '../infra/banco';
import { registrarAuditoria } from '../infra/auditoria';
import { erroDeConflito, erroDePermissao, erroNaoEncontrado, rota } from '../infra/erros';
import {
  ehChefeDeSetor,
  exigirAdmin,
  exigirAutenticacao,
  exigirChefia,
  garantirSetorSobGestao,
} from '../infra/autorizacao';
import { competenciaValida, idNumerico, textoObrigatorio, validar } from '../infra/validacao';
import { competenciaAtual, rotularCompetencia } from '../dominio/datas';
import { apurarCompetencia } from '../dominio/apuracao';
import {
  buscarFechamentoDeGrupo,
  buscarFechamentoVigente,
  garantirCompetenciaAberta,
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
          ? `Há ${pendentes} lançamento(s) que a chefia ainda não conferiu. Eles contam na média e serão congelados assim. Confira a fila antes de fechar, ou confirme o fechamento assim mesmo.`
          : null,
    });
  }),
);

/**
 * Situacao de cada grupo do setor na competencia: quem fechou, quando, e o
 * que ainda esta aberto. E por aqui que o painel sabe se pode fechar o setor.
 */
rotasDeFechamentos.get(
  '/grupos',
  exigirChefia,
  rota(async (req, res) => {
    const usuario = req.usuario!;
    const setorId = req.query.setor_id ? Number(req.query.setor_id) : usuario.setor_id;
    const competencia = req.query.competencia
      ? validar(competenciaValida, req.query.competencia)
      : competenciaAtual();

    const grupos = await consultar<{
      grupo_id: number;
      nome: string;
      chefe_id: number | null;
      chefe_nome: string | null;
      fechamento_id: number | null;
      fechado_em: string | null;
      fechado_por_nome: string | null;
      versao: number | null;
    }>(
      `SELECT g.id AS grupo_id, g.nome, g.chefe_id, c.nome AS chefe_nome,
              fg.id AS fechamento_id, fg.fechado_em, fp.nome AS fechado_por_nome, fg.versao
         FROM grupos g
         LEFT JOIN servidores c ON c.id = g.chefe_id
         LEFT JOIN fechamentos_grupo fg
                ON fg.grupo_id = g.id AND fg.competencia = $2
               AND fg.vigente AND fg.reaberto_em IS NULL
         LEFT JOIN servidores fp ON fp.id = fg.fechado_por
        WHERE g.setor_id = $1 AND g.excluido_em IS NULL
        ORDER BY g.nome`,
      [setorId, competencia],
    );

    const abertos = grupos.filter((g) => g.fechamento_id === null);
    res.json({
      competencia,
      competencia_rotulo: rotularCompetencia(competencia),
      grupos,
      grupos_abertos: abertos.length,
      setor_pode_fechar: abertos.length === 0 && grupos.length > 0,
    });
  }),
);

const esquemaFechamentoDeGrupo = z.object({
  grupo_id: idNumerico('o grupo'),
  competencia: competenciaValida,
  confirmar_pendentes: z.boolean().optional().default(false),
});

/**
 * Fechamento de grupo, o primeiro estagio.
 *
 * Executado por quem chefia o grupo, ou pela chefia do setor por cima —
 * ferias de chefe nao podem travar o mes inteiro. Quem agiu fica registrado
 * de qualquer jeito, e e isso que permite explicar depois por que o grupo dos
 * Parlamentares foi fechado por outra pessoa.
 */
rotasDeFechamentos.post(
  '/grupos',
  exigirChefia,
  rota(async (req, res) => {
    const usuario = req.usuario!;
    const dados = validar(esquemaFechamentoDeGrupo, req.body);

    const grupo = await consultarUm<{ id: number; nome: string; setor_id: number; chefe_id: number | null }>(
      'SELECT id, nome, setor_id, chefe_id FROM grupos WHERE id = $1 AND excluido_em IS NULL',
      [dados.grupo_id],
    );
    if (!grupo) throw erroNaoEncontrado('Grupo não encontrado.');

    const souOChefe = grupo.chefe_id === usuario.id;
    if (!souOChefe && !ehChefeDeSetor(usuario)) {
      throw erroDePermissao(
        `Só quem chefia ${grupo.nome} ou a chefia do setor pode fechar este grupo.`,
      );
    }
    if (ehChefeDeSetor(usuario)) garantirSetorSobGestao(usuario, grupo.setor_id);

    const jaFechado = await buscarFechamentoDeGrupo(grupo.id, dados.competencia);
    if (jaFechado) {
      throw erroDeConflito(
        `${grupo.nome} já fechou ${rotularCompetencia(dados.competencia)} em ` +
          `${new Date(jaFechado.fechado_em).toLocaleDateString('pt-BR')}, por ${jaFechado.fechado_por_nome}.`,
      );
    }
    await garantirCompetenciaAberta(grupo.setor_id, dados.competencia);

    const apuracao = await apurarCompetencia(grupo.setor_id, dados.competencia);
    const doGrupo = apuracao.servidores.filter((s) => s.grupo_id === grupo.id);
    const pendentes = doGrupo.reduce((soma, s) => soma + s.lancamentos_pendentes, 0);
    if (pendentes > 0 && !dados.confirmar_pendentes) {
      throw erroDeConflito(
        `Há ${pendentes} lançamento(s) de ${grupo.nome} que ninguém conferiu. Eles contam na média e o fechamento vai congelá-los assim. Confira a fila ou confirme assim mesmo.`,
        { pendentes_de_validacao: pendentes },
      );
    }

    const id = await emTransacao(async (cliente) => {
      const anteriores = await cliente.query<{ versao: number }>(
        'SELECT max(versao) AS versao FROM fechamentos_grupo WHERE grupo_id = $1 AND competencia = $2',
        [grupo.id, dados.competencia],
      );
      const versao = Number(anteriores.rows[0]?.versao ?? 0) + 1;
      await cliente.query(
        'UPDATE fechamentos_grupo SET vigente = FALSE WHERE grupo_id = $1 AND competencia = $2',
        [grupo.id, dados.competencia],
      );
      const inserido = await cliente.query<{ id: number }>(
        `INSERT INTO fechamentos_grupo (grupo_id, competencia, versao, vigente, fechado_por)
         VALUES ($1, $2, $3, TRUE, $4) RETURNING id`,
        [grupo.id, dados.competencia, versao, usuario.id],
      );
      await registrarAuditoria(
        {
          entidade: 'fechamento_grupo',
          entidadeId: inserido.rows[0].id,
          acao: 'CRIACAO',
          usuario,
          valorNovo: {
            grupo: grupo.nome,
            competencia: dados.competencia,
            versao,
            pendentes_congelados: pendentes,
            servidores: doGrupo.length,
          },
          contexto: souOChefe
            ? `Fechamento de ${grupo.nome} em ${rotularCompetencia(dados.competencia)}`
            : `Fechamento de ${grupo.nome} em ${rotularCompetencia(dados.competencia)}, pela chefia do setor`,
        },
        cliente,
      );
      return inserido.rows[0].id;
    });

    res.status(201).json({
      fechamento_id: id,
      mensagem:
        `${grupo.nome} fechou ${rotularCompetencia(dados.competencia)}. ` +
        'Os lançamentos desse mês, nesse grupo, ficam bloqueados.',
    });
  }),
);

/** Reabrir grupo e ato exclusivo do administrador, com justificativa. */
rotasDeFechamentos.post(
  '/grupos/:id/reabrir',
  exigirAdmin,
  rota(async (req, res) => {
    const id = Number(req.params.id);
    const dados = validar(esquemaReabertura, req.body);
    const usuario = req.usuario!;

    const fechamento = await consultarUm<{
      id: number;
      grupo_id: number;
      grupo_nome: string;
      setor_id: number;
      competencia: string;
      reaberto_em: string | null;
      vigente: boolean;
    }>(
      `SELECT fg.id, fg.grupo_id, g.nome AS grupo_nome, g.setor_id, fg.competencia,
              fg.reaberto_em, fg.vigente
         FROM fechamentos_grupo fg JOIN grupos g ON g.id = fg.grupo_id
        WHERE fg.id = $1`,
      [id],
    );
    if (!fechamento) throw erroNaoEncontrado('Fechamento de grupo não encontrado.');
    if (fechamento.reaberto_em) throw erroDeConflito('Este fechamento já foi reaberto.');
    if (!fechamento.vigente) {
      throw erroDeConflito('Esta é uma versão antiga. Reabra a versão vigente do grupo.');
    }

    const doSetor = await buscarFechamentoVigente(fechamento.setor_id, fechamento.competencia);

    await emTransacao(async (cliente) => {
      await cliente.query(
        `UPDATE fechamentos_grupo
            SET reaberto_por = $1, reaberto_em = now(), justificativa = $2
          WHERE id = $3`,
        [usuario.id, dados.justificativa, id],
      );

      // Reabrir um grupo invalida o fechamento do setor: o consolidado foi
      // calculado com este grupo dentro, e agora ele pode mudar.
      if (doSetor) {
        await cliente.query(
          `UPDATE fechamentos
              SET reaberto_por = $1, reaberto_em = now(),
                  justificativa_reabertura = $2
            WHERE id = $3`,
          [
            usuario.id,
            `Reaberto junto com o grupo ${fechamento.grupo_nome}: ${dados.justificativa}`,
            doSetor.id,
          ],
        );
      }

      await registrarAuditoria(
        {
          entidade: 'fechamento_grupo',
          entidadeId: id,
          acao: 'ALTERACAO',
          usuario,
          valorAnterior: { reaberto_em: null },
          valorNovo: { reaberto_em: 'agora', justificativa: dados.justificativa },
          contexto:
            `Reabertura de ${fechamento.grupo_nome} em ${rotularCompetencia(fechamento.competencia)}` +
            (doSetor ? ', com o fechamento do setor invalidado junto' : ''),
        },
        cliente,
      );
    });

    res.json({
      mensagem:
        `${fechamento.grupo_nome} reaberto em ${rotularCompetencia(fechamento.competencia)}.` +
        (doSetor
          ? ' O fechamento do setor foi invalidado junto e precisa ser refeito depois.'
          : ''),
    });
  }),
);

rotasDeFechamentos.get(
  '/:id',
  rota(async (req, res) => {
    const consolidado = await lerConsolidado(Number(req.params.id));
    if (!consolidado) throw erroNaoEncontrado('Consolidado não encontrado.');
    const usuario = req.usuario!;
    // O consolidado e do setor inteiro: quem nao manda no setor nao o abre.
    if (!ehChefeDeSetor(usuario) || usuario.setor_id !== consolidado.setor_id) {
      garantirSetorSobGestao(usuario, consolidado.setor_id);
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
        `A competência de ${rotularCompetencia(dados.competencia)} já está fechada desde ${new Date(jaFechado.fechado_em).toLocaleDateString('pt-BR')}. Reabra o mês antes de fechar de novo.`,
      );
    }

    // O fechamento do setor e o segundo estagio: so acontece depois que
    // todos os grupos fecharam. Fechar por cima de grupo aberto congelaria
    // numero que o chefe daquele grupo ainda ia mexer.
    const abertos = await consultar<{ nome: string }>(
      `SELECT g.nome
         FROM grupos g
         LEFT JOIN fechamentos_grupo fg
                ON fg.grupo_id = g.id AND fg.competencia = $2
               AND fg.vigente AND fg.reaberto_em IS NULL
        WHERE g.setor_id = $1 AND g.excluido_em IS NULL AND fg.id IS NULL
        ORDER BY g.nome`,
      [setorId, dados.competencia],
    );
    if (abertos.length) {
      throw erroDeConflito(
        `Ainda não fecharam ${rotularCompetencia(dados.competencia)}: ` +
          `${abertos.map((g) => g.nome).join(', ')}. ` +
          'O setor só fecha depois que todos os grupos fecharem.',
        { grupos_abertos: abertos.map((g) => g.nome) },
      );
    }

    const apuracao = await apurarCompetencia(setorId, dados.competencia);
    const pendentes = apuracao.servidores.reduce((soma, s) => soma + s.lancamentos_pendentes, 0);
    if (pendentes > 0 && !dados.confirmar_pendentes) {
      throw erroDeConflito(
        `Há ${pendentes} lançamento(s) que a chefia ainda não conferiu. Eles contam na média e o fechamento vai congelá-los assim. Confira a fila ou confirme o fechamento assim mesmo.`,
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
      mensagem: `Competência de ${rotularCompetencia(dados.competencia)} fechada. Novos lançamentos e edições nesse mês ficam bloqueados.`,
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
    if (!fechamento) throw erroNaoEncontrado('Consolidado não encontrado.');
    if (fechamento.reaberto_em) {
      throw erroDeConflito('Este consolidado já foi reaberto.');
    }
    if (!fechamento.vigente) {
      throw erroDeConflito(
        'Esta é uma versão antiga do consolidado. Reabra a versão vigente da competência.',
      );
    }

    const reabertos = await emTransacao(async (cliente) => {
      await cliente.query(
        `UPDATE fechamentos
            SET reaberto_por = $1, reaberto_em = now(), justificativa_reabertura = $2
          WHERE id = $3`,
        [usuario.id, dados.justificativa, id],
      );

      // Reabrir o setor reabre os grupos: sem isso o mes ficaria destravado
      // por cima e travado por baixo, e ninguem conseguiria corrigir nada.
      const grupos = await cliente.query<{ grupo_id: number }>(
        `UPDATE fechamentos_grupo fg
            SET reaberto_por = $1, reaberto_em = now(),
                justificativa = $2
           FROM grupos g
          WHERE g.id = fg.grupo_id AND g.setor_id = $3
            AND fg.competencia = $4 AND fg.vigente AND fg.reaberto_em IS NULL
          RETURNING fg.grupo_id`,
        [
          usuario.id,
          `Reaberto junto com o setor: ${dados.justificativa}`,
          fechamento.setor_id,
          fechamento.competencia,
        ],
      );

      await registrarAuditoria(
        {
          entidade: 'fechamento',
          entidadeId: id,
          acao: 'ALTERACAO',
          usuario,
          valorAnterior: { reaberto_em: null },
          valorNovo: {
            reaberto_em: 'agora',
            justificativa: dados.justificativa,
            grupos_reabertos: grupos.rowCount ?? 0,
          },
          contexto: `Reabertura de ${rotularCompetencia(fechamento.competencia)}`,
        },
        cliente,
      );

      return grupos.rowCount ?? 0;
    });

    res.json({
      mensagem:
        `Competência de ${rotularCompetencia(fechamento.competencia)} reaberta` +
        (reabertos ? `, junto com ${reabertos} grupo(s)` : '') +
        '. O consolidado anterior fica preservado no histórico; ao fechar de novo será criada a versão seguinte.',
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
