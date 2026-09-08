import { versaoLegivel, type Versao } from '../../../servidor/src/dominio/versao';

/** Carimbada pelo Vite no momento do build. Veja vite.config.ts. */
declare const __VERSAO__: Versao;

export const VERSAO: Versao = __VERSAO__;

export const VERSAO_LEGIVEL = versaoLegivel(VERSAO);
