import { Router } from 'express';
import { z } from 'zod';
import { consultar, consultarUm } from '../infra/banco';
import { registrarAuditoria } from '../infra/auditoria';
import { erroDePermissao, erroDeRequisicao, erroNaoEncontrado, rota } from '../infra/erros';
import {
  buscarServidorAlvo,
  ehAdmin,
  exigirAutenticacao,
  garantirAcessoAoServidor,
} from '../infra/autorizacao';
import {
  competenciaValida,
  dataIso,
  idNumerico,
  nivelComplexidade,
  textoObrigatorio,
  textoOpcional,
  validar,
} from '../infra/validacao';
import { calcularPontos, type Papel } from '../dominio/calculo';
import { carregarParametros } from '../dominio/parametros';
import { competenciaDe } from '../dominio/datas';
import { garantirCompetenciaAberta } from '../dominio/fechamento';

export const rotasDeLancamentos = Router();
rotasDeLancamentos.use(exigirAutenticacao);

const CAMPOS = `
  l.id, l.servidor_id, l.processo, l.descricao, l.nivel, l.papel, l.quantidade,
  l.data_conclusao, l.competencia, l.periodo_inicio, l.periodo_fim, l.link_externo,
  l.status, l.situacao, l.nivel_aplicado, l.percentual_papel, l.pontos,
  l.nivel_original, l.nivel_alterado_em, l.justificativa, l.validado_em,
  l.criado_em, l.atualizado_em,
  s.nome AS servidor_nome, s.matricula AS servidor_matricula, s.setor_id, s.grupo_id,
  g.nome AS grupo_nome,
  v.nome AS validado_por_nome,
  a.nome AS nivel_alterado_por_nome,
  c.nome AS criado_por_nome`;

const DE = `
  FROM lancamentos l
  JOIN servidores s ON s.id = l.servidor_id
  LEFT JOIN grupos g ON g.id = s.grupo_id
  LEFT JOIN servidores v ON v.id = l.validado_por
  LEFT JOIN servidores a ON a.id = l.nivel_alterado_por
  LEFT JOIN servidores c ON c.id = l.criado_por`;

const esquema = z.object({
  servidor_id: idNumerico('o servidor').optional(),
  processo: textoObrigatorio('o numero do processo', 60),
  descricao: textoOpcional(1000),
  nivel: nivelComplexidade,
  papel: z.enum(['EXECUCAO', 'REVISAO', 'HOMOLOGACAO'], {
    errorMap: () => ({ message: 'Selecione o papel exercido no processo.' }),
  }),
  quantidade: z.coerce
    .number({ invalid_type_error: 'Informe a quantidade.' })
    .positive('A quantidade precisa ser maior que zero.')
    .max(999, 'A quantidade maxima por lancamento e 999.')
    .default(1),
  data_conclusao: dataIso,
  periodo_inicio: dataIso.nullable().optional(),
  periodo_fim: dataIso.nullable().optional(),
  link_externo: z
    .string()
    .trim()
    .url('Informe um endereco completo, comecando com http:// ou https://.')
    .max(500)
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  status: z.enum(['EM_ANDAMENTO', 'CONCLUIDO']).default('CONCLUIDO'),
});

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

rotasDeLancamentos.get(
  '/',
  rota(async (req, res) => {
    const usuario = req.usuario!;
    const condicoes = ['l.excluido_em IS NULL'];
    const parametros: unknown[] = [];

    const filtroServidor = req.query.servidor_id ? Number(req.query.servidor_id) : null;
    if (filtroServidor) {
      await garantirAcessoAoServidor(usuario, filtroServidor);
      parametros.push(filtroServidor);
      condicoes.push(`l.servidor_id = $${parametros.length}`);
    } else if (usuario.perfil === 'SERVIDOR') {
      parametros.push(usuario.id);
      condicoes.push(`l.servidor_id = $${parametros.length}`);
    } else if (usuario.perfil === 'CHEFE') {
      parametros.push(usuario.setor_id);
      condicoes.push(`s.setor_id = $${parametros.length}`);
    }

    if (req.query.competencia) {
      parametros.push(validar(competenciaValida, req.query.competencia));
      condicoes.push(`l.competencia = $${parametros.length}`);
    }
    if (req.query.de) {
      parametros.push(validar(dataIso, req.query.de));
      condicoes.push(`l.data_conclusao >= $${parametros.length}`);
    }
    if (req.query.ate) {
      parametros.push(validar(dataIso, req.query.ate));
      condicoes.push(`l.data_conclusao <= $${parametros.length}`);
    }
    if (req.query.processo) {
      parametros.push(`%${String(req.query.processo).trim().toUpperCase()}%`);
      condicoes.push(`upper(l.processo) LIKE $${parametros.length}`);
    }
    if (req.query.situacao) {
      parametros.push(String(req.query.situacao));
      condicoes.push(`l.situacao = $${parametros.length}`);
    }
    if (req.query.status) {
      parametros.push(String(req.query.status));
      condicoes.push(`l.status = $${parametros.length}`);
    }
    if (req.query.setor_id && usuario.perfil === 'ADMIN') {
      parametros.push(Number(req.query.setor_id));
      condicoes.push(`s.setor_id = $${parametros.length}`);
    }

    const lancamentos = await consultar(
      `SELECT ${CAMPOS} ${DE}
        WHERE ${condicoes.join(' AND ')}
        ORDER BY l.data_conclusao DESC, l.id DESC
        LIMIT 500`,
      parametros,
    );
    res.json({ lancamentos });
  }),
);

