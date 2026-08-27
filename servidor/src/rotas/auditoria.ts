import { Router } from 'express';
import { consultar } from '../infra/banco';
import { rota } from '../infra/erros';
import {
  exigirAdmin,
  exigirAutenticacao,
  garantirAcessoAoServidor,
} from '../infra/autorizacao';
import { dataIso, validar } from '../infra/validacao';
import { buscarLancamento } from './lancamentos';

export const rotasDeAuditoria = Router();
rotasDeAuditoria.use(exigirAutenticacao);

const ROTULO_DA_ACAO: Record<string, string> = {
  CRIACAO: 'Criacao',
  ALTERACAO: 'Alteracao',
  EXCLUSAO: 'Exclusao',
};

/** Trilha completa: leitura restrita a administracao. */
rotasDeAuditoria.get(
  '/',
  exigirAdmin,
  rota(async (req, res) => {
    const condicoes: string[] = [];
    const parametros: unknown[] = [];

    if (req.query.entidade) {
      parametros.push(String(req.query.entidade));
      condicoes.push(`a.entidade = $${parametros.length}`);
    }
    if (req.query.entidade_id) {
      parametros.push(String(req.query.entidade_id));
      condicoes.push(`a.entidade_id = $${parametros.length}`);
    }
    if (req.query.usuario_id) {
      parametros.push(Number(req.query.usuario_id));
      condicoes.push(`a.usuario_id = $${parametros.length}`);
    }
    if (req.query.de) {
      parametros.push(validar(dataIso, req.query.de));
      condicoes.push(`a.ocorrido_em >= $${parametros.length}::date`);
    }
    if (req.query.ate) {
      parametros.push(validar(dataIso, req.query.ate));
      condicoes.push(`a.ocorrido_em < ($${parametros.length}::date + 1)`);
    }

    const registros = await consultar(
      `SELECT a.id, a.entidade, a.entidade_id, a.acao, a.usuario_id, a.usuario_nome,
              a.valor_anterior, a.valor_novo, a.contexto, a.ocorrido_em
         FROM auditoria a
        ${condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : ''}
        ORDER BY a.ocorrido_em DESC, a.id DESC
        LIMIT 500`,
      parametros,
    );

    res.json({
      registros: registros.map((registro) => ({
        ...registro,
        acao_rotulo: ROTULO_DA_ACAO[String(registro.acao)] ?? registro.acao,
      })),
    });
  }),
);

/**
 * Historico de um lancamento especifico. Visivel para o proprio servidor:
 * ele precisa conseguir ver quem mudou o nivel dele, de quanto para quanto.
 */
rotasDeAuditoria.get(
  '/lancamento/:id',
  rota(async (req, res) => {
    const id = Number(req.params.id);
    const lancamento = await buscarLancamento(id);
    await garantirAcessoAoServidor(req.usuario!, lancamento.servidor_id);

    const registros = await consultar(
      `SELECT id, acao, usuario_nome, valor_anterior, valor_novo, contexto, ocorrido_em
         FROM auditoria
        WHERE entidade = 'lancamento' AND entidade_id = $1
        ORDER BY ocorrido_em, id`,
      [String(id)],
    );

    res.json({
      lancamento: {
        id: lancamento.id,
        processo: lancamento.processo,
        nivel: lancamento.nivel,
        nivel_original: lancamento.nivel_original,
        nivel_alterado_por_nome: lancamento.nivel_alterado_por_nome,
        nivel_alterado_em: lancamento.nivel_alterado_em,
        justificativa: lancamento.justificativa,
        situacao: lancamento.situacao,
      },
      registros: registros.map((registro) => ({
        ...registro,
        acao_rotulo: ROTULO_DA_ACAO[String(registro.acao)] ?? registro.acao,
      })),
    });
  }),
);
