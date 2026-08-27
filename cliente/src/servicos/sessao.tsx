import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';

export interface Usuario {
  id: number;
  matricula: string;
  nome: string;
  email: string;
  perfil: 'SERVIDOR' | 'CHEFE' | 'ADMIN';
  setor_id: number;
  setor_nome: string;
  grupo_id: number | null;
  grupo_nome: string | null;
}

interface Sessao {
  usuario: Usuario | null;
  carregando: boolean;
  entrar: (identificacao: string, senha: string) => Promise<void>;
  sair: () => Promise<void>;
  ehChefia: boolean;
  ehAdmin: boolean;
}

const ContextoDaSessao = createContext<Sessao | null>(null);

export function ProvedorDeSessao({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    api
      .buscar<{ usuario: Usuario | null }>('/autenticacao/eu')
      .then((resposta) => setUsuario(resposta.usuario))
      .catch(() => setUsuario(null))
      .finally(() => setCarregando(false));
  }, []);

  const entrar = useCallback(async (identificacao: string, senha: string) => {
    const resposta = await api.enviar<{ usuario: Usuario }>('/autenticacao/entrar', {
      identificacao,
      senha,
    });
    setUsuario(resposta.usuario);
  }, []);

  const sair = useCallback(async () => {
    await api.enviar('/autenticacao/sair', {});
    setUsuario(null);
  }, []);

  const valor = useMemo<Sessao>(
    () => ({
      usuario,
      carregando,
      entrar,
      sair,
      ehChefia: usuario?.perfil === 'CHEFE' || usuario?.perfil === 'ADMIN',
      ehAdmin: usuario?.perfil === 'ADMIN',
    }),
    [usuario, carregando, entrar, sair],
  );

  return <ContextoDaSessao.Provider value={valor}>{children}</ContextoDaSessao.Provider>;
}

export function useSessao(): Sessao {
  const contexto = useContext(ContextoDaSessao);
  if (!contexto) throw new Error('useSessao precisa estar dentro do ProvedorDeSessao.');
  return contexto;
}
