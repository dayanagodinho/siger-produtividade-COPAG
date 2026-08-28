import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSessao } from '../servicos/sessao';
import { ROTULO_DO_PERFIL } from '../servicos/formato';
import { Icone } from './icones';
import { VERSAO, VERSAO_LEGIVEL } from '../servicos/versao';

interface Tela {
  destino: string;
  rotulo: string;
  secao: string;
  icone: ReactNode;
}

function telasDe(ehChefia: boolean, ehChefeDeSetor: boolean, ehAdmin: boolean): Tela[] {
  const telas: Tela[] = [
    { destino: '/', rotulo: 'Meu painel', secao: 'Minha produção', icone: Icone.painel },
    { destino: '/lancamentos', rotulo: 'Meus lançamentos', secao: 'Minha produção', icone: Icone.lancamentos },
  ];
  if (ehChefia) {
    telas.push(
      { destino: '/validacao', rotulo: 'Conferência de lançamentos', secao: 'Chefia', icone: Icone.validacao },
      { destino: '/ausencias', rotulo: 'Ausências', secao: 'Chefia', icone: Icone.ausencias },
    );
  }
  // O painel e o histórico são do setor inteiro. Enquanto o chefe de grupo não
  // tiver a visão agregada dos outros grupos, oferecer esses itens a ele seria
  // oferecer uma porta que o servidor fecha na cara.
  if (ehChefeDeSetor) {
    telas.push(
      { destino: '/setor', rotulo: 'Painel do setor', secao: 'Chefia', icone: Icone.setor },
      { destino: '/historico', rotulo: 'Histórico', secao: 'Chefia', icone: Icone.historico },
    );
  }

  if (ehAdmin) {
    telas.push(
      { destino: '/administracao', rotulo: 'Cadastros e parâmetros', secao: 'Administração', icone: Icone.cadastros },
      { destino: '/auditoria', rotulo: 'Auditoria', secao: 'Administração', icone: Icone.auditoria },
    );
  }
  telas.push({ destino: '/senha', rotulo: 'Trocar senha', secao: 'Conta', icone: Icone.senha });
  return telas;
}

export function Layout() {
  const { usuario, ehChefia, ehChefeDeSetor, ehAdmin } = useSessao();
  if (!usuario) return null;

  const telas = telasDe(ehChefia, ehChefeDeSetor, ehAdmin);
  const secoes = [...new Set(telas.map((t) => t.secao))];
  const classe = ({ isActive }: { isActive: boolean }) => (isActive ? 'ativo' : '');

  return (
    <div className="aplicacao">
      <nav className="menu-lateral">
        <div className="menu-marca">
          {/* A marca vive em cliente/public/marca-sigap.svg e o ícone da aba,
              mais simples, em icone-sigap.svg. Trocar os arquivos troca a
              identidade: nenhum código muda. */}
          <img className="selo" src="/marca-sigap.svg" alt="" width={40} height={40} />
          <strong>SIGAP</strong>
        </div>
        <p className="menu-marca-nome">
          Sistema de Gestão de Atividades e Produtividade
          <span> da {usuario.setor_nome}</span>
        </p>

        <div className="menu-navegacao">
          {secoes.map((secao) => (
            <div key={secao} className="menu-bloco">
              <span className="menu-secao">{secao}</span>
              {telas
                .filter((tela) => tela.secao === secao)
                .map((tela) => (
                  <NavLink
                    key={tela.destino}
                    to={tela.destino}
                    end={tela.destino === '/'}
                    className={classe}
                  >
                    {tela.icone} {tela.rotulo}
                  </NavLink>
                ))}
            </div>
          ))}
        </div>

        <div className="menu-rodape" title={VERSAO.commit ? `Publicado a partir do commit ${VERSAO.commit}` : undefined}>
          SIGAP · versão {VERSAO_LEGIVEL}
        </div>
      </nav>

      <main className="area-principal">
        <Outlet />
        <p className="rodape-area">COPAG · Coordenação de Gestão do Pagamento de Pessoal</p>
      </main>
    </div>
  );
}

