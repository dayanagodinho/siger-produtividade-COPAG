const express = require('express');
const db = require('../db');
const { autenticar, podeEditar, exigirChefia, exigirSenhaDefinitiva } = require('../auth');
const { paraMinutos, iso } = require('../cobertura');
const { ehData, ehHora, ehInteiro } = require('../validar');
const { fotografar, registrarNovas } = require('../avisos');

const rotulo = (m) => (m === 'P' ? 'presencial' : 'à distância');
const menor = (a, b) => (a < b ? a : b);
const maior = (a, b) => (a > b ? a : b);

// Teto do repetir-semana. Acima disso e quase certo engano de data.
const MAX_SEMANAS_REPLICAR = 53;

const router = express.Router();
router.use(autenticar, exigirSenhaDefinitiva);

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
  if (!ehData(inicio) || !ehData(fim)) return res.status(400).json({ erro: 'Informe início e fim no formato YYYY-MM-DD' });
  if (fim < inicio) return res.status(400).json({ erro: 'O fim deve ser igual ou posterior ao início' });
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
  if (!podeEditar(req.usuario, alvo)) return res.status(403).json({ erro: 'Você só pode editar a sua própria escala' });
  if (!ehInteiro(alvo, { min: 1 })) return res.status(400).json({ erro: 'servidor_id inválido' });
  if (!['P', 'D'].includes(modalidade)) return res.status(400).json({ erro: 'Informe a modalidade: P (presencial) ou D (à distância)' });
  if (!ehData(data)) return res.status(400).json({ erro: `Data inválida: "${data ?? ''}". Use o formato YYYY-MM-DD` });
  if (!ehHora(inicio) || !ehHora(fim)) return res.status(400).json({ erro: `Horário inválido: "${inicio ?? ''}"–"${fim ?? ''}". Use o formato HH:MM` });
  if (paraMinutos(fim) <= paraMinutos(inicio)) return res.status(400).json({ erro: 'O fim deve ser depois do início' });

  const conflito = await db.query(
    `SELECT id FROM turnos WHERE servidor_id = $1 AND data = $2 AND $3::time < fim AND $4::time > inicio`,
    [alvo, data, inicio, fim]
  );
  if (conflito.rows.length) return res.status(409).json({ erro: 'Já existe turno seu nesse horário' });

  const antes = await fotografar(data, data);
  const { rows } = await db.query(
    `INSERT INTO turnos (servidor_id, data, inicio, fim, modalidade, observacao)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, servidor_id, data, to_char(inicio,'HH24:MI') AS inicio, to_char(fim,'HH24:MI') AS fim, modalidade, observacao`,
    [alvo, data, inicio, fim, modalidade, observacao || null]
  );
  const avisos = await registrarNovas(antes, await fotografar(data, data), { autor: req.usuario, origem: `turno ${inicio}–${fim} ${rotulo(modalidade)} lancado por ${req.usuario.nome}` });
  res.status(201).json({ ...rows[0], data: iso(rows[0].data), avisos_gerados: avisos });
});

router.delete('/turnos/:id', async (req, res) => {
  if (!ehInteiro(req.params.id, { min: 1 })) return res.status(400).json({ erro: 'id inválido' });
  const { rows } = await db.query(
    `SELECT t.servidor_id, t.data, to_char(t.inicio,'HH24:MI') AS inicio, to_char(t.fim,'HH24:MI') AS fim, t.modalidade, s.nome
       FROM turnos t JOIN servidores s ON s.id = t.servidor_id WHERE t.id = $1`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ erro: 'Turno não encontrado' });
  if (!podeEditar(req.usuario, rows[0].servidor_id)) return res.status(403).json({ erro: 'Sem permissão' });
  const t = rows[0];
  const dia = iso(t.data);
  const antes = await fotografar(dia, dia);
  await db.query('DELETE FROM turnos WHERE id = $1', [req.params.id]);
  const avisos = await registrarNovas(antes, await fotografar(dia, dia), { autor: req.usuario, origem: `turno ${t.inicio}–${t.fim} ${rotulo(t.modalidade)} de ${t.nome} removido por ${req.usuario.nome}` });
  res.json({ ok: true, avisos_gerados: avisos });
});

