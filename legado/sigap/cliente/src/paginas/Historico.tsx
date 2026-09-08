import { useEffect, useState } from 'react';
import { api, mensagemDeErro } from '../servicos/api';
import { competenciaLegivel, dataHora, numero, percentual } from '../servicos/formato';
import { Aviso, Campo, Carregando, Cartao, Modal, RotuloFaixa, Vazio } from '../componentes/comuns';
import { Cabecalho } from '../componentes/Layout';
import { useSessao } from '../servicos/sessao';

interface Fechamento {
  id: number;
  setor_id: number;
  setor_nome: string;
  setor_sigla: string;
  competencia: string;
  versao: number;
  vigente: boolean;
  media_setor_oficial: number | null;
  media_setor_contraprova: number | null;
  total_pontos: number | null;
  processos_distintos: number | null;
  servidores_apurados: number | null;
  servidores_sem_apuracao: number | null;
  fechado_em: string;
  fechado_por_nome: string;
  reaberto_em: string | null;
  reaberto_por_nome: string | null;
  justificativa_reabertura: string | null;
}

interface Consolidado extends Fechamento {
  competencia_rotulo: string;
  servidores: Array<{
    servidor_id: number;
    nome: string;
    matricula: string;
    grupo_nome: string | null;
    situacao: string;
    pontos_total: number;
    dias_efetivos: number;
    media: number | null;
    referencia: number | null;
    atingimento: number | null;
    faixa: string | null;
  }>;
  grupos: Array<{
    grupo_id: number;
    nome: string;
    referencia: number | null;
    origem: string;
    servidores_considerados: number;
  }>;
}

