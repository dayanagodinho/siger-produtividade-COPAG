export class ErroDaApi extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
    readonly detalhes?: Array<{ campo: string; mensagem: string }>,
    readonly dados?: unknown,
  ) {
    super(mensagem);
    this.name = 'ErroDaApi';
  }
}

async function requisitar<T>(
  caminho: string,
  opcoes: RequestInit & { corpo?: unknown } = {},
): Promise<T> {
  const { corpo, ...resto } = opcoes;
  const resposta = await fetch(`/api${caminho}`, {
    ...resto,
    headers: {
      ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(resto.headers ?? {}),
    },
    body: corpo !== undefined ? JSON.stringify(corpo) : resto.body,
    credentials: 'same-origin',
  });

  if (resposta.status === 204) return undefined as T;

  const texto = await resposta.text();
  const dados = texto ? JSON.parse(texto) : null;

  if (!resposta.ok) {
    throw new ErroDaApi(
      resposta.status,
      dados?.mensagem ?? 'Nao foi possivel completar a operacao.',
      Array.isArray(dados?.detalhes) ? dados.detalhes : undefined,
      dados?.detalhes,
    );
  }
  return dados as T;
}

export const api = {
  buscar: <T>(caminho: string) => requisitar<T>(caminho),
  enviar: <T>(caminho: string, corpo: unknown) =>
    requisitar<T>(caminho, { method: 'POST', corpo }),
  atualizar: <T>(caminho: string, corpo: unknown) =>
    requisitar<T>(caminho, { method: 'PUT', corpo }),
  excluir: <T>(caminho: string) => requisitar<T>(caminho, { method: 'DELETE' }),
  baixar: (caminho: string) => {
    window.location.href = `/api${caminho}`;
  },
};

export function mensagemDeErro(erro: unknown): string {
  if (erro instanceof ErroDaApi) {
    if (erro.detalhes?.length) {
      return `${erro.message} ${erro.detalhes.map((d) => d.mensagem).join(' ')}`;
    }
    return erro.message;
  }
  if (erro instanceof Error) return erro.message;
  return 'Erro inesperado. Tente novamente.';
}
