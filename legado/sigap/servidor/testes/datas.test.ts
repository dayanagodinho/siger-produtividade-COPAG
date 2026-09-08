import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  competenciaDe,
  contarDiasUteisDeAusencia,
  contarDiasUteisDoMes,
  listarDiasDoMes,
  ultimoDiaDoMes,
} from '../src/dominio/datas';

test('agosto de 2026 tem 31 dias e 21 dias uteis sem feriados', () => {
  assert.equal(listarDiasDoMes('2026-08-01').length, 31);
  assert.equal(ultimoDiaDoMes('2026-08-01'), '2026-08-31');
  assert.equal(contarDiasUteisDoMes('2026-08-01', []), 21);
});

test('feriado em dia util reduz a contagem; feriado no fim de semana nao', () => {
  assert.equal(contarDiasUteisDoMes('2026-08-01', ['2026-08-12']), 20);
  assert.equal(contarDiasUteisDoMes('2026-08-01', ['2026-08-15']), 21);
});

test('a competencia vem da data de conclusao', () => {
  assert.equal(competenciaDe('2026-09-02'), '2026-09-01');
  assert.equal(competenciaDe('2026-12-31'), '2026-12-01');
});

test('ausencia e recortada pelo mes e ignora fins de semana', () => {
  const dias = contarDiasUteisDeAusencia(
    '2026-08-01',
    [{ data_inicio: '2026-07-25', data_fim: '2026-08-07' }],
    [],
  );
  assert.equal(dias, 5); // 03 a 07 de agosto
});

test('ausencias sobrepostas nao descontam o mesmo dia duas vezes', () => {
  const dias = contarDiasUteisDeAusencia(
    '2026-08-01',
    [
      { data_inicio: '2026-08-03', data_fim: '2026-08-07' },
      { data_inicio: '2026-08-05', data_fim: '2026-08-11' },
    ],
    [],
  );
  assert.equal(dias, 7); // 03 a 07 e 10 a 11
});

test('ausencia que cobre o mes inteiro zera os dias efetivos', () => {
  const uteis = contarDiasUteisDoMes('2026-08-01', []);
  const ausentes = contarDiasUteisDeAusencia(
    '2026-08-01',
    [{ data_inicio: '2026-08-01', data_fim: '2026-08-31' }],
    [],
  );
  assert.equal(uteis - ausentes, 0);
});
