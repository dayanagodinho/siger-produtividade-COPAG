const { ehHora, ehInteiro, diasUteisOuNulo } = require('./validar');

// Motor de analise de cobertura: descobre as faixas de horario em que o
// atendimento presencial fica sem ninguem (ou abaixo do minimo exigido).

function paraMinutos(hhmm) {
  const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number);
  return h * 60 + (m || 0);
}
function paraHora(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}
function iso(data) {
  return data instanceof Date ? data.toISOString().slice(0, 10) : String(data).slice(0, 10);
}
function diaDaSemana(dataIso) {
  // 0 = domingo ... 6 = sabado, sempre em horario local neutro (UTC)
  return new Date(`${dataIso}T12:00:00Z`).getUTCDay();
}
function listarDias(inicio, fim) {
  const dias = [];
  const d = new Date(`${inicio}T12:00:00Z`);
  const ate = new Date(`${fim}T12:00:00Z`);
  while (d <= ate) {
    dias.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dias;
}

/**
 * @param {Object} p
 * @param {string} p.inicio            data inicial (YYYY-MM-DD)
 * @param {string} p.fim               data final (YYYY-MM-DD)
 * @param {Array}  p.turnos            [{servidor_id, nome, data, inicio, fim, modalidade}]
 * @param {Array}  p.afastamentos      [{servidor_id, nome, data_inicio, data_fim, tipo}]
 * @param {Array}  p.feriados          [{data, descricao}]
 * @param {Object} p.config            {cobertura_inicio, cobertura_fim, minimo_presencial, granularidade_min, dias_uteis}
 * @returns {Array} um objeto por dia util, com as lacunas encontradas
 */
const CONFIG_PADRAO = Object.freeze({
  cobertura_inicio: '07:00',
  cobertura_fim: '19:00',
  minimo_presencial: '1',
  granularidade_min: '30',
  dias_uteis: '1,2,3,4,5',
});

/**
 * Le a configuracao guardada e devolve numeros seguros. Valor invalido cai no
 * padrao E entra em `avisos` — nunca some calado.
 *
 * O caso: granularidade "abc" fazia `for (m = abre; m < fecha; m += NaN)`
 * rodar zero vezes, e o painel dizia "cobertura em ordem" com zero dias uteis.
 * Zero e a resposta errada mais facil de acreditar.
 */
function interpretarConfig(config) {
  const c = { ...CONFIG_PADRAO, ...(config || {}) };
  const avisos = [];
  const usarPadrao = (chave, motivo) => {
    avisos.push(`${chave}="${c[chave]}" ${motivo}; usando o padrao ${CONFIG_PADRAO[chave]}`);
    c[chave] = CONFIG_PADRAO[chave];
  };

  if (!ehHora(c.cobertura_inicio)) usarPadrao('cobertura_inicio', 'nao e hora HH:MM');
  if (!ehHora(c.cobertura_fim)) usarPadrao('cobertura_fim', 'nao e hora HH:MM');
  if (paraMinutos(c.cobertura_fim) <= paraMinutos(c.cobertura_inicio)) {
    usarPadrao('cobertura_inicio', 'nao vem antes do fim');
    usarPadrao('cobertura_fim', 'nao vem depois do inicio');
  }
  if (!ehInteiro(c.minimo_presencial, { min: 1, max: 100 })) usarPadrao('minimo_presencial', 'nao e inteiro entre 1 e 100');
  if (!ehInteiro(c.granularidade_min, { min: 5, max: 240 })) usarPadrao('granularidade_min', 'nao e inteiro entre 5 e 240');
  if (!diasUteisOuNulo(c.dias_uteis)) usarPadrao('dias_uteis', 'nao e lista de dias 0..6');

  return {
    abre: paraMinutos(c.cobertura_inicio),
    fecha: paraMinutos(c.cobertura_fim),
    minimo: Number(c.minimo_presencial),
    passo: Number(c.granularidade_min),
    diasUteis: diasUteisOuNulo(c.dias_uteis),
    config: c,
    avisos,
  };
}

function analisarCobertura({ inicio, fim, turnos, afastamentos, feriados, config }) {
  const { abre, fecha, minimo, passo, diasUteis } = interpretarConfig(config);
  const mapaFeriados = new Map((feriados || []).map((f) => [iso(f.data), f.descricao]));

  const turnosPorDia = new Map();
  for (const t of turnos) {
    const dia = iso(t.data);
    if (!turnosPorDia.has(dia)) turnosPorDia.set(dia, []);
    turnosPorDia.get(dia).push(t);
  }

  const afastadoEm = (servidorId, dia) =>
    (afastamentos || []).some(
      (a) => Number(a.servidor_id) === Number(servidorId) && iso(a.data_inicio) <= dia && iso(a.data_fim) >= dia
    );

  const resultado = [];

  for (const dia of listarDias(inicio, fim)) {
    const feriado = mapaFeriados.get(dia);
    const util = diasUteis.includes(diaDaSemana(dia)) && !feriado;
    const doDia = (turnosPorDia.get(dia) || []).filter((t) => !afastadoEm(t.servidor_id, dia));
    const presenciais = doDia.filter((t) => t.modalidade === 'P');

    if (!util) {
      resultado.push({ data: dia, util: false, feriado: feriado || null, lacunas: [], faixas: [], presentes: [] });
      continue;
    }

    const faixas = [];
    for (let m = abre; m < fecha; m += passo) {
      const dentro = presenciais.filter((t) => paraMinutos(t.inicio) <= m && paraMinutos(t.fim) > m);
      faixas.push({
        inicio: paraHora(m),
        fim: paraHora(Math.min(m + passo, fecha)),
        quantidade: dentro.length,
        pessoas: dentro.map((t) => t.nome),
        descoberto: dentro.length < minimo,
      });
    }

    // Junta faixas descobertas consecutivas em um unico intervalo
    const lacunas = [];
    let atual = null;
    for (const f of faixas) {
      if (f.descoberto) {
        if (atual) atual.fim = f.fim;
        else atual = { inicio: f.inicio, fim: f.fim, quantidade: f.quantidade };
        atual.quantidade = Math.min(atual.quantidade, f.quantidade);
      } else if (atual) {
        lacunas.push(atual);
        atual = null;
      }
    }
    if (atual) lacunas.push(atual);

    const presentes = [...new Map(presenciais.map((t) => [t.servidor_id, t.nome])).entries()].map(
      ([id, nome]) => ({ servidor_id: id, nome })
    );

    resultado.push({ data: dia, util: true, feriado: null, minimo, lacunas, faixas, presentes });
  }

  return resultado;
}

/**
 * Soma de horas por servidor e modalidade no periodo. Turno em dia de
 * afastamento nao conta — a grade semanal ja nao contava, e a tabela do mes
 * contava: dois numeros diferentes para a mesma pessoa na mesma semana.
 */
function totalizarHoras(turnos, afastamentos = []) {
  const afastadoEm = (servidorId, dia) =>
    afastamentos.some(
      (a) => Number(a.servidor_id) === Number(servidorId) && iso(a.data_inicio) <= dia && iso(a.data_fim) >= dia
    );
  const mapa = new Map();
  for (const t of turnos) {
    if (afastadoEm(t.servidor_id, iso(t.data))) continue;
    const horas = (paraMinutos(t.fim) - paraMinutos(t.inicio)) / 60;
    if (!Number.isFinite(horas)) continue; // hora quebrada nao contamina a soma
    const chave = Number(t.servidor_id);
    if (!mapa.has(chave)) mapa.set(chave, { servidor_id: chave, nome: t.nome, presencial: 0, distancia: 0, total: 0 });
    const item = mapa.get(chave);
    if (t.modalidade === 'P') item.presencial += horas;
    else item.distancia += horas;
    item.total += horas;
  }
  return [...mapa.values()].map((i) => ({
    ...i,
    presencial: Number(i.presencial.toFixed(2)),
    distancia: Number(i.distancia.toFixed(2)),
    total: Number(i.total.toFixed(2)),
  }));
}

module.exports = { analisarCobertura, totalizarHoras, interpretarConfig, CONFIG_PADRAO, paraMinutos, paraHora, listarDias, diaDaSemana, iso };
