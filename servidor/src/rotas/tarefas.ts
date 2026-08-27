import { Router } from 'express';
import { z } from 'zod';
import { consultar, consultarUm } from '../infra/banco';
import { registrarAuditoria } from '../infra/auditoria';
import { erroDeConflito, erroDePermissao, erroNaoEncontrado, rota } from '../infra/erros';
import { ehAdmin, exigirAutenticacao, exigirChefia } from '../infra/autorizacao';
import {
  idNumerico,
  nivelComplexidade,
  textoObrigatorio,
  textoOpcional,
  validar,
} from '../infra/validacao';

export const rotasDeTarefas = Router();
rotasDeTarefas.use(exigirAutenticacao);

/**
 * Catalogo de tarefas do grupo. Serve para o servidor escolher o que fez em
 * vez de digitar do zero, e para o nivel chegar sugerido pelo proprio
 * catalogo — o que reduz a variacao entre pessoas na autodeclaracao.
 */

const esquema = z.object({
  grupo_id: idNumerico('o grupo'),
  nome: textoObrigatorio('o nome da tarefa', 160),
  descricao: textoOpcional(600),
  nivel_sugerido: nivelComplexidade,
  ativa: z.boolean().optional().default(true),
});

const CAMPOS = `
  t.id, t.grupo_id, t.nome, t.descricao, t.nivel_sugerido, t.ativa,
  g.nome AS grupo_nome, g.setor_id, n.rotulo AS nivel_rotulo, n.criterio AS nivel_criterio,
  (SELECT count(*) FROM lancamentos l
    WHERE l.tarefa_id = t.id AND l.excluido_em IS NULL)::int AS lancamentos`;

const DE = `
  FROM tarefas t
  JOIN grupos g ON g.id = t.grupo_id
  LEFT JOIN niveis_complexidade n ON n.nivel = t.nivel_sugerido`;

/** Sem filtro, o servidor recebe as tarefas do proprio grupo. */
rotasDeTarefas.get(
  '/',
  rota(async (req, res) => {
    const usuario = req.usuario!;
    const condicoes = ['t.excluido_em IS NULL', 'g.excluido_em IS NULL'];
    const parametros: unknown[] = [];

    const grupoPedido = req.query.grupo_id ? Number(req.query.grupo_id) : null;
    const grupoId = grupoPedido ?? (req.query.todos === 'true' ? null : usuario.grupo_id);

    if (grupoId !== null) {
      parametros.push(grupoId);
      condicoes.push(`t.grupo_id = $${parametros.length}`);
    } else if (usuario.perfil === 'SERVIDOR') {
      throw erroDePermissao('Você vê apenas as tarefas do seu próprio grupo.');
    } else if (!ehAdmin(usuario)) {
      parametros.push(usuario.setor_id);
      condicoes.push(`g.setor_id = $${parametros.length}`);
    }

    if (req.query.incluir_inativas !== 'true') condicoes.push('t.ativa');

    const tarefas = await consultar(
      `SELECT ${CAMPOS} ${DE} WHERE ${condicoes.join(' AND ')} ORDER BY t.nivel_sugerido, t.nome`,
      parametros,
    );
    res.json({ tarefas });
  }),
);

rotasDeTarefas.post(
  '/',
  exigirChefia,
  rota(async (req, res) => {
    const dados = validar(esquema, req.body);
    await garantirGrupoSobGestao(req.usuario!, dados.grupo_id);

    const criada = await consultarUm<{ id: number }>(
      `INSERT INTO tarefas (grupo_id, nome, descricao, nivel_sugerido, ativa)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [dados.grupo_id, dados.nome, dados.descricao, dados.nivel_sugerido, dados.ativa],
    );
    const tarefa = await buscarTarefa(criada!.id);
    await registrarAuditoria({
      entidade: 'tarefa',
      entidadeId: criada!.id,
      acao: 'CRIACAO',
      usuario: req.usuario,
      valorNovo: tarefa,
    });
    res.status(201).json({ tarefa });
  }),
);

rotasDeTarefas.put(
  '/:id',
  exigirChefia,
  rota(async (req, res) => {
    const id = Number(req.params.id);
    const anterior = await buscarTarefa(id);
    const dados = validar(esquema, req.body);
    await garantirGrupoSobGestao(req.usuario!, anterior.grupo_id);
    await garantirGrupoSobGestao(req.usuario!, dados.grupo_id);

    await consultarUm(
      `UPDATE tarefas
          SET grupo_id = $1, nome = $2, descricao = $3, nivel_sugerido = $4,
              ativa = $5, atualizado_em = now()
        WHERE id = $6 AND excluido_em IS NULL RETURNING id`,
      [dados.grupo_id, dados.nome, dados.descricao, dados.nivel_sugerido, dados.ativa, id],
    );
    const tarefa = await buscarTarefa(id);
    await registrarAuditoria({
      entidade: 'tarefa',
      entidadeId: id,
      acao: 'ALTERACAO',
      usuario: req.usuario,
      valorAnterior: anterior,
      valorNovo: tarefa,
      contexto:
        anterior.nivel_sugerido !== dados.nivel_sugerido
          ? `Nível sugerido alterado de ${anterior.nivel_sugerido} para ${dados.nivel_sugerido}; vale para os próximos lançamentos`
          : undefined,
    });
    res.json({ tarefa });
  }),
);

rotasDeTarefas.delete(
  '/:id',
  exigirChefia,
  rota(async (req, res) => {
    const id = Number(req.params.id);
    const anterior = await buscarTarefa(id);
    await garantirGrupoSobGestao(req.usuario!, anterior.grupo_id);

    if (anterior.lancamentos > 0) {
      throw erroDeConflito(
        `Esta tarefa já foi usada em ${anterior.lancamentos} lançamento(s) e o histórico precisa ser preservado. Desmarque "disponível para lançamento" em vez de excluir.`,
      );
    }

    await consultarUm('UPDATE tarefas SET excluido_em = now() WHERE id = $1 RETURNING id', [id]);
    await registrarAuditoria({
      entidade: 'tarefa',
      entidadeId: id,
      acao: 'EXCLUSAO',
      usuario: req.usuario,
      valorAnterior: anterior,
    });
    res.json({ mensagem: 'Tarefa excluída.' });
  }),
);

interface TarefaCompleta extends Record<string, unknown> {
  id: number;
  grupo_id: number;
  setor_id: number;
  nivel_sugerido: number;
  lancamentos: number;
}

export async function buscarTarefa(id: number): Promise<TarefaCompleta> {
  const tarefa = await consultarUm<TarefaCompleta>(
    `SELECT ${CAMPOS} ${DE} WHERE t.id = $1 AND t.excluido_em IS NULL`,
    [id],
  );
  if (!tarefa) throw erroNaoEncontrado('Tarefa não encontrada.');
  return tarefa;
}

async function garantirGrupoSobGestao(
  usuario: NonNullable<Express.Request['usuario']>,
  grupoId: number,
): Promise<void> {
  const grupo = await consultarUm<{ setor_id: number }>(
    'SELECT setor_id FROM grupos WHERE id = $1 AND excluido_em IS NULL',
    [grupoId],
  );
  if (!grupo) throw erroNaoEncontrado('Grupo não encontrado.');
  if (!ehAdmin(usuario) && grupo.setor_id !== usuario.setor_id) {
    throw erroDePermissao('Você só administra as tarefas dos grupos do seu setor.');
  }
}
