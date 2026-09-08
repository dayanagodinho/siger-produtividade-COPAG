import type { NextFunction, Request, Response } from 'express';
import { consultar, consultarUm } from './banco';
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
export const exigirChefia = exigirPerfil('CHEFE_GRUPO', 'CHEFE_SETOR', 'ADMIN');

export function rotuloDoPerfil(perfil: PerfilAcesso): string {
  return {
    SERVIDOR: 'Servidor',
    CHEFE_GRUPO: 'Chefe de grupo',
    CHEFE_SETOR: 'Chefe de setor',
    ADMIN: 'Administrador',
  }[perfil];
}

/** Chefia de qualquer nivel, para o que vale para as duas. */
export function ehChefia(usuario: UsuarioAutenticado): boolean {
  return usuario.perfil !== 'SERVIDOR';
}

/** Manda no setor inteiro: chefe de setor e administrador. */
export function ehChefeDeSetor(usuario: UsuarioAutenticado): boolean {
  return usuario.perfil === 'CHEFE_SETOR' || usuario.perfil === 'ADMIN';
}

export function ehAdmin(usuario: UsuarioAutenticado): boolean {
  return usuario.perfil === 'ADMIN';
}

/** Chefe manda apenas no proprio setor; administrador manda em todos. */
export function podeAdministrarSetor(usuario: UsuarioAutenticado, setorId: number): boolean {
  if (ehAdmin(usuario)) return true;
  return usuario.perfil === 'CHEFE_SETOR' && usuario.setor_id === setorId;
}

export function garantirSetorSobGestao(usuario: UsuarioAutenticado, setorId: number): void {
  if (!podeAdministrarSetor(usuario, setorId)) {
    throw erroDePermissao('Você só pode agir sobre o seu próprio setor.');
  }
}

/**
 * Ate onde vai o olhar de quem pediu o dado.
 *
 * Esta e a unica definicao de visibilidade do sistema. Toda rota que devolve
 * dado por servidor pergunta aqui e aplica o resultado na propria consulta —
 * a regra nao pode viver em copias espalhadas, porque copias divergem e a
 * divergencia aqui vaza nome de gente.
 *
 * O chefe de grupo enxerga, com nome e detalhe individual, apenas os
 * servidores dos grupos que ele chefia. Dos demais, so numero agregado, que
 * vem por outro caminho.
 */
export type Alcance =
  | { tipo: 'TUDO' }
  | { tipo: 'SETOR'; setor: number }
  | { tipo: 'GRUPOS'; grupos: number[] }
  | { tipo: 'PROPRIO'; servidor: number };

export async function alcanceDe(usuario: UsuarioAutenticado): Promise<Alcance> {
  if (usuario.perfil === 'ADMIN') return { tipo: 'TUDO' };
  if (usuario.perfil === 'CHEFE_SETOR') return { tipo: 'SETOR', setor: usuario.setor_id };
  if (usuario.perfil === 'CHEFE_GRUPO') {
    const grupos = await consultar<{ id: number }>(
      'SELECT id FROM grupos WHERE chefe_id = $1 AND excluido_em IS NULL ORDER BY id',
      [usuario.id],
    );
    return { tipo: 'GRUPOS', grupos: grupos.map((g) => g.id) };
  }
  return { tipo: 'PROPRIO', servidor: usuario.id };
}

/** Os grupos que a pessoa chefia. Vazio para quem nao chefia nenhum. */
export async function gruposChefiados(usuario: UsuarioAutenticado): Promise<number[]> {
  const alcance = await alcanceDe(usuario);
  return alcance.tipo === 'GRUPOS' ? alcance.grupos : [];
}

/**
 * Traduz o alcance em condicao de SQL, empurrando os parametros na lista de
 * quem chamou. Devolve null quando nao ha o que restringir.
 *
 * Chefe de grupo sem nenhum grupo sob sua chefia recebe 'false': melhor nao
 * devolver nada do que devolver tudo por descuido.
 */
export function condicaoDoAlcance(
  alcance: Alcance,
  campos: { servidor: string; grupo: string; setor: string },
  parametros: unknown[],
): string | null {
  if (alcance.tipo === 'TUDO') return null;

  if (alcance.tipo === 'SETOR') {
    parametros.push(alcance.setor);
    return `${campos.setor} = $${parametros.length}`;
  }

  if (alcance.tipo === 'GRUPOS') {
    if (!alcance.grupos.length) return 'false';
    parametros.push(alcance.grupos);
    return `${campos.grupo} = ANY($${parametros.length}::int[])`;
  }

  parametros.push(alcance.servidor);
  return `${campos.servidor} = $${parametros.length}`;
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
 * Servidor enxerga apenas a propria producao. Chefe de grupo, a de quem esta
 * nos grupos que ele chefia. Chefe de setor, a do seu setor. Administrador,
 * tudo.
 */
export async function garantirAcessoAoServidor(
  usuario: UsuarioAutenticado,
  servidorId: number,
): Promise<ServidorAlvo> {
  const alvo = await buscarServidorAlvo(servidorId);
  if (usuario.id === alvo.id) return alvo;

  const alcance = await alcanceDe(usuario);
  if (alcance.tipo === 'TUDO') return alvo;
  if (alcance.tipo === 'SETOR' && alcance.setor === alvo.setor_id) return alvo;
  if (alcance.tipo === 'GRUPOS' && alvo.grupo_id && alcance.grupos.includes(alvo.grupo_id)) {
    return alvo;
  }

  throw erroDePermissao(
    usuario.perfil === 'CHEFE_GRUPO'
      ? 'Este servidor não está em um grupo que você chefia. Dos outros grupos você vê apenas o número do grupo, sem detalhe por pessoa.'
      : 'Você só tem acesso aos lançamentos do seu próprio cadastro.',
  );
}
