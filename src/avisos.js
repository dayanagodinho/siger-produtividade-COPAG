const db = require('./db');
const { analisarCobertura, iso } = require('./cobertura');
const { ehEmail } = require('./validar');
const { enviarEmail } = require('./email');

// Avisos para a chefia: toda mudanca na escala (turno, afastamento, feriado,
// regra) e fotografada antes e depois. Se depois existe faixa sem presencial
// que antes nao existia, entra um aviso por dia, com quem fez e o que fez.
// A chefia ve no painel e, se o Railway tiver RESEND_API_KEY, recebe e-mail.

const DIAS_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
const dataBonita = (d) => {
  const x = new Date(`${d}T12:00:00Z`);
  return `${DIAS_CURTO[x.getUTCDay()]} ${d.slice(8, 10)}/${d.slice(5, 7)}`;
};

async function lerConfig() {
  const { rows } = await db.query('SELECT chave, valor FROM config');
  return Object.fromEntries(rows.map((r) => [r.chave, r.valor]));
}

/** Lacunas por dia util no intervalo: Map data -> [{inicio, fim}]. */
async function fotografar(inicio, fim) {
  const [config, turnos, afastamentos, feriados] = await Promise.all([
    lerConfig(),
    db.query(
      `SELECT t.servidor_id, s.nome, t.data, to_char(t.inicio,'HH24:MI') AS inicio,
              to_char(t.fim,'HH24:MI') AS fim, t.modalidade
         FROM turnos t JOIN servidores s ON s.id = t.servidor_id
        WHERE t.data BETWEEN $1 AND $2 AND s.ativo`,
      [inicio, fim]
    ),
    db.query('SELECT servidor_id, data_inicio, data_fim FROM afastamentos WHERE data_inicio <= $2 AND data_fim >= $1', [inicio, fim]),
    db.query('SELECT data, descricao FROM feriados WHERE data BETWEEN $1 AND $2', [inicio, fim]),
  ]);
  const dias = analisarCobertura({
    inicio, fim,
    turnos: turnos.rows.map((t) => ({ ...t, data: iso(t.data) })),
    afastamentos: afastamentos.rows,
    feriados: feriados.rows,
    config,
  });
  return new Map(dias.filter((d) => d.util).map((d) => [d.data, d.lacunas.map((l) => ({ inicio: l.inicio, fim: l.fim }))]));
}

/**
 * Compara duas fotografias. Uma faixa e "nova" quando nenhuma faixa do mesmo
 * dia, antes, a continha inteira. Dia que nao existia antes (virou util agora,
 * ex.: feriado removido) conta tudo como novo.
 * @returns {Array<{data: string, faixas: string[]}>}
 */
function novasLacunas(antes, depois) {
  const novas = [];
  for (const [data, lacunas] of depois) {
    const anteriores = antes.get(data) || [];
    const faixas = lacunas
      .filter((l) => !anteriores.some((a) => a.inicio <= l.inicio && a.fim >= l.fim))
      .map((l) => `${l.inicio}–${l.fim}`);
    if (faixas.length) novas.push({ data, faixas });
  }
  return novas.sort((a, b) => a.data.localeCompare(b.data));
}

/**
 * O que fazer com um aviso pendente depois de uma mudanca no dia dele:
 * - dia sem lacuna (ou que deixou de ser util): 'resolver';
 * - lacunas diferentes das do texto: 'atualizar', com a mensagem nova;
 * - igual: 'manter'.
 * Puro, para o teste. `lacunas` e o que a fotografia "depois" tem para o dia
 * (undefined quando o dia nao e mais util).
 */
function classificarPendente(aviso, lacunas) {
  if (!lacunas || !lacunas.length) return { acao: 'resolver' };
  const mensagem = `${dataBonita(aviso.data)} ficou sem ninguém presencial em ${lacunas.map((l) => `${l.inicio}–${l.fim}`).join(', ')}`;
  return mensagem === aviso.mensagem ? { acao: 'manter' } : { acao: 'atualizar', mensagem };
}

// Avisos pendentes dos dias tocados pela mudanca acompanham a escala: dia
// que ficou coberto resolve o aviso; furo que mudou de horario atualiza o
// texto. Sem isso o aviso dizia "descoberto" depois de alguem ter coberto.
async function atualizarPendentes(antes, depois) {
  const dias = [...new Set([...antes.keys(), ...depois.keys()])];
  if (!dias.length) return { resolvidos: 0, atualizados: 0 };
  const { rows } = await db.query(
    'SELECT id, data, mensagem FROM avisos WHERE NOT lido AND resolvido_em IS NULL AND data = ANY($1::date[])', [dias]);
  let resolvidos = 0, atualizados = 0;
  for (const av of rows) {
    const r = classificarPendente({ ...av, data: iso(av.data) }, depois.get(iso(av.data)));
    if (r.acao === 'resolver') { await db.query('UPDATE avisos SET resolvido_em = now(), lido = TRUE WHERE id = $1', [av.id]); resolvidos++; }
    else if (r.acao === 'atualizar') { await db.query('UPDATE avisos SET mensagem = $2 WHERE id = $1', [av.id, r.mensagem]); atualizados++; }
  }
  return { resolvidos, atualizados };
}

async function registrarNovas(antes, depois, { autor, origem }) {
  await atualizarPendentes(antes, depois);
  const novas = novasLacunas(antes, depois);
  const avisos = [];
  for (const n of novas) {
    const mensagem = `${dataBonita(n.data)} ficou sem ninguém presencial em ${n.faixas.join(', ')}`;
    const { rows } = await db.query(
      `INSERT INTO avisos (data, mensagem, origem, autor_id) VALUES ($1,$2,$3,$4)
       RETURNING id, criado_em, data, mensagem, origem, autor_id, lido`,
      [n.data, mensagem, origem || null, autor?.id || null]
    );
    avisos.push({ ...rows[0], data: iso(rows[0].data) });
  }
  if (avisos.length) notificarChefia(avisos, origem).catch((e) => console.error('Falha ao avisar a chefia por e-mail:', e.message));
  return avisos;
}

/** Fotografa, roda a mutacao, fotografa de novo e registra o que abriu. */
async function vigiar({ inicio, fim, autor, origem }, mutacao) {
  const antes = await fotografar(inicio, fim);
  const resultado = await mutacao();
  const avisos = await registrarNovas(antes, await fotografar(inicio, fim), { autor, origem });
  return { resultado, avisos };
}

// E-mail so para chefia ativa cujo login e um e-mail de verdade; quem entra
// por nome de usuario ve o aviso no painel.
async function notificarChefia(avisos, origem) {
  const { rows } = await db.query("SELECT email FROM servidores WHERE perfil = 'chefia' AND ativo");
  const para = rows.map((r) => r.email).filter((e) => ehEmail(e));
  if (!para.length) return { enviado: false, motivo: 'nenhuma chefia com e-mail' };
  const linhas = avisos.map((a) => `- ${a.mensagem}`).join('\n');
  return enviarEmail({
    para,
    assunto: `Escala Híbrida: ${avisos.length} dia(s) com horário descoberto`,
    texto: `A escala mudou e abriu horário sem ninguém presencial.\n\nO que mudou: ${origem || 'alteracao na escala'}\n\n${linhas}\n\nAbra o sistema para ver quem está e ajustar.`,
  });
}

module.exports = { fotografar, novasLacunas, classificarPendente, atualizarPendentes, registrarNovas, vigiar, notificarChefia, dataBonita };
