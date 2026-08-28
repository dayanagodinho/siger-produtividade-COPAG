import { Router } from 'express';
import { rota } from '../infra/erros';
import { exigirAdmin, exigirAutenticacao } from '../infra/autorizacao';
import {
  criarDemonstracao,
  removerDemonstracao,
  situacaoDaDemonstracao,
} from '../scripts/demonstracao';

/**
 * Carrega e descarrega os dados de demonstracao pela propria tela: quem
 * administra o sistema nao tem terminal, e mostrar o funcionamento para a
 * chefia nao pode depender de linha de comando.
 */
export const rotasDeDemonstracao = Router();
rotasDeDemonstracao.use(exigirAutenticacao, exigirAdmin);

rotasDeDemonstracao.get(
  '/',
  rota(async (_req, res) => {
    res.json(await situacaoDaDemonstracao());
  }),
);

rotasDeDemonstracao.post(
  '/',
  rota(async (req, res) => {
    res.status(201).json(await criarDemonstracao(req.usuario!.id));
  }),
);

rotasDeDemonstracao.delete(
  '/',
  rota(async (req, res) => {
    res.json(await removerDemonstracao(req.usuario!.id));
  }),
);
