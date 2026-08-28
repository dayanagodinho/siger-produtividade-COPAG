import type { PoolClient } from 'pg';
import { Router } from 'express';
import { z } from 'zod';
import { consultar, consultarUm, emTransacao } from '../infra/banco';
import { registrarAuditoria } from '../infra/auditoria';
import { erroDePermissao, erroDeRequisicao, erroNaoEncontrado, rota } from '../infra/erros';
import {
  alcanceDe,
  condicaoDoAlcance,
  exigirChefia,
  garantirAcessoAoServidor,
} from '../infra/autorizacao';
import { competenciaValida, nivelComplexidade, textoObrigatorio, validar } from '../infra/validacao';
import { competenciaDe } from '../dominio/datas';
import { garantirCompetenciaAberta } from '../dominio/fechamento';
import { calcularPontos } from '../dominio/calculo';
import { carregarParametros } from '../dominio/parametros';

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
    const parametros: unknown[] = [];
    const condicoes = ['l.excluido_em IS NULL'];

    // Quem chefia grupo confere os grupos que chefia; quem chefia o setor
    // confere qualquer um, para cobrir ausencia. A regra e a mesma de toda
    // rota que devolve dado por servidor.
    const alcance = await alcanceDe(usuario);
    const filtro = condicaoDoAlcance(
      alcance,
      { servidor: 'l.servidor_id', grupo: 's.grupo_id', setor: 's.setor_id' },
      parametros,
    );
    if (filtro) condicoes.push(filtro);

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

    // A contagem segue o mesmo alcance da lista: numero no topo que nao bate
    // com o que esta embaixo faz a pessoa procurar um lancamento que ela nao
    // pode ver.
    const doContador: unknown[] = [];
    const filtroDoContador = condicaoDoAlcance(
      alcance,
      { servidor: 'l.servidor_id', grupo: 's.grupo_id', setor: 's.setor_id' },
      doContador,
    );
    doContador.push(
      req.query.competencia ? validar(competenciaValida, req.query.competencia) : null,
    );

    const contagem = await consultarUm<{ pendentes: number; devolvidos: number; validados: number }>(
      `SELECT
         count(*) FILTER (WHERE l.situacao = 'PENDENTE')::int  AS pendentes,
         count(*) FILTER (WHERE l.situacao = 'DEVOLVIDO')::int AS devolvidos,
         count(*) FILTER (WHERE l.situacao = 'VALIDADO')::int  AS validados
         FROM lancamentos l
         JOIN servidores s ON s.id = l.servidor_id
        WHERE l.excluido_em IS NULL
          ${filtroDoContador ? `AND ${filtroDoContador}` : ''}
          AND ($${doContador.length}::date IS NULL OR l.competencia = $${doContador.length})`,
      doContador,
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
  justificativa: textoObrigatorio('a justificativa da devolução', 1000),
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
  ids: z.array(z.coerce.number().int().positive()).min(1, 'Selecione ao menos um lançamento.'),
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
      throw erroDeRequisicao('Escreva a justificativa da devolução. Ela é obrigatória.');
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
          motivo: erro instanceof Error ? erro.message : 'Não foi possível concluir.',
        });
      }
    }

    res.json({
      processados: concluidos.length,
      recusados,
      mensagem:
        recusados.length === 0
          ? `${concluidos.length} lançamento(s) ${situacao === 'VALIDADO' ? 'validado(s)' : 'devolvido(s)'}.`
          : `${concluidos.length} concluído(s) e ${recusados.length} sem alteração. Veja os motivos na lista.`,
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
  if (!anterior) throw erroNaoEncontrado('Lançamento não encontrado.');
  // Confere quem tem o lancamento no proprio alcance — e ninguem confere o
  // que lancou, porque validar a si mesmo esvazia a conferencia.
  await garantirAcessoAoServidor(usuario, anterior.servidor_id);
  if (anterior.servidor_id === usuario.id) {
    throw erroDePermissao('Ninguém confere o próprio lançamento.');
  }
  await garantirCompetenciaAberta(anterior.setor_id, competenciaDe(anterior.data_conclusao));

  const nivelMudou = novoNivel !== undefined && novoNivel !== anterior.nivel;
  if (nivelMudou && situacao === 'DEVOLVIDO') {
    throw erroDeRequisicao(
      'Escolha uma ação: corrigir o nível e validar, ou devolver para o servidor ajustar.',
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
          ? `Nível corrigido de ${anterior.nivel} para ${nivelFinal} na validação`
          : situacao === 'VALIDADO'
            ? 'Lançamento validado'
            : 'Lançamento devolvido ao servidor',
      },
      cliente,
    );

    // A conferencia da equipe e a principal producao do chefe de grupo. Ele
    // nao pode ter de validar na fila e depois lancar isso a mao.
    await ajustarConferencia(cliente, {
      lancamento: linha.rows[0],
      conferidoPor: usuario.id,
      validado: situacao === 'VALIDADO',
    });

    return linha.rows[0];
  });

  return {
    lancamento: atualizado,
    mensagem: nivelMudou
      ? `Nível corrigido de ${anterior.nivel} para ${novoNivel}. O lançamento passou a valer ${calcularPontos(novoNivel!, Number(anterior.quantidade), Number(anterior.percentual_papel))} ponto(s).`
      : situacao === 'VALIDADO'
        ? 'Lançamento validado.'
        : 'Lançamento devolvido ao servidor.',
  };
}

