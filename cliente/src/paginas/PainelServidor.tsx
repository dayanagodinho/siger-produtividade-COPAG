import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, mensagemDeErro } from '../servicos/api';
import { competenciaAtual, competenciaLegivel, numero } from '../servicos/formato';
import {
  Aviso,
  Carregando,
  Cartao,
  IndicadorAtingimento,
  Medida,
  SeletorCompetencia,
  Vazio,
} from '../componentes/comuns';
import {
  BarraDeNiveis,
  BarrasHorizontais,
  ColunasDoPeriodo,
  Figura,
  LegendaDeNiveis,
  Rosca,
} from '../componentes/graficos';
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
  pontos_por_papel: Record<string, number>;
}

interface Comparacao {
  nome: string;
  referencia: number | null;
  origem: string;
  posicao: number | null;
  total_no_grupo: number;
  melhor_media: number | null;
  faltam_pontos: number | null;
  medias: Array<{ chave: string; rotulo: string; media: number | null; sou_eu: boolean; faixa: string | null }>;
}

interface ResumoDoSetor {
  nome: string;
  sigla: string;
  media_oficial: number | null;
  media_contraprova: number | null;
  processos_distintos: number;
  total_pontos: number;
  servidores_apurados: number;
  servidores_sem_apuracao: number;
}

interface Resposta {
  competencia: string;
  competencia_rotulo: string;
  fechado?: boolean;
  dias_uteis?: number;
  painel: Painel | null;
  mensagem?: string;
  limites?: { abaixo: number; acima: number };
  grupo?: Comparacao | null;
  setor?: ResumoDoSetor;
}

interface PontoDaSerie {
  competencia: string;
  competencia_rotulo: string;
  media: number | null;
  referencia: number | null;
  situacao: string;
  sem_registro: boolean;
}

interface Nivel {
  nivel: number;
  rotulo: string;
}

interface Pendencia {
  chave: string;
  texto: string;
  detalhe?: string;
  destino: string;
  acao: string;
  urgente?: boolean;
}

