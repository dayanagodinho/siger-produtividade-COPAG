import { Router } from 'express';
import { versaoDoServidor } from '../infra/versao';
import { rotasDeAuditoria } from './auditoria';
import { rotasDeDemonstracao } from './demonstracao';
import { rotasDeAusencias } from './ausencias';
import { rotasDeAutenticacao } from './autenticacao';
import { rotasDeComplexidade } from './complexidade';
import { rotasDeFechamentos } from './fechamentos';
import { rotasDeExportacao } from './exportacoes';
import { rotasDeFeriados } from './feriados';
import { rotasDeGrupos } from './grupos';
import { rotasDeIndicadores } from './indicadores';
import { rotasDeLancamentos } from './lancamentos';
import { rotasDeParametros } from './parametros';
import { rotasDeServidores } from './servidores';
import { rotasDeSetores } from './setores';
import { rotasDeAtividades } from './atividades';
import { rotasDeValidacao } from './validacao';

export const rotasDaApi = Router();

// A saude tambem diz que versao esta no ar: e por onde se confere, sem entrar
// no sistema, se um deploy chegou.
rotasDaApi.get('/saude', (_req, res) => {
  res.json({ situacao: 'no ar', em: new Date().toISOString(), versao: versaoDoServidor() });
});

rotasDaApi.use('/autenticacao', rotasDeAutenticacao);
rotasDaApi.use('/setores', rotasDeSetores);
rotasDaApi.use('/grupos', rotasDeGrupos);
rotasDaApi.use('/servidores', rotasDeServidores);
rotasDaApi.use('/atividades', rotasDeAtividades);
rotasDaApi.use('/lancamentos', rotasDeLancamentos);
rotasDaApi.use('/ausencias', rotasDeAusencias);
rotasDaApi.use('/validacao', rotasDeValidacao);
rotasDaApi.use('/fechamentos', rotasDeFechamentos);
rotasDaApi.use('/indicadores', rotasDeIndicadores);
rotasDaApi.use('/complexidade', rotasDeComplexidade);
rotasDaApi.use('/feriados', rotasDeFeriados);
rotasDaApi.use('/parametros', rotasDeParametros);
rotasDaApi.use('/auditoria', rotasDeAuditoria);
rotasDaApi.use('/demonstracao', rotasDeDemonstracao);
rotasDaApi.use('/exportacoes', rotasDeExportacao);
