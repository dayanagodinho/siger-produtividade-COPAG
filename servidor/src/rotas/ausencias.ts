import { Router } from 'express';
import { z } from 'zod';
import { consultar, consultarUm } from '../infra/banco';
import { registrarAuditoria } from '../infra/auditoria';
import { erroDeRequisicao, erroNaoEncontrado, rota } from '../infra/erros';
import {
  buscarServidorAlvo,
  exigirAutenticacao,
  exigirChefia,
  garantirAcessoAoServidor,
  garantirSetorSobGestao,
} from '../infra/autorizacao';
import { competenciaValida, dataIso, idNumerico, textoOpcional, validar } from '../infra/validacao';
import { primeiroDiaDoMes, ultimoDiaDoMes } from '../dominio/datas';

export const rotasDeAusencias = Router();
rotasDeAusencias.use(exigirAutenticacao);

/**
 * Ausencia reduz o divisor da media, entao registra-la eleva o resultado de
 * quem faltou. Por isso o cadastro e ato da chefia ou da administracao; o
 * servidor consulta as proprias ausencias, mas nao as cria.
 */

const esquema = z.object({
  servidor_id: idNumerico('o servidor'),
  tipo: z.enum(['FERIAS', 'LICENCA', 'AFASTAMENTO', 'OUTRO'], {
    errorMap: () => ({ message: 'Selecione o tipo de ausência.' }),
  }),
  data_inicio: dataIso,
  data_fim: dataIso,
  observacao: textoOpcional(500),
});

export const ROTULO_DO_TIPO: Record<string, string> = {
  FERIAS: 'Férias',
  LICENCA: 'Licença',
  AFASTAMENTO: 'Afastamento',
  OUTRO: 'Outro',
};

rotasDeAusencias.get(
  '/',
  rota(async (req, res) => {
    const usuario = req.usuario!;
    const condicoes = ['a.excluido_em IS NULL'];
    const parametros: unknown[] = [];

    const filtroServidor = req.query.servidor_id ? Number(req.query.servidor_id) : null;
    if (filtroServidor) {
      await garantirAcessoAoServidor(usuario, filtroServidor);
      parametros.push(filtroServidor);
      condicoes.push(`a.servidor_id = $${parametros.length}`);
    } else if (usuario.perfil === 'SERVIDOR') {
      parametros.push(usuario.id);
      condicoes.push(`a.servidor_id = $${parametros.length}`);
    } else if (usuario.perfil === 'CHEFE') {
      parametros.push(usuario.setor_id);
      condicoes.push(`s.setor_id = $${parametros.length}`);
    }

    if (req.query.competencia) {
      const competencia = validar(competenciaValida, req.query.competencia);
      parametros.push(ultimoDiaDoMes(competencia));
      condicoes.push(`a.data_inicio <= $${parametros.length}`);
      parametros.push(primeiroDiaDoMes(competencia));
      condicoes.push(`a.data_fim >= $${parametros.length}`);
    }

    const ausencias = await consultar(
      `SELECT a.id, a.servidor_id, a.tipo, a.data_inicio, a.data_fim, a.observacao,
              a.criado_em, s.nome AS servidor_nome, s.matricula AS servidor_matricula,
              c.nome AS criado_por_nome
         FROM ausencias a
         JOIN servidores s ON s.id = a.servidor_id
         LEFT JOIN servidores c ON c.id = a.criado_por
        WHERE ${condicoes.join(' AND ')}
        ORDER BY a.data_inicio DESC`,
      parametros,
    );
    res.json({ ausencias });
  }),
);

rotasDeAusencias.post(
  '/',
  exigirChefia,
  rota(async (req, res) => {
    const dados = validar(esquema, req.body);
    conferirIntervalo(dados);
    const alvo = await buscarServidorAlvo(dados.servidor_id);
    garantirSetorSobGestao(req.usuario!, alvo.setor_id);

    const criada = await consultarUm<{ id: number }>(
      `INSERT INTO ausencias (servidor_id, tipo, data_inicio, data_fim, observacao, criado_por)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [dados.servidor_id, dados.tipo, dados.data_inicio, dados.data_fim, dados.observacao, req.usuario!.id],
    );
    const ausencia = await buscarAusencia(criada!.id);
    await registrarAuditoria({
      entidade: 'ausencia',
      entidadeId: criada!.id,
      acao: 'CRIACAO',
      usuario: req.usuario,
      valorNovo: ausencia,
      contexto: `Ausência de ${alvo.nome}; reduz os dias efetivos do período`,
    });
    res.status(201).json({ ausencia });
  }),
);

rotasDeAusencias.put(
  '/:id',
  exigirChefia,
  rota(async (req, res) => {
    const id = Number(req.params.id);
    const anterior = await buscarAusencia(id);
    const dados = validar(esquema, req.body);
    conferirIntervalo(dados);

    const alvoAnterior = await buscarServidorAlvo(anterior.servidor_id);
    garantirSetorSobGestao(req.usuario!, alvoAnterior.setor_id);
    const alvoNovo = await buscarServidorAlvo(dados.servidor_id);
    garantirSetorSobGestao(req.usuario!, alvoNovo.setor_id);

    await consultarUm(
      `UPDATE ausencias
          SET servidor_id = $1, tipo = $2, data_inicio = $3, data_fim = $4,
              observacao = $5, atualizado_em = now()
        WHERE id = $6 AND excluido_em IS NULL RETURNING id`,
      [dados.servidor_id, dados.tipo, dados.data_inicio, dados.data_fim, dados.observacao, id],
    );
    const ausencia = await buscarAusencia(id);
    await registrarAuditoria({
      entidade: 'ausencia',
      entidadeId: id,
      acao: 'ALTERACAO',
      usuario: req.usuario,
      valorAnterior: anterior,
      valorNovo: ausencia,
    });
    res.json({ ausencia });
  }),
);

rotasDeAusencias.delete(
  '/:id',
  exigirChefia,
  rota(async (req, res) => {
    const id = Number(req.params.id);
    const anterior = await buscarAusencia(id);
    const alvo = await buscarServidorAlvo(anterior.servidor_id);
    garantirSetorSobGestao(req.usuario!, alvo.setor_id);

    await consultarUm(
      'UPDATE ausencias SET excluido_em = now() WHERE id = $1 AND excluido_em IS NULL RETURNING id',
      [id],
    );
    await registrarAuditoria({
      entidade: 'ausencia',
      entidadeId: id,
      acao: 'EXCLUSAO',
      usuario: req.usuario,
      valorAnterior: anterior,
    });
    res.json({ mensagem: 'Ausência excluída.' });
  }),
);

interface AusenciaCompleta extends Record<string, unknown> {
  id: number;
  servidor_id: number;
}

async function buscarAusencia(id: number): Promise<AusenciaCompleta> {
  const ausencia = await consultarUm<AusenciaCompleta>(
    `SELECT a.*, s.nome AS servidor_nome
       FROM ausencias a JOIN servidores s ON s.id = a.servidor_id
      WHERE a.id = $1 AND a.excluido_em IS NULL`,
    [id],
  );
  if (!ausencia) throw erroNaoEncontrado('Ausência não encontrada.');
  return ausencia;
}

function conferirIntervalo(dados: { data_inicio: string; data_fim: string }): void {
  if (dados.data_fim < dados.data_inicio) {
    throw erroDeRequisicao('A data final da ausência não pode ser anterior a data inicial.');
  }
}
