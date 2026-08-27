import { Router } from 'express';
import { z } from 'zod';
import { consultar, consultarUm, emTransacao } from '../infra/banco';
import { registrarAuditoria } from '../infra/auditoria';
import { erroDeRequisicao, erroNaoEncontrado, rota } from '../infra/erros';
import { exigirChefia, garantirSetorSobGestao } from '../infra/autorizacao';
import { competenciaValida, nivelComplexidade, textoObrigatorio, validar } from '../infra/validacao';
import { competenciaDe } from '../dominio/datas';
import { garantirCompetenciaAberta } from '../dominio/fechamento';
import { calcularPontos } from '../dominio/calculo';

export const rotasDeValidacao = Router();
rotasDeValidacao.use(exigirChefia);

/**
 * Como a pontuacao e autodeclarada, a validacao e o unico controle contra
 * inflacao de nivel. Toda alteracao de nivel guarda o valor original, quem
 * mudou e quando, e o servidor consegue ver isso.
 */

interface LinhaFila extends Record<string, unknown> {
  id: number;
  servidor_id: number;
  setor_id: number;
  nivel: number;
  nivel_aplicado: number;
  percentual_papel: number;
  quantidade: number;
  data_conclusao: string;
  situacao: 'PENDENTE' | 'VALIDADO' | 'DEVOLVIDO';
}

rotasDeValidacao.get(
  '/fila',
  rota(async (req, res) => {
    const usuario = req.usuario!;
    const setorId = req.query.setor_id ? Number(req.query.setor_id) : usuario.setor_id;
    garantirSetorSobGestao(usuario, setorId);

    const parametros: unknown[] = [setorId];
    const condicoes = ['l.excluido_em IS NULL', 's.setor_id = $1'];

    const situacao = String(req.query.situacao ?? 'PENDENTE').toUpperCase();
    if (situacao !== 'TODAS') {
      parametros.push(situacao);
      condicoes.push(`l.situacao = $${parametros.length}`);
    }
    if (req.query.competencia) {
      parametros.push(validar(competenciaValida, req.query.competencia));
      condicoes.push(`l.competencia = $${parametros.length}`);
    }
    if (req.query.servidor_id) {
      parametros.push(Number(req.query.servidor_id));
      condicoes.push(`l.servidor_id = $${parametros.length}`);
    }

    const lancamentos = await consultar(
      `SELECT l.id, l.servidor_id, l.processo, l.descricao, l.nivel, l.papel,
              l.quantidade, l.data_conclusao, l.competencia, l.status, l.situacao,
              l.pontos, l.percentual_papel, l.nivel_original, l.justificativa,
              l.link_externo, l.criado_em,
              s.nome AS servidor_nome, s.matricula AS servidor_matricula,
              g.nome AS grupo_nome, n.rotulo AS nivel_rotulo
         FROM lancamentos l
         JOIN servidores s ON s.id = l.servidor_id
         LEFT JOIN grupos g ON g.id = s.grupo_id
         LEFT JOIN niveis_complexidade n ON n.nivel = l.nivel
        WHERE ${condicoes.join(' AND ')}
        ORDER BY l.data_conclusao, s.nome, l.id
        LIMIT 500`,
      parametros,
    );

    const contagem = await consultarUm<{ pendentes: number; devolvidos: number; validados: number }>(
      `SELECT
         count(*) FILTER (WHERE l.situacao = 'PENDENTE')::int  AS pendentes,
         count(*) FILTER (WHERE l.situacao = 'DEVOLVIDO')::int AS devolvidos,
         count(*) FILTER (WHERE l.situacao = 'VALIDADO')::int  AS validados
         FROM lancamentos l
         JOIN servidores s ON s.id = l.servidor_id
        WHERE l.excluido_em IS NULL AND s.setor_id = $1
          AND ($2::date IS NULL OR l.competencia = $2)`,
      [setorId, req.query.competencia ? validar(competenciaValida, req.query.competencia) : null],
    );

    res.json({ lancamentos, contagem });
  }),
);

const esquemaValidacao = z.object({
  nivel: nivelComplexidade.optional(),
  justificativa: z.string().trim().max(1000).optional().nullable(),
});

rotasDeValidacao.post(
  '/:id/validar',
  rota(async (req, res) => {
    const dados = validar(esquemaValidacao, req.body);
    const resultado = await aplicarDecisao(req, Number(req.params.id), 'VALIDADO', dados.justificativa ?? null, dados.nivel);
    res.json(resultado);
  }),
);

const esquemaDevolucao = z.object({
  justificativa: textoObrigatorio('a justificativa da devolucao', 1000),
});

rotasDeValidacao.post(
  '/:id/devolver',
  rota(async (req, res) => {
    const dados = validar(esquemaDevolucao, req.body);
    const resultado = await aplicarDecisao(req, Number(req.params.id), 'DEVOLVIDO', dados.justificativa);
    res.json(resultado);
  }),
);

