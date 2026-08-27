import { useCallback, useEffect, useState } from 'react';
import { api, mensagemDeErro } from '../servicos/api';
import {
  ROTULO_DO_PERFIL,
  ROTULO_DO_REGIME,
  data as formatarData,
  dataHora,
  numero,
} from '../servicos/formato';
import { Abas, Aviso, Campo, Carregando, Cartao, Modal, Vazio } from '../componentes/comuns';
import { Cabecalho } from '../componentes/Layout';

const ABAS = [
  { chave: 'setores', rotulo: 'Setores' },
  { chave: 'grupos', rotulo: 'Grupos' },
  { chave: 'servidores', rotulo: 'Servidores' },
  { chave: 'complexidade', rotulo: 'Tabela de complexidade' },
  { chave: 'feriados', rotulo: 'Feriados' },
  { chave: 'parametros', rotulo: 'Parâmetros' },
];

export function Administracao() {
  const [aba, setAba] = useState('setores');
  return (
    <>
      <Cabecalho
        titulo="Cadastros e parâmetros"
        descricao="Base do sistema: quem lança, em que grupo, com quais critérios e pesos."
      />
      <div className="conteudo">
        <Abas abas={ABAS} ativa={aba} aoMudar={setAba} />
        {aba === 'setores' && <AbaSetores />}
        {aba === 'grupos' && <AbaGrupos />}
        {aba === 'servidores' && <AbaServidores />}
        {aba === 'complexidade' && <AbaComplexidade />}
        {aba === 'feriados' && <AbaFeriados />}
        {aba === 'parametros' && <AbaParametros />}
      </div>
    </>
  );
}

function useRecurso<T>(caminho: string) {
  const [dados, setDados] = useState<T | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    setCarregando(true);
    api
      .buscar<T>(caminho)
      .then(setDados)
      .catch((falha) => setErro(mensagemDeErro(falha)))
      .finally(() => setCarregando(false));
  }, [caminho]);

  useEffect(carregar, [carregar]);
  return { dados, carregando, erro, setErro, carregar };
}

// ------------------------------------------------------------------ Setores

interface Setor {
  id: number;
  nome: string;
  sigla: string;
  chefe_servidor_id: number | null;
  chefe_nome: string | null;
  servidores_ativos: number;
  grupos: number;
}

