import { test } from 'node:test';
import assert from 'node:assert/strict';
import { definirSsl } from '../src/infra/ssl';

const INTERNO = 'postgresql://postgres:senha@postgres.railway.internal:5432/railway';
const PUBLICO = 'postgresql://postgres:senha@centerbeam.proxy.rlwy.net:41234/railway';
const LOCAL = 'postgres://postgres:postgres@localhost:5432/siger_produtividade';

test('a rede interna do Railway nao usa TLS, mesmo em producao', () => {
  assert.equal(definirSsl(INTERNO, true), undefined);
});

test('endereco publico em producao usa TLS', () => {
  assert.deepEqual(definirSsl(PUBLICO, true), { rejectUnauthorized: false });
});

test('a maquina local nunca exige TLS', () => {
  assert.equal(definirSsl(LOCAL, false), undefined);
  assert.equal(definirSsl(LOCAL, true), undefined);
});

test('desenvolvimento contra banco de fora fica sem TLS por padrao', () => {
  assert.equal(definirSsl(PUBLICO, false), undefined);
});

test('o sslmode escrito na URL manda no palpite do endereco', () => {
  assert.deepEqual(definirSsl(`${INTERNO}?sslmode=require`, true), { rejectUnauthorized: false });
  assert.equal(definirSsl(`${PUBLICO}?sslmode=disable`, true), undefined);
});

test('DATABASE_SSL manda em tudo', () => {
  assert.deepEqual(definirSsl(INTERNO, false, 'true'), { rejectUnauthorized: false });
  assert.equal(definirSsl(`${PUBLICO}?sslmode=require`, true, 'false'), undefined);
});

test('URL malformada nao derruba a decisao', () => {
  assert.equal(definirSsl('isto-nao-e-uma-url', false), undefined);
});
