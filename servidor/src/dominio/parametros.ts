import { consultar } from '../infra/banco';
import {
  LIMITES_PADRAO,
  MINIMO_HOMOLOGACAO_PADRAO,
  PESOS_PADRAO,
  type LimitesDeFaixa,
  type PesosPorPapel,
} from './calculo';

export interface ParametrosDoSistema {
  pesos: PesosPorPapel;
  limites: LimitesDeFaixa;
  /** Piso da conferencia, em pontos. Congelado em cada lancamento gerado. */
  minimoHomologacao: number;
}

export async function carregarParametros(): Promise<ParametrosDoSistema> {
  const linhas = await consultar<{ chave: string; valor: number }>(
    'SELECT chave, valor FROM parametros',
  );
  const mapa = new Map(linhas.map((linha) => [linha.chave, Number(linha.valor)]));

  return {
    pesos: {
      EXECUCAO: mapa.get('PESO_EXECUCAO') ?? PESOS_PADRAO.EXECUCAO,
      REVISAO: mapa.get('PESO_REVISAO') ?? PESOS_PADRAO.REVISAO,
      HOMOLOGACAO: mapa.get('PESO_HOMOLOGACAO') ?? PESOS_PADRAO.HOMOLOGACAO,
    },
    limites: {
      abaixo: mapa.get('FAIXA_ABAIXO') ?? LIMITES_PADRAO.abaixo,
      acima: mapa.get('FAIXA_ACIMA') ?? LIMITES_PADRAO.acima,
    },
    minimoHomologacao: mapa.get('MINIMO_HOMOLOGACAO') ?? MINIMO_HOMOLOGACAO_PADRAO,
  };
}
