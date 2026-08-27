import { useCallback, useEffect, useState } from 'react';
import { api, mensagemDeErro } from '../servicos/api';
import {
  ROTULO_DO_PAPEL,
  ROTULO_DO_STATUS,
  competenciaAtual,
  competenciaLegivel,
  data as formatarData,
  numero,
} from '../servicos/formato';
import {
  Aviso,
  Campo,
  Carregando,
  Cartao,
  MarcaSituacao,
  Modal,
  SeletorCompetencia,
  Vazio,
} from '../componentes/comuns';
import { Cabecalho } from '../componentes/Layout';
import { useSessao } from '../servicos/sessao';

interface Lancamento {
  id: number;
  processo: string | null;
  descricao: string | null;
  nivel: number;
  nivel_original: number | null;
  nivel_alterado_por_nome: string | null;
  papel: string;
  quantidade: number;
  percentual_papel: number;
  pontos: number;
  data_conclusao: string;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  link_externo: string | null;
  status: string;
  situacao: string;
  justificativa: string | null;
  servidor_nome: string;
  validado_por_nome: string | null;
  atividade_id: number | null;
  atividade_nome: string | null;
  atividade_numero: string | null;
}

interface Nivel {
  nivel: number;
  rotulo: string;
  criterio: string;
  ativo: boolean;
}

interface Atividade {
  id: number;
  numero: string | null;
  nome: string;
  descricao: string | null;
  entrega: string | null;
  nivel_sugerido: number | null;
  nivel_rotulo: string | null;
  detalhamentos: Array<{ numero: string | null; texto: string }>;
}

type Pesos = Record<string, number>;

const FORMULARIO_VAZIO = {
  atividade_id: '',
  processo: '',
  descricao: '',
  nivel: 2,
  papel: 'EXECUCAO',
  quantidade: 1,
  data_conclusao: new Date().toISOString().slice(0, 10),
  periodo_inicio: '',
  periodo_fim: '',
  link_externo: '',
  status: 'CONCLUIDO',
};