/** Competência anterior à informada, no formato AAAA-MM. */
function competenciaAnterior(competencia: string): string {
  const [ano, mes] = competencia.split('-').map(Number);
  const anterior = new Date(Date.UTC(ano, mes - 2, 1));
  return `${anterior.getUTCFullYear()}-${String(anterior.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function PainelServidor() {
  const { usuario } = useSessao();
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [resposta, setResposta] = useState<Resposta | null>(null);
  const [serie, setSerie] = useState<PontoDaSerie[]>([]);
  const [niveis, setNiveis] = useState<Nivel[]>([]);
  const [pendencias, setPendencias] = useState<Pendencia[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    api.buscar<{ niveis: Nivel[] }>('/complexidade').then((r) => setNiveis(r.niveis));
  }, []);

  useEffect(() => {
    setCarregando(true);
    setErro(null);
    Promise.all([
      api.buscar<Resposta>(`/indicadores/meu-painel?competencia=${competencia}`),
      api.buscar<{ serie: PontoDaSerie[] }>(
        `/indicadores/minha-serie?competencia=${competencia}&meses=6`,
      ),
    ])
      .then(([painel, historico]) => {
        setResposta(painel);
        setSerie(historico.serie);
      })
      .catch((falha) => setErro(mensagemDeErro(falha)))
      .finally(() => setCarregando(false));
  }, [competencia]);

  const painel = resposta?.painel ?? null;
  const rotulosDosNiveis = Object.fromEntries(niveis.map((n) => [n.nivel, n.rotulo]));

  /* O que espera ação de quem está olhando: para o servidor, o que voltou ou
     ficou pela metade; para a chefia, a fila e o mês por fechar. */
  useEffect(() => {
    let ativo = true;
    const ehChefia = usuario?.perfil === 'CHEFE' || usuario?.perfil === 'ADMIN';
    const anterior = competenciaAnterior(competencia);

    async function levantar() {
      const lista: Pendencia[] = [];

      if (ehChefia) {
        try {
          const fila = await api.buscar<{
            contagem: { pendentes: number; devolvidos: number };
          }>(`/validacao/fila?competencia=${competencia}&situacao=PENDENTE`);
          if (fila.contagem.pendentes > 0) {
            lista.push({
              chave: 'fila',
              texto: `${fila.contagem.pendentes} lançamento(s) aguardando sua validação`,
              detalhe: 'Enquanto não forem validados, ficam fora da média do setor.',
              destino: '/validacao',
              acao: 'Abrir a fila',
              urgente: true,
            });
          }
        } catch {
          /* sem permissão ou sem setor: a pendência simplesmente não aparece */
        }

        try {
          const historico = await api.buscar<{
            fechamentos: Array<{ competencia: string; vigente: boolean; reaberto_em: string | null }>;
          }>('/fechamentos');
          const fechado = historico.fechamentos.some(
            (f) => f.competencia.slice(0, 7) === anterior && f.vigente && !f.reaberto_em,
          );
          if (!fechado) {
            lista.push({
              chave: 'fechamento',
              texto: `A competência de ${competenciaLegivel(anterior)} ainda não foi fechada`,
              detalhe: 'O consolidado do mês só existe depois do fechamento.',
              destino: '/setor',
              acao: 'Ir ao painel do setor',
            });
          }
        } catch {
          /* idem */
        }
      }

      if (painel && painel.lancamentos_devolvidos > 0) {
        lista.push({
          chave: 'devolvidos',
          texto: `${painel.lancamentos_devolvidos} lançamento(s) seu(s) foram devolvidos`,
          detalhe: 'Ajuste conforme a justificativa da chefia e envie de novo.',
          destino: '/lancamentos',
          acao: 'Ver meus lançamentos',
          urgente: true,
        });
      }

      if (painel && painel.lancamentos_em_andamento > 0) {
        lista.push({
          chave: 'andamento',
          texto: `${painel.lancamentos_em_andamento} lançamento(s) seu(s) em andamento`,
          detalhe: 'Eles só entram na média depois de marcados como concluídos.',
          destino: '/lancamentos',
          acao: 'Ver meus lançamentos',
        });
      }

      if (ativo) setPendencias(lista);
    }

    void levantar();
    return () => {
      ativo = false;
    };
  }, [competencia, painel, usuario?.perfil]);

  const composicao = painel
    ? [
        { rotulo: 'Execução', valor: painel.pontos_por_papel.EXECUCAO ?? 0, cor: 'var(--papel-execucao)' },
        { rotulo: 'Revisão', valor: painel.pontos_por_papel.REVISAO ?? 0, cor: 'var(--papel-revisao)' },
        { rotulo: 'Homologação', valor: painel.pontos_por_papel.HOMOLOGACAO ?? 0, cor: 'var(--papel-homologacao)' },
      ]
    : [];

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

        {pendencias.length > 0 && (
          <Cartao
            titulo="Esperando você"
            descricao="O que precisa de uma ação sua neste mês."
          >
            <ul className="lista-pendencias">
              {pendencias.map((pendencia) => (
                <li key={pendencia.chave} data-urgente={pendencia.urgente ? 'sim' : undefined}>
                  <div>
                    <strong>{pendencia.texto}</strong>
                    {pendencia.detalhe && <span>{pendencia.detalhe}</span>}
                  </div>
                  <Link className="botao botao-pequeno" to={pendencia.destino}>
                    {pendencia.acao}
                  </Link>
                </li>
              ))}
            </ul>
          </Cartao>
        )}

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

              <Cartao>
                <Figura
                  titulo="De onde vieram seus pontos"
                  apoio={`${painel.lancamentos_validados} lançamento(s) validado(s) em ${competenciaLegivel(competencia)}`}
                >
                  <Rosca fatias={composicao} totalRotulo="pontos" />
                </Figura>
                {painel.pontos_total !== painel.pontos_base && (
                  <p className="campo-dica" style={{ marginTop: '0.75rem' }}>
                    Os {numero(painel.pontos_total - painel.pontos_base, 2)} ponto(s) de homologação
                    contam para você, mas ficam fora da base que forma a referência do grupo.
                  </p>
                )}
              </Cartao>
            </div>

            {resposta?.grupo && resposta.grupo.medias.length > 1 && (
              <Cartao>
                <Figura
                  titulo={`Você e o grupo ${resposta.grupo.nome}`}
                  apoio="As médias dos colegas aparecem sem nome: a comparação é com o nível do grupo, não com pessoas."
                >
                  <BarrasHorizontais
                    itens={resposta.grupo.medias.map((linha) => ({
                      rotulo: linha.rotulo,
                      valor: linha.media,
                      cor: linha.sou_eu ? 'var(--verde-600)' : 'var(--verde-300)',
                    }))}
                    referencia={resposta.grupo.referencia}
                    rotuloReferencia={`referência ${numero(resposta.grupo.referencia, 2)}`}
                    alturaDaBarra={20}
                  />
                </Figura>

                <div className="grade grade-3" style={{ marginTop: '1rem' }}>
                  <Medida
                    rotulo="Sua posição"
                    valor={
                      resposta.grupo.posicao
                        ? `${resposta.grupo.posicao}º de ${resposta.grupo.total_no_grupo}`
                        : '—'
                    }
                    apoio="entre quem tem apuração no grupo"
                  />
                  <Medida
                    rotulo="Referência do grupo"
                    valor={numero(resposta.grupo.referencia, 2)}
                    apoio={
                      resposta.grupo.origem === 'META_FIXA'
                        ? 'meta fixa definida para o grupo'
                        : 'mediana das médias no mês'
                    }
                  />
                  <Medida
                    rotulo="Maior média do grupo"
                    valor={numero(resposta.grupo.melhor_media, 2)}
                    apoio="ponto por dia efetivo"
                  />
                </div>

                {resposta.grupo.faltam_pontos !== null && resposta.grupo.faltam_pontos > 0 ? (
                  <Aviso tipo="atencao">
                    Para chegar à referência do grupo neste mês faltam{' '}
                    <strong>{numero(resposta.grupo.faltam_pontos, 1)} ponto(s)</strong> — algo como{' '}
                    {Math.ceil(resposta.grupo.faltam_pontos / 2)} tarefa(s) de nível N2 em execução.
                  </Aviso>
                ) : (
                  <Aviso tipo="sucesso">
                    Sua média já está na referência do grupo neste mês.
                  </Aviso>
                )}
              </Cartao>
            )}

            {resposta?.setor && (
              <Cartao
                titulo={`Como está o setor em ${competenciaLegivel(competencia)}`}
                descricao={`${resposta.setor.nome} · ${resposta.setor.servidores_apurados} servidor(es) com apuração`}
              >
                <div className="grade grade-4">
                  <Medida
                    rotulo="Média do setor"
                    valor={numero(resposta.setor.media_oficial, 2)}
                    apoio="média das médias de quem tem apuração"
                  />
                  <Medida
                    rotulo="Contraprova"
                    valor={numero(resposta.setor.media_contraprova, 2)}
                    apoio={`${numero(resposta.setor.total_pontos, 0)} pontos no total`}
                  />
                  <Medida
                    rotulo="Processos concluídos"
                    valor={resposta.setor.processos_distintos}
                    apoio="processos distintos, sem contar repetição de papel"
                  />
                  <Medida
                    rotulo="Sua média"
                    valor={numero(painel.media, 2)}
                    apoio={
                      resposta.setor.media_oficial && painel.media
                        ? painel.media >= resposta.setor.media_oficial
                          ? 'acima da média do setor'
                          : 'abaixo da média do setor'
                        : ''
                    }
                  />
                </div>
              </Cartao>
            )}

            <Cartao>
              <Figura
                titulo="Sua média mês a mês"
                apoio="A linha em cada coluna é a referência do grupo naquele mês. Traço significa mês sem lançamento."
              >
                <ColunasDoPeriodo
                  colunas={serie.map((ponto) => ({
                    rotulo: ponto.competencia_rotulo.split(' de ')[0].slice(0, 3),
                    valor:
                      ponto.situacao === 'SEM_APURACAO' || ponto.sem_registro ? null : ponto.media,
                    referencia: ponto.referencia,
                    destaque: ponto.competencia.slice(0, 7) === competencia,
                  }))}
                />
              </Figura>
            </Cartao>

            <div className="grade grade-2">
              <Cartao>
                <Figura
                  titulo="Complexidade do que você lançou"
                  apoio="Concentração num nível só costuma indicar calibração a rever."
                >
                  <BarraDeNiveis niveis={painel.distribuicao_niveis} />
                  <div style={{ marginTop: '0.9rem' }}>
                    <LegendaDeNiveis
                      rotulos={rotulosDosNiveis}
                      contagem={painel.distribuicao_niveis}
                    />
                  </div>
                </Figura>
              </Cartao>

              <Cartao titulo="Situação dos seus lançamentos">
                <div className="grade grade-3">
                  <Medida
                    rotulo="Média"
                    valor={numero(painel.media, 2)}
                    apoio={`${numero(painel.pontos_total, 1)} pontos ÷ ${painel.dias_efetivos} dias efetivos`}
                  />
                  <Medida
                    rotulo="Aguardando validação"
                    valor={painel.lancamentos_pendentes}
                    apoio={`${numero(painel.pontos_pendentes, 1)} ponto(s) fora da média até a chefia validar`}
                  />
                  <Medida
                    rotulo="Em andamento"
                    valor={painel.lancamentos_em_andamento}
                    apoio="Fora da média até serem concluídos"
                  />
                </div>
                {painel.lancamentos_devolvidos > 0 && (
                  <Aviso tipo="atencao">
                    {painel.lancamentos_devolvidos} lançamento(s) devolvido(s) pela chefia. Ajuste e
                    envie de novo para voltarem à fila.
                  </Aviso>
                )}
                {painel.dias_ausencia > 0 && (
                  <p className="campo-dica" style={{ marginTop: '0.75rem' }}>
                    Dos {painel.dias_uteis} dias úteis do mês, {painel.dias_ausencia} foram de
                    ausência registrada — sua média é dividida por {painel.dias_efetivos}.
                  </p>
                )}
              </Cartao>
            </div>
          </>
        )}
      </div>
    </>
  );
}
