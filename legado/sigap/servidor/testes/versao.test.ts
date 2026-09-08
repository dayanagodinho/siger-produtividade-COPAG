import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versaoLegivel } from '../src/dominio/versao';

test('mostra numero, dia e hora da publicacao no fuso de Brasilia', () => {
  assert.equal(
    versaoLegivel({ numero: '1.1', commit: 'abc1234', publicado_em: '2026-08-29T02:40:00.000Z' }),
    '1.1 · 28/08 às 23:40',
  );
});

test('sem data de publicacao, sobra o numero', () => {
  assert.equal(versaoLegivel({ numero: '1.1', commit: null, publicado_em: null }), '1.1');
});

test('data ilegivel nao quebra o rodape', () => {
  assert.equal(
    versaoLegivel({ numero: '1.1', commit: null, publicado_em: 'nao e uma data' }),
    '1.1',
  );
});
