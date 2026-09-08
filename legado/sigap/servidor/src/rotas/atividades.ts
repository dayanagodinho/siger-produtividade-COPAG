import { Router } from 'express';
import { z } from 'zod';
import { consultar, consultarUm } from '../infra/banco';
import { registrarAuditoria } from '../infra/auditoria';
import {
  erroDeConflito,
  erroDePermissao,
  erroDeRequisicao,
  erroNaoEncontrado,
  rota,
} from '../infra/erros';
import { ehAdmin, exigirAutenticacao, exigirChefia } from '../infra/autorizacao';
import {
  idNumerico,
  nivelComplexidade,
  textoObrigatorio,
  textoOpcional,
  validar,
} from '../infra/validacao';
import { exigirAdmin } from '../infra/autorizacao';
import { analisarImportacao, aplicarImportacao } from '../scripts/importar-atividades';

export const rotasDeAtividades = Router();
rotasDeAtividades.use(exigirAutenticacao);

/**
 * Catalogo de atividades do grupo, em arvore.
 *
 * Os niveis de cima organizam e somam nos relatorios, mas nao descrevem
 * trabalho concreto: sao agrupadores, e lancar neles faria a mesma entrega
 * contar duas vezes. So a folha da arvore recebe lancamento.
 *
 * Cada atividade guarda duas redacoes: o rotulo curto, que cabe em seletor e
 * tabela, e o texto oficial do plano de trabalho, que aparece inteiro no
 * detalhe e na exportacao.
 */

const esquema = z.object({
  grupo_id: idNumerico('o grupo'),
  numero: textoOpcional(20),
  nome: textoObrigatorio('o rótulo curto da atividade', 120),
  texto_completo: textoOpcional(2000),
  descricao: textoOpcional(600),
  entrega: textoOpcional(400),
  atividade_pai_id: idNumerico('a atividade acima').nullable().optional(),
  lancavel: z.boolean().optional().default(true),
  usa_tipo_folha: z.boolean().optional().default(false),
  // Enquanto o setor não define o peso da atividade, o nível fica em aberto.
  nivel_sugerido: nivelComplexidade.nullable().optional(),
  ativa: z.boolean().optional().default(true),
});

const CAMPOS = `
  t.id, t.grupo_id, t.numero, t.nome, t.texto_completo, t.descricao, t.entrega,
  t.nivel_sugerido, t.ativa, t.lancavel, t.usa_tipo_folha, t.atividade_pai_id,
  t.nivel_hierarquia, t.ordem,
  g.nome AS grupo_nome, g.codigo AS grupo_codigo, g.setor_id,
  n.rotulo AS nivel_rotulo, n.criterio AS nivel_criterio,
  COALESCE(tr.ancestrais, ARRAY[]::text[]) AS caminho,
  (SELECT count(*) FROM lancamentos l
    WHERE l.atividade_id = t.id AND l.excluido_em IS NULL)::int AS lancamentos`;

// A trilha ate a raiz vem de uma so varredura recursiva: e o que permite
// mostrar "Gerir a folha › Gerar relatorios" embaixo do rotulo no seletor,
// sem prender o codigo a uma profundidade fixa.
const DE = `
  FROM atividades t
  JOIN grupos g ON g.id = t.grupo_id
  LEFT JOIN niveis_complexidade n ON n.nivel = t.nivel_sugerido
  LEFT JOIN trilha tr ON tr.id = t.id`;

const TRILHA = `
  WITH RECURSIVE trilha AS (
    SELECT id, nome, ARRAY[]::text[] AS ancestrais
      FROM atividades WHERE atividade_pai_id IS NULL AND excluido_em IS NULL
    UNION ALL
    SELECT a.id, a.nome, t.ancestrais || t.nome
      FROM atividades a
      JOIN trilha t ON t.id = a.atividade_pai_id
     WHERE a.excluido_em IS NULL
  )`;

