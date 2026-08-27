import type { NextFunction, Request, Response } from 'express';

export class ErroDeAplicacao extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
    readonly detalhes?: unknown,
  ) {
    super(mensagem);
    this.name = 'ErroDeAplicacao';
  }
}

export const erroDeRequisicao = (mensagem: string, detalhes?: unknown) =>
  new ErroDeAplicacao(400, mensagem, detalhes);
export const erroDeAutenticacao = (mensagem = 'Entre no sistema para continuar.') =>
  new ErroDeAplicacao(401, mensagem);
export const erroDePermissao = (mensagem = 'Seu perfil nao permite esta acao.') =>
  new ErroDeAplicacao(403, mensagem);
export const erroNaoEncontrado = (mensagem = 'Registro nao encontrado.') =>
  new ErroDeAplicacao(404, mensagem);
export const erroDeConflito = (mensagem: string, detalhes?: unknown) =>
  new ErroDeAplicacao(409, mensagem, detalhes);

/** Envolve rotas assincronas para que rejeicoes cheguem ao tratador de erros. */
export function rota(
  manipulador: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    manipulador(req, res, next).catch(next);
  };
}

export function tratadorDeErros(
  erro: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (erro instanceof ErroDeAplicacao) {
    res.status(erro.status).json({ mensagem: erro.message, detalhes: erro.detalhes });
    return;
  }

  const comCodigo = erro as { code?: string; constraint?: string; message?: string };

  if (comCodigo?.code === '23505') {
    res.status(409).json({
      mensagem:
        comCodigo.constraint === 'lancamentos_sem_duplicidade'
          ? 'Este processo ja foi lancado por voce neste mesmo nivel e papel.'
          : 'Ja existe um registro com estes dados. Ajuste os campos em duplicidade e salve de novo.',
    });
    return;
  }

  if (comCodigo?.code === '23503') {
    res.status(409).json({
      mensagem: 'O registro esta vinculado a outros dados e nao pode ser alterado desta forma.',
    });
    return;
  }

  console.error('Erro nao tratado:', erro);
  res.status(500).json({
    mensagem: 'Nao foi possivel concluir a operacao. Tente novamente; se persistir, avise a administracao.',
  });
}
