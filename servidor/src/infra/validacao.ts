import { z, type ZodTypeAny } from 'zod';
import { erroDeRequisicao } from './erros';

export function validar<T extends ZodTypeAny>(esquema: T, dados: unknown): z.infer<T> {
  const resultado = esquema.safeParse(dados);
  if (!resultado.success) {
    const detalhes = resultado.error.issues.map((problema) => ({
      campo: problema.path.join('.') || '(corpo)',
      mensagem: problema.message,
    }));
    throw erroDeRequisicao('Revise os campos destacados e envie de novo.', detalhes);
  }
  return resultado.data;
}

export const dataIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data no formato AAAA-MM-DD.');

export const textoObrigatorio = (rotulo: string, maximo = 255) =>
  z
    .string({ required_error: `Informe ${rotulo}.` })
    .trim()
    .min(1, `Informe ${rotulo}.`)
    .max(maximo, `${rotulo} deve ter no maximo ${maximo} caracteres.`);

export const textoOpcional = (maximo = 2000) =>
  z
    .string()
    .trim()
    .max(maximo, `O texto deve ter no maximo ${maximo} caracteres.`)
    .optional()
    .nullable()
    .transform((valor) => (valor === '' ? null : (valor ?? null)));

export const idNumerico = (rotulo: string) =>
  z.coerce
    .number({ invalid_type_error: `Selecione ${rotulo}.` })
    .int(`Selecione ${rotulo}.`)
    .positive(`Selecione ${rotulo}.`);

export const nivelComplexidade = z.coerce
  .number({ invalid_type_error: 'Selecione o nivel de complexidade.' })
  .int('Selecione o nivel de complexidade.')
  .min(1, 'O nivel vai de 1 a 4.')
  .max(4, 'O nivel vai de 1 a 4.');

export const competenciaValida = z
  .string()
  .regex(/^\d{4}-\d{2}(-01)?$/, 'Informe a competencia no formato AAAA-MM.')
  .transform((valor) => (valor.length === 7 ? `${valor}-01` : valor));
