import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const derivar = promisify(scrypt) as (
  senha: string,
  sal: Buffer,
  tamanho: number,
) => Promise<Buffer>;

const TAMANHO_CHAVE = 64;

export async function gerarHashDeSenha(senha: string): Promise<string> {
  const sal = randomBytes(16);
  const derivada = await derivar(senha, sal, TAMANHO_CHAVE);
  return `scrypt$${sal.toString('hex')}$${derivada.toString('hex')}`;
}

export async function conferirSenha(senha: string, hashGravado: string): Promise<boolean> {
  const partes = hashGravado.split('$');
  if (partes.length !== 3 || partes[0] !== 'scrypt') return false;

  const sal = Buffer.from(partes[1], 'hex');
  const esperada = Buffer.from(partes[2], 'hex');
  if (esperada.length !== TAMANHO_CHAVE) return false;

  const derivada = await derivar(senha, sal, TAMANHO_CHAVE);
  return timingSafeEqual(derivada, esperada);
}

export function validarForcaDaSenha(senha: string): string | null {
  if (senha.length < 8) return 'A senha precisa ter ao menos 8 caracteres.';
  if (!/[a-zA-Z]/.test(senha)) return 'A senha precisa conter ao menos uma letra.';
  if (!/[0-9]/.test(senha)) return 'A senha precisa conter ao menos um número.';
  return null;
}
