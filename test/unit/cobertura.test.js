const test = require('node:test');
const assert = require('node:assert/strict');
const { analisarCobertura, totalizarHoras, interpretarConfig, CONFIG_PADRAO } = require('../../src/cobertura');

const CONFIG = { ...CONFIG_PADRAO };
const turno = (servidor_id, nome, data, inicio, fim, modalidade = 'P') => ({ servidor_id, nome, data, inicio, fim, modalidade });

test('dia util sem ninguem presencial e uma lacuna inteira 07:00-19:00', () => {
  const [dia] = analisarCobertura({ inicio: '2026-09-08', fim: '2026-09-08', turnos: [], afastamentos: [], feriados: [], config: CONFIG });
  assert.equal(dia.util, true);
  assert.deepEqual(dia.lacunas, [{ inicio: '07:00', fim: '19:00', quantidade: 0 }]);
});

test('faixas descobertas consecutivas viram um intervalo so; as cobertas somem', () => {
  const turnos = [turno(1, 'Ana', '2026-09-08', '08:00', '12:00'), turno(2, 'Bia', '2026-09-08', '14:00', '18:00')];
  const [dia] = analisarCobertura({ inicio: '2026-09-08', fim: '2026-09-08', turnos, afastamentos: [], feriados: [], config: CONFIG });
  assert.deepEqual(dia.lacunas.map((l) => `${l.inicio}-${l.fim}`), ['07:00-08:00', '12:00-14:00', '18:00-19:00']);
  assert.deepEqual(dia.presentes.map((p) => p.nome), ['Ana', 'Bia']);
});

test('turno a distancia nao cobre; so presencial conta', () => {
  const turnos = [turno(1, 'Ana', '2026-09-08', '07:00', '19:00', 'D')];
  const [dia] = analisarCobertura({ inicio: '2026-09-08', fim: '2026-09-08', turnos, afastamentos: [], feriados: [], config: CONFIG });
  assert.equal(dia.lacunas.length, 1);
  assert.equal(dia.presentes.length, 0);
});

test('afastamento tira a pessoa da cobertura naquele dia e so naquele dia', () => {
  const turnos = [turno(1, 'Ana', '2026-09-08', '07:00', '19:00'), turno(1, 'Ana', '2026-09-09', '07:00', '19:00')];
  const afastamentos = [{ servidor_id: '1', data_inicio: '2026-09-08', data_fim: '2026-09-08', tipo: 'Folga' }];
  const dias = analisarCobertura({ inicio: '2026-09-08', fim: '2026-09-09', turnos, afastamentos, feriados: [], config: CONFIG });
  assert.equal(dias[0].lacunas.length, 1, 'dia afastado fica descoberto');
  assert.equal(dias[1].lacunas.length, 0, 'dia seguinte segue coberto');
});

test('fim de semana e feriado nao sao dias uteis e nao geram lacuna', () => {
  const dias = analisarCobertura({
    inicio: '2026-09-11', fim: '2026-09-14', turnos: [], afastamentos: [],
    feriados: [{ data: '2026-09-14', descricao: 'Teste' }], config: CONFIG,
  });
  assert.deepEqual(dias.map((d) => [d.data, d.util]), [
    ['2026-09-11', true], ['2026-09-12', false], ['2026-09-13', false], ['2026-09-14', false],
  ]);
  assert.equal(dias[3].feriado, 'Teste');
});

test('minimo 2: uma pessoa so ainda e descoberto, com quantidade 1', () => {
  const turnos = [turno(1, 'Ana', '2026-09-08', '07:00', '19:00')];
  const [dia] = analisarCobertura({ inicio: '2026-09-08', fim: '2026-09-08', turnos, afastamentos: [], feriados: [], config: { ...CONFIG, minimo_presencial: '2' } });
  assert.deepEqual(dia.lacunas, [{ inicio: '07:00', fim: '19:00', quantidade: 1 }]);
});

test('config com lixo cai no padrao E avisa — nunca "cobertura em ordem" com zero dias uteis', () => {
  const lixo = { cobertura_inicio: '25:99', cobertura_fim: '19:00', minimo_presencial: '-3', granularidade_min: 'abc', dias_uteis: 'x,y' };
  const r = interpretarConfig(lixo);
  assert.equal(r.abre, 7 * 60);
  assert.equal(r.fecha, 19 * 60);
  assert.equal(r.minimo, 1);
  assert.equal(r.passo, 30);
  assert.deepEqual(r.diasUteis, [1, 2, 3, 4, 5]);
  assert.equal(r.avisos.length, 4, r.avisos.join(' | '));

  const [dia] = analisarCobertura({ inicio: '2026-09-08', fim: '2026-09-08', turnos: [], afastamentos: [], feriados: [], config: lixo });
  assert.equal(dia.util, true);
  assert.equal(dia.lacunas.length, 1);
});

test('config com inicio depois do fim cai no padrao', () => {
  const r = interpretarConfig({ ...CONFIG, cobertura_inicio: '19:00', cobertura_fim: '07:00' });
  assert.equal(r.abre, 7 * 60);
  assert.equal(r.fecha, 19 * 60);
  assert.ok(r.avisos.length >= 1);
});

test('config vazia, null e undefined usam o padrao sem aviso', () => {
  for (const c of [{}, null, undefined]) {
    const r = interpretarConfig(c);
    assert.deepEqual(r.avisos, []);
    assert.equal(r.passo, 30);
  }
});

test('totalizarHoras soma por modalidade e ignora dias de afastamento', () => {
  const turnos = [
    turno(1, 'Ana', '2026-09-08', '08:00', '12:00', 'P'),
    turno(1, 'Ana', '2026-09-08', '13:00', '17:00', 'D'),
    turno(1, 'Ana', '2026-09-09', '08:00', '12:00', 'P'), // afastada: nao conta
    turno(2, 'Bia', '2026-09-09', '08:00', '11:30', 'P'),
  ];
  const afastamentos = [{ servidor_id: 1, data_inicio: '2026-09-09', data_fim: '2026-09-09' }];
  const r = totalizarHoras(turnos, afastamentos).sort((a, b) => a.servidor_id - b.servidor_id);
  assert.deepEqual(r, [
    { servidor_id: 1, nome: 'Ana', presencial: 4, distancia: 4, total: 8 },
    { servidor_id: 2, nome: 'Bia', presencial: 3.5, distancia: 0, total: 3.5 },
  ]);
});

test('totalizarHoras com lixo dentro: hora quebrada nao contamina a soma dos outros turnos', () => {
  const turnos = [
    turno(1, 'Ana', '2026-09-08', '08:00', '12:00', 'P'),
    turno(1, 'Ana', '2026-09-09', 'abc', '12:00', 'P'),
    turno(1, 'Ana', '2026-09-10', null, undefined, 'P'),
    { servidor_id: '1', nome: 'Ana', data: '2026-09-11', inicio: '13:00', fim: '15:00', modalidade: 'D' },
  ];
  const [r] = totalizarHoras(turnos);
  assert.equal(r.presencial, 4);
  assert.equal(r.distancia, 2);
  assert.equal(r.total, 6);
  assert.ok(!Number.isNaN(r.total));
  assert.equal(JSON.stringify(r).includes('null'), false);
});
