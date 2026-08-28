import * as fs from 'fs';
import * as path from 'path';
import { pool } from '../infra/banco';
import { aplicarMigracoes } from './migrar';

/**
 * Carrega no banco a lista de atividades da COPAG — os quatro grupos de
 * pagamento, as 93 atividades e o detalhamento de cada uma — junto com os
 * feriados do ano.
 *
 * A importacao e somativa: nao apaga nada e nao sobrescreve nada. Grupo,
 * atividade ou feriado que ja exista fica como esta, com as alteracoes que o
 * setor tiver feito pela tela. Rodar duas vezes tem o mesmo efeito de rodar
 * uma. E o oposto de `semear`, que limpa o banco e povoa com gente ficticia.
 */

interface Detalhamento {
  numero: string;
  texto: string;
}

interface AtividadeDoCatalogo {
  numero: string;
  nome: string;
  entrega: string;
  detalhamentos: Detalhamento[];
}

interface GrupoDoCatalogo {
  nome: string;
  descricao: string;
  atividades: AtividadeDoCatalogo[];
}

export interface Catalogo {
  setor: { nome: string; sigla: string };
  grupos: GrupoDoCatalogo[];
}

export interface ResumoDaImportacao {
  setor: string;
  gruposCriados: number;
  atividadesCriadas: number;
  detalhamentosCriados: number;
  feriadosCriados: number;
  jaExistiam: number;
}

export const FERIADOS_2026: Array<[string, string]> = [
  ['2026-01-01', 'Confraternização Universal'],
  ['2026-02-16', 'Carnaval'],
  ['2026-02-17', 'Carnaval'],
  ['2026-04-03', 'Sexta-feira Santa'],
  ['2026-04-21', 'Tiradentes'],
  ['2026-05-01', 'Dia do Trabalho'],
  ['2026-06-04', 'Corpus Christi'],
  ['2026-09-07', 'Independência do Brasil'],
  ['2026-10-12', 'Nossa Senhora Aparecida'],
  ['2026-11-02', 'Finados'],
  ['2026-11-15', 'Proclamação da República'],
  ['2026-11-20', 'Dia Nacional de Zumbi e da Consciência Negra'],
  ['2026-12-25', 'Natal'],
];

export function lerCatalogo(): Catalogo {
  const arquivo = path.resolve(__dirname, '..', '..', 'dados', 'atividades-copag.json');
  return JSON.parse(fs.readFileSync(arquivo, 'utf8')) as Catalogo;
}

/**
 * Descobre em qual setor as atividades entram. A ordem vai do mais explicito
 * ao mais provavel: o setor pedido, o setor de mesma sigla, o unico setor do
 * banco (o caso da primeira subida) e, em ultimo caso, um setor novo.
 */
async function resolverSetor(catalogo: Catalogo, setorId?: number): Promise<{ id: number; nome: string }> {
  if (setorId) {
    const pedido = await pool.query<{ id: number; nome: string }>(
      'SELECT id, nome FROM setores WHERE id = $1 AND excluido_em IS NULL',
      [setorId],
    );
    if (!pedido.rowCount) throw new Error(`Setor ${setorId} não encontrado.`);
    return pedido.rows[0];
  }

  const porSigla = await pool.query<{ id: number; nome: string }>(
    'SELECT id, nome FROM setores WHERE upper(sigla) = upper($1) AND excluido_em IS NULL',
    [catalogo.setor.sigla],
  );
  if (porSigla.rowCount) return porSigla.rows[0];

  const existentes = await pool.query<{ id: number; nome: string }>(
    'SELECT id, nome FROM setores WHERE excluido_em IS NULL ORDER BY id',
  );
  if (existentes.rowCount === 1) return existentes.rows[0];

  const criado = await pool.query<{ id: number; nome: string }>(
    'INSERT INTO setores (nome, sigla) VALUES ($1, $2) RETURNING id, nome',
    [catalogo.setor.nome, catalogo.setor.sigla],
  );
  return criado.rows[0];
}

