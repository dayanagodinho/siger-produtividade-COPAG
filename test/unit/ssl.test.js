const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x@localhost:5432/x';
const { definirSsl } = require('../../src/db');

// A regra e a mesma do SIGAP, que ja rodou meses no mesmo Railway.
test('rede interna do Railway e maquina local nao usam TLS, mesmo em producao', () => {
  assert.equal(definirSsl('postgresql://u:s@postgres.railway.internal:5432/railway', true), false);
  assert.equal(definirSsl('postgresql://u:s@localhost:5432/escala', true), false);
  assert.equal(definirSsl('postgresql://u:s@127.0.0.1:5499/escala', false), false);
});

test('endereco publico usa TLS em producao e nao usa fora dela', () => {
  assert.deepEqual(definirSsl('postgresql://u:s@junction.proxy.rlwy.net:1234/railway', true), { rejectUnauthorized: false });
  assert.equal(definirSsl('postgresql://u:s@junction.proxy.rlwy.net:1234/railway', false), false);
});

test('sslmode na URL e DATABASE_SSL mandam acima do palpite', () => {
  assert.deepEqual(definirSsl('postgresql://u:s@localhost/x?sslmode=require', false), { rejectUnauthorized: false });
  assert.equal(definirSsl('postgresql://u:s@fora.com/x?sslmode=disable', true), false);
  assert.equal(definirSsl('postgresql://u:s@fora.com/x', true, 'false'), false);
  assert.deepEqual(definirSsl('postgresql://u:s@localhost/x', false, 'true'), { rejectUnauthorized: false });
});

test('URL quebrada, vazia ou undefined nao derruba: decide pelo ambiente', () => {
  assert.equal(definirSsl('lixo', false), false);
  assert.deepEqual(definirSsl('lixo', true), { rejectUnauthorized: false });
  assert.equal(definirSsl(undefined, false), false);
});
