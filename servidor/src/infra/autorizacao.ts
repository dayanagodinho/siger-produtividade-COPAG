import type { NextFunction, Request, Response } from 'express';
import { consultarUm } from './banco';
import { erroDeAutenticacao, erroDePermissao, erroNaoEncontrado, rota } from './erros';
import type { PerfilAcesso, UsuarioAutenticado } from './tipos';

/**
 * Todo controle de acesso e resolvido aqui, no servidor. O front esconde
 * botoes por conveniencia, nunca por seguranca.
 */

export const carregarUsuario = rota(async (req: Request, _res: Response, next: NextFunction) => {
  const id = req.session?.usuarioId;
  if (id) {
    const usuario = await consultarUm<UsuarioAutenticado>(
      `SELECT id, matricula, nome, email, perfil, setor_id, grupo_id, situacao
         FROM servidores
        WHERE id = $1 AND excluido_em IS NULL AND situacao = 'ATIVO'`,
      [id],
    );
    if (usuario) req.usuario = usuario;
    else req.session.usuarioId = undefined;
  }
  next();
});

export function exigirAutenticacao(req: Request, _res: Response, next: NextFunction): void {
  if (!req.usuario) throw erroDeAutenticacao();
  next();
}

export function exigirPerfil(...perfis: PerfilAcesso[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.usuario) throw erroDeAutenticacao();
    if (!perfis.includes(req.usuario.perfil)) {
      throw erroDePermissao(
        `Esta área é restrita aos perfis: ${perfis.map(rotuloDoPerfil).join(', ')}.`,
      );
    }
    next();
  };
}

export const exigirAdmin = exigirPerfil('ADMIN');
export const exigirChefia = exigirPerfil('CHEFE', 'ADMIN');

export function rotuloDoPerfil(perfil: PerfilAcesso): string {
  return { SERVIDOR: 'Servidor', CHEFE: 'Chefe', ADMIN: 'Administrador' }[perfil];
}

export function ehAdmin(usuario: UsuarioAutenticado): boolean {
  return usuario.perfil === 'ADMIN';
}

/** Chefe manda apenas no proprio setor; administrador manda em todos. */
export function podeAdministrarSetor(usuario: UsuarioAutenticado, setorId: number): boolean {
  if (ehAdmin(usuario)) return true;
  return usuario.perfil === 'CHEFE' && usuario.setor_id === setorId;
}

export function garantirSetorSobGestao(usuario: UsuarioAutenticado, setorId: number): void {
  if (!podeAdministrarSetor(usuario, setorId)) {
    throw erroDePermissao('Você só pode agir sobre o seu próprio setor.');
  }
}

export interface ServidorAlvo {
  id: number;
  nome: string;
  setor_id: number;
  grupo_id: number | null;
}

export async function buscarServidorAlvo(servidorId: number): Promise<ServidorAlvo> {
  const alvo = await consultarUm<ServidorAlvo>(
    `SELECT id, nome, setor_id, grupo_id
       FROM servidores WHERE id = $1 AND excluido_em IS NULL`,
    [servidorId],
  );
  if (!alvo) throw erroNaoEncontrado('Servidor não encontrado.');
  return alvo;
}

/**
 * Servidor enxerga apenas a propria producao. Chefe enxerga a do seu setor.
 * Administrador enxerga tudo.
 */
export async function garantirAcessoAoServidor(
  usuario: UsuarioAutenticado,
  servidorId: number,
): Promise<ServidorAlvo> {
  const alvo = await buscarServidorAlvo(servidorId);
  if (usuario.id === alvo.id) return alvo;
  if (ehAdmin(usuario)) return alvo;
  if (usuario.perfil === 'CHEFE' && usuario.setor_id === alvo.setor_id) return alvo;
  throw erroDePermissao('Você só tem acesso aos lançamentos do seu próprio cadastro.');
}
