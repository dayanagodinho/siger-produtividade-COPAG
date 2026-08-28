import type { PoolClient } from 'pg';
import { consultar, emTransacao } from '../infra/banco';
import { erroDeRequisicao } from '../infra/erros';
import {
  chaveDaLinha,
  lerCsvDeAtividades,
  type LinhaDeAtividade,
} from '../dominio/csv-atividades';

/**
 * Carga da lista de atividades a partir do CSV do plano de trabalho.
 *
 * A lista muda, e a Coordenacao precisa recarregar sem depender de ninguem —
 * por isso a importacao e repetivel: cada atividade carrega a chave que veio
 * do arquivo, e reimportar atualiza em vez de duplicar.
 *
 * Atividade que sai da lista nao e apagada, e desativada: pode haver
 * lancamento apontando para ela, e o historico do que ja foi produzido nao
 * pode mudar porque a lista foi reescrita.
 */

export interface GrupoDaPrevia {
  codigo: string;
  nome: string | null;
  registros: number;
  novas: number;
  atualizadas: number;
}

export interface PreviaDaImportacao {
  registros: number;
  lancaveis: number;
  agrupadores: number;
  comTipoDeFolha: number;
  grupos: GrupoDaPrevia[];
  gruposDesconhecidos: string[];
  aDesativar: number;
  aDesativarComLancamentos: number;
  problemas: string[];
}

export interface ResumoDaImportacao {
  criadas: number;
  atualizadas: number;
  desativadas: number;
  lancaveis: number;
  agrupadores: number;
}

interface AtividadeGravada {
  id: number;
  grupo_id: number;
  chave_importacao: string | null;
  lancamentos: number;
}

async function preparar(texto: string) {
  const { linhas, problemas } = lerCsvDeAtividades(texto);

  const grupos = await consultar<{ id: number; codigo: string | null; nome: string }>(
    'SELECT id, codigo, nome FROM grupos WHERE excluido_em IS NULL',
  );
  const porCodigo = new Map(
    grupos.filter((g) => g.codigo).map((g) => [g.codigo!.toUpperCase(), g]),
  );

  const codigosNoArquivo = [...new Set(linhas.map((l) => l.grupo))];
  const desconhecidos = codigosNoArquivo.filter((c) => !porCodigo.has(c));
  const idsEnvolvidos = codigosNoArquivo
    .map((c) => porCodigo.get(c)?.id)
    .filter((id): id is number => id !== undefined);

  const gravadas = idsEnvolvidos.length
    ? await consultar<AtividadeGravada>(
        `SELECT a.id, a.grupo_id, a.chave_importacao,
                (SELECT count(*) FROM lancamentos l
                  WHERE l.atividade_id = a.id AND l.excluido_em IS NULL)::int AS lancamentos
           FROM atividades a
          WHERE a.grupo_id = ANY($1::int[]) AND a.excluido_em IS NULL AND a.ativa`,
        [idsEnvolvidos],
      )
    : [];

  return { linhas, problemas, porCodigo, desconhecidos, gravadas };
}

export async function analisarImportacao(texto: string): Promise<PreviaDaImportacao> {
  const { linhas, problemas, porCodigo, desconhecidos, gravadas } = await preparar(texto);

  const chavesDoArquivo = new Set<string>();
  const porGrupo = new Map<string, GrupoDaPrevia>();
  const gravadasPorChave = new Map<string, AtividadeGravada>();
  for (const a of gravadas) {
    if (a.chave_importacao) gravadasPorChave.set(`${a.grupo_id}|${a.chave_importacao}`, a);
  }

  for (const linha of linhas) {
    const chave = chaveDaLinha(linha);
    chavesDoArquivo.add(chave);

    const grupo = porCodigo.get(linha.grupo);
    const resumo =
      porGrupo.get(linha.grupo) ??
      porGrupo
        .set(linha.grupo, {
          codigo: linha.grupo,
          nome: grupo?.nome ?? null,
          registros: 0,
          novas: 0,
          atualizadas: 0,
        })
        .get(linha.grupo)!;

    resumo.registros += 1;
    if (grupo && gravadasPorChave.has(`${grupo.id}|${chave}`)) resumo.atualizadas += 1;
    else resumo.novas += 1;
  }

  const forasDaLista = gravadas.filter(
    (a) => !a.chave_importacao || !chavesDoArquivo.has(a.chave_importacao),
  );

  return {
    registros: linhas.length,
    lancaveis: linhas.filter((l) => l.lancavel).length,
    agrupadores: linhas.filter((l) => !l.lancavel).length,
    comTipoDeFolha: linhas.filter((l) => l.usaTipoFolha).length,
    grupos: [...porGrupo.values()],
    gruposDesconhecidos: desconhecidos,
    aDesativar: forasDaLista.length,
    aDesativarComLancamentos: forasDaLista.filter((a) => a.lancamentos > 0).length,
    problemas,
  };
}