const esquemaLote = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1, 'Selecione ao menos um lancamento.'),
  acao: z.enum(['VALIDAR', 'DEVOLVER'], {
    errorMap: () => ({ message: 'Escolha validar ou devolver.' }),
  }),
  justificativa: z.string().trim().max(1000).optional().nullable(),
});

/** Acao em lote da fila. Devolucao em lote exige justificativa, igual a individual. */
rotasDeValidacao.post(
  '/lote',
  rota(async (req, res) => {
    const dados = validar(esquemaLote, req.body);
    if (dados.acao === 'DEVOLVER' && !dados.justificativa) {
      throw erroDeRequisicao('Escreva a justificativa da devolucao. Ela e obrigatoria.');
    }

    const situacao = dados.acao === 'VALIDAR' ? 'VALIDADO' : 'DEVOLVIDO';
    const concluidos: number[] = [];
    const recusados: Array<{ id: number; motivo: string }> = [];

    for (const id of dados.ids) {
      try {
        await aplicarDecisao(req, id, situacao, dados.justificativa ?? null);
        concluidos.push(id);
      } catch (erro) {
        recusados.push({
          id,
          motivo: erro instanceof Error ? erro.message : 'Nao foi possivel concluir.',
        });
      }
    }

    res.json({
      processados: concluidos.length,
      recusados,
      mensagem:
        recusados.length === 0
          ? `${concluidos.length} lancamento(s) ${situacao === 'VALIDADO' ? 'validado(s)' : 'devolvido(s)'}.`
          : `${concluidos.length} concluido(s) e ${recusados.length} sem alteracao. Veja os motivos na lista.`,
    });
  }),
);

async function aplicarDecisao(
  req: Parameters<Parameters<typeof rota>[0]>[0],
  id: number,
  situacao: 'VALIDADO' | 'DEVOLVIDO',
  justificativa: string | null,
  novoNivel?: number,
) {
  const usuario = req.usuario!;
  const anterior = await consultarUm<LinhaFila>(
    `SELECT l.*, s.setor_id, s.nome AS servidor_nome
       FROM lancamentos l JOIN servidores s ON s.id = l.servidor_id
      WHERE l.id = $1 AND l.excluido_em IS NULL`,
    [id],
  );
  if (!anterior) throw erroNaoEncontrado('Lancamento nao encontrado.');
  garantirSetorSobGestao(usuario, anterior.setor_id);
  await garantirCompetenciaAberta(anterior.setor_id, competenciaDe(anterior.data_conclusao));

  const nivelMudou = novoNivel !== undefined && novoNivel !== anterior.nivel;
  if (nivelMudou && situacao === 'DEVOLVIDO') {
    throw erroDeRequisicao(
      'Escolha uma acao: corrigir o nivel e validar, ou devolver para o servidor ajustar.',
    );
  }

  const atualizado = await emTransacao(async (cliente) => {
    const nivelFinal = nivelMudou ? novoNivel! : anterior.nivel;
    const linha = await cliente.query(
      `UPDATE lancamentos
          SET situacao = $1,
              justificativa = $2,
              validado_por = $3,
              validado_em = now(),
              nivel = $4,
              nivel_aplicado = $4,
              nivel_original = CASE WHEN $5::boolean
                                    THEN COALESCE(nivel_original, nivel)
                                    ELSE nivel_original END,
              nivel_alterado_por = CASE WHEN $5::boolean THEN $3 ELSE nivel_alterado_por END,
              nivel_alterado_em  = CASE WHEN $5::boolean THEN now() ELSE nivel_alterado_em END,
              atualizado_em = now()
        WHERE id = $6
        RETURNING *`,
      [situacao, justificativa, usuario.id, nivelFinal, nivelMudou, id],
    );

    await registrarAuditoria(
      {
        entidade: 'lancamento',
        entidadeId: id,
        acao: 'ALTERACAO',
        usuario,
        valorAnterior: { situacao: anterior.situacao, nivel: anterior.nivel, pontos: anterior.pontos },
        valorNovo: { situacao, nivel: nivelFinal, pontos: linha.rows[0]?.pontos },
        contexto: nivelMudou
          ? `Nivel corrigido de ${anterior.nivel} para ${nivelFinal} na validacao`
          : situacao === 'VALIDADO'
            ? 'Lancamento validado'
            : 'Lancamento devolvido ao servidor',
      },
      cliente,
    );

    return linha.rows[0];
  });

  return {
    lancamento: atualizado,
    mensagem: nivelMudou
      ? `Nivel corrigido de ${anterior.nivel} para ${novoNivel}. O lancamento passou a valer ${calcularPontos(novoNivel!, Number(anterior.quantidade), Number(anterior.percentual_papel))} ponto(s).`
      : situacao === 'VALIDADO'
        ? 'Lancamento validado.'
        : 'Lancamento devolvido ao servidor.',
  };
}