/**
 * Regra 2.4: ao digitar um processo ja lancado, avisar antes de salvar.
 * E aviso, nao bloqueio: revisao por outra pessoa e legitima.
 */
rotasDeLancamentos.get(
  '/verificar-processo',
  rota(async (req, res) => {
    const processo = String(req.query.processo ?? '').trim();
    if (!processo) {
      res.json({ existentes: [] });
      return;
    }
    const existentes = await consultar(
      `SELECT l.id, l.processo, l.papel, l.nivel, l.data_conclusao, l.situacao,
              s.nome AS servidor_nome, s.id AS servidor_id
         ${DE}
        WHERE l.excluido_em IS NULL AND upper(l.processo) = upper($1)
        ORDER BY l.data_conclusao`,
      [processo],
    );
    res.json({ existentes });
  }),
);

rotasDeLancamentos.get(
  '/:id',
  rota(async (req, res) => {
    const lancamento = await buscarLancamento(Number(req.params.id));
    await garantirAcessoAoServidor(req.usuario!, lancamento.servidor_id);
    res.json({ lancamento });
  }),
);

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

rotasDeLancamentos.post(
  '/',
  rota(async (req, res) => {
    const usuario = req.usuario!;
    const dados = validar(esquema, req.body);
    const servidorId = dados.servidor_id ?? usuario.id;

    if (servidorId !== usuario.id && usuario.perfil === 'SERVIDOR') {
      throw erroDePermissao('Voce so pode lancar a propria producao.');
    }
    const alvo = await buscarServidorAlvo(servidorId);
    if (servidorId !== usuario.id && !ehAdmin(usuario) && alvo.setor_id !== usuario.setor_id) {
      throw erroDePermissao('Voce so pode lancar por servidores do seu setor.');
    }

    conferirPeriodo(dados);
    const competencia = competenciaDe(dados.data_conclusao);
    await garantirCompetenciaAberta(alvo.setor_id, competencia);

    // Regra 2.6: o percentual do papel e congelado agora e nao muda depois.
    const { pesos } = await carregarParametros();
    const percentual = pesos[dados.papel as Papel];

    const criado = await consultarUm<{ id: number }>(
      `INSERT INTO lancamentos
         (servidor_id, processo, descricao, nivel, papel, quantidade, data_conclusao,
          periodo_inicio, periodo_fim, link_externo, status, situacao,
          nivel_aplicado, percentual_papel, criado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'PENDENTE', $4, $12, $13)
       RETURNING id`,
      [
        servidorId, dados.processo, dados.descricao, dados.nivel, dados.papel,
        dados.quantidade, dados.data_conclusao, dados.periodo_inicio ?? null,
        dados.periodo_fim ?? null, dados.link_externo ?? null, dados.status,
        percentual, usuario.id,
      ],
    );

    const lancamento = await buscarLancamento(criado!.id);
    await registrarAuditoria({
      entidade: 'lancamento',
      entidadeId: criado!.id,
      acao: 'CRIACAO',
      usuario,
      valorNovo: lancamento,
      contexto:
        servidorId === usuario.id ? undefined : `Lancado em nome de ${alvo.nome}`,
    });

    res.status(201).json({
      lancamento,
      aviso: `Lancamento registrado com ${calcularPontos(dados.nivel, dados.quantidade, percentual)} ponto(s). Aguarda validacao da chefia.`,
    });
  }),
);

