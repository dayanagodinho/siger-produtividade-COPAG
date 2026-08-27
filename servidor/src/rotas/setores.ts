import { Router } from 'express';
import { z } from 'zod';
import { consultar, consultarUm } from '../infra/banco';
import { registrarAuditoria } from '../infra/auditoria';
import { erroDeConflito, erroNaoEncontrado, rota } from '../infra/erros';
import { exigirAdmin, exigirAutenticacao } from '../infra/autorizacao';
import { idNumerico, textoObrigatorio, validar } from '../infra/validacao';

export const rotasDeSetores = Router();
rotasDeSetores.use(exigirAutenticacao);

const esquema = z.object({
  nome: textoObrigatorio('o nome do setor'),
  sigla: textoObrigatorio('a sigla do setor', 20),
  chefe_servidor_id: idNumerico('o chefe responsavel').nullable().optional(),
});

rotasDeSetores.get(
  '/',
  rota(async (_req, res) => {
    const setores = await consultar(
      `SELECT s.id, s.nome, s.sigla, s.chefe_servidor_id,
              c.nome AS chefe_nome,
              (SELECT count(*) FROM servidores v
                WHERE v.setor_id = s.id AND v.excluido_em IS NULL AND v.situacao = 'ATIVO')::int
                AS servidores_ativos,
              (SELECT count(*) FROM grupos g
                WHERE g.setor_id = s.id AND g.excluido_em IS NULL)::int AS grupos
         FROM setores s
         LEFT JOIN servidores c ON c.id = s.chefe_servidor_id
        WHERE s.excluido_em IS NULL
        ORDER BY s.nome`,
    );
    res.json({ setores });
  }),
);

rotasDeSetores.post(
  '/',
  exigirAdmin,
  rota(async (req, res) => {
    const dados = validar(esquema, req.body);
    const criado = await consultarUm(
      `INSERT INTO setores (nome, sigla, chefe_servidor_id)
       VALUES ($1, $2, $3) RETURNING *`,
      [dados.nome, dados.sigla, dados.chefe_servidor_id ?? null],
    );
    await registrarAuditoria({
      entidade: 'setor',
      entidadeId: (criado as { id: number }).id,
      acao: 'CRIACAO',
      usuario: req.usuario,
      valorNovo: criado,
    });
    res.status(201).json({ setor: criado });
  }),
);

rotasDeSetores.put(
  '/:id',
  exigirAdmin,
  rota(async (req, res) => {
    const id = Number(req.params.id);
    const dados = validar(esquema, req.body);
    const anterior = await consultarUm('SELECT * FROM setores WHERE id = $1 AND excluido_em IS NULL', [id]);
    if (!anterior) throw erroNaoEncontrado('Setor nao encontrado.');

    const atualizado = await consultarUm(
      `UPDATE setores
          SET nome = $1, sigla = $2, chefe_servidor_id = $3, atualizado_em = now()
        WHERE id = $4 RETURNING *`,
      [dados.nome, dados.sigla, dados.chefe_servidor_id ?? null, id],
    );
    await registrarAuditoria({
      entidade: 'setor',
      entidadeId: id,
      acao: 'ALTERACAO',
      usuario: req.usuario,
      valorAnterior: anterior,
      valorNovo: atualizado,
    });
    res.json({ setor: atualizado });
  }),
);

rotasDeSetores.delete(
  '/:id',
  exigirAdmin,
  rota(async (req, res) => {
    const id = Number(req.params.id);
    const anterior = await consultarUm('SELECT * FROM setores WHERE id = $1 AND excluido_em IS NULL', [id]);
    if (!anterior) throw erroNaoEncontrado('Setor nao encontrado.');

    const vinculados = await consultarUm<{ total: number }>(
      `SELECT count(*)::int AS total FROM servidores
        WHERE setor_id = $1 AND excluido_em IS NULL`,
      [id],
    );
    if (vinculados && vinculados.total > 0) {
      throw erroDeConflito(
        `Este setor tem ${vinculados.total} servidor(es) vinculado(s). Mova essas pessoas para outro setor antes de excluir.`,
      );
    }

    await consultarUm('UPDATE setores SET excluido_em = now() WHERE id = $1 RETURNING id', [id]);
    await registrarAuditoria({
      entidade: 'setor',
      entidadeId: id,
      acao: 'EXCLUSAO',
      usuario: req.usuario,
      valorAnterior: anterior,
    });
    res.json({ mensagem: 'Setor excluido.' });
  }),
);
