import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

function obrigatorio(chave: string, padrao?: string): string {
  const valor = process.env[chave] ?? padrao;
  if (!valor) {
    throw new Error(
      `Variável de ambiente ${chave} não definida. Copie o arquivo .env.example para .env e preencha os valores.`,
    );
  }
  return valor;
}

export const configuracao = {
  urlBanco: obrigatorio(
    'DATABASE_URL',
    'postgres://postgres:postgres@localhost:5432/siger_produtividade',
  ),
  porta: Number(process.env.PORT ?? 3000),
  segredoSessao: obrigatorio('SESSION_SECRET', 'segredo-de-desenvolvimento-nao-use-em-producao'),
  ambiente: process.env.NODE_ENV ?? 'development',
  get producao(): boolean {
    return this.ambiente === 'production';
  },
  migrarAoIniciar: (process.env.MIGRAR_AO_INICIAR ?? 'true') !== 'false',
};
