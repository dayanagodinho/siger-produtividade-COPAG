const test = require('node:test');
const assert = require('node:assert/strict');
const { novasLacunas, dataBonita } = require('../../src/avisos');

const foto = (obj) => new Map(Object.entries(obj).map(([d, faixas]) => [d, faixas.map((f) => { const [inicio, fim] = f.split('-'); return { inicio, fim }; })]));

test('faixa que ja existia antes nao vira aviso; faixa nova vira', () => {
  const antes = foto({ '2026-09-09': ['07:00-07:30'] });
  const depois = foto({ '2026-09-09': ['07:00-07:30', '12:00-14:00'] });
  assert.deepEqual(novasLacunas(antes, depois), [{ data: '2026-09-09', faixas: ['12:00–14:00'] }]);
});

test('faixa contida numa lacuna antiga maior nao e nova; faixa que cresceu e', () => {
  const antes = foto({ '2026-09-09': ['07:00-09:00'] });
  assert.deepEqual(novasLacunas(antes, foto({ '2026-09-09': ['07:30-08:00'] })), [], 'encolheu: nada a avisar');
  assert.deepEqual(novasLacunas(antes, foto({ '2026-09-09': ['07:00-10:00'] })), [{ data: '2026-09-09', faixas: ['07:00–10:00'] }], 'cresceu: avisa');
});

test('dia que nao era util antes (feriado removido) conta tudo como novo', () => {
  const antes = foto({});
  const depois = foto({ '2026-09-07': ['07:00-18:00'] });
  assert.deepEqual(novasLacunas(antes, depois), [{ data: '2026-09-07', faixas: ['07:00–18:00'] }]);
});

test('dia que ficou coberto some, e nada e avisado', () => {
  const antes = foto({ '2026-09-09': ['12:00-14:00'] });
  assert.deepEqual(novasLacunas(antes, foto({ '2026-09-09': [] })), []);
  assert.deepEqual(novasLacunas(antes, foto({})), []);
});

test('varios dias saem em ordem de data', () => {
  const antes = foto({});
  const depois = foto({ '2026-09-11': ['07:00-08:00'], '2026-09-09': ['12:00-13:00'] });
  assert.deepEqual(novasLacunas(antes, depois).map((n) => n.data), ['2026-09-09', '2026-09-11']);
});

test('dataBonita nao anda um dia em fuso positivo nem negativo', () => {
  assert.equal(dataBonita('2026-09-07'), 'Seg 07/09');
  assert.equal(dataBonita('2026-01-01'), 'Qui 01/01');
});
