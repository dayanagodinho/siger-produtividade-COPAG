import { Router } from 'express';
import { z } from 'zod';
import { consultar, consultarUm } from '../infra/banco';
import { registrarAuditoria } from '../infra/auditoria';
import { erroDePermissao, erroDeRequisicao, erroNaoEncontrado, rota } from '../infra/erros';
import {
  alcanceDe,
  buscarServidorAlvo,
  condicaoDoAlcance,
  ehAdmin,
  exigirAutenticacao,
  garantirAcessoAoServidor,
} from '../infra/autorizacao';
import {
  competenciaValida,
  dataIso,
  idNumerico,
  nivelComplexidade,
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
  l.criado_em, l.atualizado_em, l.atividade_id, l.tipo_folha,
  s.nome AS servidor_nome, s.matricula AS servidor_matricula, s.setor_id, s.grupo_id,
  g.nome AS grupo_nome, tf.nome AS atividade_nome, tf.numero AS atividade_numero,
  tf.texto_completo AS atividade_texto, tf.usa_tipo_folha AS atividade_usa_tipo_folha,
  v.nome AS validado_por_nome,
  a.nome AS nivel_alterado_por_nome,
  c.nome AS criado_por_nome`;

const DE = `
  FROM lancamentos l
  JOIN servidores s ON s.id = l.servidor_id
  LEFT JOIN grupos g ON g.id = s.grupo_id
  LEFT JOIN atividades tf ON tf.id = l.atividade_id
  LEFT JOIN servidores v ON v.id = l.validado_por
  LEFT JOIN servidores a ON a.id = l.nivel_alterado_por
  LEFT JOIN servidores c ON c.id = l.criado_por`;

const esquema = z.object({
  servidor_id: idNumerico('o servidor').optional(),
  atividade_id: idNumerico('a atividade').nullable().optional(),
  // Opcional de verdade: a tela diz "Se houver", e nem toda atividade da
  // COPAG nasce de um processo com numero.
  processo: textoOpcional(60),
  descricao: textoOpcional(1000),
  nivel: nivelComplexidade,
  papel: z.enum(['EXECUCAO', 'REVISAO', 'HOMOLOGACAO'], {
    errorMap: () => ({ message: 'Selecione o papel exercido no processo.' }),
  }),
  quantidade: z.coerce
    .number({ invalid_type_error: 'Informe a quantidade.' })
    .positive('A quantidade precisa ser maior que zero.')
    .max(999, 'A quantidade máxima por lançamento é 999.')
    .default(1),
  data_conclusao: dataIso,
  periodo_inicio: dataIso.nullable().optional(),
  periodo_fim: dataIso.nullable().optional(),
  link_externo: z
    .string()
    .trim()
    .url('Informe um endereço completo, começando com http:// ou https://.')
    .max(500)
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  status: z.enum(['EM_ANDAMENTO', 'CONCLUIDO']).default('CONCLUIDO'),
  // De qual folha se trata. Fica no lancamento e nao na atividade: quatro
  // tipos vezes cada atividade de folha inchariam a lista, e assim o tipo
  // vira dimensao de filtro nos relatorios.
  tipo_folha: z
    .enum(['NORMAL', 'COMPLEMENTAR', 'ADIANTAMENTO_GRATIFICACAO', 'GRATIFICACAO_NATALINA'])
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
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
    } else {
      const filtro = condicaoDoAlcance(await alcanceDe(usuario), { servidor: 'l.servidor_id', grupo: 's.grupo_id', setor: 's.setor_id' }, parametros);
      if (filtro) condicoes.push(filtro);
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

// A mesma atividade se repete varias vezes no mes, e isso e o trabalho normal
// da COPAG. Nao ha aviso nem trava de repeticao: o controle contra lancamento
// indevido e a conferencia da chefia.

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
      throw erroDePermissao('Você só pode lançar a própria produção.');
    }
    const alvo = await buscarServidorAlvo(servidorId);
    if (servidorId !== usuario.id && !ehAdmin(usuario) && alvo.setor_id !== usuario.setor_id) {
      throw erroDePermissao('Você só pode lançar por servidores do seu setor.');
    }

    conferirPeriodo(dados);
    await conferirAtividade(dados.atividade_id ?? null, alvo.grupo_id, dados.tipo_folha ?? null);
    const competencia = competenciaDe(dados.data_conclusao);
    await garantirCompetenciaAberta(alvo.setor_id, competencia);

    // Regra 2.6: o percentual do papel e congelado agora e nao muda depois.
    const { pesos } = await carregarParametros();
    const percentual = pesos[dados.papel as Papel];

    const criado = await consultarUm<{ id: number }>(
      `INSERT INTO lancamentos
         (servidor_id, processo, descricao, nivel, papel, quantidade, data_conclusao,
          periodo_inicio, periodo_fim, link_externo, status, situacao,
          nivel_aplicado, percentual_papel, criado_por, atividade_id, tipo_folha)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'PENDENTE', $4, $12, $13, $14, $15)
       RETURNING id`,
      [
        servidorId, dados.processo ?? null, dados.descricao, dados.nivel, dados.papel,
        dados.quantidade, dados.data_conclusao, dados.periodo_inicio ?? null,
        dados.periodo_fim ?? null, dados.link_externo ?? null, dados.status,
        percentual, usuario.id, dados.atividade_id ?? null, dados.tipo_folha ?? null,
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
        servidorId === usuario.id ? undefined : `Lançado em nome de ${alvo.nome}`,
    });

    res.status(201).json({
      lancamento,
      aviso: `Lançamento registrado: ${calcularPontos(dados.nivel, dados.quantidade, percentual)} ponto(s) já contam na sua média. A chefia confere e só deixa de contar se devolver.`,
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
    await conferirAtividade(dados.atividade_id ?? null, alvo.grupo_id, dados.tipo_folha ?? null);

    const chefia = usuario.perfil !== 'SERVIDOR';
    if (!chefia && anterior.situacao === 'VALIDADO') {
      throw erroDePermissao(
        'Este lançamento já foi validado pela chefia. Peça a devolução antes de alterar.',
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
              nivel_aplicado = $3, percentual_papel = $12, atividade_id = $13,
              tipo_folha = $14, atualizado_em = now()
        WHERE id = $15 AND excluido_em IS NULL
        RETURNING id`,
      [
        dados.processo ?? null, dados.descricao, dados.nivel, dados.papel, dados.quantidade,
        dados.data_conclusao, dados.periodo_inicio ?? null, dados.periodo_fim ?? null,
        dados.link_externo ?? null, dados.status, novaSituacao, percentual,
        dados.atividade_id ?? null, dados.tipo_folha ?? null, id,
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
          ? 'Alteração pelo servidor devolveu o lançamento para a fila de validação'
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
        'Este lançamento já foi validado pela chefia e não pode ser excluído por você.',
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
    res.json({ mensagem: 'Lançamento excluído.' });
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
  if (!lancamento) throw erroNaoEncontrado('Lançamento não encontrado.');
  return lancamento;
}

