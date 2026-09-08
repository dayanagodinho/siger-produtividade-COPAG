import * as fs from 'fs';
import * as path from 'path';
import { pool } from '../infra/banco';
import { aplicarMigracoes } from './migrar';
import { aplicarImportacao, type ResumoDaImportacao } from './importar-atividades';

/**
 * Deixa o sistema utilizavel na primeira subida: cria o setor da COPAG, os
 * quatro grupos de pagamento e carrega a lista de atividades do plano de
 * trabalho, junto com os feriados do ano.
 *
 * A lista vem do mesmo CSV que a Coordenacao usa na tela de importacao — um
 * caminho so, para o que sobe sozinho e o que ela recarrega depois nunca
 * divergirem. Reimportar atualiza em vez de duplicar, entao rodar de novo nao
 * desfaz ajuste nenhum feito pela tela.
 */

interface GrupoDoSetor {
  codigo: string;
  nome: string;
  descricao: string;
}

const SETOR = { nome: 'Coordenação de Gestão do Pagamento de Pessoal', sigla: 'COPAG' };

const GRUPOS: GrupoDoSetor[] = [
  {
    codigo: 'EFETIVOS',
    nome: 'Pagamento dos Servidores Efetivos',
    descricao: 'Folha dos servidores efetivos do quadro.',
  },
  {
    codigo: 'INATIVOS_PENSIONISTAS',
    nome: 'Pagamento de Inativos, Pensionistas e Benefícios Externos',
    descricao: 'Folha de inativos, pensionistas e benefícios externos.',
  },
  {
    codigo: 'PARLAMENTARES',
    nome: 'Pagamento dos Parlamentares',
    descricao: 'Folha de parlamentares ativos, aposentados e pensionistas.',
  },
  {
    codigo: 'COMISSIONADOS',
    nome: 'Pagamento dos Comissionados',
    descricao: 'Folha de secretários parlamentares e cargos de natureza especial.',
  },
];

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

export function lerCsvDoProjeto(): string {
  return fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'dados', 'atividades-copag.csv'),
    'utf8',
  );
}

export interface ResumoDoCatalogo extends ResumoDaImportacao {
  setor: string;
  gruposCriados: number;
  feriadosCriados: number;
}

export async function importarCatalogo(setorId?: number): Promise<ResumoDoCatalogo> {
  const setor = await resolverSetor(setorId);
  let gruposCriados = 0;

  for (const grupo of GRUPOS) {
    if (await garantirGrupo(setor.id, grupo)) gruposCriados += 1;
  }

  const usuario = await pool.query<{ id: number }>(
    "SELECT id FROM servidores WHERE perfil = 'ADMIN' AND excluido_em IS NULL ORDER BY id LIMIT 1",
  );
  const importacao = await aplicarImportacao(lerCsvDoProjeto(), usuario.rows[0]?.id ?? null);

  let feriadosCriados = 0;
  for (const [data, descricao] of FERIADOS_2026) {
    const inserido = await pool.query(
      'INSERT INTO feriados (data, descricao) VALUES ($1, $2) ON CONFLICT (data) DO NOTHING',
      [data, descricao],
    );
    feriadosCriados += inserido.rowCount ?? 0;
  }

  return { ...importacao, setor: setor.nome, gruposCriados, feriadosCriados };
}

/**
 * Descobre em qual setor as atividades entram. A ordem vai do mais explicito
 * ao mais provavel: o setor pedido, o setor de mesma sigla, o unico setor do
 * banco (o caso da primeira subida) e, em ultimo caso, um setor novo.
 */
async function resolverSetor(setorId?: number): Promise<{ id: number; nome: string }> {
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
    [SETOR.sigla],
  );
  if (porSigla.rowCount) return porSigla.rows[0];

  const existentes = await pool.query<{ id: number; nome: string }>(
    'SELECT id, nome FROM setores WHERE excluido_em IS NULL ORDER BY id',
  );
  if (existentes.rowCount === 1) return existentes.rows[0];

  const criado = await pool.query<{ id: number; nome: string }>(
    'INSERT INTO setores (nome, sigla) VALUES ($1, $2) RETURNING id, nome',
    [SETOR.nome, SETOR.sigla],
  );
  return criado.rows[0];
}

/** Devolve true quando o grupo nasceu agora. O codigo e o que liga o CSV a ele. */
async function garantirGrupo(setorId: number, grupo: GrupoDoSetor): Promise<boolean> {
  const porCodigo = await pool.query(
    `SELECT id FROM grupos
      WHERE setor_id = $1 AND upper(codigo) = upper($2) AND excluido_em IS NULL`,
    [setorId, grupo.codigo],
  );
  if (porCodigo.rowCount) return false;

  // O grupo pode existir de uma carga anterior, so que sem codigo: nesse caso
  // ele ganha o codigo em vez de nascer um irmao repetido.
  const porNome = await pool.query(
    `UPDATE grupos SET codigo = $3, atualizado_em = now()
      WHERE setor_id = $1 AND lower(nome) = lower($2) AND excluido_em IS NULL
        AND codigo IS NULL
      RETURNING id`,
    [setorId, grupo.nome, grupo.codigo],
  );
  if (porNome.rowCount) return false;

  await pool.query(
    'INSERT INTO grupos (setor_id, nome, descricao, codigo) VALUES ($1, $2, $3, $4)',
    [setorId, grupo.nome, grupo.descricao, grupo.codigo],
  );
  return true;
}

/**
 * Roda a carga na primeira subida, quando ainda nao ha nenhuma atividade
 * cadastrada. Com a lista no lugar, nao faz nada. IMPORTAR_CATALOGO=false
 * desliga o comportamento para quem quiser montar a propria lista do zero.
 */
export async function importarCatalogoNaPrimeiraSubida(): Promise<string | null> {
  if ((process.env.IMPORTAR_CATALOGO ?? 'true') === 'false') return null;

  const jaTem = await pool.query('SELECT 1 FROM atividades WHERE excluido_em IS NULL LIMIT 1');
  if (jaTem.rowCount) return null;

  const resumo = await importarCatalogo();
  return (
    `Lista de atividades carregada em ${resumo.setor}: ${resumo.gruposCriados} grupos, ` +
    `${resumo.criadas} atividades (${resumo.lancaveis} lançáveis e ${resumo.agrupadores} ` +
    `agrupadoras) e ${resumo.feriadosCriados} feriados.`
  );
}

function descrever(resumo: ResumoDoCatalogo): string {
  return [
    `Setor: ${resumo.setor}`,
    `Grupos criados: ${resumo.gruposCriados}`,
    `Atividades criadas: ${resumo.criadas}`,
    `Atividades atualizadas: ${resumo.atualizadas}`,
    `Atividades desativadas: ${resumo.desativadas}`,
    `Lançáveis: ${resumo.lancaveis} · agrupadoras: ${resumo.agrupadores}`,
    `Feriados criados: ${resumo.feriadosCriados}`,
  ].join('\n');
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