function AbaSetores() {
  const { dados, carregando, erro, setErro, carregar } = useRecurso<{ setores: Setor[] }>('/setores');
  const [servidores, setServidores] = useState<Array<{ id: number; nome: string }>>([]);
  const [editando, setEditando] = useState<Setor | null>(null);
  const [criando, setCriando] = useState(false);
  const [sucesso, setSucesso] = useState<string | null>(null);

  useEffect(() => {
    api
      .buscar<{ servidores: Array<{ id: number; nome: string }> }>('/servidores')
      .then((resposta) => setServidores(resposta.servidores));
  }, []);

  async function excluir(setor: Setor) {
    if (!window.confirm(`Excluir o setor ${setor.sigla}?`)) return;
    try {
      await api.excluir(`/setores/${setor.id}`);
      setSucesso('Setor excluído.');
      carregar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  return (
    <Cartao
      titulo="Setores"
      acoes={
        <button type="button" className="botao botao-principal" onClick={() => setCriando(true)}>
          Novo setor
        </button>
      }
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}
      {carregando ? (
        <Carregando />
      ) : !dados?.setores.length ? (
        <Vazio titulo="Nenhum setor cadastrado">Cadastre o primeiro setor para começar.</Vazio>
      ) : (
        <div className="tabela-envolucro">
          <table>
            <thead>
              <tr>
                <th>Sigla</th>
                <th>Nome</th>
                <th>Chefe responsável</th>
                <th className="numerico">Servidores</th>
                <th className="numerico">Grupos</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {dados.setores.map((setor) => (
                <tr key={setor.id}>
                  <td>
                    <strong>{setor.sigla}</strong>
                  </td>
                  <td>{setor.nome}</td>
                  <td className="discreto">{setor.chefe_nome ?? 'Não definido'}</td>
                  <td className="numerico">{setor.servidores_ativos}</td>
                  <td className="numerico">{setor.grupos}</td>
                  <td>
                    <div className="acoes">
                      <button
                        type="button"
                        className="botao botao-discreto botao-pequeno"
                        onClick={() => setEditando(setor)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="botao botao-discreto botao-pequeno botao-risco"
                        onClick={() => void excluir(setor)}
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

      {(criando || editando) && (
        <FormularioSimples
          titulo={editando ? 'Editar setor' : 'Novo setor'}
          campos={[
            { chave: 'nome', rotulo: 'Nome do setor', tipo: 'texto', obrigatorio: true },
            { chave: 'sigla', rotulo: 'Sigla', tipo: 'texto', obrigatorio: true },
            {
              chave: 'chefe_servidor_id',
              rotulo: 'Chefe responsável',
              tipo: 'selecao',
              opcoes: [
                { valor: '', rotulo: 'Não definido' },
                ...servidores.map((s) => ({ valor: String(s.id), rotulo: s.nome })),
              ],
            },
          ]}
          valores={{
            nome: editando?.nome ?? '',
            sigla: editando?.sigla ?? '',
            chefe_servidor_id: editando?.chefe_servidor_id ? String(editando.chefe_servidor_id) : '',
          }}
          aoFechar={() => {
            setCriando(false);
            setEditando(null);
          }}
          aoSalvar={async (valores) => {
            const corpo = {
              nome: valores.nome,
              sigla: valores.sigla,
              chefe_servidor_id: valores.chefe_servidor_id ? Number(valores.chefe_servidor_id) : null,
            };
            if (editando) await api.atualizar(`/setores/${editando.id}`, corpo);
            else await api.enviar('/setores', corpo);
            setCriando(false);
            setEditando(null);
            setSucesso('Setor salvo.');
            carregar();
          }}
        />
      )}
    </Cartao>
  );
}

// ------------------------------------------------------------------- Grupos

interface Grupo {
  id: number;
  setor_id: number;
  setor_nome: string;
  nome: string;
  descricao: string | null;
  meta_referencia: number | null;
  meta_definida_em: string | null;
  servidores_ativos: number;
}

function AbaGrupos() {
  const { dados, carregando, erro, setErro, carregar } = useRecurso<{ grupos: Grupo[] }>('/grupos');
  const { dados: setores } = useRecurso<{ setores: Setor[] }>('/setores');
  const [editando, setEditando] = useState<Grupo | null>(null);
  const [criando, setCriando] = useState(false);
  const [sucesso, setSucesso] = useState<string | null>(null);

  async function excluir(grupo: Grupo) {
    if (!window.confirm(`Excluir o grupo ${grupo.nome}?`)) return;
    try {
      await api.excluir(`/grupos/${grupo.id}`);
      setSucesso('Grupo excluído.');
      carregar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  return (
    <Cartao
      titulo="Grupos"
      descricao="Servidores do mesmo grupo executam trabalho de natureza comparável. Sem meta fixa, a referência do mês é a mediana das médias do grupo."
      acoes={
        <button type="button" className="botao botao-principal" onClick={() => setCriando(true)}>
          Novo grupo
        </button>
      }
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}
      {carregando ? (
        <Carregando />
      ) : !dados?.grupos.length ? (
        <Vazio titulo="Nenhum grupo cadastrado">
          Crie grupos para que a referência de comparação faça sentido entre pares.
        </Vazio>
      ) : (
        <div className="tabela-envolucro">
          <table>
            <thead>
              <tr>
                <th>Grupo</th>
                <th>Setor</th>
                <th>Referência</th>
                <th className="numerico">Servidores</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {dados.grupos.map((grupo) => (
                <tr key={grupo.id}>
                  <td>
                    <strong>{grupo.nome}</strong>
                    <div className="discreto">{grupo.descricao ?? '—'}</div>
                  </td>
                  <td className="discreto">{grupo.setor_nome}</td>
                  <td>
                    {grupo.meta_referencia === null ? (
                      'Apurada no mês (mediana)'
                    ) : (
                      <>
                        Meta fixa de {numero(grupo.meta_referencia, 2)}
                        <div className="campo-dica">
                          definida em {dataHora(grupo.meta_definida_em)}
                        </div>
                      </>
                    )}
                  </td>
                  <td className="numerico">{grupo.servidores_ativos}</td>
                  <td>
                    <div className="acoes">
                      <button
                        type="button"
                        className="botao botao-discreto botao-pequeno"
                        onClick={() => setEditando(grupo)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="botao botao-discreto botao-pequeno botao-risco"
                        onClick={() => void excluir(grupo)}
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

      {(criando || editando) && (
        <FormularioSimples
          titulo={editando ? 'Editar grupo' : 'Novo grupo'}
          campos={[
            {
              chave: 'setor_id',
              rotulo: 'Setor',
              tipo: 'selecao',
              obrigatorio: true,
              opcoes: (setores?.setores ?? []).map((s) => ({
                valor: String(s.id),
                rotulo: `${s.sigla} — ${s.nome}`,
              })),
            },
            { chave: 'nome', rotulo: 'Nome do grupo', tipo: 'texto', obrigatorio: true },
            { chave: 'descricao', rotulo: 'Descrição', tipo: 'area' },
            {
              chave: 'meta_referencia',
              rotulo: 'Meta de referência (opcional)',
              tipo: 'numero',
              dica: 'Deixe em branco para o sistema usar a mediana das médias do grupo no mês.',
            },
          ]}
          valores={{
            setor_id: String(editando?.setor_id ?? setores?.setores[0]?.id ?? ''),
            nome: editando?.nome ?? '',
            descricao: editando?.descricao ?? '',
            meta_referencia:
              editando?.meta_referencia === null || editando?.meta_referencia === undefined
                ? ''
                : String(editando.meta_referencia),
          }}
          aoFechar={() => {
            setCriando(false);
            setEditando(null);
          }}
          aoSalvar={async (valores) => {
            const corpo = {
              setor_id: Number(valores.setor_id),
              nome: valores.nome,
              descricao: valores.descricao || null,
              meta_referencia: valores.meta_referencia ? Number(valores.meta_referencia) : null,
            };
            if (editando) await api.atualizar(`/grupos/${editando.id}`, corpo);
            else await api.enviar('/grupos', corpo);
            setCriando(false);
            setEditando(null);
            setSucesso('Grupo salvo.');
            carregar();
          }}
        />
      )}
    </Cartao>
  );
}

// --------------------------------------------------------------- Servidores

interface ServidorCadastro {
  id: number;
  matricula: string;
  nome: string;
  email: string;
  setor_id: number;
  setor_sigla: string;
  grupo_id: number | null;
  grupo_nome: string | null;
  perfil: string;
  regime: string;
  situacao: string;
  data_admissao: string;
  data_desligamento: string | null;
}

function AbaServidores() {
  const { dados, carregando, erro, setErro, carregar } = useRecurso<{
    servidores: ServidorCadastro[];
  }>('/servidores?incluir_inativos=true');
  const { dados: setores } = useRecurso<{ setores: Setor[] }>('/setores');
  const { dados: grupos } = useRecurso<{ grupos: Grupo[] }>('/grupos');
  const [editando, setEditando] = useState<ServidorCadastro | null>(null);
  const [criando, setCriando] = useState(false);
  const [redefinindo, setRedefinindo] = useState<ServidorCadastro | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  return (
    <Cartao
      titulo="Servidores"
      acoes={
        <button type="button" className="botao botao-principal" onClick={() => setCriando(true)}>
          Novo servidor
        </button>
      }
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}
      {carregando ? (
        <Carregando />
      ) : !dados?.servidores.length ? (
        <Vazio titulo="Nenhum servidor cadastrado">Cadastre as pessoas que vão lançar produção.</Vazio>
      ) : (
        <div className="tabela-envolucro">
          <table>
            <thead>
              <tr>
                <th>Matrícula</th>
                <th>Nome</th>
                <th>Setor / grupo</th>
                <th>Perfil</th>
                <th>Regime</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {dados.servidores.map((servidor) => (
                <tr key={servidor.id}>
                  <td>{servidor.matricula}</td>
                  <td>
                    {servidor.nome}
                    <div className="campo-dica">{servidor.email}</div>
                  </td>
                  <td className="discreto">
                    {servidor.setor_sigla}
                    <div className="campo-dica">{servidor.grupo_nome ?? 'Sem grupo'}</div>
                  </td>
                  <td>{ROTULO_DO_PERFIL[servidor.perfil]}</td>
                  <td className="discreto">{ROTULO_DO_REGIME[servidor.regime]}</td>
                  <td>
                    <span
                      className={`marca ${servidor.situacao === 'ATIVO' ? 'marca-validado' : 'marca-neutra'}`}
                    >
                      {servidor.situacao === 'ATIVO' ? 'Ativo' : 'Inativo'}
                    </span>
                    <div className="campo-dica">
                      desde {formatarData(servidor.data_admissao)}
                    </div>
                  </td>
                  <td>
                    <div className="acoes">
                      <button
                        type="button"
                        className="botao botao-discreto botao-pequeno"
                        onClick={() => setEditando(servidor)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="botao botao-discreto botao-pequeno"
                        onClick={() => setRedefinindo(servidor)}
                      >
                        Redefinir senha
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(criando || editando) && (
        <FormularioSimples
          titulo={editando ? 'Editar servidor' : 'Novo servidor'}
          campos={[
            { chave: 'matricula', rotulo: 'Matrícula', tipo: 'texto', obrigatorio: true },
            { chave: 'nome', rotulo: 'Nome completo', tipo: 'texto', obrigatorio: true },
            { chave: 'email', rotulo: 'E-mail', tipo: 'email', obrigatorio: true },
            ...(editando
              ? []
              : ([
                  {
                    chave: 'senha',
                    rotulo: 'Senha inicial',
                    tipo: 'senha',
                    obrigatorio: true,
                    dica: 'Ao menos 8 caracteres, com letras e números.',
                  },
                ] as CampoDoFormulario[])),
            {
              chave: 'setor_id',
              rotulo: 'Setor',
              tipo: 'selecao',
              obrigatorio: true,
              opcoes: (setores?.setores ?? []).map((s) => ({
                valor: String(s.id),
                rotulo: `${s.sigla} — ${s.nome}`,
              })),
            },
            {
              chave: 'grupo_id',
              rotulo: 'Grupo',
              tipo: 'selecao',
              dica: 'O grupo precisa pertencer ao setor escolhido.',
              opcoes: [
                { valor: '', rotulo: 'Sem grupo' },
                ...(grupos?.grupos ?? []).map((g) => ({
                  valor: String(g.id),
                  rotulo: `${g.nome} (${g.setor_nome})`,
                })),
              ],
            },
            {
              chave: 'perfil',
              rotulo: 'Perfil de acesso',
              tipo: 'selecao',
              obrigatorio: true,
              opcoes: Object.entries(ROTULO_DO_PERFIL).map(([valor, rotulo]) => ({ valor, rotulo })),
            },
            {
              chave: 'regime',
              rotulo: 'Regime de trabalho',
              tipo: 'selecao',
              obrigatorio: true,
              opcoes: Object.entries(ROTULO_DO_REGIME).map(([valor, rotulo]) => ({ valor, rotulo })),
            },
            {
              chave: 'situacao',
              rotulo: 'Situação',
              tipo: 'selecao',
              obrigatorio: true,
              opcoes: [
                { valor: 'ATIVO', rotulo: 'Ativo' },
                { valor: 'INATIVO', rotulo: 'Inativo' },
              ],
            },
            { chave: 'data_admissao', rotulo: 'Data de admissão', tipo: 'data', obrigatorio: true },
            { chave: 'data_desligamento', rotulo: 'Data de desligamento', tipo: 'data' },
          ]}
          valores={{
            matricula: editando?.matricula ?? '',
            nome: editando?.nome ?? '',
            email: editando?.email ?? '',
            senha: '',
            setor_id: String(editando?.setor_id ?? setores?.setores[0]?.id ?? ''),
            grupo_id: editando?.grupo_id ? String(editando.grupo_id) : '',
            perfil: editando?.perfil ?? 'SERVIDOR',
            regime: editando?.regime ?? 'INTEGRAL',
            situacao: editando?.situacao ?? 'ATIVO',
            data_admissao: editando?.data_admissao?.slice(0, 10) ?? '',
            data_desligamento: editando?.data_desligamento?.slice(0, 10) ?? '',
          }}
          aoFechar={() => {
            setCriando(false);
            setEditando(null);
          }}
          aoSalvar={async (valores) => {
            const corpo: Record<string, unknown> = {
              matricula: valores.matricula,
              nome: valores.nome,
              email: valores.email,
              setor_id: Number(valores.setor_id),
              grupo_id: valores.grupo_id ? Number(valores.grupo_id) : null,
              perfil: valores.perfil,
              regime: valores.regime,
              situacao: valores.situacao,
              data_admissao: valores.data_admissao,
              data_desligamento: valores.data_desligamento || null,
            };
            if (editando) {
              await api.atualizar(`/servidores/${editando.id}`, corpo);
            } else {
              await api.enviar('/servidores', { ...corpo, senha: valores.senha });
            }
            setCriando(false);
            setEditando(null);
            setSucesso('Servidor salvo.');
            carregar();
          }}
        />
      )}

      {redefinindo && (
        <FormularioSimples
          titulo={`Redefinir a senha de ${redefinindo.nome}`}
          campos={[
            {
              chave: 'senha',
              rotulo: 'Nova senha',
              tipo: 'senha',
              obrigatorio: true,
              dica: 'Ao menos 8 caracteres, com letras e números. Informe a nova senha ao servidor.',
            },
          ]}
          valores={{ senha: '' }}
          aoFechar={() => setRedefinindo(null)}
          aoSalvar={async (valores) => {
            await api.enviar(`/servidores/${redefinindo.id}/redefinir-senha`, {
              senha: valores.senha,
            });
            setRedefinindo(null);
            setSucesso('Senha redefinida.');
          }}
        />
      )}
    </Cartao>
  );
}

// -------------------------------------------------------------- Complexidade

interface Nivel {
  nivel: number;
  rotulo: string;
  criterio: string;
  ativo: boolean;
  atualizado_em: string;
}

function AbaComplexidade() {
  const { dados, carregando, erro, setErro, carregar } = useRecurso<{ niveis: Nivel[] }>(
    '/complexidade',
  );
  const [editando, setEditando] = useState<Nivel | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  return (
    <Cartao
      titulo="Tabela de complexidade"
      descricao="Estes critérios aparecem na tela de lançamento, ao lado do seletor de nível. Pontuação autodeclarada sem critério visível vira chute."
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}
      {carregando ? (
        <Carregando />
      ) : (
        <div className="tabela-envolucro">
          <table>
            <thead>
              <tr>
                <th style={{ width: '4rem' }}>Nível</th>
                <th>Rótulo</th>
                <th>Critério</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {dados?.niveis.map((nivel) => (
                <tr key={nivel.nivel}>
                  <td>
                    <strong>{nivel.nivel}</strong>
                  </td>
                  <td>{nivel.rotulo}</td>
                  <td className="discreto">{nivel.criterio}</td>
                  <td>
                    <span className={`marca ${nivel.ativo ? 'marca-validado' : 'marca-neutra'}`}>
                      {nivel.ativo ? 'Em uso' : 'Desativado'}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="botao botao-discreto botao-pequeno"
                      onClick={() => setEditando(nivel)}
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editando && (
        <FormularioSimples
          titulo={`Editar o nível ${editando.nivel}`}
          campos={[
            { chave: 'rotulo', rotulo: 'Rótulo', tipo: 'texto', obrigatorio: true },
            { chave: 'criterio', rotulo: 'Critério', tipo: 'area', obrigatorio: true },
            {
              chave: 'ativo',
              rotulo: 'Disponível para lançamento',
              tipo: 'selecao',
              opcoes: [
                { valor: 'sim', rotulo: 'Sim' },
                { valor: 'nao', rotulo: 'Não' },
              ],
            },
          ]}
          valores={{
            rotulo: editando.rotulo,
            criterio: editando.criterio,
            ativo: editando.ativo ? 'sim' : 'nao',
          }}
          aoFechar={() => setEditando(null)}
          aoSalvar={async (valores) => {
            await api.atualizar(`/complexidade/${editando.nivel}`, {
              rotulo: valores.rotulo,
              criterio: valores.criterio,
              ativo: valores.ativo === 'sim',
            });
            setEditando(null);
            setSucesso('Nível atualizado.');
            carregar();
          }}
        />
      )}
    </Cartao>
  );
}

// ----------------------------------------------------------------- Feriados

function AbaFeriados() {
  const anoAtual = new Date().getFullYear();
  const [ano, setAno] = useState(anoAtual);
  const { dados, carregando, erro, setErro, carregar } = useRecurso<{
    feriados: Array<{ id: number; data: string; descricao: string }>;
  }>(`/feriados?ano=${ano}`);
  const [criando, setCriando] = useState(false);
  const [sucesso, setSucesso] = useState<string | null>(null);

  async function excluir(id: number, descricao: string) {
    if (!window.confirm(`Excluir o feriado ${descricao}?`)) return;
    try {
      await api.excluir(`/feriados/${id}`);
      setSucesso('Feriado excluído. O cálculo de dias úteis já considera a mudança.');
      carregar();
    } catch (falha) {
      setErro(mensagemDeErro(falha));
    }
  }

  return (
    <Cartao
      titulo="Feriados"
      descricao="Feriado em dia útil reduz os dias úteis do mês e, com isso, o divisor da média."
      acoes={
        <button type="button" className="botao botao-principal" onClick={() => setCriando(true)}>
          Novo feriado
        </button>
      }
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}
      <div className="filtros">
        <Campo rotulo="Ano">
          <select value={ano} onChange={(evento) => setAno(Number(evento.target.value))}>
            {[anoAtual - 1, anoAtual, anoAtual + 1].map((valor) => (
              <option key={valor} value={valor}>
                {valor}
              </option>
            ))}
          </select>
        </Campo>
      </div>

      {carregando ? (
        <Carregando />
      ) : !dados?.feriados.length ? (
        <Vazio titulo={`Nenhum feriado cadastrado em ${ano}`}>
          Cadastre os feriados do ano para que os dias úteis fiquem corretos.
        </Vazio>
      ) : (
        <div className="tabela-envolucro">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Descrição</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {dados.feriados.map((feriado) => (
                <tr key={feriado.id}>
                  <td>{formatarData(feriado.data)}</td>
                  <td>{feriado.descricao}</td>
                  <td>
                    <button
                      type="button"
                      className="botao botao-discreto botao-pequeno botao-risco"
                      onClick={() => void excluir(feriado.id, feriado.descricao)}
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {criando && (
        <FormularioSimples
          titulo="Novo feriado"
          campos={[
            { chave: 'data', rotulo: 'Data', tipo: 'data', obrigatorio: true },
            { chave: 'descricao', rotulo: 'Descrição', tipo: 'texto', obrigatorio: true },
          ]}
          valores={{ data: '', descricao: '' }}
          aoFechar={() => setCriando(false)}
          aoSalvar={async (valores) => {
            await api.enviar('/feriados', valores);
            setCriando(false);
            setSucesso('Feriado cadastrado.');
            carregar();
          }}
        />
      )}
    </Cartao>
  );
}

// --------------------------------------------------------------- Parâmetros

const DESCRICAO_DO_PARAMETRO: Record<string, string> = {
  PESO_EXECUCAO: 'Percentual do nível aplicado a lançamentos de Execução.',
  PESO_REVISAO: 'Percentual do nível aplicado a lançamentos de Revisão.',
  PESO_HOMOLOGACAO: 'Percentual do nível aplicado a lançamentos de Homologação.',
  FAIXA_ABAIXO: 'Abaixo deste percentual de atingimento, a faixa é "Abaixo da referência".',
  FAIXA_ACIMA: 'Acima deste percentual de atingimento, a faixa é "Acima da referência".',
};

function AbaParametros() {
  const { dados, carregando, erro, setErro, carregar } = useRecurso<{
    parametros: Array<{
      chave: string;
      valor: number;
      descricao: string;
      atualizado_em: string;
      atualizado_por_nome: string | null;
    }>;
  }>('/parametros');
  const [editando, setEditando] = useState<{ chave: string; valor: number } | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  return (
    <Cartao
      titulo="Parâmetros"
      descricao="Alterar um parâmetro vale para lançamentos futuros. Os já registrados guardam o percentual aplicado no momento do registro, então meses anteriores não mudam de resultado."
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}
      {carregando ? (
        <Carregando />
      ) : (
        <div className="tabela-envolucro">
          <table>
            <thead>
              <tr>
                <th>Parâmetro</th>
                <th className="numerico">Valor</th>
                <th>Para que serve</th>
                <th>Última alteração</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {dados?.parametros.map((parametro) => (
                <tr key={parametro.chave}>
                  <td>
                    <strong>{parametro.chave.replace(/_/g, ' ').toLowerCase()}</strong>
                  </td>
                  <td className="numerico">{numero(parametro.valor, 0)}%</td>
                  <td className="discreto">
                    {DESCRICAO_DO_PARAMETRO[parametro.chave] ?? parametro.descricao}
                  </td>
                  <td className="discreto">
                    {dataHora(parametro.atualizado_em)}
                    {parametro.atualizado_por_nome && (
                      <div className="campo-dica">{parametro.atualizado_por_nome}</div>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="botao botao-discreto botao-pequeno"
                      onClick={() => setEditando({ chave: parametro.chave, valor: parametro.valor })}
                    >
                      Alterar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editando && (
        <FormularioSimples
          titulo={`Alterar ${editando.chave.replace(/_/g, ' ').toLowerCase()}`}
          campos={[{ chave: 'valor', rotulo: 'Novo valor (%)', tipo: 'numero', obrigatorio: true }]}
          valores={{ valor: String(editando.valor) }}
          aoFechar={() => setEditando(null)}
          aoSalvar={async (valores) => {
            await api.atualizar(`/parametros/${editando.chave}`, { valor: Number(valores.valor) });
            setEditando(null);
            setSucesso('Parâmetro alterado. Vale para os próximos lançamentos.');
            carregar();
          }}
        />
      )}
    </Cartao>
  );
}

// -------------------------------------------------------- Formulário genérico

interface CampoDoFormulario {
  chave: string;
  rotulo: string;
  tipo: 'texto' | 'area' | 'numero' | 'data' | 'email' | 'senha' | 'selecao';
  obrigatorio?: boolean;
  dica?: string;
  opcoes?: Array<{ valor: string; rotulo: string }>;
}

function FormularioSimples({
  titulo,
  campos,
  valores,
  aoFechar,
  aoSalvar,
}: {
  titulo: string;
  campos: CampoDoFormulario[];
  valores: Record<string, string>;
  aoFechar: () => void;
  aoSalvar: (valores: Record<string, string>) => Promise<void>;
}) {
  const [estado, setEstado] = useState(valores);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function submeter(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await aoSalvar(estado);
    } catch (falha) {
      setErro(mensagemDeErro(falha));
      setEnviando(false);
    }
  }

  return (
    <Modal
      titulo={titulo}
      aoFechar={aoFechar}
      rodape={
        <>
          <button type="button" className="botao" onClick={aoFechar}>
            Cancelar
          </button>
          <button
            type="submit"
            form="formulario-simples"
            className="botao botao-principal"
            disabled={enviando}
          >
            {enviando ? 'Salvando...' : 'Salvar'}
          </button>
        </>
      }
    >
      <form id="formulario-simples" onSubmit={submeter}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {campos.map((campo) => (
          <Campo key={campo.chave} rotulo={campo.rotulo} dica={campo.dica}>
            {campo.tipo === 'area' ? (
              <textarea
                value={estado[campo.chave] ?? ''}
                required={campo.obrigatorio}
                onChange={(evento) =>
                  setEstado({ ...estado, [campo.chave]: evento.target.value })
                }
              />
            ) : campo.tipo === 'selecao' ? (
              <select
                value={estado[campo.chave] ?? ''}
                required={campo.obrigatorio}
                onChange={(evento) =>
                  setEstado({ ...estado, [campo.chave]: evento.target.value })
                }
              >
                {campo.opcoes?.map((opcao) => (
                  <option key={opcao.valor} value={opcao.valor}>
                    {opcao.rotulo}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={
                  campo.tipo === 'numero' ? 'number'
                  : campo.tipo === 'data' ? 'date'
                  : campo.tipo === 'email' ? 'email'
                  : campo.tipo === 'senha' ? 'password'
                  : 'text'
                }
                step={campo.tipo === 'numero' ? 'any' : undefined}
                value={estado[campo.chave] ?? ''}
                required={campo.obrigatorio}
                onChange={(evento) =>
                  setEstado({ ...estado, [campo.chave]: evento.target.value })
                }
              />
            )}
          </Campo>
        ))}
      </form>
    </Modal>
  );
}