/** Busca de tela do topo, no mesmo padrão do SIPAG: lupa e atalho Ctrl+K. */
function BuscaDeTela() {
  const { ehChefia, ehChefeDeSetor, ehAdmin } = useSessao();
  const navegar = useNavigate();
  const local = useLocation();
  const [termo, setTermo] = useState('');
  const [aberta, setAberta] = useState(false);
  const campo = useRef<HTMLInputElement>(null);

  const telas = useMemo(
    () => telasDe(ehChefia, ehChefeDeSetor, ehAdmin),
    [ehChefia, ehChefeDeSetor, ehAdmin],
  );

  const achados = useMemo(() => {
    const busca = termo
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    if (!busca) return telas;
    return telas.filter((tela) =>
      `${tela.rotulo} ${tela.secao}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .includes(busca),
    );
  }, [termo, telas]);

  useEffect(() => {
    function atalho(evento: KeyboardEvent) {
      if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === 'k') {
        evento.preventDefault();
        campo.current?.focus();
        setAberta(true);
      }
      if (evento.key === 'Escape') setAberta(false);
    }
    window.addEventListener('keydown', atalho);
    return () => window.removeEventListener('keydown', atalho);
  }, []);

  useEffect(() => setAberta(false), [local.pathname]);

  function ir(destino: string) {
    setTermo('');
    setAberta(false);
    navegar(destino);
  }

  return (
    <div className="busca-tela">
      <span className="lupa" aria-hidden="true">
        {Icone.lupa}
      </span>
      <input
        ref={campo}
        value={termo}
        onChange={(evento) => {
          setTermo(evento.target.value);
          setAberta(true);
        }}
        onFocus={() => setAberta(true)}
        onBlur={() => window.setTimeout(() => setAberta(false), 150)}
        onKeyDown={(evento) => {
          if (evento.key === 'Enter' && achados[0]) ir(achados[0].destino);
        }}
        placeholder="Buscar tela..."
        aria-label="Buscar tela"
      />
      <kbd>Ctrl+K</kbd>
      {aberta && (
        <ul className="resultados-busca">
          {achados.length === 0 ? (
            <li className="sem-resultado">Nenhuma tela com esse nome.</li>
          ) : (
            achados.map((tela) => (
              <li key={tela.destino}>
                <button type="button" onMouseDown={() => ir(tela.destino)}>
                  {tela.icone}
                  <span>{tela.rotulo}</span>
                  <em>{tela.secao}</em>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

export function Cabecalho({
  titulo,
  descricao,
  acoes,
}: {
  titulo: string;
  descricao?: string;
  acoes?: ReactNode;
}) {
  const { usuario, sair } = useSessao();
  const local = useLocation();
  const navegar = useNavigate();

  return (
    <header className="cabecalho">
      <div className="cabecalho-titulo">
        {local.pathname !== '/' && (
          <nav className="trilha" aria-label="Você está em">
            <button type="button" onClick={() => navegar('/')} aria-label="Ir para o meu painel">
              {Icone.casa}
            </button>
            <span aria-hidden="true">{Icone.seta}</span>
            <strong>{titulo}</strong>
          </nav>
        )}
        <h1>{titulo}</h1>
        {descricao && <p>{descricao}</p>}
      </div>

      <div className="cabecalho-acoes">
        <BuscaDeTela />
        <div className="acoes">
          {acoes}
          {usuario && (
            <>
              <span className="chip-usuario">
                <span className="inicial" aria-hidden="true">
                  {usuario.nome.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <strong>{usuario.nome.split(' ').slice(0, 2).join(' ')}</strong>
                  <span>
                    {usuario.matricula} · {ROTULO_DO_PERFIL[usuario.perfil]}
                  </span>
                </div>
              </span>
              <button
                type="button"
                className="botao botao-discreto"
                onClick={() => void sair()}
                title="Sair do sistema"
                aria-label="Sair do sistema"
              >
                {Icone.sair}
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
