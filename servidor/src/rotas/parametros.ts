import { Router } from 'express';
import { z } from 'zod';
import { consultar, consultarUm } from '../infra/banco';
import { registrarAuditoria } from '../infra/auditoria';
import { erroNaoEncontrado, rota } from '../infra/erros';
import { exigirAdmin, exigirAutenticacao } from '../infra/autorizacao';
import { validar } from '../infra/validacao';

export const rotasDeParametros = Router();
rotasDeParametros.use(exigirAutenticacao);

rotasDeParametros.get(
  '/',
  rota(async (_req, res) => {
    const parametros = await consultar(
      `SELECT p.chave, p.valor, p.descricao, p.atualizado_em, s.nome AS atualizado_por_nome
         FROM parametros p
         LEFT JOIN servidores s ON s.id = p.atualizado_por
        ORDER BY p.chave`,
    );
    res.json({ parametros });
  }),
);

const esquema = z.object({
  valor: z.coerce
    .number({ invalid_type_error: 'Informe um número.' })
    .min(0, 'O valor não pode ser negativo.')
    .max(1000, 'O valor máximo aceito é 1000.'),
});

/**
 * Alterar um parametro nunca muda o passado: os lancamentos ja gravados
 * guardam o percentual aplicado no momento do registro (regra 2.6).
 */
rotasDeParametros.put(
  '/:chave',
  exigirAdmin,
  rota(async (req, res) => {
    const chave = String(req.params.chave).toUpperCase();
    const dados = validar(esquema, req.body);

    const anterior = await consultarUm('SELECT * FROM parametros WHERE chave = $1', [chave]);
    if (!anterior) throw erroNaoEncontrado('Parâmetro não encontrado.');

    const atualizado = await consultarUm(
      `UPDATE parametros
          SET valor = $1, atualizado_em = now(), atualizado_por = $2
        WHERE chave = $3 RETURNING *`,
      [dados.valor, req.usuario!.id, chave],
    );
    await registrarAuditoria({
      entidade: 'parametro',
      entidadeId: chave,
      acao: 'ALTERACAO',
      usuario: req.usuario,
      valorAnterior: anterior,
      valorNovo: atualizado,
      contexto: 'Vale para lançamentos futuros; os já registrados mantêm o valor congelado',
    });
    res.json({ parametro: atualizado });
  }),
);
