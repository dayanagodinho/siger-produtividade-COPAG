import { Router } from 'express';
import { z } from 'zod';
import { consultar, consultarUm } from '../infra/banco';
import { registrarAuditoria } from '../infra/auditoria';
import { erroDeConflito, erroNaoEncontrado, rota } from '../infra/erros';
import { exigirAdmin, exigirAutenticacao } from '../infra/autorizacao';
import { idNumerico, textoObrigatorio, textoOpcional, validar } from '../infra/validacao';

export const rotasDeGrupos = Router();
rotasDeGrupos.use(exigirAutenticacao);

const esquema = z.object({
  setor_id: idNumerico('o setor'),
  nome: textoObrigatorio('o nome do grupo'),
  descricao: textoOpcional(500),
  meta_referencia: z.coerce
    .number()
    .positive('A meta de referência precisa ser maior que zero.')
    .nullable()
    .optional(),
});

rotasDeGrupos.get(
  '/',
  rota(async (req, res) => {
    const setorId = req.query.setor_id ? Number(req.query.setor_id) : null;
    const grupos = await consultar(
      `SELECT g.id, g.setor_id, g.nome, g.descricao, g.meta_referencia, g.meta_definida_em,
              s.nome AS setor_nome, s.sigla AS setor_sigla,
              (SELECT count(*) FROM servidores v
                WHERE v.grupo_id = g.id AND v.excluido_em IS NULL AND v.situacao = 'ATIVO')::int
                AS servidores_ativos
         FROM grupos g
         JOIN setores s ON s.id = g.setor_id
        WHERE g.excluido_em IS NULL
          AND ($1::int IS NULL OR g.setor_id = $1)
        ORDER BY s.nome, g.nome`,
      [setorId],
    );
    res.json({ grupos });
  }),
);

rotasDeGrupos.post(
  '/',
  exigirAdmin,
  rota(async (req, res) => {
    const dados = validar(esquema, req.body);
    const meta = dados.meta_referencia ?? null;
    const criado = await consultarUm(
      `INSERT INTO grupos (setor_id, nome, descricao, meta_referencia, meta_definida_em)
       VALUES ($1, $2, $3, $4, CASE WHEN $4::numeric IS NULL THEN NULL ELSE now() END)
       RETURNING *`,
      [dados.setor_id, dados.nome, dados.descricao, meta],
    );
    await registrarAuditoria({
      entidade: 'grupo',
      entidadeId: (criado as { id: number }).id,
      acao: 'CRIACAO',
      usuario: req.usuario,
      valorNovo: criado,
    });
    res.status(201).json({ grupo: criado });
  }),
);

rotasDeGrupos.put(
  '/:id',
  exigirAdmin,
  rota(async (req, res) => {
    const id = Number(req.params.id);
    const dados = validar(esquema, req.body);
    const anterior = await consultarUm<{ meta_referencia: number | null }>(
      'SELECT * FROM grupos WHERE id = $1 AND excluido_em IS NULL',
      [id],
    );
    if (!anterior) throw erroNaoEncontrado('Grupo não encontrado.');

    const meta = dados.meta_referencia ?? null;
    const metaMudou = Number(anterior.meta_referencia ?? 0) !== Number(meta ?? 0);

    const atualizado = await consultarUm(
      `UPDATE grupos
          SET setor_id = $1, nome = $2, descricao = $3, meta_referencia = $4,
              meta_definida_em = CASE
                WHEN $4::numeric IS NULL THEN NULL
                WHEN $5::boolean THEN now()
                ELSE meta_definida_em
              END,
              atualizado_em = now()
        WHERE id = $6
        RETURNING *`,
      [dados.setor_id, dados.nome, dados.descricao, meta, metaMudou, id],
    );
    await registrarAuditoria({
      entidade: 'grupo',
      entidadeId: id,
      acao: 'ALTERACAO',
      usuario: req.usuario,
      valorAnterior: anterior,
      valorNovo: atualizado,
      contexto: metaMudou ? 'Meta de referência alterada' : undefined,
    });
    res.json({ grupo: atualizado });
  }),
);

rotasDeGrupos.delete(
  '/:id',
  exigirAdmin,
  rota(async (req, res) => {
    const id = Number(req.params.id);
    const anterior = await consultarUm('SELECT * FROM grupos WHERE id = $1 AND excluido_em IS NULL', [id]);
    if (!anterior) throw erroNaoEncontrado('Grupo não encontrado.');

    const vinculados = await consultarUm<{ total: number }>(
      `SELECT count(*)::int AS total FROM servidores WHERE grupo_id = $1 AND excluido_em IS NULL`,
      [id],
    );
    if (vinculados && vinculados.total > 0) {
      throw erroDeConflito(
        `Este grupo tem ${vinculados.total} servidor(es) vinculado(s). Mova essas pessoas para outro grupo antes de excluir.`,
      );
    }

    await consultarUm('UPDATE grupos SET excluido_em = now() WHERE id = $1 RETURNING id', [id]);
    await registrarAuditoria({
      entidade: 'grupo',
      entidadeId: id,
      acao: 'EXCLUSAO',
      usuario: req.usuario,
      valorAnterior: anterior,
    });
    res.json({ mensagem: 'Grupo excluído.' });
  }),
);