/**
 * Edita um turno existente. A chefia pode inclusive passar o turno para outro
 * servidor; quem nao e chefia so mexe no proprio. Sobreposicao e conferida
 * contra os OUTROS turnos da pessoa no dia, nunca contra o proprio.
 */
router.put('/turnos/:id', async (req, res) => {
  if (!ehInteiro(req.params.id, { min: 1 })) return res.status(400).json({ erro: 'id inválido' });
  const atual = (await db.query(
    `SELECT id, servidor_id, data, to_char(inicio,'HH24:MI') AS inicio, to_char(fim,'HH24:MI') AS fim, modalidade, observacao
       FROM turnos WHERE id = $1`, [req.params.id])).rows[0];
  if (!atual) return res.status(404).json({ erro: 'Turno não encontrado' });
  if (!podeEditar(req.usuario, atual.servidor_id)) return res.status(403).json({ erro: 'Sem permissão' });

  const corpo = req.body || {};
  const alvo = corpo.servidor_id ?? atual.servidor_id;
  const data = corpo.data ?? iso(atual.data);
  const inicio = corpo.inicio ?? atual.inicio;
  const fim = corpo.fim ?? atual.fim;
  const modalidade = corpo.modalidade ?? atual.modalidade;
  const observacao = corpo.observacao === undefined ? atual.observacao : (corpo.observacao || null);

  if (!ehInteiro(alvo, { min: 1 })) return res.status(400).json({ erro: 'servidor_id inválido' });
  if (!podeEditar(req.usuario, alvo)) return res.status(403).json({ erro: 'Você só pode editar a sua própria escala' });
  if (!['P', 'D'].includes(modalidade)) return res.status(400).json({ erro: 'Informe a modalidade: P (presencial) ou D (à distância)' });
  if (!ehData(data)) return res.status(400).json({ erro: `Data inválida: "${data ?? ''}". Use o formato YYYY-MM-DD` });
  if (!ehHora(inicio) || !ehHora(fim)) return res.status(400).json({ erro: `Horário inválido: "${inicio ?? ''}"–"${fim ?? ''}". Use o formato HH:MM` });
  if (paraMinutos(fim) <= paraMinutos(inicio)) return res.status(400).json({ erro: 'O fim deve ser depois do início' });

  const conflito = await db.query(
    `SELECT id FROM turnos WHERE servidor_id = $1 AND data = $2 AND id <> $5 AND $3::time < fim AND $4::time > inicio`,
    [alvo, data, inicio, fim, atual.id]
  );
  if (conflito.rows.length) return res.status(409).json({ erro: 'Já existe outro turno nesse horário' });

  const de = menor(iso(atual.data), data), ate = maior(iso(atual.data), data);
  const antes = await fotografar(de, ate);
  const { rows } = await db.query(
    `UPDATE turnos SET servidor_id = $1, data = $2, inicio = $3, fim = $4, modalidade = $5, observacao = $6
      WHERE id = $7
      RETURNING id, servidor_id, data, to_char(inicio,'HH24:MI') AS inicio, to_char(fim,'HH24:MI') AS fim, modalidade, observacao`,
    [alvo, data, inicio, fim, modalidade, observacao, atual.id]
  );
  const avisos = await registrarNovas(antes, await fotografar(de, ate), { autor: req.usuario, origem: `turno alterado por ${req.usuario.nome} para ${inicio}–${fim} ${rotulo(modalidade)} em ${data}` });
  res.json({ ...rows[0], data: iso(rows[0].data), avisos_gerados: avisos });
});

/**
 * Replica a escala de uma semana para as semanas seguintes — o padrao da
 * planilha antiga, em que a mesma semana se repete ate o fim do periodo.
 */
