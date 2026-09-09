const express = require('express');
const db = require('../db');
const { autenticar, exigirChefia } = require('../auth');
const { analisarCobertura, totalizarHoras, interpretarConfig, iso } = require('../cobertura');
const { ehData, ehHora, ehInteiro, diasUteisOuNulo, numeroOuNulo } = require('../validar');

const router = express.Router();
router.use(autenticar);

async function lerConfig() {
  const { rows } = await db.query('SELECT chave, valor FROM config');
  return Object.fromEntries(rows.map((r) => [r.chave, r.valor]));
}

router.get('/', async (req, res) => {
  const { inicio, fim } = req.query;
  if (!ehData(inicio) || !ehData(fim)) return res.status(400).json({ erro: 'Informe inicio e fim no formato YYYY-MM-DD' });
  if (fim < inicio) return res.status(400).json({ erro: 'O fim deve ser igual ou posterior ao inicio' });
  const [config, turnos, afastamentos, feriados] = await Promise.all([
    lerConfig(),
    db.query(
      `SELECT t.servidor_id, s.nome, t.data, to_char(t.inicio,'HH24:MI') AS inicio,
              to_char(t.fim,'HH24:MI') AS fim, t.modalidade
         FROM turnos t JOIN servidores s ON s.id = t.servidor_id
        WHERE t.data BETWEEN $1 AND $2 AND s.ativo`,
      [inicio, fim]
    ),
    db.query(
      `SELECT servidor_id, data_inicio, data_fim FROM afastamentos WHERE data_inicio <= $2 AND data_fim >= $1`,
      [inicio, fim]
    ),
    db.query('SELECT data, descricao FROM feriados WHERE data BETWEEN $1 AND $2', [inicio, fim]),
  ]);

  const listaTurnos = turnos.rows.map((t) => ({ ...t, data: iso(t.data) }));
  const dias = analisarCobertura({
    inicio,
    fim,
    turnos: listaTurnos,
    afastamentos: afastamentos.rows,
    feriados: feriados.rows,
    config,
  });

  const diasComLacuna = dias.filter((d) => d.lacunas.length);
  const { avisos } = interpretarConfig(config);
  res.json({
    config,
    avisos,
    dias,
    resumo: {
      dias_uteis: dias.filter((d) => d.util).length,
      dias_com_lacuna: diasComLacuna.length,
      total_lacunas: diasComLacuna.reduce((s, d) => s + d.lacunas.length, 0),
    },
    horas: totalizarHoras(listaTurnos, afastamentos.rows),
  });
});

router.get('/config', async (req, res) => res.json(await lerConfig()));

// Cada regra tem a sua checagem; valor ruim e recusado com o motivo, e nada e
// gravado ate todas passarem (a config e lida inteira em toda analise).
const REGRAS = {
  cobertura_inicio: [(v) => ehHora(v), 'hora no formato HH:MM'],
  cobertura_fim: [(v) => ehHora(v), 'hora no formato HH:MM'],
  minimo_presencial: [(v) => ehInteiro(v, { min: 1, max: 100 }), 'inteiro entre 1 e 100'],
  granularidade_min: [(v) => ehInteiro(v, { min: 5, max: 240 }), 'inteiro entre 5 e 240 (minutos)'],
  dias_uteis: [(v) => Boolean(diasUteisOuNulo(v)), 'lista de dias da semana de 0 (domingo) a 6 (sabado), separados por virgula'],
  periodo_inicio: [(v) => v === '' || v === null || ehData(v), 'data no formato YYYY-MM-DD, ou vazio'],
  periodo_fim: [(v) => v === '' || v === null || ehData(v), 'data no formato YYYY-MM-DD, ou vazio'],
};

router.put('/config', exigirChefia, async (req, res) => {
  const atual = await lerConfig();
  const novo = {};
  const erros = [];
  for (const [chave, valor] of Object.entries(req.body || {})) {
    if (!REGRAS[chave]) continue;
    const [valida, esperado] = REGRAS[chave];
    if (!valida(valor)) erros.push(`${chave}: esperado ${esperado}, recebido "${valor}"`);
    else novo[chave] = chave === 'dias_uteis' ? diasUteisOuNulo(valor).join(',') : String(valor ?? '').trim();
  }
  const junto = { ...atual, ...novo };
  if (!erros.length && ehHora(junto.cobertura_inicio) && ehHora(junto.cobertura_fim)
      && numeroOuNulo(junto.cobertura_fim.replace(':', '')) <= numeroOuNulo(junto.cobertura_inicio.replace(':', ''))) {
    erros.push(`cobertura_fim (${junto.cobertura_fim}) precisa ser depois de cobertura_inicio (${junto.cobertura_inicio})`);
  }
  if (!erros.length && junto.periodo_inicio && junto.periodo_fim && junto.periodo_fim < junto.periodo_inicio) {
    erros.push(`periodo_fim (${junto.periodo_fim}) precisa ser igual ou depois de periodo_inicio (${junto.periodo_inicio})`);
  }
  if (erros.length) return res.status(400).json({ erro: `Regra recusada: ${erros.join('; ')}`, erros });
  for (const [chave, valor] of Object.entries(novo)) {
    await db.query('INSERT INTO config (chave, valor) VALUES ($1,$2) ON CONFLICT (chave) DO UPDATE SET valor = $2', [chave, valor]);
  }
  res.json(await lerConfig());
});

module.exports = router;