/** Sem filtro, o servidor recebe as atividades do proprio grupo. */
rotasDeAtividades.get(
  '/',
  rota(async (req, res) => {
    const usuario = req.usuario!;
    const condicoes = ['t.excluido_em IS NULL', 'g.excluido_em IS NULL'];
    const parametros: unknown[] = [];

    /*
     * Quem lanca escolhe entre as atividades do proprio grupo, e so elas. Sem
     * grupo nao existe "as minhas atividades": o catalogo inteiro so aparece
     * para quem pede `todos`, na tela de cadastro.
     *
     * Antes, quem administra e nao tem grupo caia no ramo do catalogo inteiro
     * e via as 296 — o seletor oferecia o que o proprio servidor recusava
     * depois, dizendo que a atividade era de outro grupo.
     */
    const grupoPedido = req.query.grupo_id ? Number(req.query.grupo_id) : null;

    if (grupoPedido !== null) {
      if (usuario.perfil === 'SERVIDOR' && grupoPedido !== usuario.grupo_id) {
        throw erroDePermissao('Você vê apenas as atividades do seu próprio grupo.');
      }
      parametros.push(grupoPedido);
      condicoes.push(`t.grupo_id = $${parametros.length}`);
    } else if (req.query.todos === 'true') {
      if (usuario.perfil === 'SERVIDOR') {
        throw erroDePermissao('Você vê apenas as atividades do seu próprio grupo.');
      }
      if (!ehAdmin(usuario)) {
        parametros.push(usuario.setor_id);
        condicoes.push(`g.setor_id = $${parametros.length}`);
      }
    } else if (usuario.grupo_id !== null) {
      parametros.push(usuario.grupo_id);
      condicoes.push(`t.grupo_id = $${parametros.length}`);
    } else {
      throw erroDeRequisicao(
        'Você não está em nenhum grupo, e a lista de atividades é por grupo. ' +
          'Peça à administração para indicar o seu grupo em Cadastros → Servidores.',
      );
    }

    if (req.query.incluir_inativas !== 'true') condicoes.push('t.ativa');

    if (req.query.somente_lancaveis === 'true') condicoes.push('t.lancavel');

    const atividades = await consultar(
      `${TRILHA} SELECT ${CAMPOS} ${DE} WHERE ${condicoes.join(' AND ')}
        ORDER BY g.nome, t.ordem, t.id`,
      parametros,
    );
    res.json({ atividades });
  }),
);

/**
 * A carga da lista vem em dois tempos de proposito: primeiro a previa, que so
 * le e conta, e depois a gravacao. Ninguem deveria trocar 296 atividades sem
 * ver antes quantas entram, quantas mudam e quantas saem de circulacao.
 */
const esquemaDoArquivo = z.object({
  conteudo: z.string().min(1, 'Escolha o arquivo CSV com a lista de atividades.'),
});

rotasDeAtividades.post(
  '/importacao/previa',
  exigirAdmin,
  rota(async (req, res) => {
    const { conteudo } = validar(esquemaDoArquivo, req.body);
    res.json(await analisarImportacao(conteudo));
  }),
);

rotasDeAtividades.post(
  '/importacao',
  exigirAdmin,
  rota(async (req, res) => {
    const { conteudo } = validar(esquemaDoArquivo, req.body);
    res.json(await aplicarImportacao(conteudo, req.usuario!.id));
  }),
);

rotasDeAtividades.post(
  '/',
  exigirChefia,
  rota(async (req, res) => {
    const dados = validar(esquema, req.body);
    await garantirGrupoSobGestao(req.usuario!, dados.grupo_id);

    const criada = await consultarUm<{ id: number }>(
      `INSERT INTO atividades
         (grupo_id, numero, nome, texto_completo, descricao, entrega, nivel_sugerido,
          ativa, atividade_pai_id, lancavel, usa_tipo_folha, nivel_hierarquia)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               COALESCE((SELECT nivel_hierarquia + 1 FROM atividades WHERE id = $9), 1))
       RETURNING id`,
      [
        dados.grupo_id, dados.numero, dados.nome, dados.texto_completo ?? dados.nome,
        dados.descricao, dados.entrega, dados.nivel_sugerido ?? null, dados.ativa,
        dados.atividade_pai_id ?? null, dados.lancavel, dados.usa_tipo_folha,
      ],
    );
    const atividade = await buscarAtividade(criada!.id);
    await registrarAuditoria({
      entidade: 'atividade',
      entidadeId: criada!.id,
      acao: 'CRIACAO',
      usuario: req.usuario,
      valorNovo: atividade,
    });
    res.status(201).json({ atividade });
  }),
);

