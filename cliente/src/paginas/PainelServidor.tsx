import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, mensagemDeErro } from '../servicos/api';
import { competenciaAtual, competenciaLegivel, numero } from '../servicos/formato';
import {
  Aviso,
  Carregando,
  Cartao,
  DistribuicaoNiveis,
  IndicadorAtingimento,
  Medida,
  SeletorCompetencia,
  Vazio,
} from '../componentes/comuns';
import { Cabecalho } from '../componentes/Layout';
import { useSessao } from '../servicos/sessao';

interface Painel {
  nome: string;
  grupo_nome: string | null;
  situacao: 'APURADO' | 'SEM_APURACAO';
  pontos_total: number;
  pontos_base: number;
  pontos_pendentes: number;
  dias_uteis: number;
  dias_ausencia: number;
  dias_efetivos: number;
  media: number | null;
  referencia: number | null;
  atingimento: number | null;
  faixa: string | null;
  faixa_rotulo: string | null;
  referencia_rotulo: string;
  lancamentos_validados: number;
  lancamentos_pendentes: number;
  lancamentos_em_andamento: number;
  lancamentos_devolvidos: number;
  distribuicao_niveis: Record<string, number>;
}

interface Resposta {
  competencia: string;
  competencia_rotulo: string;
  fechado?: boolean;
  dias_uteis?: number;
  painel: Painel | null;
  mensagem?: string;
  limites?: { abaixo: number; acima: number };
}

export function PainelServidor() {
  const { usuario } = useSessao();
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [resposta, setResposta] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    setCarregando(true);
    setErro(null);
    api
      .buscar<Resposta>(`/indicadores/meu-painel?competencia=${competencia}`)
      .then(setResposta)
      .catch((falha) => setErro(mensagemDeErro(falha)))
      .finally(() => setCarregando(false));
  }, [competencia]);

  const painel = resposta?.painel ?? null;

  return (
    <>
      <Cabecalho
        titulo={`Olá, ${usuario?.nome.split(' ')[0]}`}
        descricao={`Sua apuração de ${competenciaLegivel(competencia)}${
          painel?.grupo_nome ? ` · grupo ${painel.grupo_nome}` : ''
        }`}
        acoes={
          <Link className="botao botao-principal" to="/lancamentos">
            Registrar lançamento
          </Link>
        }
      />

      <div className="conteudo">
        <div className="filtros">
          <SeletorCompetencia valor={competencia} aoMudar={setCompetencia} />
        </div>

        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {resposta?.fechado && (
          <Aviso tipo="informativo">
            Esta competência já está fechada. Os números abaixo são definitivos e não aceitam mais
            lançamentos.
          </Aviso>
        )}

        {carregando ? (
          <Carregando />
        ) : !painel ? (
          <Cartao>
            <Vazio titulo="Nenhuma apuração neste mês">
              {resposta?.mensagem ??
                'Registre os processos que você concluiu para acompanhar sua média.'}
              <div style={{ marginTop: '1rem' }}>
                <Link className="botao botao-principal" to="/lancamentos">
                  Registrar lançamento
                </Link>
              </div>
            </Vazio>
          </Cartao>
        ) : painel.situacao === 'SEM_APURACAO' ? (
          <Cartao titulo="Mês sem apuração">
            <Aviso tipo="informativo">
              Você esteve ausente em todos os {painel.dias_uteis} dias úteis de{' '}
              {competenciaLegivel(competencia)}. O mês fica sem apuração: não gera média e não entra
              no cálculo do grupo nem do setor.
            </Aviso>
          </Cartao>
        ) : (
          <>
            <div className="grade grade-2">
              <Cartao>
                <IndicadorAtingimento
                  atingimento={painel.atingimento}
                  faixa={painel.faixa}
                  faixaRotulo={painel.faixa_rotulo}
                  media={painel.media}
                  referencia={painel.referencia}
                  origemRotulo={painel.referencia_rotulo}
                  limites={resposta?.limites}
                />
                {painel.atingimento === null && (
                  <Aviso tipo="atencao">
                    Seu grupo ainda não tem referência apurada neste mês. Peça à chefia que defina a
                    meta do grupo ou aguarde os lançamentos validados dos colegas.
                  </Aviso>
                )}
              </Cartao>

              <Cartao titulo="Como sua média foi formada">
                <div className="grade grade-3">
                  <Medida
                    rotulo="Pontos validados"
                    valor={numero(painel.pontos_total, 2)}
                    apoio={`${painel.lancamentos_validados} lançamento(s)`}
                  />
                  <Medida
                    rotulo="Dias efetivos"
                    valor={painel.dias_efetivos}
                    apoio={`${painel.dias_uteis} dias úteis − ${painel.dias_ausencia} de ausência`}
                  />
                  <Medida
                    rotulo="Média"
                    valor={numero(painel.media, 2)}
                    apoio="pontos por dia efetivo"
                  />
                </div>
                <p className="campo-dica" style={{ marginTop: '1rem' }}>
                  Distribuição dos seus níveis no mês:{' '}
                  <DistribuicaoNiveis niveis={painel.distribuicao_niveis} /> (níveis 1 a 4)
                </p>
              </Cartao>
            </div>

            <div className="grade grade-3">
              <Cartao>
                <Medida
                  rotulo="Aguardando validação"
                  valor={painel.lancamentos_pendentes}
                  apoio={`${numero(painel.pontos_pendentes, 2)} ponto(s) fora da média até a chefia validar`}
                />
              </Cartao>
              <Cartao>
                <Medida
                  rotulo="Em andamento"
                  valor={painel.lancamentos_em_andamento}
                  apoio="Contam como volume, mas ficam fora da média até serem concluídos"
                />
              </Cartao>
              <Cartao>
                <Medida
                  rotulo="Devolvidos"
                  valor={painel.lancamentos_devolvidos}
                  apoio={
                    painel.lancamentos_devolvidos > 0
                      ? 'Ajuste e envie de novo para voltarem à fila'
                      : 'Nenhum lançamento devolvido'
                  }
                />
              </Cartao>
            </div>

            {painel.pontos_total !== painel.pontos_base && (
              <Aviso tipo="informativo">
                Dos seus {numero(painel.pontos_total, 2)} pontos,{' '}
                {numero(painel.pontos_total - painel.pontos_base, 2)} vêm de homologação. Eles contam
                na sua apuração individual, mas ficam fora da base que forma a referência do grupo.
              </Aviso>
            )}
          </>
        )}
      </div>
    </>
  );
}
