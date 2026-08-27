import { useCallback, useEffect, useState } from 'react';
import { api, mensagemDeErro } from '../servicos/api';
import { dataHora } from '../servicos/formato';
import { Aviso, Campo, Carregando, Cartao, Vazio } from '../componentes/comuns';
import { Cabecalho } from '../componentes/Layout';

interface Registro {
  id: number;
  entidade: string;
  entidade_id: string | null;
  acao: string;
  acao_rotulo: string;
  usuario_nome: string | null;
  valor_anterior: unknown;
  valor_novo: unknown;
  contexto: string | null;
  ocorrido_em: string;
}

const ENTIDADES = [
  { valor: '', rotulo: 'Todas' },
  { valor: 'lancamento', rotulo: 'Lançamentos' },
  { valor: 'ausencia', rotulo: 'Ausências' },
  { valor: 'servidor', rotulo: 'Servidores' },
  { valor: 'setor', rotulo: 'Setores' },
  { valor: 'grupo', rotulo: 'Grupos' },
  { valor: 'parametro', rotulo: 'Parâmetros' },
  { valor: 'nivel_complexidade', rotulo: 'Tabela de complexidade' },
  { valor: 'feriado', rotulo: 'Feriados' },
  { valor: 'fechamento', rotulo: 'Fechamentos' },
  { valor: 'sessao', rotulo: 'Entradas e saídas' },
];

/** A tabela mostra o nome que a pessoa reconhece, não a chave interna. */
const NOME_DA_ENTIDADE: Record<string, string> = {
  lancamento: 'Lançamento',
  ausencia: 'Ausência',
  servidor: 'Servidor',
  setor: 'Setor',
  grupo: 'Grupo',
  parametro: 'Parâmetro',
  nivel_complexidade: 'Nível de complexidade',
  feriado: 'Feriado',
  fechamento: 'Fechamento',
  sessao: 'Acesso',
};

export function Auditoria() {
  const [entidade, setEntidade] = useState('');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<number | null>(null);

  const carregar = useCallback(() => {
    setCarregando(true);
    const parametros = new URLSearchParams();
    if (entidade) parametros.set('entidade', entidade);
    if (de) parametros.set('de', de);
    if (ate) parametros.set('ate', ate);
    api
      .buscar<{ registros: Registro[] }>(`/auditoria?${parametros}`)
      .then((resposta) => setRegistros(resposta.registros))
      .catch((falha) => setErro(mensagemDeErro(falha)))
      .finally(() => setCarregando(false));
  }, [entidade, de, ate]);

  useEffect(carregar, [carregar]);

  return (
    <>
      <Cabecalho
        titulo="Auditoria"
        descricao="Toda criação, alteração e exclusão registrada, com autor, momento e valores."
      />
      <div className="conteudo">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        <Cartao>
          <div className="filtros">
            <Campo rotulo="Tipo de registro">
              <select value={entidade} onChange={(evento) => setEntidade(evento.target.value)}>
                {ENTIDADES.map((opcao) => (
                  <option key={opcao.valor} value={opcao.valor}>
                    {opcao.rotulo}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo rotulo="De">
              <input type="date" value={de} onChange={(evento) => setDe(evento.target.value)} />
            </Campo>
            <Campo rotulo="Até">
              <input type="date" value={ate} onChange={(evento) => setAte(evento.target.value)} />
            </Campo>
          </div>

          {carregando ? (
            <Carregando />
          ) : registros.length === 0 ? (
            <Vazio titulo="Nenhum registro no filtro escolhido">
              Amplie o período ou escolha outro tipo de registro.
            </Vazio>
          ) : (
            <div className="tabela-envolucro">
              <table>
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Quem</th>
                    <th>Ação</th>
                    <th>Registro</th>
                    <th>Contexto</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {registros.map((registro) => (
                    <tr key={registro.id}>
                      <td>{dataHora(registro.ocorrido_em)}</td>
                      <td>{registro.usuario_nome ?? 'Sistema'}</td>
                      <td>{registro.acao_rotulo}</td>
                      <td className="discreto">
                        {NOME_DA_ENTIDADE[registro.entidade] ?? registro.entidade}
                        {registro.entidade_id ? ` nº ${registro.entidade_id}` : ''}
                      </td>
                      <td className="discreto">{registro.contexto ?? '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="botao botao-discreto botao-pequeno"
                          onClick={() => setAberto(aberto === registro.id ? null : registro.id)}
                        >
                          {aberto === registro.id ? 'Ocultar' : 'Ver valores'}
                        </button>
                        {aberto === registro.id && (
                          <pre
                            style={{
                              whiteSpace: 'pre-wrap',
                              fontSize: '0.78rem',
                              background: 'var(--papel)',
                              padding: '0.5rem',
                              borderRadius: '6px',
                              marginTop: '0.5rem',
                              maxWidth: '460px',
                            }}
                          >
                            {JSON.stringify(
                              { antes: registro.valor_anterior, depois: registro.valor_novo },
                              null,
                              2,
                            )}
                          </pre>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Cartao>
      </div>
    </>
  );
}