export async function importarCatalogo(setorId?: number): Promise<ResumoDaImportacao> {
  const catalogo = lerCatalogo();
  const setor = await resolverSetor(catalogo, setorId);
  const resumo: ResumoDaImportacao = {
    setor: setor.nome,
    gruposCriados: 0,
    atividadesCriadas: 0,
    detalhamentosCriados: 0,
    feriadosCriados: 0,
    jaExistiam: 0,
  };

  for (const grupo of catalogo.grupos) {
    const grupoId = await garantirGrupo(setor.id, grupo, resumo);

    for (const atividade of grupo.atividades) {
      const existente = await pool.query<{ id: number }>(
        `SELECT id FROM atividades
          WHERE grupo_id = $1 AND lower(nome) = lower($2) AND excluido_em IS NULL`,
        [grupoId, atividade.nome],
      );
      if (existente.rowCount) {
        resumo.jaExistiam += 1;
        continue;
      }

      // Sem nivel_sugerido: o peso e indicado pelo servidor no lancamento.
      const criada = await pool.query<{ id: number }>(
        `INSERT INTO atividades (grupo_id, numero, nome, entrega, nivel_sugerido)
         VALUES ($1, $2, $3, $4, NULL) RETURNING id`,
        [grupoId, atividade.numero, atividade.nome, atividade.entrega || null],
      );
      resumo.atividadesCriadas += 1;

      // O detalhamento so entra junto com a atividade nova: assim uma segunda
      // importacao nao duplica linhas nem desfaz ajuste feito pelo setor.
      for (const [ordem, detalhe] of atividade.detalhamentos.entries()) {
        await pool.query(
          `INSERT INTO detalhamentos (atividade_id, numero, texto, ordem)
           VALUES ($1, $2, $3, $4)`,
          [criada.rows[0].id, detalhe.numero || null, detalhe.texto, ordem],
        );
        resumo.detalhamentosCriados += 1;
      }
    }
  }

  for (const [data, descricao] of FERIADOS_2026) {
    const inserido = await pool.query(
      'INSERT INTO feriados (data, descricao) VALUES ($1, $2) ON CONFLICT (data) DO NOTHING',
      [data, descricao],
    );
    resumo.feriadosCriados += inserido.rowCount ?? 0;
  }

  return resumo;
}

async function garantirGrupo(
  setorId: number,
  grupo: GrupoDoCatalogo,
  resumo: ResumoDaImportacao,
): Promise<number> {
  const existente = await pool.query<{ id: number }>(
    `SELECT id FROM grupos
      WHERE setor_id = $1 AND lower(nome) = lower($2) AND excluido_em IS NULL`,
    [setorId, grupo.nome],
  );
  if (existente.rowCount) return existente.rows[0].id;

  const criado = await pool.query<{ id: number }>(
    'INSERT INTO grupos (setor_id, nome, descricao) VALUES ($1, $2, $3) RETURNING id',
    [setorId, grupo.nome, grupo.descricao || null],
  );
  resumo.gruposCriados += 1;
  return criado.rows[0].id;
}

/**
 * Roda a importacao na primeira subida, quando ainda nao ha nenhuma atividade
 * cadastrada. Com o catalogo ja no lugar, nao faz nada. IMPORTAR_CATALOGO=false
 * desliga o comportamento para quem quiser montar a propria lista do zero.
 */
export async function importarCatalogoNaPrimeiraSubida(): Promise<string | null> {
  if ((process.env.IMPORTAR_CATALOGO ?? 'true') === 'false') return null;

  const jaTem = await pool.query('SELECT 1 FROM atividades WHERE excluido_em IS NULL LIMIT 1');
  if (jaTem.rowCount) return null;

  const resumo = await importarCatalogo();
  return (
    `Lista de atividades carregada em ${resumo.setor}: ` +
    `${resumo.gruposCriados} grupos, ${resumo.atividadesCriadas} atividades, ` +
    `${resumo.detalhamentosCriados} detalhamentos e ${resumo.feriadosCriados} feriados.`
  );
}

function descrever(resumo: ResumoDaImportacao): string {
  const partes = [
    `Setor: ${resumo.setor}`,
    `Grupos criados: ${resumo.gruposCriados}`,
    `Atividades criadas: ${resumo.atividadesCriadas}`,
    `Detalhamentos criados: ${resumo.detalhamentosCriados}`,
    `Feriados criados: ${resumo.feriadosCriados}`,
  ];
  if (resumo.jaExistiam) partes.push(`Atividades que já existiam e foram mantidas: ${resumo.jaExistiam}`);
  return partes.join('\n');
}

if (require.main === module) {
  const argumento = process.argv.find((valor) => valor.startsWith('--setor='));
  const setorId = argumento ? Number(argumento.split('=')[1]) : undefined;

  aplicarMigracoes()
    .then(() => importarCatalogo(setorId))
    .then((resumo) => {
      console.log(descrever(resumo));
      return pool.end();
    })
    .catch((erro) => {
      console.error('Falha ao importar a lista de atividades:', erro.message);
      process.exitCode = 1;
      return pool.end();
    });
}
