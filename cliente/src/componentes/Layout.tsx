import { NavLink, Outlet } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSessao } from '../servicos/sessao';
import { ROTULO_DO_PERFIL } from '../servicos/formato';

/* Ícones em traço, no mesmo peso do texto do menu. */
const tracado = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const Icone = {
  painel: (
    <svg viewBox="0 0 24 24" {...tracado} aria-hidden="true">
      <path d="M3 12l9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </svg>
  ),
  lancamentos: (
    <svg viewBox="0 0 24 24" {...tracado} aria-hidden="true">
      <path d="M7 3h10a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </svg>
  ),
  validacao: (
    <svg viewBox="0 0 24 24" {...tracado} aria-hidden="true">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ),
  ausencias: (
    <svg viewBox="0 0 24 24" {...tracado} aria-hidden="true">
      <path d="M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z" />
      <path d="M8 3v4M16 3v4M4 10h16" />
    </svg>
  ),
  setor: (
    <svg viewBox="0 0 24 24" {...tracado} aria-hidden="true">
      <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />
    </svg>
  ),
  historico: (
    <svg viewBox="0 0 24 24" {...tracado} aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  cadastros: (
    <svg viewBox="0 0 24 24" {...tracado} aria-hidden="true">
      <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
      <path d="M19 12a7 7 0 00-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 00-1.7-1L14.5 3h-4l-.4 2.6a7 7 0 00-1.7 1l-2.3-1-2 3.4L6 11a7 7 0 000 2l-2 1.5 2 3.4 2.3-1a7 7 0 001.7 1l.4 2.6h4l.4-2.6a7 7 0 001.7-1l2.3 1 2-3.4-2-1.5c.1-.3.1-.7.1-1z" />
    </svg>
  ),
  auditoria: (
    <svg viewBox="0 0 24 24" {...tracado} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4.3-4.3" />
    </svg>
  ),
  senha: (
    <svg viewBox="0 0 24 24" {...tracado} aria-hidden="true">
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 018 0v3" />
    </svg>
  ),
  sair: (
    <svg viewBox="0 0 24 24" {...tracado} aria-hidden="true">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </svg>
  ),
};

export function Layout() {
  const { usuario, ehChefia, ehAdmin } = useSessao();
  if (!usuario) return null;

  const classe = ({ isActive }: { isActive: boolean }) => (isActive ? 'ativo' : '');

  return (
    <div className="aplicacao">
      <nav className="menu-lateral">
        <div className="menu-marca">
          <span className="selo" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round">
              <path d="M5 19V9M12 19V5M19 19v-6" />
            </svg>
          </span>
          <div>
            <strong>Produtividade</strong>
            <span>{usuario.setor_nome}</span>
          </div>
        </div>

        <div className="menu-navegacao">
          <span className="menu-secao">Minha produção</span>
          <NavLink to="/" end className={classe}>
            {Icone.painel} Meu painel
          </NavLink>
          <NavLink to="/lancamentos" className={classe}>
            {Icone.lancamentos} Meus lançamentos
          </NavLink>

          {ehChefia && (
            <>
              <span className="menu-secao">Chefia</span>
              <NavLink to="/validacao" className={classe}>
                {Icone.validacao} Fila de validação
              </NavLink>
              <NavLink to="/ausencias" className={classe}>
                {Icone.ausencias} Ausências
              </NavLink>
              <NavLink to="/setor" className={classe}>
                {Icone.setor} Painel do setor
              </NavLink>
              <NavLink to="/historico" className={classe}>
                {Icone.historico} Histórico
              </NavLink>
            </>
          )}

          {ehAdmin && (
            <>
              <span className="menu-secao">Administração</span>
              <NavLink to="/administracao" className={classe}>
                {Icone.cadastros} Cadastros e parâmetros
              </NavLink>
              <NavLink to="/auditoria" className={classe}>
                {Icone.auditoria} Auditoria
              </NavLink>
            </>
          )}

          <span className="menu-secao">Conta</span>
          <NavLink to="/senha" className={classe}>
            {Icone.senha} Trocar senha
          </NavLink>
        </div>

        <div className="menu-rodape">Controle de Produtividade · versão 1.0</div>
      </nav>

      <main className="area-principal">
        <Outlet />
      </main>
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

  return (
    <header className="cabecalho">
      <div>
        <h1>{titulo}</h1>
        {descricao && <p>{descricao}</p>}
      </div>
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
    </header>
  );
}