export function MeusLancamentos() {
  const { usuario } = useSessao();
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [busca, setBusca] = useState('');
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [niveis, setNiveis] = useState<Nivel[]>([]);
  const [atividades, setAtividades] = useState<Atividade[]>([]);
  const [pesos, setPesos] = useState<Pesos>({ EXECUCAO: 100, REVISAO: 40, HOMOLOGACAO: 20 });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [formularioAberto, setFormularioAberto] = useState(false);
  const [editando, setEditando] = useState<Lancamento | null>(null);

  const carregar = useCallback(() => {
    setCarregando(true);
    const parametros = new URLSearchParams({ competencia, servidor_id: String(usuario!.id) });
    if (busca.trim()) parametros.set('processo', busca.trim());
    api
      .buscar<{ lancamentos: Lancamento[] }>(`/lancamentos?${parametros}`)
      .then((resposta) => setLancamentos(resposta.lancamentos))
      .catch((falha) => setErro(mensagemDeErro(falha)))
      .finally(() => setCarregando(false));
  }, [competencia, busca, usuario]);

  useEffect(() => {
    api.buscar<{ niveis: Nivel[] }>('/complexidade').then((r) => setNiveis(r.niveis));
    api
      .buscar<{ atividades: Atividade[] }>('/atividades')
      .then((r) => setAtividades(r.atividades))
      .catch(() => setAtividades([]));
    api
      .buscar<{ parametros: Array<{ chave: string; valor: number }> }>('/parametros')
      .then((r) => {
        const mapa: Pesos = {};
        for (const item of r.parametros) {
          if (item.chave.startsWith('PESO_')) mapa[item.chave.slice(5)] = Number(item.valor);
        }
        setPesos((atual) => ({ ...atual, ...mapa }));
      })
      .catch(() => undefined);
  }, []);

  useEffect(carregar, [carregar]);

  async function excluir(lancamento: Lancamento) {
    const identificacao = lancamento.processo ?? lancamento.atividade_nome ?? 'selecionado';
    if (!window.confirm(`Excluir o lançamento ${identificacao}?`)) return;
    setErro(null);
    try {
      await api.excluir(`/lancamentos/${lancamento.id}`);
      setSucesso('Lançamento excluído.');
      carregar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  const totalValidado = lancamentos
    .filter((l) => l.situacao === 'VALIDADO' && l.status === 'CONCLUIDO')
    .reduce((soma, l) => soma + Number(l.pontos), 0);

  return (
    <>
      <Cabecalho
        titulo="Meus lançamentos"
        descricao={`Processos registrados em ${competenciaLegivel(competencia)}`}
        acoes={
          <>
            <button
              type="button"
              className="botao"
              onClick={() =>
                api.baixar(
                  `/exportacoes/lancamentos.xlsx?competencia=${competencia}&servidor_id=${usuario!.id}`,
                )
              }
            >
              Exportar XLSX
            </button>
            <button
              type="button"
              className="botao botao-principal"
              onClick={() => {
                setEditando(null);
                setFormularioAberto(true);
              }}
            >
              Novo lançamento
            </button>
          </>
        }
      />

      <div className="conteudo">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}

        <Cartao>
          <div className="filtros">
            <SeletorCompetencia valor={competencia} aoMudar={setCompetencia} />
            <Campo rotulo="Buscar processo">
              <input
                value={busca}
                onChange={(evento) => setBusca(evento.target.value)}
                placeholder="Ex.: 856481/2026"
              />
            </Campo>
          </div>

          {carregando ? (
            <Carregando />
          ) : lancamentos.length === 0 ? (
            <Vazio titulo="Nenhum lançamento neste período">
              Registre os processos concluídos no mês para que eles entrem na sua apuração.
            </Vazio>
          ) : (
            <>
              <div className="tabela-envolucro">
                <table>
                  <thead>
                    <tr>
                      <th>Processo</th>
                      <th>Descrição</th>
                      <th>Nível</th>
                      <th>Papel</th>
                      <th className="numerico">Pontos</th>
                      <th>Conclusão</th>
                      <th>Situação</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {lancamentos.map((lancamento) => (
                      <tr key={lancamento.id}>
                        <td>
                          <strong className="nao-quebra">
                            {lancamento.processo ?? (
                              <span className="discreto">sem processo</span>
                            )}
                          </strong>
                          {lancamento.status === 'EM_ANDAMENTO' && (
                            <div className="marca marca-neutra" style={{ marginTop: '0.2rem' }}>
                              {ROTULO_DO_STATUS[lancamento.status]}
                            </div>
                          )}
                        </td>
                        <td className="discreto">
                          <div className="resumo" title={lancamento.descricao ?? ''}>
                            {lancamento.atividade_nome ?? lancamento.descricao ?? '—'}
                          </div>
                          {lancamento.justificativa && (
                            <div style={{ marginTop: '0.35rem', color: 'var(--alerta)' }}>
                              Chefia: {lancamento.justificativa}
                            </div>
                          )}
                        </td>
                        <td>
                          N{lancamento.nivel}
                          {lancamento.nivel_original !== null && (
                            <div className="campo-dica">
                              corrigido de N{lancamento.nivel_original} por{' '}
                              {lancamento.nivel_alterado_por_nome}
                            </div>
                          )}
                        </td>
                        <td>
                          {ROTULO_DO_PAPEL[lancamento.papel]}
                          <div className="campo-dica">{numero(lancamento.percentual_papel, 0)}%</div>
                        </td>
                        <td className="numerico">{numero(lancamento.pontos, 2)}</td>
                        <td>{formatarData(lancamento.data_conclusao)}</td>
                        <td>
                          <MarcaSituacao situacao={lancamento.situacao} />
                          {lancamento.validado_por_nome && (
                            <div className="campo-dica">{lancamento.validado_por_nome}</div>
                          )}
                        </td>
                        <td>
                          <div className="acoes acoes-tabela">
                            <button
                              type="button"
                              className="botao botao-discreto botao-pequeno"
                              onClick={() => {
                                setEditando(lancamento);
                                setFormularioAberto(true);
                              }}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className="botao botao-discreto botao-pequeno botao-risco"
                              onClick={() => void excluir(lancamento)}
                            >
                              Excluir
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="campo-dica" style={{ marginTop: '0.75rem' }}>
                {lancamentos.length} lançamento(s) no período · {numero(totalValidado, 2)} ponto(s)
                validados entram na média.
              </p>
            </>
          )}
        </Cartao>
      </div>

      {formularioAberto && (
        <FormularioLancamento
          niveis={niveis}
          atividades={atividades}
          pesos={pesos}
          lancamento={editando}
          aoFechar={() => setFormularioAberto(false)}
          aoSalvar={(mensagem) => {
            setFormularioAberto(false);
            setSucesso(mensagem);
            setErro(null);
            carregar();
          }}
        />
      )}
    </>
  );
}

interface Existente {
  id: number;
  servidor_nome: string;
  papel: string;
  data_conclusao: string;
  nivel: number;
}

function FormularioLancamento({
  niveis,
  atividades,
  pesos,
  lancamento,
  aoFechar,
  aoSalvar,
}: {
  niveis: Nivel[];
  atividades: Atividade[];
  pesos: Pesos;
  lancamento: Lancamento | null;
  aoFechar: () => void;
  aoSalvar: (mensagem: string) => void;
}) {
  const [formulario, setFormulario] = useState(
    lancamento
      ? {
          atividade_id: lancamento.atividade_id ? String(lancamento.atividade_id) : '',
          processo: lancamento.processo ?? '',
          descricao: lancamento.descricao ?? '',
          nivel: lancamento.nivel,
          papel: lancamento.papel,
          quantidade: Number(lancamento.quantidade),
          data_conclusao: lancamento.data_conclusao.slice(0, 10),
          periodo_inicio: lancamento.periodo_inicio?.slice(0, 10) ?? '',
          periodo_fim: lancamento.periodo_fim?.slice(0, 10) ?? '',
          link_externo: lancamento.link_externo ?? '',
          status: lancamento.status,
        }
      : FORMULARIO_VAZIO,
  );
  const [existentes, setExistentes] = useState<Existente[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const criterio = niveis.find((n) => n.nivel === Number(formulario.nivel));

  // Regra 2.4: avisa que o processo ja foi lancado, sem impedir o registro.
  useEffect(() => {
    const processo = formulario.processo.trim();
    if (processo.length < 4) {
      setExistentes([]);
      return;
    }
    const espera = setTimeout(() => {
      api
        .buscar<{ existentes: Existente[] }>(
          `/lancamentos/verificar-processo?processo=${encodeURIComponent(processo)}`,
        )
        .then((resposta) =>
          setExistentes(resposta.existentes.filter((e) => e.id !== lancamento?.id)),
        )
        .catch(() => setExistentes([]));
    }, 350);
    return () => clearTimeout(espera);
  }, [formulario.processo, lancamento?.id]);

  function alterar(campo: string, valor: string | number) {
    setFormulario((atual) => ({ ...atual, [campo]: valor }));
  }

  const atividadeEscolhida = atividades.find((a) => String(a.id) === formulario.atividade_id);

  /* A atividade define o que foi feito. O peso é indicado pelo servidor, então
     o nível só vem preenchido quando o setor já fixou um para a atividade. */
  function escolherAtividade(id: string) {
    const atividade = atividades.find((a) => String(a.id) === id);
    setFormulario((atual) => ({
      ...atual,
      atividade_id: id,
      nivel: atividade?.nivel_sugerido ?? atual.nivel,
    }));
  }

  const temDetalhe = Boolean(
    formulario.periodo_fim || formulario.link_externo || Number(formulario.quantidade) !== 1,
  );

  const percentualDoPapel = pesos[formulario.papel] ?? 100;
  const pontos =
    Math.round(
      Number(formulario.nivel) * Number(formulario.quantidade || 0) * percentualDoPapel,
    ) / 100;

  async function submeter(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    const corpo = {
      ...formulario,
      atividade_id: formulario.atividade_id ? Number(formulario.atividade_id) : null,
      periodo_inicio: formulario.periodo_inicio || null,
      periodo_fim: formulario.periodo_fim || null,
      link_externo: formulario.link_externo || null,
      descricao: formulario.descricao || null,
    };
    try {
      if (lancamento) {
        await api.atualizar(`/lancamentos/${lancamento.id}`, corpo);
        aoSalvar('Lançamento atualizado. Ele volta para a fila de validação da chefia.');
      } else {
        const resposta = await api.enviar<{ aviso: string }>('/lancamentos', corpo);
        aoSalvar(resposta.aviso);
      }
    } catch (falha) {
      setErro(mensagemDeErro(falha));
      setEnviando(false);
    }
  }

  return (
    <Modal
      titulo={lancamento ? 'Editar lançamento' : 'Novo lançamento'}
      aoFechar={aoFechar}
      rodape={
        <>
          <button type="button" className="botao" onClick={aoFechar}>
            Cancelar
          </button>
          <button
            type="submit"
            form="formulario-lancamento"
            className="botao botao-principal"
            disabled={enviando}
          >
            {enviando ? 'Salvando...' : 'Salvar lançamento'}
          </button>
        </>
      }
    >
      <form id="formulario-lancamento" onSubmit={submeter}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        {atividades.length > 0 && (
          <Campo
            rotulo="Atividade"
            dica="A lista é a do seu grupo. É a atividade que recebe a pontuação."
          >
            <select
              value={formulario.atividade_id}
              onChange={(evento) => escolherAtividade(evento.target.value)}
            >
              <option value="">Selecione a atividade...</option>
              {atividades.map((atividade) => (
                <option key={atividade.id} value={atividade.id}>
                  {atividade.numero ? `${atividade.numero}. ` : ''}
                  {atividade.nome}
                </option>
              ))}
            </select>
          </Campo>
        )}

        {atividadeEscolhida && (atividadeEscolhida.entrega || atividadeEscolhida.detalhamentos.length > 0) && (
          <details className="detalhe-tabela">
            <summary>
              O que entra nesta atividade
              {atividadeEscolhida.detalhamentos.length > 0
                ? ` (${atividadeEscolhida.detalhamentos.length} itens)`
                : ''}
            </summary>
            {atividadeEscolhida.entrega && (
              <p className="campo-dica" style={{ marginTop: '0.5rem' }}>
                <strong>Entrega esperada:</strong> {atividadeEscolhida.entrega}
              </p>
            )}
            {atividadeEscolhida.detalhamentos.length > 0 && (
              <ul className="lista-detalhamento">
                {atividadeEscolhida.detalhamentos.map((detalhe, indice) => (
                  <li key={`${detalhe.numero ?? indice}`}>
                    {detalhe.numero && <span className="numero">{detalhe.numero}</span>}
                    {detalhe.texto}
                  </li>
                ))}
              </ul>
            )}
          </details>
        )}

        <Campo
          rotulo="Número do processo (se houver)"
          dica="Com o número, o sistema conta a entrega no total do setor e avisa se alguém já lançou o mesmo processo."
        >
          <input
            value={formulario.processo}
            onChange={(evento) => alterar('processo', evento.target.value)}
            placeholder="Ex.: 856481/2026"
          />
        </Campo>

        {existentes.length > 0 && (
          <Aviso tipo="atencao">
            {existentes.map((existente) => (
              <div key={existente.id}>
                Processo {formulario.processo.trim()} já lançado por {existente.servidor_nome} como{' '}
                {ROTULO_DO_PAPEL[existente.papel]} em {formatarData(existente.data_conclusao)}.
              </div>
            ))}
            <div style={{ marginTop: '0.35rem' }}>
              Se o seu lançamento é de outro papel — revisão ou homologação — pode salvar
              normalmente.
            </div>
          </Aviso>
        )}

        <div className="linha-campos">
          <Campo
            rotulo="Pontuação: nível de complexidade"
            dica="Você indica o peso; a chefia confere na validação."
          >
            <select
              value={formulario.nivel}
              onChange={(evento) => alterar('nivel', Number(evento.target.value))}
            >
              {niveis
                .filter((nivel) => nivel.ativo)
                .map((nivel) => (
                  <option key={nivel.nivel} value={nivel.nivel}>
                    N{nivel.nivel} — {nivel.rotulo}
                  </option>
                ))}
            </select>
          </Campo>

          <Campo rotulo="Papel no processo">
            <select
              value={formulario.papel}
              onChange={(evento) => alterar('papel', evento.target.value)}
            >
              <option value="EXECUCAO">Execução</option>
              <option value="REVISAO">Revisão</option>
              <option value="HOMOLOGACAO">Homologação</option>
            </select>
          </Campo>
        </div>

        {/* O critério fica visível na hora de escolher o nível: pontuação
            autodeclarada sem critério à vista vira chute. */}
        {criterio && (
          <Aviso tipo="informativo">
            <strong>
              N{criterio.nivel} — {criterio.rotulo}:
            </strong>{' '}
            {criterio.criterio}
          </Aviso>
        )}

        {/* A conta aparece enquanto a pessoa escolhe, e não só depois de salvar. */}
        <Aviso tipo="sucesso">
          <strong>Este lançamento vale {numero(pontos, 2)} ponto(s).</strong> Nível{' '}
          {formulario.nivel} × {formulario.quantidade || 0}{' '}
          {Number(formulario.quantidade) === 1 ? 'vez' : 'vezes'} ×{' '}
          {numero(percentualDoPapel, 0)}% de {ROTULO_DO_PAPEL[formulario.papel].toLowerCase()}.
        </Aviso>

        <div className="linha-campos">
          <Campo rotulo="Início (se souber)">
            <input
              type="date"
              value={formulario.periodo_inicio}
              onChange={(evento) => alterar('periodo_inicio', evento.target.value)}
            />
          </Campo>

          <Campo
            rotulo={
              formulario.status === 'EM_ANDAMENTO' ? 'Previsão de conclusão' : 'Data de conclusão'
            }
            dica="É esta data que define em que mês o ponto entra."
          >
            <input
              type="date"
              value={formulario.data_conclusao}
              onChange={(evento) => alterar('data_conclusao', evento.target.value)}
              required
            />
          </Campo>
        </div>

        <Campo rotulo="Situação">
          <select
            value={formulario.status}
            onChange={(evento) => alterar('status', evento.target.value)}
          >
            <option value="CONCLUIDO">Concluído</option>
            <option value="EM_ANDAMENTO">Em andamento</option>
          </select>
        </Campo>

        <Campo rotulo="Observação">
          <textarea
            value={formulario.descricao}
            onChange={(evento) => alterar('descricao', evento.target.value)}
            placeholder="Algo que a chefia precise saber para validar. Opcional."
          />
        </Campo>

        <details className="detalhe-tabela" open={temDetalhe}>
          <summary>Mais campos, se precisar</summary>

          <div className="linha-campos">
            <Campo
              rotulo="Quantas vezes"
              dica="Quantas vezes você fez esta mesma tarefa neste processo. Deixe 1 se foi uma vez só."
            >
              <input
                type="number"
                min={1}
                step="1"
                value={formulario.quantidade}
                onChange={(evento) => alterar('quantidade', Number(evento.target.value))}
              />
            </Campo>

            <Campo rotulo="Fim da execução">
              <input
                type="date"
                value={formulario.periodo_fim}
                onChange={(evento) => alterar('periodo_fim', evento.target.value)}
              />
            </Campo>
          </div>

          <Campo rotulo="Link externo">
            <input
              type="url"
              value={formulario.link_externo}
              onChange={(evento) => alterar('link_externo', evento.target.value)}
              placeholder="https://"
            />
          </Campo>
        </details>

        {formulario.status === 'EM_ANDAMENTO' && (
          <Aviso tipo="informativo">
            Lançamentos em andamento aparecem no painel como volume, mas ficam fora da média até
            serem concluídos.
          </Aviso>
        )}
      </form>
    </Modal>
  );
}
