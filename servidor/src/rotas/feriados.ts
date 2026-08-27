import { Router } from 'express';
import { z } from 'zod';
import { consultar, consultarUm } from '../infra/banco';
import { registrarAuditoria } from '../infra/auditoria';
import { erroNaoEncontrado, rota } from '../infra/erros';
import { exigirAdmin, exigirAutenticacao } from '../infra/autorizacao';
import { dataIso, textoObrigatorio, validar } from '../infra/validacao';

export const rotasDeFeriados = Router();
rotasDeFeriados.use(exigirAutenticacao);

const esquema = z.object({
  data: dataIso,
  descricao: textoObrigatorio('a descricao do feriado', 120),
});

rotasDeFeriados.get(
  '/',
  rota(async (req, res) => {
    const ano = req.query.ano ? Number(req.query.ano) : null;
    const feriados = await consultar(
      `SELECT id, data, descricao FROM feriados
        WHERE ($1::int IS NULL OR EXTRACT(YEAR FROM data) = $1)
        ORDER BY data`,
      [ano],
    );
    res.json({ feriados });
  }),
);

rotasDeFeriados.post(
  '/',
  exigirAdmin,
  rota(async (req, res) => {
    const dados = validar(esquema, req.body);
    const criado = await consultarUm(
      'INSERT INTO feriados (data, descricao) VALUES ($1, $2) RETURNING *',
      [dados.data, dados.descricao],
    );
    await registrarAuditoria({
      entidade: 'feriado',
      entidadeId: (criado as { id: number }).id,
      acao: 'CRIACAO',
      usuario: req.usuario,
      valorNovo: criado,
      contexto: 'Feriado afeta o calculo de dias uteis',
    });
    res.status(201).json({ feriado: criado });
  }),
);

rotasDeFeriados.delete(
  '/:id',
  exigirAdmin,
  rota(async (req, res) => {
    const id = Number(req.params.id);
    const anterior = await consultarUm('SELECT * FROM feriados WHERE id = $1', [id]);
    if (!anterior) throw erroNaoEncontrado('Feriado nao encontrado.');

    await consultarUm('DELETE FROM feriados WHERE id = $1 RETURNING id', [id]);
    await registrarAuditoria({
      entidade: 'feriado',
      entidadeId: id,
      acao: 'EXCLUSAO',
      usuario: req.usuario,
      valorAnterior: anterior,
      contexto: 'Feriado afeta o calculo de dias uteis',
    });
    res.json({ mensagem: 'Feriado excluido.' });
  }),
);
