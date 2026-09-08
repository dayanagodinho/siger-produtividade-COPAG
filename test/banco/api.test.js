// Teste contra banco DE VERDADE (regra 3 do repositorio): sobe o app, roda
// migracao e seed num banco de teste e exercita as rotas de ponta a ponta,
// incluindo repetir a operacao — onde moram os bugs de identidade.
//
// Como rodar:  DATABASE_URL_TESTE=postgresql://... npm run test:banco
// O banco apontado e APAGADO a cada execucao.

const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.DATABASE_URL_TESTE) {
  console.error('DATABASE_URL_TESTE nao definida. Aponte para um Postgres de teste (ele sera apagado).');
  process.exit(1);
}
process.env.DATABASE_URL = process.env.DATABASE_URL_TESTE;
process.env.JWT_SECRET = 'segredo-de-teste';
process.env.SENHA_PADRAO = 'mudar123';

const db = require('../../src/db');
const { migrar } = require('../../scripts/migrate');
const { semear } = require('../../scripts/seed');
const app = require('../../server');

let servidor;
let base;
const cookies = {};

async function chamar(caminho, { metodo = 'GET', corpo, como } = {}) {
  const r = await fetch(`${base}/api${caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(como ? { Cookie: cookies[como] } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json, setCookie: r.headers.get('set-cookie') };
}

async function entrar(quem, email, senha = 'mudar123') {
  const r = await chamar('/auth/login', { metodo: 'POST', corpo: { email, senha } });
  assert.equal(r.status, 200, `login de ${email}: ${JSON.stringify(r.json)}`);
  cookies[quem] = r.setCookie.split(';')[0];
  return r.json;
}

const contar = async (tabela, where = 'TRUE', params = []) =>
  Number((await db.query(`SELECT count(*)::int AS n FROM ${tabela} WHERE ${where}`, params)).rows[0].n);

// Simula o banco herdado do SIGAP: tabelas `servidores` e `feriados` no schema
// public, com OUTRAS colunas e dados. Elas precisam sobreviver intactas.
const SIGAP_SERVIDORES = 3;
async function plantarSigap() {
  await db.pool.query(`
    DROP SCHEMA IF EXISTS ${db.SCHEMA} CASCADE;
    DROP TABLE IF EXISTS public.servidores, public.feriados CASCADE;
    CREATE TABLE public.servidores (id SERIAL PRIMARY KEY, matricula TEXT NOT NULL, nome TEXT NOT NULL, setor_id INT);
    CREATE TABLE public.feriados (id SERIAL PRIMARY KEY, data DATE NOT NULL, nome TEXT NOT NULL);
    INSERT INTO public.servidores (matricula, nome, setor_id) VALUES ('1001','Sigap Um',1),('1002','Sigap Dois',1),('1003','Sigap Tres',1);
    INSERT INTO public.feriados (data, nome) VALUES ('2026-09-07','Independencia');
  `);
}

test.before(async () => {
  await plantarSigap();
  await migrar();
  servidor = app.listen(0);
  await new Promise((ok) => servidor.once('listening', ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

test.after(async () => {
  servidor.close();
  await db.pool.end();
});

test('/api/saude diz qual sistema esta no ar e o que este build sabe fazer', async () => {
  const r = await chamar('/saude');
  assert.equal(r.status, 200);
  assert.equal(r.json.sistema, 'escala-hibrida');
  assert.equal(r.json.schema, db.SCHEMA);
  assert.equal(r.json.capacidades.schema_proprio, true);
  assert.equal(r.json.situacao, undefined, 'nao e a resposta do SIGAP');
});

test('seed e idempotente: rodar tres vezes da o mesmo banco', async () => {
  const a = await semear();
  assert.equal(a.servidores, 7);
  assert.equal(a.turnos, 218);
  const b = await semear();
  assert.equal(b.turnos, 0);
  const c = await semear({ soSeVazio: true });
  assert.equal(c.pulado, true);
  assert.equal(await contar('servidores'), 7);
  assert.equal(await contar('turnos'), 218);
});

test('as tabelas do SIGAP no schema public continuam intactas depois de migrar e semear', async () => {
  // Roda depois do teste do seed: o schema proprio ja esta semeado.
  const { rows: s } = await db.pool.query('SELECT count(*)::int AS n, min(nome) AS nome FROM public.servidores');
  assert.equal(s[0].n, SIGAP_SERVIDORES);
  assert.equal(s[0].nome, 'Sigap Dois');
  const { rows: f } = await db.pool.query('SELECT count(*)::int AS n FROM public.feriados');
  assert.equal(f[0].n, 1);
  const { rows: e } = await db.pool.query(`SELECT count(*)::int AS n FROM ${db.SCHEMA}.servidores`);
  assert.equal(e[0].n, 7, 'os 7 da escala estao no schema proprio');
  const { rows: col } = await db.pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'servidores' AND column_name = 'senha_hash'"
  );
  assert.equal(col.length, 0, 'nenhuma coluna da escala vazou para a tabela do SIGAP');
});

test('login ignora maiusculas no email e recusa senha errada', async () => {
  const eu = await entrar('chefia', 'DAYANA@Setor.Local');
  assert.equal(eu.perfil, 'chefia');
  await entrar('luiz', 'luiz@setor.local');
  const r = await chamar('/auth/login', { metodo: 'POST', corpo: { email: 'luiz@setor.local', senha: 'x' } });
  assert.equal(r.status, 401);
  assert.equal((await chamar('/servidores')).status, 401, 'sem cookie e 401');
});

test('email duplicado por maiuscula e recusado (409), e o guardado fica em minusculas', async () => {
  const a = await chamar('/servidores', { metodo: 'POST', como: 'chefia', corpo: { nome: 'Teste', email: 'Teste@Setor.local' } });
  assert.equal(a.status, 201, JSON.stringify(a.json));
  assert.equal(a.json.email, 'teste@setor.local');
  const b = await chamar('/servidores', { metodo: 'POST', como: 'chefia', corpo: { nome: 'Teste 2', email: 'TESTE@setor.local' } });
  assert.equal(b.status, 409, JSON.stringify(b.json));
  const c = await chamar(`/servidores/${a.json.id}`, { metodo: 'PUT', como: 'chefia', corpo: { email: 'LUIZ@setor.local' } });
  assert.equal(c.status, 409, 'renomear para email de outro tambem e 409');
  assert.equal(await contar('servidores', "lower(email) = 'teste@setor.local'"), 1);
});

test('meta com lixo e recusada com 400 e motivo, nao 500', async () => {
  const r = await chamar('/servidores/2', { metodo: 'PUT', como: 'chefia', corpo: { meta_presencial_semanal: 'abc' } });
  assert.equal(r.status, 400);
  assert.match(r.json.erro, /meta_presencial_semanal/);
  const ok = await chamar('/servidores/2', { metodo: 'PUT', como: 'chefia', corpo: { meta_presencial_semanal: '12,5' } });
  assert.equal(ok.status, 200);
  assert.equal(Number(ok.json.meta_presencial_semanal), 12.5);
});

test('servidor so edita a propria escala; chefia edita a de qualquer um', async () => {
  const r = await chamar('/escala/turnos', { metodo: 'POST', como: 'luiz', corpo: { servidor_id: 3, data: '2026-11-02', inicio: '08:00', fim: '12:00', modalidade: 'P' } });
  assert.equal(r.status, 403);
  const c = await chamar('/escala/turnos', { metodo: 'POST', como: 'chefia', corpo: { servidor_id: 3, data: '2026-11-02', inicio: '08:00', fim: '12:00', modalidade: 'P' } });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  assert.equal(c.json.data, '2026-11-02', 'DATE volta como texto, sem andar um dia');
});

test('turno: lixo em data/hora da 400 com motivo; sobreposicao da 409', async () => {
  const casos = [
    [{ data: 'ontem', inicio: '08:00', fim: '12:00', modalidade: 'P' }, /Data invalida/],
    [{ data: '2026-11-03', inicio: 'abc', fim: '12:00', modalidade: 'P' }, /Horario invalido/],
    [{ data: '2026-11-03', inicio: '12:00', fim: '08:00', modalidade: 'P' }, /fim deve ser depois/],
    [{ data: '2026-11-03', inicio: '08:00', fim: '12:00', modalidade: 'X' }, /modalidade/],
    [{ data: '2026-02-30', inicio: '08:00', fim: '12:00', modalidade: 'P' }, /Data invalida/],
  ];
  for (const [corpo, re] of casos) {
    const r = await chamar('/escala/turnos', { metodo: 'POST', como: 'luiz', corpo });
    assert.equal(r.status, 400, JSON.stringify({ corpo, r: r.json }));
    assert.match(r.json.erro, re);
  }
  const ok = await chamar('/escala/turnos', { metodo: 'POST', como: 'luiz', corpo: { data: '2026-11-03', inicio: '08:00', fim: '12:00', modalidade: 'P' } });
  assert.equal(ok.status, 201);
  const sobre = await chamar('/escala/turnos', { metodo: 'POST', como: 'luiz', corpo: { data: '2026-11-03', inicio: '11:00', fim: '13:00', modalidade: 'D' } });
  assert.equal(sobre.status, 409);
  const colado = await chamar('/escala/turnos', { metodo: 'POST', como: 'luiz', corpo: { data: '2026-11-03', inicio: '12:00', fim: '13:00', modalidade: 'D' } });
  assert.equal(colado.status, 201, 'turno que comeca onde o outro termina nao e sobreposicao');
});

test('consultas com data invalida dao 400, nao 500', async () => {
  for (const caminho of ['/escala?inicio=abc&fim=2026-09-01', '/cobertura?inicio=abc&fim=2026-09-01', '/escala?inicio=2026-09-30&fim=2026-09-01', '/cobertura']) {
    const r = await chamar(caminho, { como: 'luiz' });
    assert.equal(r.status, 400, caminho);
  }
});

test('afastamento tira a pessoa da cobertura e das horas do periodo; remover devolve', async () => {
  // Na planilha, 09/09 tem Luiz 07:00-14:00 presencial e mais gente a partir das 07:30.
  const antes = await chamar('/cobertura?inicio=2026-09-09&fim=2026-09-09', { como: 'luiz' });
  assert.equal(antes.status, 200);
  assert.ok(antes.json.dias[0].presentes.some((p) => p.nome === 'Luiz'));
  const horasAntes = antes.json.horas.find((h) => h.nome === 'Luiz').presencial;
  assert.equal(horasAntes, 7);

  const af = await chamar('/escala/afastamentos', { metodo: 'POST', como: 'luiz', corpo: { data_inicio: '2026-09-09', data_fim: '2026-09-09', tipo: 'Folga' } });
  assert.equal(af.status, 201, JSON.stringify(af.json));

  const durante = await chamar('/cobertura?inicio=2026-09-09&fim=2026-09-09', { como: 'luiz' });
  assert.ok(!durante.json.dias[0].presentes.some((p) => p.nome === 'Luiz'));
  assert.equal(durante.json.horas.find((h) => h.nome === 'Luiz'), undefined, 'hora em dia afastado nao conta');

  const del = await chamar(`/escala/afastamentos/${af.json.id}`, { metodo: 'DELETE', como: 'luiz' });
  assert.equal(del.status, 200);
  const depois = await chamar('/cobertura?inicio=2026-09-09&fim=2026-09-09', { como: 'luiz' });
  assert.equal(depois.json.horas.find((h) => h.nome === 'Luiz').presencial, 7);
});

test('feriado tira o dia da checagem; so chefia cadastra', async () => {
  const neg = await chamar('/escala/feriados', { metodo: 'POST', como: 'luiz', corpo: { data: '2026-09-10', descricao: 'Teste' } });
  assert.equal(neg.status, 403);
  const ok = await chamar('/escala/feriados', { metodo: 'POST', como: 'chefia', corpo: { data: '2026-09-10', descricao: 'Teste' } });
  assert.equal(ok.status, 201);
  const cob = await chamar('/cobertura?inicio=2026-09-10&fim=2026-09-10', { como: 'luiz' });
  assert.equal(cob.json.dias[0].util, false);
  assert.equal(cob.json.dias[0].feriado, 'Teste');
  assert.equal((await chamar('/escala/feriados/2026-09-10', { metodo: 'DELETE', como: 'chefia' })).status, 200);
  assert.equal((await chamar('/escala/feriados/abc', { metodo: 'DELETE', como: 'chefia' })).status, 400);
});

test('repetir semana: cria, repetir de novo cria zero, e "ate" lixo ou distante demais e recusado (era laco infinito)', async () => {
  // Semana base nova, fora do periodo da planilha, para nao esbarrar em turno existente.
  const base = '2026-11-09'; // segunda
  for (const [dia, ini, fim, mod] of [['2026-11-09', '08:00', '12:00', 'P'], ['2026-11-10', '13:00', '17:00', 'D']]) {
    assert.equal((await chamar('/escala/turnos', { metodo: 'POST', como: 'luiz', corpo: { data: dia, inicio: ini, fim, modalidade: mod } })).status, 201);
  }
  const lixo = await chamar('/escala/replicar', { metodo: 'POST', como: 'luiz', corpo: { semana_base: base, ate: 'abc' } });
  assert.equal(lixo.status, 400, JSON.stringify(lixo.json));
  const longe = await chamar('/escala/replicar', { metodo: 'POST', como: 'luiz', corpo: { semana_base: base, ate: '2099-12-31' } });
  assert.equal(longe.status, 400);
  assert.match(longe.json.erro, /maximo/);
  const curto = await chamar('/escala/replicar', { metodo: 'POST', como: 'luiz', corpo: { semana_base: base, ate: '2026-11-12' } });
  assert.equal(curto.status, 400, 'menos de uma semana nao repete nada');

  const antes = await contar('turnos', 'servidor_id = 5 AND data > $1', [base]);
  const r = await chamar('/escala/replicar', { metodo: 'POST', como: 'luiz', corpo: { semana_base: base, ate: '2026-12-04' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.semanas, 3);
  assert.equal(r.json.criados, 6);
  assert.equal(await contar('turnos', 'servidor_id = 5 AND data > $1', [base]), antes + 6);

  const denovo = await chamar('/escala/replicar', { metodo: 'POST', como: 'luiz', corpo: { semana_base: base, ate: '2026-12-04' } });
  assert.equal(denovo.json.criados, 0, 'repetir a operacao nao duplica');
  assert.equal(await contar('turnos', 'servidor_id = 5 AND data > $1', [base]), antes + 6);
});

test('regras de cobertura: lixo e recusado inteiro com motivo, e nada e gravado', async () => {
  const antes = (await chamar('/cobertura/config', { como: 'chefia' })).json;
  const r = await chamar('/cobertura/config', { metodo: 'PUT', como: 'chefia', corpo: { granularidade_min: 'abc', cobertura_inicio: '25:99', minimo_presencial: '-3', dias_uteis: 'x,y', outra: '1' } });
  assert.equal(r.status, 400);
  assert.equal(r.json.erros.length, 4, r.json.erro);
  assert.deepEqual((await chamar('/cobertura/config', { como: 'chefia' })).json, antes, 'nada mudou');

  const invertido = await chamar('/cobertura/config', { metodo: 'PUT', como: 'chefia', corpo: { cobertura_inicio: '20:00' } });
  assert.equal(invertido.status, 400, 'inicio depois do fim atual tambem e recusado');

  const ok = await chamar('/cobertura/config', { metodo: 'PUT', como: 'chefia', corpo: { minimo_presencial: 2, dias_uteis: '5, 1,1' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.minimo_presencial, '2');
  assert.equal(ok.json.dias_uteis, '1,5');
  assert.equal((await chamar('/cobertura/config', { metodo: 'PUT', como: 'luiz', corpo: { minimo_presencial: 1 } })).status, 403);

  // Um analise com a config valida nao traz avisos
  const cob = await chamar('/cobertura?inicio=2026-09-08&fim=2026-09-08', { como: 'luiz' });
  assert.deepEqual(cob.json.avisos, []);
  await chamar('/cobertura/config', { metodo: 'PUT', como: 'chefia', corpo: { minimo_presencial: 1, dias_uteis: '1,2,3,4,5' } });
});

test('config invalida gravada por fora do app nao silencia o alerta: cai no padrao e avisa', async () => {
  await db.query(`UPDATE config SET valor = 'abc' WHERE chave = 'granularidade_min'`);
  const cob = await chamar('/cobertura?inicio=2026-09-08&fim=2026-09-08', { como: 'luiz' });
  assert.equal(cob.status, 200);
  assert.equal(cob.json.resumo.dias_uteis, 1, 'nao pode dizer zero dias uteis');
  assert.equal(cob.json.avisos.length, 1);
  assert.match(cob.json.avisos[0], /granularidade_min/);
  await db.query(`UPDATE config SET valor = '30' WHERE chave = 'granularidade_min'`);
});

test('trocar senha: curta e 400, certa funciona e a antiga para de valer', async () => {
  assert.equal((await chamar('/auth/senha', { metodo: 'POST', como: 'luiz', corpo: { senha_atual: 'mudar123', senha_nova: '123' } })).status, 400);
  assert.equal((await chamar('/auth/senha', { metodo: 'POST', como: 'luiz', corpo: { senha_atual: 'errada', senha_nova: 'novasenha' } })).status, 401);
  assert.equal((await chamar('/auth/senha', { metodo: 'POST', como: 'luiz', corpo: { senha_atual: 'mudar123', senha_nova: 'novasenha' } })).status, 200);
  assert.equal((await chamar('/auth/login', { metodo: 'POST', corpo: { email: 'luiz@setor.local', senha: 'mudar123' } })).status, 401);
  await entrar('luiz', 'luiz@setor.local', 'novasenha');
});
