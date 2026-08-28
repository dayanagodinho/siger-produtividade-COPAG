/**
 * A COPAG tem chefia do setor inteiro e chefia de cada grupo, e as duas veem
 * coisas diferentes: o chefe de grupo enxerga nome e lancamento apenas de quem
 * ele chefia; dos outros grupos, so o numero agregado.
 */
export type PerfilAcesso = 'SERVIDOR' | 'CHEFE_GRUPO' | 'CHEFE_SETOR' | 'ADMIN';

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
