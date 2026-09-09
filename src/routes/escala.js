const express = require('express');
const db = require('../db');
const { autenticar, podeEditar, exigirChefia } = require('../auth');
const { paraMinutos, iso } = require('../cobertura');
const { ehData, ehHora, ehInteiro } = require('../validar');

// Teto do repetir-semana. Acima disso e quase certo engano de data.
const MAX_SEMANAS_REPLICAR = 53;

const router = express.Router();
router.use(autenticar);

const SQL_TURNOS = `
  SELECT t.id, t.servidor_id, s.nome, t.data, to_char(t.inicio,'HH24:MI') AS inicio,
         to_char(t.fim,'HH24:MI') AS fim, t.modalidade, t.observacao
    FROM turnos t JOIN servidores s ON s.id = t.servidor_id
   WHERE t.data BETWEEN $1 AND $2
   ORDER BY t.data, t.inicio, s.nome`;

const SQL_AFAST = `
  SELECT a.id, a.servidor_id, s.nome, a.data_inicio, a.data_fim, a.tipo, a.observacao
    FROM afastamentos a JOIN servidores s ON s.id = a.servidor_id
   WHERE a.data_inicio <= $2 AND a.data_fim >= $1
   ORDER BY a.data_inicio`;

router.get('/', async (req, res) => {
  const { inicio, fim } = req.query;
  if (!ehData(inicio) || !ehData(fim)) return res.status(400).json({ erro: 'Informe inicio e fim no formato YYYY-MM-DD' });
  if (fim < inicio) return res.status(400).json({ erro: 'O fim deve ser igual ou posterior ao inicio' });
  const [turnos, afastamentos, feriados] = await Promise.all([
    db.query(SQL_TURNOS, [inicio, fim]),
    db.query(SQL_AFAST, [inicio, fim]),
    db.query('SELECT data, descricao FROM feriados WHERE data BETWEEN $1 AND $2', [inicio, fim]),
  ]);
  res.json({
    turnos: turnos.rows.map((t) => ({ ...t, data: iso(t.data) })),
    afastamentos: afastamentos.rows.map((a) => ({ ...a, data_inicio: iso(a.data_inicio), data_fim: iso(a.data_fim) })),
    feriados: feriados.rows.map((f) => ({ ...f, data: iso(f.data) })),
  });
});

// Cria um turno. Recusa sobreposicao com outro turno do mesmo servidor no mesmo dia.
router.post('/turnos', async (req, res) => {
  const { servidor_id, data, inicio, fim, modalidade, observacao } = req.body || {};
  const alvo = servidor_id || req.usuario.id;
  if (!podeEditar(req.usuario, alvo)) return res.status(403).json({ erro: 'Voce so pode editar a sua propria escala' });
  if (!ehInteiro(alvo, { min: 1 })) return res.status(400).json({ erro: 'servidor_id invalido' });
  if (!['P', 'D'].includes(modalidade)) return res.status(400).json({ erro: 'Informe a modalidade: P (presencial) ou D (a distancia)' });
  if (!ehData(data)) return res.status(400).json({ erro: `Data invalida: "${data ?? ''}". Use o formato YYYY-MM-DD` });
  if (!ehHora(inicio) || !ehHora(fim)) return res.status(400).json({ erro: `Horario invalido: "${inicio ?? ''}"–"${fim ?? ''}". Use o formato HH:MM` });
  if (paraMinutos(fim) <= paraMinutos(inicio)) return res.status(400).json({ erro: 'O fim deve ser depois do inicio' });

  const conflito = await db.query(
    `SELECT id FROM turnos WHERE servidor_id = $1 AND data = $2 AND $3::time < fim AND $4::time > inicio`,
    [alvo, data, inicio, fim]
  );
  if (conflito.rows.length) return res.status(409).json({ erro: 'Ja existe turno seu nesse horario' });

  const { rows } = await db.query(
    `INSERT INTO turnos (servidor_id, data, inicio, fim, modalidade, observacao)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, servidor_id, data, to_char(inicio,'HH24:MI') AS inicio, to_char(fim,'HH24:MI') AS fim, modalidade, observacao`,
    [alvo, data, inicio, fim, modalidade, observacao || null]
  );
  res.status(201).json({ ...rows[0], data: iso(rows[0].data) });
});

