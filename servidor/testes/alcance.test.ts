import { test } from 'node:test';
import assert from 'node:assert/strict';
import { condicaoDoAlcance, type Alcance } from '../src/infra/autorizacao';

const CAMPOS = { servidor: 'l.servidor_id', grupo: 's.grupo_id', setor: 's.setor_id' };

function aplicar(alcance: Alcance) {
  const parametros: unknown[] = [];
  return { condicao: condicaoDoAlcance(alcance, CAMPOS, parametros), parametros };
}

test('quem vê tudo não recebe filtro nenhum', () => {
  assert.equal(aplicar({ tipo: 'TUDO' }).condicao, null);
});

test('chefe de setor fica preso ao próprio setor', () => {
  const { condicao, parametros } = aplicar({ tipo: 'SETOR', setor: 7 });
  assert.equal(condicao, 's.setor_id = $1');
  assert.deepEqual(parametros, [7]);
});

test('chefe de grupo fica preso aos grupos que chefia', () => {
  const { condicao, parametros } = aplicar({ tipo: 'GRUPOS', grupos: [2, 5] });
  assert.equal(condicao, 's.grupo_id = ANY($1::int[])');
  assert.deepEqual(parametros, [[2, 5]]);
});

test('chefe sem grupo nenhum não vê nada — nunca tudo', () => {
  const { condicao, parametros } = aplicar({ tipo: 'GRUPOS', grupos: [] });
  assert.equal(condicao, 'false');
  assert.deepEqual(parametros, []);
});

test('servidor fica preso a si mesmo', () => {
  const { condicao, parametros } = aplicar({ tipo: 'PROPRIO', servidor: 42 });
  assert.equal(condicao, 'l.servidor_id = $1');
  assert.deepEqual(parametros, [42]);
});

test('os parâmetros continuam de onde a consulta já estava', () => {
  const parametros: unknown[] = ['2026-08-01'];
  const condicao = condicaoDoAlcance({ tipo: 'SETOR', setor: 3 }, CAMPOS, parametros);
  assert.equal(condicao, 's.setor_id = $2');
  assert.deepEqual(parametros, ['2026-08-01', 3]);
});