export function Historico() {
  const { ehAdmin } = useSessao();
  const [fechamentos, setFechamentos] = useState<Fechamento[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<Consolidado | null>(null);
  const [reabrindo, setReabrindo] = useState<Fechamento | null>(null);

  function carregar() {
    setCarregando(true);
    api
      .buscar<{ fechamentos: Fechamento[] }>('/fechamentos')
      .then((resposta) => setFechamentos(resposta.fechamentos))
      .catch((falha) => setErro(mensagemDeErro(falha)))
      .finally(() => setCarregando(false));
  }

  useEffect(carregar, []);

  async function abrirDetalhe(fechamento: Fechamento) {
    try {
      const resposta = await api.buscar<{ consolidado: Consolidado }>(
        `/fechamentos/${fechamento.id}`,
      );
      setDetalhe(resposta.consolidado);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  const vigentes = fechamentos.filter((f) => f.vigente);
  const variacao = (indice: number): number | null => {
    const atual = vigentes[indice]?.media_setor_oficial;
    const anterior = vigentes[indice + 1]?.media_setor_oficial;
    if (atual === null || atual === undefined || !anterior) return null;
    return atual / anterior - 1;
  };

  return (
    <>
      <Cabecalho
        titulo="Histórico"
        descricao="Consolidados fechados, versão por versão, com comparação entre meses."
      />

      <div className="conteudo">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}

        <Cartao titulo="Competências fechadas">
          {carregando ? (
            <Carregando />
          ) : fechamentos.length === 0 ? (
            <Vazio titulo="Nenhuma competência fechada ainda">
              Feche um mês no painel do setor para gerar o primeiro consolidado.
            </Vazio>
          ) : (
            <div className="tabela-envolucro">
              <table>
                <thead>
                  <tr>
                    <th>Competência</th>
                    <th>Setor</th>
                    <th className="numerico">Média oficial</th>
                    <th className="numerico">Variação</th>
                    <th className="numerico">Contraprova</th>
                    <th className="numerico">Processos</th>
                    <th>Situação</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {fechamentos.map((fechamento) => {
                    const posicao = vigentes.indexOf(fechamento);
                    const delta = posicao >= 0 ? variacao(posicao) : null;
                    return (
                      <tr key={fechamento.id}>
                        <td>
                          <strong>{competenciaLegivel(fechamento.competencia.slice(0, 7))}</strong>
                          <div className="campo-dica">versão {fechamento.versao}</div>
                        </td>
                        <td className="discreto">{fechamento.setor_sigla}</td>
                        <td className="numerico">{numero(fechamento.media_setor_oficial, 2)}</td>
                        <td className="numerico">
                          {delta === null ? '—' : `${delta >= 0 ? '+' : ''}${percentual(delta, 1)}`}
                        </td>
                        <td className="numerico">{numero(fechamento.media_setor_contraprova, 2)}</td>
                        <td className="numerico">{fechamento.processos_distintos ?? '—'}</td>
                        <td>
                          {fechamento.reaberto_em ? (
                            <>
                              <span className="marca marca-devolvido">Reaberta</span>
                              <div className="campo-dica">
                                {fechamento.reaberto_por_nome} ·{' '}
                                {dataHora(fechamento.reaberto_em)}
                              </div>
                            </>
                          ) : fechamento.vigente ? (
                            <span className="marca marca-validado">Vigente</span>
                          ) : (
                            <span className="marca marca-neutra">Versão anterior</span>
                          )}
                          <div className="campo-dica">
                            Fechada por {fechamento.fechado_por_nome}
                          </div>
                        </td>
                        <td>
                          <div className="acoes">
                            <button
                              type="button"
                              className="botao botao-discreto botao-pequeno"
                              onClick={() => void abrirDetalhe(fechamento)}
                            >
                              Ver consolidado
                            </button>
                            {ehAdmin && fechamento.vigente && !fechamento.reaberto_em && (
                              <button
                                type="button"
                                className="botao botao-discreto botao-pequeno botao-risco"
                                onClick={() => setReabrindo(fechamento)}
                              >
                                Reabrir
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Cartao>
      </div>

      {detalhe && (
        <Modal
          titulo={`Consolidado de ${detalhe.competencia_rotulo} · versão ${detalhe.versao}`}
          aoFechar={() => setDetalhe(null)}
        >
          {detalhe.justificativa_reabertura && (
            <Aviso tipo="atencao">
              Reaberta por {detalhe.reaberto_por_nome}: {detalhe.justificativa_reabertura}
            </Aviso>
          )}
          <p className="discreto">
            Fechada por {detalhe.fechado_por_nome} em {dataHora(detalhe.fechado_em)}. Média oficial{' '}
            {numero(detalhe.media_setor_oficial, 2)} · contraprova{' '}
            {numero(detalhe.media_setor_contraprova, 2)} · {detalhe.processos_distintos} processos
            distintos.
          </p>

          <h3 style={{ marginTop: '1rem' }}>Referência congelada por grupo</h3>
          <div className="tabela-envolucro" style={{ marginTop: '0.5rem' }}>
            <table>
              <thead>
                <tr>
                  <th>Grupo</th>
                  <th className="numerico">Referência</th>
                  <th>Origem</th>
                </tr>
              </thead>
              <tbody>
                {detalhe.grupos.map((grupo) => (
                  <tr key={grupo.grupo_id}>
                    <td>{grupo.nome}</td>
                    <td className="numerico">{numero(grupo.referencia, 2)}</td>
                    <td className="discreto">
                      {grupo.origem === 'META_FIXA' ? 'Meta fixa' : 'Apurada no mês'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 style={{ marginTop: '1.25rem' }}>Servidores</h3>
          <div className="tabela-envolucro" style={{ marginTop: '0.5rem' }}>
            <table>
              <thead>
                <tr>
                  <th>Servidor</th>
                  <th className="numerico">Pontos</th>
                  <th className="numerico">Dias</th>
                  <th className="numerico">Média</th>
                  <th className="numerico">Atingimento</th>
                  <th>Faixa</th>
                </tr>
              </thead>
              <tbody>
                {detalhe.servidores.map((servidor) => (
                  <tr key={servidor.servidor_id}>
                    <td>{servidor.nome}</td>
                    <td className="numerico">{numero(servidor.pontos_total, 1)}</td>
                    <td className="numerico">{servidor.dias_efetivos}</td>
                    <td className="numerico">{numero(servidor.media, 2)}</td>
                    <td className="numerico">{percentual(servidor.atingimento, 0)}</td>
                    <td>
                      {servidor.situacao === 'SEM_APURACAO' ? (
                        <span className="marca marca-neutra">Sem apuração</span>
                      ) : (
                        <RotuloFaixa
                          faixa={servidor.faixa}
                          texto={
                            servidor.faixa === 'ABAIXO' ? 'Abaixo da referência'
                            : servidor.faixa === 'DENTRO' ? 'Dentro da referência'
                            : servidor.faixa === 'ACIMA' ? 'Acima da referência'
                            : null
                          }
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {reabrindo && (
        <Reabertura
          fechamento={reabrindo}
          aoFechar={() => setReabrindo(null)}
          aoConcluir={(mensagem) => {
            setReabrindo(null);
            setSucesso(mensagem);
            carregar();
          }}
        />
      )}
    </>
  );
}

function Reabertura({
  fechamento,
  aoFechar,
  aoConcluir,
}: {
  fechamento: Fechamento;
  aoFechar: () => void;
  aoConcluir: (mensagem: string) => void;
}) {
  const [justificativa, setJustificativa] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  async function reabrir() {
    setErro(null);
    try {
      const resposta = await api.enviar<{ mensagem: string }>(
        `/fechamentos/${fechamento.id}/reabrir`,
        { justificativa },
      );
      aoConcluir(resposta.mensagem);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  return (
    <Modal
      titulo={`Reabrir ${competenciaLegivel(fechamento.competencia.slice(0, 7))}`}
      aoFechar={aoFechar}
      rodape={
        <>
          <button type="button" className="botao" onClick={aoFechar}>
            Cancelar
          </button>
          <button
            type="button"
            className="botao botao-principal"
            disabled={justificativa.trim().length === 0}
            onClick={() => void reabrir()}
          >
            Reabrir competência
          </button>
        </>
      }
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <p>
        A reabertura libera lançamentos e edições no mês. O consolidado atual é preservado; ao
        fechar de novo, o sistema grava uma nova versão ao lado da anterior.
      </p>
      <Campo rotulo="Justificativa" dica="Fica registrada no log e no consolidado.">
        <textarea
          value={justificativa}
          onChange={(evento) => setJustificativa(evento.target.value)}
          placeholder="Ex.: lançamento de julho ficou de fora por erro na data de conclusão."
          autoFocus
        />
      </Campo>
    </Modal>
  );
}