rotasDeLancamentos.put(
  '/:id',
  rota(async (req, res) => {
    const usuario = req.usuario!;
    const id = Number(req.params.id);
    const anterior = await buscarLancamento(id);
    const alvo = await garantirAcessoAoServidor(usuario, anterior.servidor_id);
    const dados = validar(esquema, req.body);
    conferirPeriodo(dados);

    const chefia = usuario.perfil !== 'SERVIDOR';
    if (!chefia && anterior.situacao === 'VALIDADO') {
      throw erroDePermissao(
        'Este lancamento ja foi validado pela chefia. Peca a devolucao antes de alterar.',
      );
    }

    const competenciaAntiga = competenciaDe(anterior.data_conclusao);
    const competenciaNova = competenciaDe(dados.data_conclusao);
    await garantirCompetenciaAberta(alvo.setor_id, competenciaAntiga);
    if (competenciaNova !== competenciaAntiga) {
      await garantirCompetenciaAberta(alvo.setor_id, competenciaNova);
    }

    // Se o papel mudou, o percentual e redeclarado com os parametros de hoje.
    let percentual = anterior.percentual_papel;
    if (dados.papel !== anterior.papel) {
      const { pesos } = await carregarParametros();
      percentual = pesos[dados.papel as Papel];
    }

    // Alteracao pelo proprio servidor devolve o lancamento para a fila.
    const novaSituacao = chefia ? anterior.situacao : 'PENDENTE';

    await consultarUm(
      `UPDATE lancamentos
          SET processo = $1, descricao = $2, nivel = $3, papel = $4, quantidade = $5,
              data_conclusao = $6, periodo_inicio = $7, periodo_fim = $8,
              link_externo = $9, status = $10, situacao = $11,
              nivel_aplicado = $3, percentual_papel = $12, atualizado_em = now()
        WHERE id = $13 AND excluido_em IS NULL
        RETURNING id`,
      [
        dados.processo, dados.descricao, dados.nivel, dados.papel, dados.quantidade,
        dados.data_conclusao, dados.periodo_inicio ?? null, dados.periodo_fim ?? null,
        dados.link_externo ?? null, dados.status, novaSituacao, percentual, id,
      ],
    );

    const lancamento = await buscarLancamento(id);
    await registrarAuditoria({
      entidade: 'lancamento',
      entidadeId: id,
      acao: 'ALTERACAO',
      usuario,
      valorAnterior: anterior,
      valorNovo: lancamento,
      contexto:
        novaSituacao === 'PENDENTE' && anterior.situacao !== 'PENDENTE'
          ? 'Alteracao pelo servidor devolveu o lancamento para a fila de validacao'
          : undefined,
    });
    res.json({ lancamento });
  }),
);

/** Regra 7: exclusao e sempre logica. O historico nao pode sumir. */
rotasDeLancamentos.delete(
  '/:id',
  rota(async (req, res) => {
    const usuario = req.usuario!;
    const id = Number(req.params.id);
    const anterior = await buscarLancamento(id);
    const alvo = await garantirAcessoAoServidor(usuario, anterior.servidor_id);

    if (usuario.perfil === 'SERVIDOR' && anterior.situacao === 'VALIDADO') {
      throw erroDePermissao(
        'Este lancamento ja foi validado pela chefia e nao pode ser excluido por voce.',
      );
    }
    await garantirCompetenciaAberta(alvo.setor_id, competenciaDe(anterior.data_conclusao));

    await consultarUm(
      'UPDATE lancamentos SET excluido_em = now() WHERE id = $1 AND excluido_em IS NULL RETURNING id',
      [id],
    );
    await registrarAuditoria({
      entidade: 'lancamento',
      entidadeId: id,
      acao: 'EXCLUSAO',
      usuario,
      valorAnterior: anterior,
    });
    res.json({ mensagem: 'Lancamento excluido.' });
  }),
);

// ---------------------------------------------------------------------------

interface LancamentoCompleto extends Record<string, unknown> {
  id: number;
  servidor_id: number;
  setor_id: number;
  data_conclusao: string;
  papel: Papel;
  situacao: 'PENDENTE' | 'VALIDADO' | 'DEVOLVIDO';
  percentual_papel: number;
}

export async function buscarLancamento(id: number): Promise<LancamentoCompleto> {
  const lancamento = await consultarUm<LancamentoCompleto>(
    `SELECT ${CAMPOS} ${DE} WHERE l.id = $1 AND l.excluido_em IS NULL`,
    [id],
  );
  if (!lancamento) throw erroNaoEncontrado('Lancamento nao encontrado.');
  return lancamento;
}

function conferirPeriodo(dados: {
  periodo_inicio?: string | null;
  periodo_fim?: string | null;
  data_conclusao: string;
}): void {
  if (dados.periodo_inicio && dados.periodo_fim && dados.periodo_fim < dados.periodo_inicio) {
    throw erroDeRequisicao('O fim do periodo de execucao nao pode ser anterior ao inicio.');
  }
  if (dados.periodo_inicio && dados.periodo_inicio > dados.data_conclusao) {
    throw erroDeRequisicao('O inicio da execucao nao pode ser posterior a data de conclusao.');
  }
}
