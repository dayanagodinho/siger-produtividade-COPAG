import { Router } from 'express';
import { rotasDeAutenticacao } from './autenticacao';

export const rotasDaApi = Router();

rotasDaApi.get('/saude', (_req, res) => {
  res.json({ situacao: 'no ar', em: new Date().toISOString() });
});

rotasDaApi.use('/autenticacao', rotasDeAutenticacao);
