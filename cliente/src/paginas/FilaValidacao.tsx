import { useCallback, useEffect, useState } from 'react';
import { api, mensagemDeErro } from '../servicos/api';
import {
  ROTULO_DO_PAPEL,
  competenciaAtual,
  competenciaLegivel,
  data as formatarData,
  numero,
} from '../servicos/formato';
import {
  Avatar,
  Aviso,
  Campo,
  Carregando,
  Cartao,
  MarcaSituacao,
  Medida,
  Modal,
  SeletorCompetencia,
  Vazio,
} from '../componentes/comuns';
import { Cabecalho } from '../componentes/Layout';

interface ItemDaFila {
  id: number;
  processo: string | null;
  descricao: string | null;
  nivel: number;
  nivel_rotulo: string | null;
  nivel_original: number | null;
  papel: string;
  quantidade: number;
  pontos: number;
  data_conclusao: string;
  status: string;
  situacao: string;
  justificativa: string | null;
  servidor_nome: string;
  servidor_matricula: string;
  grupo_nome: string | null;
  link_externo: string | null;
}

export function FilaValidacao() {
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [situacao, setSituacao] = useState('PENDENTE');
  const [itens, setItens] = useState<ItemDaFila[]>([]);
  const [contagem, setContagem] = useState({ pendentes: 0, validados: 0, devolvidos: 0 });
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [devolvendo, setDevolvendo] = useState<ItemDaFila | null>(null);
  const [corrigindo, setCorrigindo] = useState<ItemDaFila | null>(null);
  const [devolucaoEmLote, setDevolucaoEmLote] = useState(false);

  const carregar = useCallback(() => {
    setCarregando(true);
    setSelecionados(new Set());
    api
      .buscar<{ lancamentos: ItemDaFila[]; contagem: typeof contagem }>(
        `/validacao/fila?competencia=${competencia}&situacao=${situacao}`,
      )
      .then((resposta) => {
        setItens(resposta.lancamentos);
        setContagem(resposta.contagem);
      })
      .catch((falha) => setErro(mensagemDeErro(falha)))
      .finally(() => setCarregando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competencia, situacao]);

  useEffect(carregar, [carregar]);

  async function validar(item: ItemDaFila) {
    setErro(null);
    try {
      const resposta = await api.enviar<{ mensagem: string }>(`/validacao/${item.id}/validar`, {});
      setSucesso(resposta.mensagem);
      carregar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  async function agirEmLote(acao: 'VALIDAR' | 'DEVOLVER', justificativa?: string) {
    setErro(null);
    try {
      const resposta = await api.enviar<{ mensagem: string }>('/validacao/lote', {
        ids: [...selecionados],
        acao,
        justificativa,
      });
      setSucesso(resposta.mensagem);
      setDevolucaoEmLote(false);
      carregar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  function alternar(id: number) {
    setSelecionados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  return (
    <>
      <Cabecalho
        titulo="Fila de validação"
        descricao={`Lançamentos do setor em ${competenciaLegivel(competencia)}`}
      />

      <div className="conteudo">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}

        <div className="grade grade-3">
          <Cartao>
            <Medida
              rotulo="Aguardando validação"
              valor={contagem.pendentes}
              apoio="Fora da média até serem validados"
            />
          </Cartao>
          <Cartao>
            <Medida rotulo="Validados" valor={contagem.validados} apoio="Entram na apuração" />
          </Cartao>
          <Cartao>
            <Medida
              rotulo="Devolvidos"
              valor={contagem.devolvidos}
              apoio="Aguardando ajuste do servidor"
            />
          </Cartao>
        </div>

        <Cartao
          titulo="Lançamentos"
          descricao="A pontuação é autodeclarada; a validação é o controle contra inflação de nível."
          acoes={
            selecionados.size > 0 ? (
              <>
                <span className="campo-dica">{selecionados.size} selecionado(s)</span>
                <button
                  type="button"
                  className="botao"
                  onClick={() => setDevolucaoEmLote(true)}
                >
                  Devolver em lote
                </button>
                <button
                  type="button"
                  className="botao botao-principal"
                  onClick={() => void agirEmLote('VALIDAR')}
                >
                  Validar em lote
                </button>
              </>
            ) : undefined
          }
        >
          <div className="filtros">
            <SeletorCompetencia valor={competencia} aoMudar={setCompetencia} />
            <Campo rotulo="Situação">
              <select value={situacao} onChange={(evento) => setSituacao(evento.target.value)}>
                <option value="PENDENTE">Aguardando validação</option>
                <option value="VALIDADO">Validados</option>
                <option value="DEVOLVIDO">Devolvidos</option>
                <option value="TODAS">Todas</option>
              </select>
            </Campo>
          </div>

          {carregando ? (
            <Carregando />
          ) : itens.length === 0 ? (
            <Vazio titulo="Nada nesta fila">
              {situacao === 'PENDENTE'
                ? 'Todos os lançamentos do período já foram avaliados. Você pode fechar a competência no painel do setor.'
                : 'Nenhum lançamento nesta situação no período escolhido.'}
            </Vazio>
          ) : (
            <div className="tabela-envolucro">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '2.5rem' }}>
                      <input
                        type="checkbox"
                        checked={selecionados.size === itens.length && itens.length > 0}
                        onChange={(evento) =>
                          setSelecionados(
                            evento.target.checked ? new Set(itens.map((i) => i.id)) : new Set(),
                          )
                        }
                        aria-label="Selecionar todos"
                      />
                    </th>
                    <th>Servidor</th>
                    <th>Processo</th>
                    <th>Nível</th>
                    <th>Papel</th>
                    <th className="numerico">Pontos</th>
                    <th>Conclusão</th>
                    <th>Situação</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {itens.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selecionados.has(item.id)}
                          onChange={() => alternar(item.id)}
                          aria-label={`Selecionar ${item.processo ?? item.descricao ?? 'lançamento'}`}
                        />
                      </td>
                      <td className="nome-servidor">
                        <span className="celula-pessoa">
                          <Avatar nome={item.servidor_nome} />
                          <span>
                            {item.servidor_nome}
                            <span className="campo-dica" style={{ display: 'block' }}>
                              {item.servidor_matricula}
                              {item.grupo_nome ? ` · ${item.grupo_nome}` : ''}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td>
                        <strong className="nao-quebra">
                          {item.processo ?? <span className="discreto">sem processo</span>}
                        </strong>
                        <div className="discreto resumo" title={item.descricao ?? ''}>
                          {item.descricao || '—'}
                        </div>
                        {item.link_externo && (
                          <a href={item.link_externo} target="_blank" rel="noreferrer">
                            Abrir link
                          </a>
                        )}
                      </td>
                      <td className="nao-quebra">
                        N{item.nivel} — {item.nivel_rotulo}
                        {item.nivel_original !== null && (
                          <div className="campo-dica">declarado como N{item.nivel_original}</div>
                        )}
                      </td>
                      <td>{ROTULO_DO_PAPEL[item.papel]}</td>
                      <td className="numerico">{numero(item.pontos, 2)}</td>
                      <td>{formatarData(item.data_conclusao)}</td>
                      <td>
                        <MarcaSituacao situacao={item.situacao} />
                        {item.justificativa && (
                          <div className="campo-dica">{item.justificativa}</div>
                        )}
                      </td>
                      <td>
                        <div className="acoes acoes-tabela">
                          {item.situacao !== 'VALIDADO' && (
                            <button
                              type="button"
                              className="botao botao-pequeno"
                              onClick={() => void validar(item)}
                            >
                              Validar
                            </button>
                          )}
                          <button
                            type="button"
                            className="botao botao-discreto botao-pequeno"
                            onClick={() => setCorrigindo(item)}
                          >
                            Corrigir
                          </button>
                          {item.situacao !== 'DEVOLVIDO' && (
                            <button
                              type="button"
                              className="botao botao-discreto botao-pequeno botao-risco"
                              onClick={() => setDevolvendo(item)}
                            >
                              Devolver
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Cartao>
      </div>

      {devolvendo && (
        <FormularioDevolucao
          item={devolvendo}
          aoFechar={() => setDevolvendo(null)}
          aoConcluir={(mensagem) => {
            setDevolvendo(null);
            setSucesso(mensagem);
            carregar();
          }}
        />
      )}

      {corrigindo && (
        <FormularioCorrecao
          item={corrigindo}
          aoFechar={() => setCorrigindo(null)}
          aoConcluir={(mensagem) => {
            setCorrigindo(null);
            setSucesso(mensagem);
            carregar();
          }}
        />
      )}

      {devolucaoEmLote && (
        <DevolucaoEmLote
          quantidade={selecionados.size}
          aoFechar={() => setDevolucaoEmLote(false)}
          aoConfirmar={(justificativa) => void agirEmLote('DEVOLVER', justificativa)}
        />
      )}
    </>
  );
}

function FormularioDevolucao({
  item,
  aoFechar,
  aoConcluir,
}: {
  item: ItemDaFila;
  aoFechar: () => void;
  aoConcluir: (mensagem: string) => void;
}) {
  const [justificativa, setJustificativa] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  async function devolver() {
    setErro(null);
    try {
      const resposta = await api.enviar<{ mensagem: string }>(`/validacao/${item.id}/devolver`, {
        justificativa,
      });
      aoConcluir(resposta.mensagem);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  return (
    <Modal
      titulo={`Devolver: ${item.processo ?? item.descricao ?? 'lançamento'}`}
      aoFechar={aoFechar}
      rodape={
        <>
          <button type="button" className="botao" onClick={aoFechar}>
            Cancelar
          </button>
          <button
            type="button"
            className="botao botao-principal"
            onClick={() => void devolver()}
            disabled={justificativa.trim().length === 0}
          >
            Devolver ao servidor
          </button>
        </>
      }
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <p className="discreto">
        Lançado por {item.servidor_nome} como {ROTULO_DO_PAPEL[item.papel]}, nível N{item.nivel}.
      </p>
      <Campo
        rotulo="Justificativa"
        dica="O servidor vê este texto. Diga o que precisa ser ajustado."
      >
        <textarea
          value={justificativa}
          onChange={(evento) => setJustificativa(evento.target.value)}
          placeholder="Ex.: O processo seguiu o rito padrão, sem retenção. Reclassifique como nível 2."
          autoFocus
        />
      </Campo>
    </Modal>
  );
}

function FormularioCorrecao({
  item,
  aoFechar,
  aoConcluir,
}: {
  item: ItemDaFila;
  aoFechar: () => void;
  aoConcluir: (mensagem: string) => void;
}) {
  const [nivel, setNivel] = useState(item.nivel);
  const [justificativa, setJustificativa] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  async function corrigir() {
    setErro(null);
    try {
      const resposta = await api.enviar<{ mensagem: string }>(`/validacao/${item.id}/validar`, {
        nivel,
        justificativa: justificativa || null,
      });
      aoConcluir(resposta.mensagem);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  return (
    <Modal
      titulo={`Corrigir o nível: ${item.processo ?? item.descricao ?? 'lançamento'}`}
      aoFechar={aoFechar}
      rodape={
        <>
          <button type="button" className="botao" onClick={aoFechar}>
            Cancelar
          </button>
          <button type="button" className="botao botao-principal" onClick={() => void corrigir()}>
            Corrigir e validar
          </button>
        </>
      }
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <p className="discreto">
        Declarado por {item.servidor_nome} como nível N{item.nivel}. A correção fica registrada com
        seu nome e aparece para o servidor.
      </p>
      <Campo rotulo="Novo nível">
        <select value={nivel} onChange={(evento) => setNivel(Number(evento.target.value))}>
          {[1, 2, 3, 4].map((valor) => (
            <option key={valor} value={valor}>
              N{valor}
            </option>
          ))}
        </select>
      </Campo>
      <Campo rotulo="Observação (opcional)">
        <textarea
          value={justificativa}
          onChange={(evento) => setJustificativa(evento.target.value)}
          placeholder="Explique o motivo da reclassificação."
        />
      </Campo>
    </Modal>
  );
}

function DevolucaoEmLote({
  quantidade,
  aoFechar,
  aoConfirmar,
}: {
  quantidade: number;
  aoFechar: () => void;
  aoConfirmar: (justificativa: string) => void;
}) {
  const [justificativa, setJustificativa] = useState('');
  return (
    <Modal
      titulo={`Devolver ${quantidade} lançamento(s)`}
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
            onClick={() => aoConfirmar(justificativa)}
          >
            Devolver todos
          </button>
        </>
      }
    >
      <Campo rotulo="Justificativa" dica="A mesma justificativa vale para todos os selecionados.">
        <textarea
          value={justificativa}
          onChange={(evento) => setJustificativa(evento.target.value)}
          autoFocus
        />
      </Campo>
    </Modal>
  );
}