rotasDeAtividades.put(
  '/:id',
  exigirChefia,
  rota(async (req, res) => {
    const id = Number(req.params.id);
    const anterior = await buscarAtividade(id);
    const dados = validar(esquema, req.body);
    await garantirGrupoSobGestao(req.usuario!, anterior.grupo_id);
    await garantirGrupoSobGestao(req.usuario!, dados.grupo_id);

    await consultarUm(
      `UPDATE atividades
          SET grupo_id = $1, numero = $2, nome = $3, texto_completo = $4, descricao = $5,
              entrega = $6, nivel_sugerido = $7, ativa = $8, atividade_pai_id = $9,
              lancavel = $10, usa_tipo_folha = $11, atualizado_em = now()
        WHERE id = $12 AND excluido_em IS NULL RETURNING id`,
      [
        dados.grupo_id, dados.numero, dados.nome, dados.texto_completo ?? dados.nome,
        dados.descricao, dados.entrega, dados.nivel_sugerido ?? null, dados.ativa,
        dados.atividade_pai_id ?? null, dados.lancavel, dados.usa_tipo_folha, id,
      ],
    );
    const atividade = await buscarAtividade(id);
    await registrarAuditoria({
      entidade: 'atividade',
      entidadeId: id,
      acao: 'ALTERACAO',
      usuario: req.usuario,
      valorAnterior: anterior,
      valorNovo: atividade,
      contexto:
        anterior.nivel_sugerido !== dados.nivel_sugerido
          ? `Nível sugerido alterado de ${anterior.nivel_sugerido} para ${dados.nivel_sugerido}; vale para os próximos lançamentos`
          : undefined,
    });
    res.json({ atividade });
  }),
);

rotasDeAtividades.delete(
  '/:id',
  exigirChefia,
  rota(async (req, res) => {
    const id = Number(req.params.id);
    const anterior = await buscarAtividade(id);
    await garantirGrupoSobGestao(req.usuario!, anterior.grupo_id);

    if (anterior.lancamentos > 0) {
      throw erroDeConflito(
        `Esta atividade já foi usada em ${anterior.lancamentos} lançamento(s) e o histórico precisa ser preservado. Desmarque "disponível para lançamento" em vez de excluir.`,
      );
    }

    await consultarUm('UPDATE atividades SET excluido_em = now() WHERE id = $1 RETURNING id', [id]);
    await registrarAuditoria({
      entidade: 'atividade',
      entidadeId: id,
      acao: 'EXCLUSAO',
      usuario: req.usuario,
      valorAnterior: anterior,
    });
    res.json({ mensagem: 'Atividade excluída.' });
  }),
);

interface AtividadeCompleta extends Record<string, unknown> {
  id: number;
  grupo_id: number;
  setor_id: number;
  nivel_sugerido: number | null;
  lancamentos: number;
}

export async function buscarAtividade(id: number): Promise<AtividadeCompleta> {
  const atividade = await consultarUm<AtividadeCompleta>(
    `SELECT ${CAMPOS} ${DE} WHERE t.id = $1 AND t.excluido_em IS NULL`,
    [id],
  );
  if (!atividade) throw erroNaoEncontrado('Atividade não encontrada.');
  return atividade;
}

async function garantirGrupoSobGestao(
  usuario: NonNullable<Express.Request['usuario']>,
  grupoId: number,
): Promise<void> {
  const grupo = await consultarUm<{ setor_id: number }>(
    'SELECT setor_id FROM grupos WHERE id = $1 AND excluido_em IS NULL',
    [grupoId],
  );
  if (!grupo) throw erroNaoEncontrado('Grupo não encontrado.');
  if (!ehAdmin(usuario) && grupo.setor_id !== usuario.setor_id) {
    throw erroDePermissao('Você só administra as atividades dos grupos do seu setor.');
  }
}