/** A atividade escolhida precisa ser do grupo de quem está lançando. */
async function conferirAtividade(
  atividadeId: number | null,
  grupoId: number | null,
  tipoFolha: string | null,
): Promise<void> {
  if (!atividadeId) return;
  const atividade = await consultarUm<{
    grupo_id: number;
    ativa: boolean;
    nome: string;
    lancavel: boolean;
    usa_tipo_folha: boolean;
  }>(
    `SELECT grupo_id, ativa, nome, lancavel, usa_tipo_folha
       FROM atividades WHERE id = $1 AND excluido_em IS NULL`,
    [atividadeId],
  );
  if (!atividade) throw erroDeRequisicao('Atividade não encontrada.');
  if (atividade.grupo_id !== grupoId) {
    throw erroDeRequisicao(
      'Esta atividade pertence a outro grupo. Escolha uma atividade do seu grupo.',
    );
  }
  if (!atividade.ativa) {
    throw erroDeRequisicao(
      `A atividade "${atividade.nome}" saiu da lista do grupo e não aceita novos lançamentos.`,
    );
  }
  // O agrupador organiza a arvore e soma nos relatorios; o trabalho concreto
  // esta nos filhos. Lancar nele faria a mesma entrega contar duas vezes.
  if (!atividade.lancavel) {
    throw erroDeRequisicao(
      `"${atividade.nome}" agrupa outras atividades e não recebe lançamento. Escolha uma das atividades que estão dentro dela.`,
    );
  }
  if (atividade.usa_tipo_folha && !tipoFolha) {
    throw erroDeRequisicao('Informe de qual folha se trata.');
  }
}

function conferirPeriodo(dados: {
  periodo_inicio?: string | null;
  periodo_fim?: string | null;
  data_conclusao: string;
}): void {
  if (dados.periodo_inicio && dados.periodo_fim && dados.periodo_fim < dados.periodo_inicio) {
    throw erroDeRequisicao('O fim do período de execução não pode ser anterior ao inicio.');
  }
  if (dados.periodo_inicio && dados.periodo_inicio > dados.data_conclusao) {
    throw erroDeRequisicao('O inicio da execução não pode ser posterior a data de conclusão.');
  }
}
