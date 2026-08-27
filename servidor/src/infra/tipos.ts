export type PerfilAcesso = 'SERVIDOR' | 'CHEFE' | 'ADMIN';

export interface UsuarioAutenticado {
  id: number;
  matricula: string;
  nome: string;
  email: string;
  perfil: PerfilAcesso;
  setor_id: number;
  grupo_id: number | null;
  situacao: 'ATIVO' | 'INATIVO';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      usuario?: UsuarioAutenticado;
    }
  }
}

declare module 'express-session' {
  interface SessionData {
    usuarioId?: number;
  }
}

export {};