interface LinhaGravada {
  id: number;
  atividade_id: number | null;
  nivel_aplicado: number;
  data_conclusao: string;
  competencia: string;
  servidor_id: number;
}

/**
 * Mantem em dia o lancamento de conferencia que acompanha cada validacao.
 *
 * Validar gera a producao de quem conferiu; desfazer a validacao apaga essa
 * producao. O lancamento gerado nasce ja VALIDADO — nao faz sentido validar a
 * validacao — e carrega origem AUTOMATICO, para nunca se confundir com
 * producao que alguem lancou a mao.
 *
 * O percentual e o piso sao congelados aqui, como em qualquer lancamento:
 * mudar o parametro amanha nao pode reescrever o que ja foi conferido.
 */
async function ajustarConferencia(
  cliente: PoolClient,
  dados: { lancamento: LinhaGravada; conferidoPor: number; validado: boolean },
): Promise<void> {
  const { lancamento, conferidoPor, validado } = dados;

  // Quem confere nao pode colher a propria conferencia.
  const anterior = await cliente.query<{ id: number }>(
    `SELECT id FROM lancamentos
      WHERE lancamento_origem_id = $1 AND excluido_em IS NULL`,
    [lancamento.id],
  );

  if (!validado) {
    // Devolveu: a conferencia deixou de existir, e o ponto dela vai junto.
    if (anterior.rowCount) {
      await cliente.query('UPDATE lancamentos SET excluido_em = now() WHERE id = $1', [
        anterior.rows[0].id,
      ]);
    }
    return;
  }

  const { pesos, minimoHomologacao } = await carregarParametros();

  if (anterior.rowCount) {
    // Revalidou com outro nivel: a conferencia acompanha o nivel conferido.
    await cliente.query(
      `UPDATE lancamentos
          SET nivel = $1, nivel_aplicado = $1, data_conclusao = $2,
              validado_por = $3, validado_em = now(), atualizado_em = now()
        WHERE id = $4`,
      [lancamento.nivel_aplicado, lancamento.data_conclusao, conferidoPor, anterior.rows[0].id],
    );
    return;
  }

  await cliente.query(
    `INSERT INTO lancamentos
       (servidor_id, atividade_id, processo, descricao, nivel, papel, quantidade,
        data_conclusao, status, situacao, nivel_aplicado, percentual_papel,
        pontos_minimos, criado_por, origem, lancamento_origem_id,
        validado_por, validado_em)
     VALUES ($1, $2, NULL, $3, $4, 'HOMOLOGACAO', 1, $5, 'CONCLUIDO', 'VALIDADO',
             $4, $6, $7, $1, 'AUTOMATICO', $8, $1, now())`,
    [
      conferidoPor,
      lancamento.atividade_id,
      'Conferência de lançamento da equipe',
      lancamento.nivel_aplicado,
      lancamento.data_conclusao,
      pesos.HOMOLOGACAO,
      minimoHomologacao,
      lancamento.id,
    ],
  );
}
