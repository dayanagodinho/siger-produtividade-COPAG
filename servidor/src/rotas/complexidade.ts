import { Router } from 'express';
import { z } from 'zod';
import { consultar, consultarUm } from '../infra/banco';
import { registrarAuditoria } from '../infra/auditoria';
import { erroNaoEncontrado, rota } from '../infra/erros';
import { exigirAdmin, exigirAutenticacao } from '../infra/autorizacao';
import { nivelComplexidade, textoObrigatorio, validar } from '../infra/validacao';

export const rotasDeComplexidade = Router();
rotasDeComplexidade.use(exigirAutenticacao);

/**
 * A tabela de complexidade e lida por todo mundo: os criterios precisam
 * aparecer na tela de lancamento, ao lado do seletor de nivel. Pontuacao
 * autodeclarada sem criterio visivel vira chute.
 */
rotasDeComplexidade.get(
  '/',
  rota(async (_req, res) => {
    const niveis = await consultar(
      'SELECT nivel, rotulo, criterio, ativo, atualizado_em FROM niveis_complexidade ORDER BY nivel',
    );
    res.json({ niveis });
  }),
);

const esquema = z.object({
  rotulo: textoObrigatorio('o rotulo do nivel', 60),
  criterio: textoObrigatorio('a descricao do criterio', 600),
  ativo: z.boolean().optional().default(true),
});

rotasDeComplexidade.put(
  '/:nivel',
  exigirAdmin,
  rota(async (req, res) => {
    const nivel = validar(nivelComplexidade, req.params.nivel);
    const dados = validar(esquema, req.body);

    const anterior = await consultarUm('SELECT * FROM niveis_complexidade WHERE nivel = $1', [nivel]);
    if (!anterior) throw erroNaoEncontrado('Nivel de complexidade nao encontrado.');

    const atualizado = await consultarUm(
      `UPDATE niveis_complexidade
          SET rotulo = $1, criterio = $2, ativo = $3, atualizado_em = now()
        WHERE nivel = $4 RETURNING *`,
      [dados.rotulo, dados.criterio, dados.ativo, nivel],
    );
    await registrarAuditoria({
      entidade: 'nivel_complexidade',
      entidadeId: nivel,
      acao: 'ALTERACAO',
      usuario: req.usuario,
      valorAnterior: anterior,
      valorNovo: atualizado,
    });
    res.json({ nivel: atualizado });
  }),
);
