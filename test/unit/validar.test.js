const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../../src/validar');

test('ehData aceita so YYYY-MM-DD de verdade', () => {
  assert.equal(v.ehData('2026-09-08'), true);
  assert.equal(v.ehData('2026-02-29'), false); // 2026 nao e bissexto
  assert.equal(v.ehData('2026-13-01'), false);
  assert.equal(v.ehData('ontem'), false);
  assert.equal(v.ehData('abc'), false);
  assert.equal(v.ehData(''), false);
  assert.equal(v.ehData(null), false);
  assert.equal(v.ehData(undefined), false);
  assert.equal(v.ehData(20260908), false);
  assert.equal(v.ehData('08/09/2026'), false);
});

test('ehHora aceita so HH:MM entre 00:00 e 23:59', () => {
  assert.equal(v.ehHora('07:30'), true);
  assert.equal(v.ehHora('23:59'), true);
  assert.equal(v.ehHora('25:99'), false);
  assert.equal(v.ehHora('7:30'), false);
  assert.equal(v.ehHora('abc'), false);
  assert.equal(v.ehHora(null), false);
  assert.equal(v.ehHora(730), false);
});

test('numeroOuNulo: lixo vira NaN (nunca zero), vazio vira null', () => {
  assert.equal(v.numeroOuNulo('abc'), NaN);
  assert.equal(v.numeroOuNulo('12,5'), 12.5);
  assert.equal(v.numeroOuNulo(' 20 '), 20);
  assert.equal(v.numeroOuNulo(''), null);
  assert.equal(v.numeroOuNulo(null), null);
  assert.equal(v.numeroOuNulo(undefined), null);
  assert.equal(v.numeroOuNulo(NaN), NaN);
  assert.equal(v.numeroOuNulo(Infinity), NaN);
  assert.equal(v.numeroOuNulo(-3), -3);
});

test('ehInteiro respeita limites e recusa lixo', () => {
  assert.equal(v.ehInteiro('30', { min: 5, max: 240 }), true);
  assert.equal(v.ehInteiro(30, { min: 5, max: 240 }), true);
  assert.equal(v.ehInteiro('abc', { min: 5 }), false);
  assert.equal(v.ehInteiro('-3', { min: 1 }), false);
  assert.equal(v.ehInteiro('2.5', { min: 1 }), false);
  assert.equal(v.ehInteiro(null, { min: 1 }), false);
  assert.equal(v.ehInteiro(NaN), false);
});

test('normalizarEmail e ehEmail', () => {
  assert.equal(v.normalizarEmail('  Teste@Setor.LOCAL '), 'teste@setor.local');
  assert.equal(v.ehEmail('teste@setor.local'), true);
  assert.equal(v.ehEmail('teste'), false);
  assert.equal(v.ehEmail(''), false);
  assert.equal(v.ehEmail(null), false);
});

test('diasUteisOuNulo', () => {
  assert.deepEqual(v.diasUteisOuNulo('1,2,3,4,5'), [1, 2, 3, 4, 5]);
  assert.deepEqual(v.diasUteisOuNulo(' 5, 1 ,1'), [1, 5]);
  assert.equal(v.diasUteisOuNulo('x,y'), null);
  assert.equal(v.diasUteisOuNulo('1,7'), null);
  assert.equal(v.diasUteisOuNulo(''), null);
  assert.equal(v.diasUteisOuNulo(null), null);
});

test('ehLogin aceita e-mail ou nome de usuario curto, e recusa lixo', () => {
  assert.equal(v.ehLogin('dayana@setor.local'), true);
  assert.equal(v.ehLogin('CleliaDayana@Gmail.com'), true);
  assert.equal(v.ehLogin('dayana'), true);
  assert.equal(v.ehLogin('dayana.godinho'), true);
  assert.equal(v.ehLogin('  Dayana_2026 '), true);
  assert.equal(v.ehLogin('da'), false, 'curto demais');
  assert.equal(v.ehLogin('dayana godinho'), false, 'espaco no meio');
  assert.equal(v.ehLogin('.dayana'), false, 'nao comeca com ponto');
  assert.equal(v.ehLogin(''), false);
  assert.equal(v.ehLogin(null), false);
  assert.equal(v.ehLogin('a'.repeat(41)), false);
});

test('loginDoNome: primeiro nome, minusculo, sem acento', () => {
  assert.equal(v.loginDoNome('Dayana'), 'dayana');
  assert.equal(v.loginDoNome('João Pedro'), 'joao');
  assert.equal(v.loginDoNome('  Luís  Carlos '), 'luis');
  assert.equal(v.loginDoNome('D\'Ávila'), 'davila');
  assert.equal(v.loginDoNome(''), '');
  assert.equal(v.loginDoNome(null), '');
});