router.post('/replicar', async (req, res) => {
  const { semana_base, ate, servidor_id, substituir } = req.body || {};
  if (!ehData(semana_base) || !ehData(ate)) {
    return res.status(400).json({ erro: 'Informe semana_base e até no formato YYYY-MM-DD' });
  }
  const alvo = servidor_id || req.usuario.id;
  if (!ehInteiro(alvo, { min: 1 })) return res.status(400).json({ erro: 'servidor_id inválido' });
  if (!podeEditar(req.usuario, alvo)) return res.status(403).json({ erro: 'Sem permissão' });
  // Quantas semanas cabem entre a base e "ate". Sem este teto, "ate" invalido
  // ou distante demais virava laco sem fim gravando turno dentro de uma
  // transacao — o servidor travava com o cliente do banco preso.
  const semanas = Math.floor((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${semana_base}T12:00:00Z`)) / (7 * 86400000));
  if (semanas < 1) return res.status(400).json({ erro: `"até" (${ate}) precisa ser ao menos uma semana depois da semana base (${semana_base})` });
  if (semanas > MAX_SEMANAS_REPLICAR) {
    return res.status(400).json({ erro: `Sao ${semanas} semanas entre ${semana_base} e ${ate}; o máximo e ${MAX_SEMANAS_REPLICAR} (um ano). Escolha uma data mais próxima` });
  }

  const base = await db.query(
    `SELECT data, to_char(inicio,'HH24:MI') AS inicio, to_char(fim,'HH24:MI') AS fim, modalidade, observacao
       FROM turnos WHERE servidor_id = $1 AND data BETWEEN $2 AND ($2::date + 6)`,
    [alvo, semana_base]
  );
  if (!base.rows.length) return res.status(400).json({ erro: 'A semana base não tem turnos lancados' });

  const antes = await fotografar(semana_base, ate);
  let criados = 0;
  const ids = [];
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
        const novo = await cliente.query(
          `INSERT INTO turnos (servidor_id, data, inicio, fim, modalidade, observacao) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [alvo, dataStr, t.inicio, t.fim, t.modalidade, t.observacao]
        );
        ids.push(novo.rows[0].id);
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
  const avisos = await registrarNovas(antes, await fotografar(semana_base, ate), { autor: req.usuario, origem: `semana de ${semana_base} repetida até ${ate} por ${req.usuario.nome}${substituir ? ', substituindo o que havia' : ''}` });
  res.json({ ok: true, criados, semanas, ids, avisos_gerados: avisos });
});

router.post('/afastamentos', async (req, res) => {
  const { servidor_id, data_inicio, data_fim, tipo, observacao } = req.body || {};
  const alvo = servidor_id || req.usuario.id;
  if (!ehInteiro(alvo, { min: 1 })) return res.status(400).json({ erro: 'servidor_id inválido' });
  if (!podeEditar(req.usuario, alvo)) return res.status(403).json({ erro: 'Sem permissão' });
  if (!ehData(data_inicio) || !ehData(data_fim)) return res.status(400).json({ erro: 'Informe data_inicio e data_fim no formato YYYY-MM-DD' });
  if (data_fim < data_inicio) return res.status(400).json({ erro: 'A data final deve ser igual ou posterior a inicial' });
  const antes = await fotografar(data_inicio, data_fim);
  const { rows } = await db.query(
    `INSERT INTO afastamentos (servidor_id, data_inicio, data_fim, tipo, observacao)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [alvo, data_inicio, data_fim, tipo || 'Licenca', observacao || null]
  );
  const nomeAlvo = (await db.query('SELECT nome FROM servidores WHERE id = $1', [alvo])).rows[0]?.nome || 'servidor';
  const avisos = await registrarNovas(antes, await fotografar(data_inicio, data_fim), { autor: req.usuario, origem: `${tipo || 'afastamento'} de ${nomeAlvo} (${data_inicio} a ${data_fim}) registrado por ${req.usuario.nome}` });
  res.status(201).json({ ...rows[0], data_inicio: iso(rows[0].data_inicio), data_fim: iso(rows[0].data_fim), avisos_gerados: avisos });
});

router.put('/afastamentos/:id', async (req, res) => {
  if (!ehInteiro(req.params.id, { min: 1 })) return res.status(400).json({ erro: 'id inválido' });
  const atual = (await db.query('SELECT * FROM afastamentos WHERE id = $1', [req.params.id])).rows[0];
  if (!atual) return res.status(404).json({ erro: 'Afastamento não encontrado' });
  if (!podeEditar(req.usuario, atual.servidor_id)) return res.status(403).json({ erro: 'Sem permissão' });

  const corpo = req.body || {};
  const alvo = corpo.servidor_id ?? atual.servidor_id;
  const data_inicio = corpo.data_inicio ?? iso(atual.data_inicio);
  const data_fim = corpo.data_fim ?? iso(atual.data_fim);
  const tipo = corpo.tipo ? String(corpo.tipo).trim() : atual.tipo;
  const observacao = corpo.observacao === undefined ? atual.observacao : (corpo.observacao || null);

  if (!ehInteiro(alvo, { min: 1 })) return res.status(400).json({ erro: 'servidor_id inválido' });
  if (!podeEditar(req.usuario, alvo)) return res.status(403).json({ erro: 'Sem permissão' });
  if (!ehData(data_inicio) || !ehData(data_fim)) return res.status(400).json({ erro: 'Informe data_inicio e data_fim no formato YYYY-MM-DD' });
  if (data_fim < data_inicio) return res.status(400).json({ erro: 'A data final deve ser igual ou posterior a inicial' });
  if (!tipo) return res.status(400).json({ erro: 'Informe o tipo do afastamento' });

  const de = menor(iso(atual.data_inicio), data_inicio), ate = maior(iso(atual.data_fim), data_fim);
  const antes = await fotografar(de, ate);
  const { rows } = await db.query(
    `UPDATE afastamentos SET servidor_id = $1, data_inicio = $2, data_fim = $3, tipo = $4, observacao = $5
      WHERE id = $6 RETURNING *`,
    [alvo, data_inicio, data_fim, tipo, observacao, atual.id]
  );
  const avisos = await registrarNovas(antes, await fotografar(de, ate), { autor: req.usuario, origem: `afastamento alterado por ${req.usuario.nome} (${tipo}, ${data_inicio} a ${data_fim})` });
  res.json({ ...rows[0], data_inicio: iso(rows[0].data_inicio), data_fim: iso(rows[0].data_fim), avisos_gerados: avisos });
});

router.delete('/afastamentos/:id', async (req, res) => {
  if (!ehInteiro(req.params.id, { min: 1 })) return res.status(400).json({ erro: 'id inválido' });
  const { rows } = await db.query(
    'SELECT a.*, s.nome FROM afastamentos a JOIN servidores s ON s.id = a.servidor_id WHERE a.id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ erro: 'Afastamento não encontrado' });
  if (!podeEditar(req.usuario, rows[0].servidor_id)) return res.status(403).json({ erro: 'Sem permissão' });
  const a = rows[0];
  const de = iso(a.data_inicio), ate = iso(a.data_fim);
  const antes = await fotografar(de, ate);
  await db.query('DELETE FROM afastamentos WHERE id = $1', [req.params.id]);
  const avisos = await registrarNovas(antes, await fotografar(de, ate), { autor: req.usuario, origem: `${a.tipo} de ${a.nome} (${de} a ${ate}) removido por ${req.usuario.nome}` });
  res.json({ ok: true, avisos_gerados: avisos });
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
  if (!descricao || !String(descricao).trim()) return res.status(400).json({ erro: 'Informe a descrição do feriado' });
  await db.query('INSERT INTO feriados (data, descricao) VALUES ($1,$2) ON CONFLICT (data) DO UPDATE SET descricao = $2', [data, descricao]);
  res.status(201).json({ data, descricao });
});

router.delete('/feriados/:data', exigirChefia, async (req, res) => {
  if (!ehData(req.params.data)) return res.status(400).json({ erro: 'Data inválida' });
  const dia = req.params.data;
  const antes = await fotografar(dia, dia);
  await db.query('DELETE FROM feriados WHERE data = $1', [dia]);
  const avisos = await registrarNovas(antes, await fotografar(dia, dia), { autor: req.usuario, origem: `feriado de ${dia} removido por ${req.usuario.nome}; o dia voltou a exigir cobertura` });
  res.json({ ok: true, avisos_gerados: avisos });
});

module.exports = router;
