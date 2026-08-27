import { NavLink, Outlet } from 'react-router-dom';
import { useSessao } from '../servicos/sessao';
import { ROTULO_DO_PERFIL } from '../servicos/formato';

export function Layout() {
  const { usuario, sair, ehChefia, ehAdmin } = useSessao();
  if (!usuario) return null;

  const classe = ({ isActive }: { isActive: boolean }) => (isActive ? 'ativo' : '');

  return (
    <div className="aplicacao">
      <nav className="menu-lateral">
        <div className="menu-marca">
          <strong>Controle de Produtividade</strong>
          <span>{usuario.setor_nome}</span>
        </div>

        <div className="menu-navegacao">
          <span className="menu-secao">Minha produção</span>
          <NavLink to="/" end className={classe}>
            Meu painel
          </NavLink>
          <NavLink to="/lancamentos" className={classe}>
            Meus lançamentos
          </NavLink>

          {ehChefia && (
            <>
              <span className="menu-secao">Chefia</span>
              <NavLink to="/validacao" className={classe}>
                Fila de validação
              </NavLink>
              <NavLink to="/ausencias" className={classe}>
                Ausências
              </NavLink>
              <NavLink to="/setor" className={classe}>
                Painel do setor
              </NavLink>
              <NavLink to="/historico" className={classe}>
                Histórico
              </NavLink>
            </>
          )}

          {ehAdmin && (
            <>
              <span className="menu-secao">Administração</span>
              <NavLink to="/administracao" className={classe}>
                Cadastros e parâmetros
              </NavLink>
              <NavLink to="/auditoria" className={classe}>
                Auditoria
              </NavLink>
            </>
          )}
        </div>

        <div className="menu-rodape">
          <div>
            <strong>{usuario.nome}</strong>
            <span>
              {ROTULO_DO_PERFIL[usuario.perfil]}
              {usuario.grupo_nome ? ` · ${usuario.grupo_nome}` : ''}
            </span>
          </div>
          <div className="acoes" style={{ marginTop: '0.5rem' }}>
            <NavLink to="/senha" className="botao botao-pequeno">
              Trocar senha
            </NavLink>
            <button type="button" className="botao botao-pequeno" onClick={() => void sair()}>
              Sair
            </button>
          </div>
        </div>
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
  acoes?: React.ReactNode;
}) {
  return (
    <header className="cabecalho">
      <div>
        <h1>{titulo}</h1>
        {descricao && <p>{descricao}</p>}
      </div>
      {acoes && <div className="acoes">{acoes}</div>}
    </header>
  );
}
