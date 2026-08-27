import { Router } from 'express';
import { rotasDeAusencias } from './ausencias';
import { rotasDeAutenticacao } from './autenticacao';
import { rotasDeComplexidade } from './complexidade';
import { rotasDeFeriados } from './feriados';
import { rotasDeGrupos } from './grupos';
import { rotasDeIndicadores } from './indicadores';
import { rotasDeLancamentos } from './lancamentos';
import { rotasDeParametros } from './parametros';
import { rotasDeServidores } from './servidores';
import { rotasDeSetores } from './setores';

export const rotasDaApi = Router();

rotasDaApi.get('/saude', (_req, res) => {
  res.json({ situacao: 'no ar', em: new Date().toISOString() });
});

rotasDaApi.use('/autenticacao', rotasDeAutenticacao);
rotasDaApi.use('/setores', rotasDeSetores);
rotasDaApi.use('/grupos', rotasDeGrupos);
rotasDaApi.use('/servidores', rotasDeServidores);
rotasDaApi.use('/lancamentos', rotasDeLancamentos);
rotasDaApi.use('/ausencias', rotasDeAusencias);
rotasDaApi.use('/indicadores', rotasDeIndicadores);
rotasDaApi.use('/complexidade', rotasDeComplexidade);
rotasDaApi.use('/feriados', rotasDeFeriados);
rotasDaApi.use('/parametros', rotasDeParametros);
