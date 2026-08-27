import { consultar } from '../infra/banco';
import {
  LIMITES_PADRAO,
  PESOS_PADRAO,
  type LimitesDeFaixa,
  type PesosPorPapel,
} from './calculo';

export interface ParametrosDoSistema {
  pesos: PesosPorPapel;
  limites: LimitesDeFaixa;
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
  };
}
