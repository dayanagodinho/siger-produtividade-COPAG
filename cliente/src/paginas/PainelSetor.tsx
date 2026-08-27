import { useCallback, useEffect, useState } from 'react';
import { api, mensagemDeErro } from '../servicos/api';
import { competenciaAtual, competenciaLegivel, dataHora, numero, percentual } from '../servicos/formato';
import {
  Aviso,
  Campo,
  Carregando,
  Cartao,
  DistribuicaoNiveis,
  Medida,
  Modal,
  RotuloFaixa,
  SeletorCompetencia,
  Vazio,
} from '../componentes/comuns';
import { Cabecalho } from '../componentes/Layout';
import { useSessao } from '../servicos/sessao';

interface ServidorApurado {
  servidor_id: number;
  nome: string;
  matricula: string;
  grupo_nome: string | null;
  situacao: 'APURADO' | 'SEM_APURACAO';
  pontos_total: number;
  pontos_base: number;
  pontos_pendentes: number;
  dias_efetivos: number;
  dias_ausencia: number;
  media: number | null;
  referencia: number | null;
  atingimento: number | null;
  faixa: string | null;
  faixa_rotulo: string | null;
  referencia_rotulo: string;
  lancamentos_pendentes: number;
  distribuicao_niveis: Record<string, number>;
  taxa_correcao: number | null;
  lancamentos_avaliados: number;
}

interface Apuracao {
  competencia: string;
  competencia_rotulo: string;
  setor: { id: number; nome: string; sigla: string };
  dias_uteis: number;
  grupos: Array<{
    grupo_id: number;
    nome: string;
    referencia: number | null;
    origem: string;
    meta_definida_em: string | null;
    servidores_considerados: number;
  }>;
  servidores: ServidorApurado[];
  resumo: {
    media_oficial: number | null;
    media_contraprova: number | null;
    total_pontos: number;
    total_dias_efetivos: number;
    processos_distintos: number;
    servidores_apurados: number;
    servidores_sem_apuracao: number;
  };
  fechado: boolean;
  fechamento: { id: number; versao: number; fechado_em: string; fechado_por_nome: string } | null;
}