export async function aplicarImportacao(
  texto: string,
  usuarioId: number | null,
): Promise<ResumoDaImportacao> {
  const previa = await analisarImportacao(texto);

  if (previa.problemas.length) {
    throw erroDeRequisicao(
      `O arquivo tem ${previa.problemas.length} problema(s). Corrija antes de importar.`,
      previa.problemas.slice(0, 20).map((mensagem) => ({ campo: 'arquivo', mensagem })),
    );
  }
  if (previa.gruposDesconhecidos.length) {
    throw erroDeRequisicao(
      `Não existe grupo cadastrado com o código ${previa.gruposDesconhecidos.join(', ')}. ` +
        'Cadastre o grupo, ou informe o código dele em Cadastros → Grupos.',
    );
  }
  if (!previa.registros) {
    throw erroDeRequisicao('O arquivo não tem nenhuma atividade.');
  }

  const { linhas, porCodigo } = await preparar(texto);
  const resumo: ResumoDaImportacao = {
    criadas: 0,
    atualizadas: 0,
    desativadas: 0,
    lancaveis: previa.lancaveis,
    agrupadores: previa.agrupadores,
  };

  await emTransacao(async (cliente) => {
    const idsEnvolvidos = [...new Set(linhas.map((l) => porCodigo.get(l.grupo)!.id))];

    // Solta os codigos antes de reatribui-los: se uma atividade trocar de
    // codigo com outra, atualizar uma a uma esbarraria no indice unico no meio
    // do caminho.
    await cliente.query(
      'UPDATE atividades SET numero = NULL WHERE grupo_id = ANY($1::int[]) AND excluido_em IS NULL',
      [idsEnvolvidos],
    );

    // Primeira passada grava a atividade sem o pai — o pai pode ainda nao
    // existir. A segunda amarra a arvore.
    const idPorChave = new Map<string, number>();
    for (const [posicao, linha] of linhas.entries()) {
      const grupoId = porCodigo.get(linha.grupo)!.id;
      const chave = chaveDaLinha(linha);
      const id = await gravar(cliente, grupoId, chave, linha, posicao, resumo);
      idPorChave.set(chave, id);
    }

    for (const linha of linhas) {
      if (!linha.codigoPai) continue;
      // O pai sempre tem codigo: e assim que os filhos o referenciam.
      const paiId = idPorChave.get(`${linha.grupo}|${linha.codigoPai}`);
      const filhoId = idPorChave.get(chaveDaLinha(linha));
      if (!paiId || !filhoId) continue;
      await cliente.query('UPDATE atividades SET atividade_pai_id = $1 WHERE id = $2', [
        paiId,
        filhoId,
      ]);
    }

    // O que saiu da lista some do seletor mas continua no banco: ha
    // lancamento apontando para essas atividades, e o ja produzido nao muda
    // porque a lista foi reescrita.
    const chaves = linhas.map(chaveDaLinha);
    const desativadas = await cliente.query(
      `UPDATE atividades SET ativa = FALSE, atualizado_em = now()
        WHERE grupo_id = ANY($1::int[]) AND excluido_em IS NULL AND ativa
          AND (chave_importacao IS NULL OR NOT (chave_importacao = ANY($2::text[])))`,
      [idsEnvolvidos, chaves],
    );
    resumo.desativadas = desativadas.rowCount ?? 0;

    // Na primeira subida ainda pode nao existir ninguem para assinar a carga.
    const autor = usuarioId
      ? await cliente.query<{ nome: string }>('SELECT nome FROM servidores WHERE id = $1', [
          usuarioId,
        ])
      : null;
    await cliente.query(
      `INSERT INTO auditoria (entidade, entidade_id, acao, usuario_id, usuario_nome, contexto)
       VALUES ('atividade', 'importacao', 'ALTERACAO', $1::int, $2, $3)`,
      [
        usuarioId,
        autor?.rows[0]?.nome ?? 'Carga automática do sistema',
        `Lista de atividades importada: ${resumo.criadas} novas, ${resumo.atualizadas} atualizadas, ` +
          `${resumo.desativadas} desativadas.`,
      ],
    );
  });

  return resumo;
}

async function gravar(
  cliente: PoolClient,
  grupoId: number,
  chave: string,
  linha: LinhaDeAtividade,
  posicao: number,
  resumo: ResumoDaImportacao,
): Promise<number> {
  const existente = await cliente.query<{ id: number }>(
    `SELECT id FROM atividades
      WHERE grupo_id = $1 AND chave_importacao = $2 AND excluido_em IS NULL`,
    [grupoId, chave],
  );

  const valores = [
    linha.rotuloCurto,
    linha.textoCompleto,
    linha.entrega,
    linha.codigo,
    linha.nivel,
    linha.lancavel,
    linha.usaTipoFolha,
    posicao,
  ];

  if (existente.rowCount) {
    await cliente.query(
      `UPDATE atividades
          SET nome = $1, texto_completo = $2, entrega = $3, numero = $4,
              nivel_hierarquia = $5, lancavel = $6, usa_tipo_folha = $7, ordem = $8,
              ativa = TRUE, atividade_pai_id = NULL, atualizado_em = now()
        WHERE id = $9`,
      [...valores, existente.rows[0].id],
    );
    resumo.atualizadas += 1;
    return existente.rows[0].id;
  }

  const criada = await cliente.query<{ id: number }>(
    `INSERT INTO atividades
       (grupo_id, nome, texto_completo, entrega, numero, nivel_hierarquia,
        lancavel, usa_tipo_folha, ordem, chave_importacao, nivel_sugerido, ativa)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, TRUE)
     RETURNING id`,
    [grupoId, ...valores, chave],
  );
  resumo.criadas += 1;
  return criada.rows[0].id;
}
