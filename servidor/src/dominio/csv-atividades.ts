/**
 * Leitura do CSV da lista de atividades da COPAG.
 *
 * O arquivo sai de planilha, entao chega com BOM, com ponto-e-virgula por
 * separador e com campos entre aspas sempre que o texto tem ponto-e-virgula
 * dentro — que e o caso da redacao oficial de varias atividades. Nada disso
 * pode virar dado sujo do outro lado.
 *
 * A analise nao toca o banco: recebe texto, devolve linhas conferidas e os
 * problemas encontrados. E isso que permite mostrar a previa antes de gravar.
 */

export interface LinhaDeAtividade {
  grupo: string;
  codigo: string | null;
  codigoPai: string | null;
  nivel: number;
  lancavel: boolean;
  usaTipoFolha: boolean;
  rotuloCurto: string;
  textoCompleto: string;
  entrega: string | null;
  /** Posicao no arquivo, para apontar o erro onde a pessoa consegue achar. */
  linha: number;
}

export interface LeituraDoCsv {
  linhas: LinhaDeAtividade[];
  problemas: string[];
}

const COLUNAS = [
  'grupo',
  'codigo',
  'codigo_pai',
  'nivel',
  'lancavel',
  'usa_tipo_folha',
  'rotulo_curto',
  'atividade_completa',
  'entrega_esperada',
] as const;

/** Separa uma linha respeitando aspas, com "" valendo por uma aspa literal. */
export function separarCampos(linha: string, separador = ';'): string[] {
  const campos: string[] = [];
  let atual = '';
  let dentroDeAspas = false;

  for (let i = 0; i < linha.length; i += 1) {
    const c = linha[i];
    if (dentroDeAspas) {
      if (c === '"') {
        if (linha[i + 1] === '"') {
          atual += '"';
          i += 1;
        } else {
          dentroDeAspas = false;
        }
      } else {
        atual += c;
      }
    } else if (c === '"') {
      dentroDeAspas = true;
    } else if (c === separador) {
      campos.push(atual);
      atual = '';
    } else {
      atual += c;
    }
  }
  campos.push(atual);
  return campos;
}

/** Quebra o texto em linhas logicas, deixando quebras dentro de aspas passarem. */
function linhasLogicas(texto: string): string[] {
  const linhas: string[] = [];
  let atual = '';
  let dentroDeAspas = false;

  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (c === '"') dentroDeAspas = !dentroDeAspas;
    if (!dentroDeAspas && (c === '\n' || c === '\r')) {
      if (c === '\r' && texto[i + 1] === '\n') i += 1;
      linhas.push(atual);
      atual = '';
    } else {
      atual += c;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

function simOuNao(valor: string): boolean | null {
  const limpo = valor.trim().toUpperCase();
  if (limpo === 'SIM' || limpo === 'S' || limpo === 'TRUE' || limpo === '1') return true;
  if (limpo === 'NAO' || limpo === 'NÃO' || limpo === 'N' || limpo === 'FALSE' || limpo === '0') {
    return false;
  }
  return null;
}

export function lerCsvDeAtividades(texto: string): LeituraDoCsv {
  const problemas: string[] = [];
  const linhas: LinhaDeAtividade[] = [];

  // Planilha grava BOM no inicio; sem tirar, a primeira coluna vira "﻿grupo".
  const conteudo = texto.replace(/^﻿/, '');
  const cruas = linhasLogicas(conteudo).filter((l) => l.trim().length > 0);

  if (!cruas.length) {
    return { linhas: [], problemas: ['O arquivo está vazio.'] };
  }

  const cabecalho = separarCampos(cruas[0]).map((c) => c.trim().toLowerCase());
  const faltando = COLUNAS.filter((coluna) => !cabecalho.includes(coluna));
  if (faltando.length) {
    return {
      linhas: [],
      problemas: [`Faltam colunas no cabeçalho: ${faltando.join(', ')}.`],
    };
  }
  const posicao = Object.fromEntries(COLUNAS.map((c) => [c, cabecalho.indexOf(c)])) as Record<
    (typeof COLUNAS)[number],
    number
  >;

  for (let i = 1; i < cruas.length; i += 1) {
    const numeroDaLinha = i + 1;
    const campos = separarCampos(cruas[i]);
    const pegar = (coluna: (typeof COLUNAS)[number]) => (campos[posicao[coluna]] ?? '').trim();

    const grupo = pegar('grupo').toUpperCase();
    if (!grupo) continue; // linha em branco no fim do arquivo

    const rotuloCurto = pegar('rotulo_curto');
    const textoCompleto = pegar('atividade_completa') || rotuloCurto;
    if (!rotuloCurto && !textoCompleto) {
      problemas.push(`Linha ${numeroDaLinha}: sem rótulo e sem texto da atividade.`);
      continue;
    }

    const lancavel = simOuNao(pegar('lancavel'));
    const usaTipoFolha = simOuNao(pegar('usa_tipo_folha'));
    if (lancavel === null) {
      problemas.push(`Linha ${numeroDaLinha}: "lancavel" deve ser SIM ou NAO.`);
      continue;
    }
    if (usaTipoFolha === null) {
      problemas.push(`Linha ${numeroDaLinha}: "usa_tipo_folha" deve ser SIM ou NAO.`);
      continue;
    }

    const codigoPai = pegar('codigo_pai') || null;
    const nivelBruto = Number(pegar('nivel'));
    const nivel = Number.isFinite(nivelBruto) && nivelBruto > 0 ? nivelBruto : codigoPai ? 2 : 1;

    linhas.push({
      grupo,
      codigo: pegar('codigo') || null,
      codigoPai,
      nivel,
      lancavel,
      usaTipoFolha,
      rotuloCurto: rotuloCurto || textoCompleto.slice(0, 46),
      textoCompleto,
      entrega: pegar('entrega_esperada') || null,
      linha: numeroDaLinha,
    });
  }

  problemas.push(...conferirArvore(linhas));
  return { linhas, problemas };
}

/**
 * A chave estavel de cada atividade: o codigo hierarquico quando existe e,
 * quando nao, o pai somado a redacao oficial. E ela que permite reimportar a
 * lista sem duplicar o que ja esta gravado.
 */
export function chaveDaLinha(linha: LinhaDeAtividade): string {
  return linha.codigo
    ? `${linha.grupo}|${linha.codigo}`
    : `${linha.grupo}|${linha.codigoPai ?? ''}|${linha.textoCompleto.toLowerCase()}`;
}

function conferirArvore(linhas: LinhaDeAtividade[]): string[] {
  const problemas: string[] = [];

  const porCodigo = new Set(
    linhas.filter((l) => l.codigo).map((l) => `${l.grupo}|${l.codigo}`),
  );
  for (const linha of linhas) {
    if (linha.codigoPai && !porCodigo.has(`${linha.grupo}|${linha.codigoPai}`)) {
      problemas.push(
        `Linha ${linha.linha}: o código pai "${linha.codigoPai}" não existe no grupo ${linha.grupo}.`,
      );
    }
  }

  const vistas = new Map<string, number>();
  for (const linha of linhas) {
    const chave = chaveDaLinha(linha);
    const antes = vistas.get(chave);
    if (antes) {
      problemas.push(`Linha ${linha.linha}: repete a atividade da linha ${antes}.`);
    } else {
      vistas.set(chave, linha.linha);
    }
  }

  return problemas;
}