export function PainelSetor() {
  const { ehAdmin } = useSessao();
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [setorId, setSetorId] = useState<number | null>(null);
  const [setores, setSetores] = useState<Array<{ id: number; nome: string; sigla: string }>>([]);
  const [apuracao, setApuracao] = useState<Apuracao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [fechando, setFechando] = useState(false);

  useEffect(() => {
    api
      .buscar<{ setores: Array<{ id: number; nome: string; sigla: string }> }>(
        '/indicadores/meus-setores',
      )
      .then((resposta) => {
        setSetores(resposta.setores);
        if (resposta.setores.length > 0) setSetorId(resposta.setores[0].id);
      })
      .catch((falha) => setErro(mensagemDeErro(falha)));
  }, []);

  const carregar = useCallback(() => {
    if (!setorId) return;
    setCarregando(true);
    api
      .buscar<Apuracao>(`/indicadores/setor?competencia=${competencia}&setor_id=${setorId}`)
      .then(setApuracao)
      .catch((falha) => setErro(mensagemDeErro(falha)))
      .finally(() => setCarregando(false));
  }, [competencia, setorId]);

  useEffect(carregar, [carregar]);

  return (
    <>
      <Cabecalho
        titulo="Painel do setor"
        descricao={
          apuracao
            ? `${apuracao.setor.nome} · ${competenciaLegivel(competencia)} · ${apuracao.dias_uteis} dias úteis`
            : 'Apuração mensal do setor'
        }
        acoes={
          <>
            <button
              type="button"
              className="botao"
              disabled={!setorId}
              onClick={() =>
                api.baixar(
                  `/exportacoes/painel-setor.xlsx?competencia=${competencia}&setor_id=${setorId}`,
                )
              }
            >
              Exportar XLSX
            </button>
            {apuracao && !apuracao.fechado && (
              <button
                type="button"
                className="botao botao-principal"
                onClick={() => setFechando(true)}
              >
                Fechar competência
              </button>
            )}
          </>
        }
      />

      <div className="conteudo">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}

        <div className="filtros">
          <SeletorCompetencia valor={competencia} aoMudar={setCompetencia} />
          {ehAdmin && setores.length > 1 && (
            <Campo rotulo="Setor">
              <select
                value={setorId ?? ''}
                onChange={(evento) => setSetorId(Number(evento.target.value))}
              >
                {setores.map((setor) => (
                  <option key={setor.id} value={setor.id}>
                    {setor.sigla} — {setor.nome}
                  </option>
                ))}
              </select>
            </Campo>
          )}
        </div>

        {carregando || !apuracao ? (
          <Carregando />
        ) : (
          <>
            {apuracao.fechado && apuracao.fechamento && (
              <Aviso tipo="informativo">
                Competência fechada em {dataHora(apuracao.fechamento.fechado_em)} por{' '}
                {apuracao.fechamento.fechado_por_nome} (versão {apuracao.fechamento.versao}). Novos
                lançamentos e edições neste mês estão bloqueados.
              </Aviso>
            )}

            <div className="grade grade-4">
              <Cartao>
                <Medida
                  rotulo="Média do setor"
                  valor={numero(apuracao.resumo.media_oficial, 2)}
                  apoio="Oficial: média simples das médias"
                />
              </Cartao>
              <Cartao>
                <Medida
                  rotulo="Contraprova"
                  valor={numero(apuracao.resumo.media_contraprova, 2)}
                  apoio={`${numero(apuracao.resumo.total_pontos, 1)} pontos ÷ ${apuracao.resumo.total_dias_efetivos} dias`}
                />
              </Cartao>
              <Cartao>
                <Medida
                  rotulo="Processos distintos"
                  valor={apuracao.resumo.processos_distintos}
                  apoio="Entrega real: um processo pode gerar até três lançamentos"
                />
              </Cartao>
              <Cartao>
                <Medida
                  rotulo="Servidores"
                  valor={apuracao.resumo.servidores_apurados}
                  apoio={`${apuracao.resumo.servidores_sem_apuracao} sem apuração no mês`}
                />
              </Cartao>
            </div>

            <Cartao
              titulo="Referência de cada grupo"
              descricao="A referência define o atingimento de quem está no grupo."
            >
              <div className="tabela-envolucro">
                <table>
                  <thead>
                    <tr>
                      <th>Grupo</th>
                      <th className="numerico">Referência</th>
                      <th>Origem</th>
                      <th className="numerico">Servidores considerados</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apuracao.grupos.map((grupo) => (
                      <tr key={grupo.grupo_id}>
                        <td>{grupo.nome}</td>
                        <td className="numerico">{numero(grupo.referencia, 2)}</td>
                        <td>
                          {grupo.origem === 'META_FIXA'
                            ? `Meta fixa definida em ${
                                grupo.meta_definida_em
                                  ? new Date(grupo.meta_definida_em).toLocaleDateString('pt-BR')
                                  : '—'
                              }`
                            : grupo.origem === 'MEDIANA_APURADA'
                              ? 'Referência apurada no mês (mediana do grupo)'
                              : 'Sem referência: nenhum servidor apurado no grupo'}
                        </td>
                        <td className="numerico">{grupo.servidores_considerados}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Cartao>

            <Cartao
              titulo="Servidores"
              descricao="Distribuição de níveis e taxa de correção ajudam a ver quem está calibrando mal a autodeclaração."
            >
              {apuracao.servidores.length === 0 ? (
                <Vazio titulo="Nenhum servidor com apuração neste mês">
                  Verifique se há servidores ativos lotados neste setor.
                </Vazio>
              ) : (
                <div className="tabela-envolucro">
                  <table>
                    <thead>
                      <tr>
                        <th>Servidor</th>
                        <th className="numerico">Pontos</th>
                        <th className="numerico">Dias</th>
                        <th className="numerico">Média</th>
                        <th className="numerico">Referência</th>
                        <th className="numerico">Atingimento</th>
                        <th>Faixa</th>
                        <th>Níveis 1–4</th>
                        <th className="numerico">Correção</th>
                      </tr>
                    </thead>
                    <tbody>
                      {apuracao.servidores.map((servidor) => (
                        <tr key={servidor.servidor_id}>
                          <td className="nome-servidor">
                            {servidor.nome}
                            <div className="campo-dica">
                              {servidor.matricula} · {servidor.grupo_nome ?? 'sem grupo'}
                            </div>
                          </td>
                          <td className="numerico">
                            {numero(servidor.pontos_total, 1)}
                            {servidor.lancamentos_pendentes > 0 && (
                              <div className="campo-dica">
                                +{numero(servidor.pontos_pendentes, 1)} na fila
                              </div>
                            )}
                          </td>
                          <td className="numerico">
                            {servidor.dias_efetivos}
                            {servidor.dias_ausencia > 0 && (
                              <div className="campo-dica">−{servidor.dias_ausencia} ausência</div>
                            )}
                          </td>
                          <td className="numerico">{numero(servidor.media, 2)}</td>
                          <td className="numerico">{numero(servidor.referencia, 2)}</td>
                          <td className="numerico">{percentual(servidor.atingimento, 0)}</td>
                          <td>
                            {servidor.situacao === 'SEM_APURACAO' ? (
                              <span className="marca marca-neutra">Sem apuração</span>
                            ) : (
                              <RotuloFaixa
                                faixa={servidor.faixa}
                                texto={
                                  servidor.faixa === 'ABAIXO' ? 'Abaixo'
                                  : servidor.faixa === 'DENTRO' ? 'Dentro'
                                  : servidor.faixa === 'ACIMA' ? 'Acima'
                                  : 'Sem referência'
                                }
                              />
                            )}
                          </td>
                          <td>
                            <DistribuicaoNiveis niveis={servidor.distribuicao_niveis} />
                          </td>
                          <td className="numerico">
                            {percentual(servidor.taxa_correcao, 0)}
                            <div className="campo-dica">
                              {servidor.lancamentos_avaliados} avaliados
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Cartao>
          </>
        )}
      </div>

      {fechando && setorId && (
        <FecharCompetencia
          setorId={setorId}
          competencia={competencia}
          aoFechar={() => setFechando(false)}
          aoConcluir={(mensagem) => {
            setFechando(false);
            setSucesso(mensagem);
            carregar();
          }}
        />
      )}
    </>
  );
}

function FecharCompetencia({
  setorId,
  competencia,
  aoFechar,
  aoConcluir,
}: {
  setorId: number;
  competencia: string;
  aoFechar: () => void;
  aoConcluir: (mensagem: string) => void;
}) {
  const [previa, setPrevia] = useState<{
    pendentes_de_validacao: number;
    em_andamento: number;
    pronto_para_fechar: boolean;
    alerta: string | null;
    resumo: Apuracao['resumo'];
  } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api
      .buscar<typeof previa>(
        `/fechamentos/previa?competencia=${competencia}&setor_id=${setorId}`,
      )
      .then(setPrevia)
      .catch((falha) => setErro(mensagemDeErro(falha)));
  }, [competencia, setorId]);

  async function fechar() {
    setErro(null);
    setEnviando(true);
    try {
      const resposta = await api.enviar<{ mensagem: string }>('/fechamentos', {
        setor_id: setorId,
        competencia,
        confirmar_pendentes: true,
      });
      aoConcluir(resposta.mensagem);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
      setEnviando(false);
    }
  }

  return (
    <Modal
      titulo={`Fechar ${competenciaLegivel(competencia)}`}
      aoFechar={aoFechar}
      rodape={
        <>
          <button type="button" className="botao" onClick={aoFechar}>
            Cancelar
          </button>
          <button
            type="button"
            className="botao botao-principal"
            onClick={() => void fechar()}
            disabled={enviando || !previa}
          >
            {enviando ? 'Fechando...' : 'Confirmar fechamento'}
          </button>
        </>
      }
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!previa ? (
        <Carregando />
      ) : (
        <>
          {previa.alerta && <Aviso tipo="atencao">{previa.alerta}</Aviso>}
          <p>
            O fechamento bloqueia novos lançamentos e edições nesta competência e congela os
            números abaixo. A reabertura depende da administração e fica registrada.
          </p>
          <div className="grade grade-3" style={{ marginTop: '1rem' }}>
            <Medida
              rotulo="Média oficial"
              valor={numero(previa.resumo.media_oficial, 2)}
            />
            <Medida
              rotulo="Processos distintos"
              valor={previa.resumo.processos_distintos}
            />
            <Medida
              rotulo="Na fila de validação"
              valor={previa.pendentes_de_validacao}
              apoio="Ficam congelados fora da média"
            />
          </div>
        </>
      )}
    </Modal>
  );
}
