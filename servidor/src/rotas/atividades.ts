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

export const rotasDeAtividades = Router();
rotasDeAtividades.use(exigirAutenticacao);

/**
 * Catalogo de atividades do grupo. Serve para o servidor escolher o que fez em
 * vez de digitar do zero, e para o nivel chegar sugerido pelo proprio
 * catalogo — o que reduz a variacao entre pessoas na autodeclaracao.
 */

const esquema = z.object({
  grupo_id: idNumerico('o grupo'),
  numero: textoOpcional(20),
  nome: textoObrigatorio('o nome da atividade', 400),
  descricao: textoOpcional(600),
  entrega: textoOpcional(400),
  // Enquanto o setor não define o peso da atividade, o nível fica em aberto.
  nivel_sugerido: nivelComplexidade.nullable().optional(),
  ativa: z.boolean().optional().default(true),
});

const CAMPOS = `
  t.id, t.grupo_id, t.numero, t.nome, t.descricao, t.entrega, t.nivel_sugerido, t.ativa,
  g.nome AS grupo_nome, g.setor_id, n.rotulo AS nivel_rotulo, n.criterio AS nivel_criterio,
  (SELECT count(*) FROM lancamentos l
    WHERE l.atividade_id = t.id AND l.excluido_em IS NULL)::int AS lancamentos,
  COALESCE(
    (SELECT json_agg(json_build_object('numero', d.numero, 'texto', d.texto) ORDER BY d.ordem)
       FROM detalhamentos d WHERE d.atividade_id = t.id),
    '[]'::json
  ) AS detalhamentos`;

const DE = `
  FROM atividades t
  JOIN grupos g ON g.id = t.grupo_id
  LEFT JOIN niveis_complexidade n ON n.nivel = t.nivel_sugerido`;

/** Sem filtro, o servidor recebe as atividades do proprio grupo. */
rotasDeAtividades.get(
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
      throw erroDePermissao('Você vê apenas as atividades do seu próprio grupo.');
    } else if (!ehAdmin(usuario)) {
      parametros.push(usuario.setor_id);
      condicoes.push(`g.setor_id = $${parametros.length}`);
    }

    if (req.query.incluir_inativas !== 'true') condicoes.push('t.ativa');

    const atividades = await consultar(
      `SELECT ${CAMPOS} ${DE} WHERE ${condicoes.join(' AND ')} ORDER BY nullif(regexp_replace(coalesce(t.numero, '999'), '\\D', '', 'g'), '')::int NULLS LAST, t.nome`,
      parametros,
    );
    res.json({ atividades });
  }),
);

rotasDeAtividades.post(
  '/',
  exigirChefia,
  rota(async (req, res) => {
    const dados = validar(esquema, req.body);
    await garantirGrupoSobGestao(req.usuario!, dados.grupo_id);

    const criada = await consultarUm<{ id: number }>(
      `INSERT INTO atividades (grupo_id, numero, nome, descricao, entrega, nivel_sugerido, ativa)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        dados.grupo_id, dados.numero, dados.nome, dados.descricao, dados.entrega,
        dados.nivel_sugerido ?? null, dados.ativa,
      ],
    );
    const atividade = await buscarAtividade(criada!.id);
    await registrarAuditoria({
      entidade: 'atividade',
      entidadeId: criada!.id,
      acao: 'CRIACAO',
      usuario: req.usuario,
      valorNovo: atividade,
    });
    res.status(201).json({ atividade });
  }),
);

rotasDeAtividades.put(
  '/:id',
  exigirChefia,
  rota(async (req, res) => {
    const id = Number(req.params.id);
    const anterior = await buscarAtividade(id);
    const dados = validar(esquema, req.body);
    await garantirGrupoSobGestao(req.usuario!, anterior.grupo_id);
    await garantirGrupoSobGestao(req.usuario!, dados.grupo_id);

    await consultarUm(
      `UPDATE atividades
          SET grupo_id = $1, numero = $2, nome = $3, descricao = $4, entrega = $5,
              nivel_sugerido = $6, ativa = $7, atualizado_em = now()
        WHERE id = $8 AND excluido_em IS NULL RETURNING id`,
      [
        dados.grupo_id, dados.numero, dados.nome, dados.descricao, dados.entrega,
        dados.nivel_sugerido ?? null, dados.ativa, id,
      ],
    );
    const atividade = await buscarAtividade(id);
    await registrarAuditoria({
      entidade: 'atividade',
      entidadeId: id,
      acao: 'ALTERACAO',
      usuario: req.usuario,
      valorAnterior: anterior,
      valorNovo: atividade,
      contexto:
        anterior.nivel_sugerido !== dados.nivel_sugerido
          ? `Nível sugerido alterado de ${anterior.nivel_sugerido} para ${dados.nivel_sugerido}; vale para os próximos lançamentos`
          : undefined,
    });
    res.json({ atividade });
  }),
);

rotasDeAtividades.delete(
  '/:id',
  exigirChefia,
  rota(async (req, res) => {
    const id = Number(req.params.id);
    const anterior = await buscarAtividade(id);
    await garantirGrupoSobGestao(req.usuario!, anterior.grupo_id);

    if (anterior.lancamentos > 0) {
      throw erroDeConflito(
        `Esta atividade já foi usada em ${anterior.lancamentos} lançamento(s) e o histórico precisa ser preservado. Desmarque "disponível para lançamento" em vez de excluir.`,
      );
    }

    await consultarUm('UPDATE atividades SET excluido_em = now() WHERE id = $1 RETURNING id', [id]);
    await registrarAuditoria({
      entidade: 'atividade',
      entidadeId: id,
      acao: 'EXCLUSAO',
      usuario: req.usuario,
      valorAnterior: anterior,
    });
    res.json({ mensagem: 'Atividade excluída.' });
  }),
);

interface AtividadeCompleta extends Record<string, unknown> {
  id: number;
  grupo_id: number;
  setor_id: number;
  nivel_sugerido: number | null;
  lancamentos: number;
}

export async function buscarAtividade(id: number): Promise<AtividadeCompleta> {
  const atividade = await consultarUm<AtividadeCompleta>(
    `SELECT ${CAMPOS} ${DE} WHERE t.id = $1 AND t.excluido_em IS NULL`,
    [id],
  );
  if (!atividade) throw erroNaoEncontrado('Atividade não encontrada.');
  return atividade;
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
    throw erroDePermissao('Você só administra as atividades dos grupos do seu setor.');
  }
}
