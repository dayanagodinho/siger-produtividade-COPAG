import { useCallback, useEffect, useState } from 'react';
import { api, mensagemDeErro } from '../servicos/api';
import {
  ROTULO_DO_TIPO_AUSENCIA,
  competenciaAtual,
  competenciaLegivel,
  data as formatarData,
} from '../servicos/formato';
import {
  Aviso,
  Campo,
  Carregando,
  Cartao,
  Modal,
  SeletorCompetencia,
  Vazio,
} from '../componentes/comuns';
import { Cabecalho } from '../componentes/Layout';

interface Ausencia {
  id: number;
  servidor_id: number;
  servidor_nome: string;
  servidor_matricula: string;
  tipo: string;
  data_inicio: string;
  data_fim: string;
  observacao: string | null;
  criado_por_nome: string | null;
}

interface Servidor {
  id: number;
  nome: string;
  matricula: string;
}

export function Ausencias() {
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [ausencias, setAusencias] = useState<Ausencia[]>([]);
  const [servidores, setServidores] = useState<Servidor[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [editando, setEditando] = useState<Ausencia | null>(null);
  const [criando, setCriando] = useState(false);

  const carregar = useCallback(() => {
    setCarregando(true);
    api
      .buscar<{ ausencias: Ausencia[] }>(`/ausencias?competencia=${competencia}`)
      .then((resposta) => setAusencias(resposta.ausencias))
      .catch((falha) => setErro(mensagemDeErro(falha)))
      .finally(() => setCarregando(false));
  }, [competencia]);

  useEffect(carregar, [carregar]);
  useEffect(() => {
    api
      .buscar<{ servidores: Servidor[] }>('/servidores')
      .then((resposta) => setServidores(resposta.servidores));
  }, []);

  async function excluir(ausencia: Ausencia) {
    if (!window.confirm(`Excluir a ausência de ${ausencia.servidor_nome}?`)) return;
    try {
      await api.excluir(`/ausencias/${ausencia.id}`);
      setSucesso('Ausência excluída.');
      carregar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  return (
    <>
      <Cabecalho
        titulo="Ausências"
        descricao="Férias, licenças e afastamentos reduzem os dias efetivos do mês."
        acoes={
          <button type="button" className="botao botao-principal" onClick={() => setCriando(true)}>
            Registrar ausência
          </button>
        }
      />

      <div className="conteudo">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}

        <Aviso tipo="informativo">
          A ausência reduz o divisor da média, então registrá-la eleva o resultado de quem faltou.
          Por isso o cadastro é ato da chefia — o servidor consulta, mas não cria.
        </Aviso>

        <Cartao titulo={`Ausências que atingem ${competenciaLegivel(competencia)}`}>
          <div className="filtros">
            <SeletorCompetencia valor={competencia} aoMudar={setCompetencia} />
          </div>

          {carregando ? (
            <Carregando />
          ) : ausencias.length === 0 ? (
            <Vazio titulo="Nenhuma ausência neste mês">
              Registre férias, licenças e afastamentos para que os dias efetivos fiquem corretos.
            </Vazio>
          ) : (
            <div className="tabela-envolucro">
              <table>
                <thead>
                  <tr>
                    <th>Servidor</th>
                    <th>Tipo</th>
                    <th>Início</th>
                    <th>Fim</th>
                    <th>Observação</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {ausencias.map((ausencia) => (
                    <tr key={ausencia.id}>
                      <td>
                        {ausencia.servidor_nome}
                        <div className="campo-dica">{ausencia.servidor_matricula}</div>
                      </td>
                      <td>{ROTULO_DO_TIPO_AUSENCIA[ausencia.tipo]}</td>
                      <td>{formatarData(ausencia.data_inicio)}</td>
                      <td>{formatarData(ausencia.data_fim)}</td>
                      <td className="discreto">
                        {ausencia.observacao || '—'}
                        {ausencia.criado_por_nome && (
                          <div className="campo-dica">Registrada por {ausencia.criado_por_nome}</div>
                        )}
                      </td>
                      <td>
                        <div className="acoes">
                          <button
                            type="button"
                            className="botao botao-discreto botao-pequeno"
                            onClick={() => setEditando(ausencia)}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="botao botao-discreto botao-pequeno botao-risco"
                            onClick={() => void excluir(ausencia)}
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
          )}
        </Cartao>
      </div>

      {(criando || editando) && (
        <FormularioAusencia
          ausencia={editando}
          servidores={servidores}
          aoFechar={() => {
            setCriando(false);
            setEditando(null);
          }}
          aoSalvar={(mensagem) => {
            setCriando(false);
            setEditando(null);
            setSucesso(mensagem);
            carregar();
          }}
        />
      )}
    </>
  );
}

function FormularioAusencia({
  ausencia,
  servidores,
  aoFechar,
  aoSalvar,
}: {
  ausencia: Ausencia | null;
  servidores: Servidor[];
  aoFechar: () => void;
  aoSalvar: (mensagem: string) => void;
}) {
  const [formulario, setFormulario] = useState({
    servidor_id: ausencia?.servidor_id ?? servidores[0]?.id ?? 0,
    tipo: ausencia?.tipo ?? 'FERIAS',
    data_inicio: ausencia?.data_inicio.slice(0, 10) ?? '',
    data_fim: ausencia?.data_fim.slice(0, 10) ?? '',
    observacao: ausencia?.observacao ?? '',
  });
  const [erro, setErro] = useState<string | null>(null);

  async function submeter(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    try {
      if (ausencia) {
        await api.atualizar(`/ausencias/${ausencia.id}`, formulario);
        aoSalvar('Ausência atualizada.');
      } else {
        await api.enviar('/ausencias', formulario);
        aoSalvar('Ausência registrada.');
      }
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  return (
    <Modal
      titulo={ausencia ? 'Editar ausência' : 'Registrar ausência'}
      aoFechar={aoFechar}
      rodape={
        <>
          <button type="button" className="botao" onClick={aoFechar}>
            Cancelar
          </button>
          <button type="submit" form="formulario-ausencia" className="botao botao-principal">
            Salvar
          </button>
        </>
      }
    >
      <form id="formulario-ausencia" onSubmit={submeter}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Servidor">
          <select
            value={formulario.servidor_id}
            onChange={(evento) =>
              setFormulario({ ...formulario, servidor_id: Number(evento.target.value) })
            }
          >
            {servidores.map((servidor) => (
              <option key={servidor.id} value={servidor.id}>
                {servidor.nome} ({servidor.matricula})
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Tipo">
          <select
            value={formulario.tipo}
            onChange={(evento) => setFormulario({ ...formulario, tipo: evento.target.value })}
          >
            {Object.entries(ROTULO_DO_TIPO_AUSENCIA).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </select>
        </Campo>
        <div className="linha-campos">
          <Campo rotulo="Início">
            <input
              type="date"
              value={formulario.data_inicio}
              onChange={(evento) =>
                setFormulario({ ...formulario, data_inicio: evento.target.value })
              }
              required
            />
          </Campo>
          <Campo rotulo="Fim">
            <input
              type="date"
              value={formulario.data_fim}
              onChange={(evento) => setFormulario({ ...formulario, data_fim: evento.target.value })}
              required
            />
          </Campo>
        </div>
        <Campo rotulo="Observação (opcional)">
          <textarea
            value={formulario.observacao ?? ''}
            onChange={(evento) => setFormulario({ ...formulario, observacao: evento.target.value })}
          />
        </Campo>
      </form>
    </Modal>
  );
}