router.delete('/turnos/:id', async (req, res) => {
  if (!ehInteiro(req.params.id, { min: 1 })) return res.status(400).json({ erro: 'id invalido' });
  const { rows } = await db.query('SELECT servidor_id FROM turnos WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ erro: 'Turno nao encontrado' });
  if (!podeEditar(req.usuario, rows[0].servidor_id)) return res.status(403).json({ erro: 'Sem permissao' });
  await db.query('DELETE FROM turnos WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

/**
 * Edita um turno existente. A chefia pode inclusive passar o turno para outro
 * servidor; quem nao e chefia so mexe no proprio. Sobreposicao e conferida
 * contra os OUTROS turnos da pessoa no dia, nunca contra o proprio.
 */
router.put('/turnos/:id', async (req, res) => {
  if (!ehInteiro(req.params.id, { min: 1 })) return res.status(400).json({ erro: 'id invalido' });
  const atual = (await db.query(
    `SELECT id, servidor_id, data, to_char(inicio,'HH24:MI') AS inicio, to_char(fim,'HH24:MI') AS fim, modalidade, observacao
       FROM turnos WHERE id = $1`, [req.params.id])).rows[0];
  if (!atual) return res.status(404).json({ erro: 'Turno nao encontrado' });
  if (!podeEditar(req.usuario, atual.servidor_id)) return res.status(403).json({ erro: 'Sem permissao' });

  const corpo = req.body || {};
  const alvo = corpo.servidor_id ?? atual.servidor_id;
  const data = corpo.data ?? iso(atual.data);
  const inicio = corpo.inicio ?? atual.inicio;
  const fim = corpo.fim ?? atual.fim;
  const modalidade = corpo.modalidade ?? atual.modalidade;
  const observacao = corpo.observacao === undefined ? atual.observacao : (corpo.observacao || null);

  if (!ehInteiro(alvo, { min: 1 })) return res.status(400).json({ erro: 'servidor_id invalido' });
  if (!podeEditar(req.usuario, alvo)) return res.status(403).json({ erro: 'Voce so pode editar a sua propria escala' });
  if (!['P', 'D'].includes(modalidade)) return res.status(400).json({ erro: 'Informe a modalidade: P (presencial) ou D (a distancia)' });
  if (!ehData(data)) return res.status(400).json({ erro: `Data invalida: "${data ?? ''}". Use o formato YYYY-MM-DD` });
  if (!ehHora(inicio) || !ehHora(fim)) return res.status(400).json({ erro: `Horario invalido: "${inicio ?? ''}"–"${fim ?? ''}". Use o formato HH:MM` });
  if (paraMinutos(fim) <= paraMinutos(inicio)) return res.status(400).json({ erro: 'O fim deve ser depois do inicio' });

  const conflito = await db.query(
    `SELECT id FROM turnos WHERE servidor_id = $1 AND data = $2 AND id <> $5 AND $3::time < fim AND $4::time > inicio`,
    [alvo, data, inicio, fim, atual.id]
  );
  if (conflito.rows.length) return res.status(409).json({ erro: 'Ja existe outro turno nesse horario' });

  const { rows } = await db.query(
    `UPDATE turnos SET servidor_id = $1, data = $2, inicio = $3, fim = $4, modalidade = $5, observacao = $6
      WHERE id = $7
      RETURNING id, servidor_id, data, to_char(inicio,'HH24:MI') AS inicio, to_char(fim,'HH24:MI') AS fim, modalidade, observacao`,
    [alvo, data, inicio, fim, modalidade, observacao, atual.id]
  );
  res.json({ ...rows[0], data: iso(rows[0].data) });
});

/**
 * Replica a escala de uma semana para as semanas seguintes — o padrao da
 * planilha antiga, em que a mesma semana se repete ate o fim do periodo.
 */
router.post('/replicar', async (req, res) => {
  const { semana_base, ate, servidor_id, substituir } = req.body || {};
  if (!ehData(semana_base) || !ehData(ate)) {
    return res.status(400).json({ erro: 'Informe semana_base e ate no formato YYYY-MM-DD' });
  }
  const alvo = servidor_id || req.usuario.id;
  if (!ehInteiro(alvo, { min: 1 })) return res.status(400).json({ erro: 'servidor_id invalido' });
  if (!podeEditar(req.usuario, alvo)) return res.status(403).json({ erro: 'Sem permissao' });
  // Quantas semanas cabem entre a base e "ate". Sem este teto, "ate" invalido
  // ou distante demais virava laco sem fim gravando turno dentro de uma
  // transacao — o servidor travava com o cliente do banco preso.
  const semanas = Math.floor((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${semana_base}T12:00:00Z`)) / (7 * 86400000));
  if (semanas < 1) return res.status(400).json({ erro: `"ate" (${ate}) precisa ser ao menos uma semana depois da semana base (${semana_base})` });
  if (semanas > MAX_SEMANAS_REPLICAR) {
    return res.status(400).json({ erro: `Sao ${semanas} semanas entre ${semana_base} e ${ate}; o maximo e ${MAX_SEMANAS_REPLICAR} (um ano). Escolha uma data mais proxima` });
  }

  const base = await db.query(
    `SELECT data, to_char(inicio,'HH24:MI') AS inicio, to_char(fim,'HH24:MI') AS fim, modalidade, observacao
       FROM turnos WHERE servidor_id = $1 AND data BETWEEN $2 AND ($2::date + 6)`,
    [alvo, semana_base]
  );
  if (!base.rows.length) return res.status(400).json({ erro: 'A semana base nao tem turnos lancados' });

  let criados = 0;
  const cliente = await db.pool.connect();
  try {
    await cliente.query('BEGIN');
    for (let semana = 1; semana <= semanas; semana++) {
      const deslocamento = semana * 7;
      const primeiroDia = new Date(`${semana_base}T12:00:00Z`);
      primeiroDia.setUTCDate(primeiroDia.getUTCDate() + deslocamento);
      if (primeiroDia.toISOString().slice(0, 10) > ate) break;
      for (const t of base.rows) {
        const novaData = new Date(`${iso(t.data)}T12:00:00Z`);
        novaData.setUTCDate(novaData.getUTCDate() + deslocamento);
        const dataStr = novaData.toISOString().slice(0, 10);
        if (dataStr > ate) continue;
        if (substituir) {
          await cliente.query('DELETE FROM turnos WHERE servidor_id = $1 AND data = $2', [alvo, dataStr]);
        }
        const conflito = await cliente.query(
          `SELECT id FROM turnos WHERE servidor_id = $1 AND data = $2 AND $3::time < fim AND $4::time > inicio`,
          [alvo, dataStr, t.inicio, t.fim]
        );
        if (conflito.rows.length) continue;
        await cliente.query(
          `INSERT INTO turnos (servidor_id, data, inicio, fim, modalidade, observacao) VALUES ($1,$2,$3,$4,$5,$6)`,
          [alvo, dataStr, t.inicio, t.fim, t.modalidade, t.observacao]
        );
        criados++;
      }
    }
    await cliente.query('COMMIT');
  } catch (e) {
    await cliente.query('ROLLBACK');
    throw e;
  } finally {
    cliente.release();
  }
  res.json({ ok: true, criados, semanas });
});

router.post('/afastamentos', async (req, res) => {
  const { servidor_id, data_inicio, data_fim, tipo, observacao } = req.body || {};
  const alvo = servidor_id || req.usuario.id;
  if (!ehInteiro(alvo, { min: 1 })) return res.status(400).json({ erro: 'servidor_id invalido' });
  if (!podeEditar(req.usuario, alvo)) return res.status(403).json({ erro: 'Sem permissao' });
  if (!ehData(data_inicio) || !ehData(data_fim)) return res.status(400).json({ erro: 'Informe data_inicio e data_fim no formato YYYY-MM-DD' });
  if (data_fim < data_inicio) return res.status(400).json({ erro: 'A data final deve ser igual ou posterior a inicial' });
  const { rows } = await db.query(
    `INSERT INTO afastamentos (servidor_id, data_inicio, data_fim, tipo, observacao)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [alvo, data_inicio, data_fim, tipo || 'Licenca', observacao || null]
  );
  res.status(201).json({ ...rows[0], data_inicio: iso(rows[0].data_inicio), data_fim: iso(rows[0].data_fim) });
});

router.put('/afastamentos/:id', async (req, res) => {
  if (!ehInteiro(req.params.id, { min: 1 })) return res.status(400).json({ erro: 'id invalido' });
  const atual = (await db.query('SELECT * FROM afastamentos WHERE id = $1', [req.params.id])).rows[0];
  if (!atual) return res.status(404).json({ erro: 'Afastamento nao encontrado' });
  if (!podeEditar(req.usuario, atual.servidor_id)) return res.status(403).json({ erro: 'Sem permissao' });

  const corpo = req.body || {};
  const alvo = corpo.servidor_id ?? atual.servidor_id;
  const data_inicio = corpo.data_inicio ?? iso(atual.data_inicio);
  const data_fim = corpo.data_fim ?? iso(atual.data_fim);
  const tipo = corpo.tipo ? String(corpo.tipo).trim() : atual.tipo;
  const observacao = corpo.observacao === undefined ? atual.observacao : (corpo.observacao || null);

  if (!ehInteiro(alvo, { min: 1 })) return res.status(400).json({ erro: 'servidor_id invalido' });
  if (!podeEditar(req.usuario, alvo)) return res.status(403).json({ erro: 'Sem permissao' });
  if (!ehData(data_inicio) || !ehData(data_fim)) return res.status(400).json({ erro: 'Informe data_inicio e data_fim no formato YYYY-MM-DD' });
  if (data_fim < data_inicio) return res.status(400).json({ erro: 'A data final deve ser igual ou posterior a inicial' });
  if (!tipo) return res.status(400).json({ erro: 'Informe o tipo do afastamento' });

  const { rows } = await db.query(
    `UPDATE afastamentos SET servidor_id = $1, data_inicio = $2, data_fim = $3, tipo = $4, observacao = $5
      WHERE id = $6 RETURNING *`,
    [alvo, data_inicio, data_fim, tipo, observacao, atual.id]
  );
  res.json({ ...rows[0], data_inicio: iso(rows[0].data_inicio), data_fim: iso(rows[0].data_fim) });
});

router.delete('/afastamentos/:id', async (req, res) => {
  if (!ehInteiro(req.params.id, { min: 1 })) return res.status(400).json({ erro: 'id invalido' });
  const { rows } = await db.query('SELECT servidor_id FROM afastamentos WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ erro: 'Afastamento nao encontrado' });
  if (!podeEditar(req.usuario, rows[0].servidor_id)) return res.status(403).json({ erro: 'Sem permissao' });
  await db.query('DELETE FROM afastamentos WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// Feriados de um ano inteiro, para a tela de gestao. Qualquer um pode ver;
// so a chefia grava ou apaga.
router.get('/feriados', async (req, res) => {
  const ano = Number(req.query.ano);
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) return res.status(400).json({ erro: 'Informe o ano com quatro digitos (ex.: 2026)' });
  const { rows } = await db.query('SELECT data, descricao FROM feriados WHERE data BETWEEN $1 AND $2 ORDER BY data', [`${ano}-01-01`, `${ano}-12-31`]);
  res.json(rows.map((f) => ({ ...f, data: iso(f.data) })));
});

router.post('/feriados', exigirChefia, async (req, res) => {
  const { data, descricao } = req.body || {};
  if (!ehData(data)) return res.status(400).json({ erro: 'Informe a data no formato YYYY-MM-DD' });
  if (!descricao || !String(descricao).trim()) return res.status(400).json({ erro: 'Informe a descricao do feriado' });
  await db.query('INSERT INTO feriados (data, descricao) VALUES ($1,$2) ON CONFLICT (data) DO UPDATE SET descricao = $2', [data, descricao]);
  res.status(201).json({ data, descricao });
});

router.delete('/feriados/:data', exigirChefia, async (req, res) => {
  if (!ehData(req.params.data)) return res.status(400).json({ erro: 'Data invalida' });
  await db.query('DELETE FROM feriados WHERE data = $1', [req.params.data]);
  res.json({ ok: true });
});

module.exports = router;
