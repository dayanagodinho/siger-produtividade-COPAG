/* Escala Híbrida — interface (JavaScript puro, sem framework) */

const estado = {
  usuario: null,
  servidores: [],
  visao: 'semana',
  referencia: new Date(),
  dados: { turnos: [], afastamentos: [], feriados: [] },
  cobertura: null,
};

const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const DIAS_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const TIPOS_AFASTAMENTO = ['Férias', 'Licença médica', 'Licença', 'Capacitação', 'Folga', 'Outro'];

/* ---------------- utilitários ---------------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const deIso = (s) => new Date(`${s}T12:00:00`);
const somaDias = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const segundaDa = (d) => { const x = new Date(d); const dia = (x.getDay() + 6) % 7; return somaDias(x, -dia); };
const emMinutos = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const paraHoras = (n) => Number(n).toFixed(1).replace('.', ',');
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const escapar = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dataBonita = (s) => { const d = deIso(s); return `${DIAS_CURTO[d.getDay()]} ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`; };
const dataBr = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
const icone = (nome) => `<svg class="ic"><use href="#i-${nome}"/></svg>`;

// Dias em que há expediente (0 = domingo … 6 = sábado). Vem das regras da
// chefia; sem regra carregada, segunda a sexta. Fim de semana não entra na
// escala: as visões não o mostram e as setas do dia pulam por cima dele.
function diasUteisSemana() {
  const texto = estado.cobertura?.config?.dias_uteis;
  const lista = String(texto || '1,2,3,4,5').split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return lista.length ? lista : [1, 2, 3, 4, 5];
}
const temExpediente = (d) => diasUteisSemana().includes(d.getDay());
function proximoDiaUtil(d, sentido = 1) {
  let x = new Date(d);
  for (let i = 0; i < 7; i++) { x = somaDias(x, sentido); if (temExpediente(x)) return x; }
  return d;
}

function aviso(texto) {
  const el = $('#aviso');
  el.textContent = texto;
  el.classList.add('ver');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('ver'), 2800);
}

async function api(caminho, opcoes = {}) {
  const resposta = await fetch(`/api${caminho}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opcoes,
    body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
  });
  if (resposta.status === 401 && estado.usuario) { location.reload(); return; }
  const json = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(json.erro || 'Falha na comunicação com o servidor');
  return json;
}

const podeEditar = (servidorId) => estado.usuario.perfil === 'chefia' || Number(estado.usuario.id) === Number(servidorId);
const ehChefia = () => estado.usuario?.perfil === 'chefia';

/* ---------------- tema claro / escuro ---------------- */
function aplicarTema(tema) {
  document.documentElement.dataset.tema = tema;
  try { localStorage.setItem('escala-tema', tema); } catch { /* sem armazenamento: só nesta visita */ }
  $$('.btn-tema use').forEach((u) => u.setAttribute('href', tema === 'escuro' ? '#i-sol' : '#i-lua'));
  $$('.btn-tema').forEach((b) => { b.title = tema === 'escuro' ? 'Mudar para o tema claro' : 'Mudar para o tema escuro'; });
}
$$('.btn-tema').forEach((b) => b.addEventListener('click', () => {
  aplicarTema(document.documentElement.dataset.tema === 'escuro' ? 'claro' : 'escuro');
}));
aplicarTema(document.documentElement.dataset.tema || 'claro');

/* ---------------- login ---------------- */
$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#erro-login').textContent = '';
  try {
    estado.usuario = await api('/auth/login', { method: 'POST', corpo: { email: $('#email').value.trim(), senha: $('#senha').value } });
    iniciar();
  } catch (erro) {
    $('#erro-login').textContent = erro.message;
  }
});

$('#btn-sair').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST' }); location.reload(); });

/* ---------------- período visível ---------------- */
function intervalo() {
  const r = estado.referencia;
  if (estado.visao === 'dia') return { inicio: iso(r), fim: iso(r) };
  if (estado.visao === 'semana') { const seg = segundaDa(r); return { inicio: iso(seg), fim: iso(somaDias(seg, 6)) }; }
  const primeiro = new Date(r.getFullYear(), r.getMonth(), 1);
  const ultimo = new Date(r.getFullYear(), r.getMonth() + 1, 0);
  return { inicio: iso(segundaDa(primeiro)), fim: iso(somaDias(segundaDa(ultimo), 6)) };
}

function rotuloPeriodo() {
  const r = estado.referencia;
  if (estado.visao === 'dia') return `${DIAS_SEMANA[r.getDay()]}, ${r.getDate()} de ${MESES[r.getMonth()]} de ${r.getFullYear()}`;
  if (estado.visao === 'semana') {
    const seg = segundaDa(r), sex = somaDias(seg, 4);
    return `${seg.getDate()}/${seg.getMonth() + 1} a ${sex.getDate()}/${sex.getMonth() + 1} de ${seg.getFullYear()}`;
  }
  return `${MESES[r.getMonth()]} de ${r.getFullYear()}`;
}

/* ---------------- carregamento ---------------- */
async function carregar() {
  const { inicio, fim } = intervalo();
  const [escala, cobertura] = await Promise.all([
    api(`/escala?inicio=${inicio}&fim=${fim}`),
    api(`/cobertura?inicio=${inicio}&fim=${fim}`),
  ]);
  estado.dados = escala;
  estado.cobertura = cobertura;
  desenhar();
}

async function iniciar() {
  $('#login').classList.add('oculto');
  $('#app').classList.remove('oculto');
  estado.servidores = await api('/servidores');
  $('#quem').textContent = `${estado.usuario.nome}${ehChefia() ? ' · chefia' : ''}`;
  if (ehChefia()) { $('#btn-config').classList.remove('oculto'); $('#btn-feriados').classList.remove('oculto'); }
  await carregar();
  // Aberto num sábado ou domingo: já cai no próximo dia com expediente.
  if (!temExpediente(estado.referencia)) { estado.referencia = proximoDiaUtil(estado.referencia, 1); await carregar(); }
}

/* ---------------- navegação ---------------- */
$$('.abas button').forEach((b) => b.addEventListener('click', () => {
  $$('.abas button').forEach((x) => x.classList.remove('ativa'));
  b.classList.add('ativa');
  estado.visao = b.dataset.visao;
  carregar();
}));
$('#ant').addEventListener('click', () => { deslocar(-1); });
$('#prox').addEventListener('click', () => { deslocar(1); });
$('#hoje').addEventListener('click', () => {
  const hoje = new Date();
  estado.referencia = temExpediente(hoje) ? hoje : proximoDiaUtil(hoje, 1);
  carregar();
});
function deslocar(n) {
  const r = estado.referencia;
  if (estado.visao === 'dia') estado.referencia = proximoDiaUtil(r, n);
  else if (estado.visao === 'semana') estado.referencia = somaDias(r, 7 * n);
  else estado.referencia = new Date(r.getFullYear(), r.getMonth() + n, 1);
  carregar();
}

/* ---------------- consultas auxiliares ---------------- */
const turnosDe = (servidorId, data) => estado.dados.turnos
  .filter((t) => Number(t.servidor_id) === Number(servidorId) && t.data === data)
  .sort((a, b) => a.inicio.localeCompare(b.inicio));

const afastamentoDe = (servidorId, data) => estado.dados.afastamentos
  .find((a) => Number(a.servidor_id) === Number(servidorId) && a.data_inicio <= data && a.data_fim >= data);

const diaCobertura = (data) => estado.cobertura?.dias.find((d) => d.data === data);
const feriadoEm = (data) => estado.dados.feriados.find((f) => f.data === data);
const servidoresAtivos = () => estado.servidores.filter((s) => s.ativo !== false);

/* ---------------- barra de cobertura ----------------
   Azul = faixa com alguém presencial (mais forte com 2 ou mais); listrado
   com borda vermelha = ninguém presencial. É a mesma peça no dia, na semana
   e no mês, só muda a altura. */
function barraCobertura(dia, { alta = false } = {}) {
  if (!dia) return '';
  if (!dia.util) return `<div class="cob-vazia">${dia.feriado ? `Feriado: ${escapar(dia.feriado)}` : 'Sem expediente'}</div>`;
  let anteriorFalta = false;
  const faixas = dia.faixas.map((f) => {
    const primeira = f.descoberto && !anteriorFalta;
    anteriorFalta = f.descoberto;
    const titulo = f.descoberto
      ? `${f.inicio}–${f.fim}: ninguém presencial`
      : `${f.inicio}–${f.fim}: ${f.pessoas.join(', ')}`;
    const classe = f.descoberto ? `falta${primeira ? ' primeira' : ''}` : `ok${f.quantidade >= 2 ? ' forte' : ''}`;
    return `<div class="f ${classe}" title="${escapar(titulo)}"></div>`;
  }).join('');
  return `<div class="cob${alta ? ' alta' : ''}">${faixas}</div>`;
}

function pilulasLacunas(dia) {
  if (!dia || !dia.util) return '';
  if (!dia.lacunas.length) return `<div class="cob-ok">${icone('ok')} Alguém presencial em todas as faixas até as ${estado.cobertura.config.cobertura_fim}</div>`;
  return `<div class="lacunas">${dia.lacunas.map((l) => `<span class="lacuna">${icone('alerta')} ${l.inicio}–${l.fim} sem ninguém presencial</span>`).join('')}</div>`;
}

/* ---------------- alerta de cobertura ---------------- */
function desenharAlerta() {
  const el = $('#alerta');
  let dias = (estado.cobertura?.dias || []).filter((d) => d.util && d.lacunas.length);
  if (estado.visao === 'mes') {
    // o intervalo carregado inclui semanas vizinhas; o alerta fala só do mês exibido
    const mes = String(estado.referencia.getMonth() + 1).padStart(2, '0');
    const ano = estado.referencia.getFullYear();
    dias = dias.filter((d) => d.data.startsWith(`${ano}-${mes}`));
  }
  const cfg = estado.cobertura?.config || {};
  const min = cfg.minimo_presencial || 1;
  const avisos = (estado.cobertura?.avisos || []).length
    ? `<div style="margin-top:6px"><strong>Atenção:</strong> regra de cobertura inválida no cadastro — ${escapar(estado.cobertura.avisos.join('; '))}. Corrija em "Regras".</div>`
    : '';
  if (!dias.length) {
    el.className = avisos ? 'ruim' : 'bom';
    el.innerHTML = `${icone('ok')}<div><h3>Cobertura em ordem</h3>Todos os dias com expediente do período têm ao menos ${min} pessoa(s) presencial(is) das ${escapar(cfg.cobertura_inicio)} às ${escapar(cfg.cobertura_fim)}.${avisos}</div>`;
    return;
  }
  el.className = 'ruim';
  const itens = dias.slice(0, 15).map((d) => {
    const faixas = d.lacunas.map((l) => `${l.inicio}–${l.fim}`).join(', ');
    return `<span class="dia-link" data-dia="${d.data}">${dataBonita(d.data)} <b>${faixas}</b></span>`;
  }).join('');
  el.innerHTML = `${icone('alerta')}<div><h3>${dias.length} dia(s) com horário descoberto</h3>
    <div>Alguém precisa estar presencial das ${escapar(cfg.cobertura_inicio)} às ${escapar(cfg.cobertura_fim)}. Clique no dia para ver quem está e ajustar.</div>
    <div class="dias">${itens}${dias.length > 15 ? `<span class="dia-link" style="cursor:default">…e mais ${dias.length - 15}</span>` : ''}</div>${avisos}</div>`;
  el.querySelectorAll('.dia-link[data-dia]').forEach((s) => s.addEventListener('click', () => irParaDia(s.dataset.dia)));
}

function irParaDia(data) {
  estado.referencia = deIso(data);
  estado.visao = 'dia';
  $$('.abas button').forEach((x) => x.classList.toggle('ativa', x.dataset.visao === 'dia'));
  carregar();
}

/* ---------------- desenho ---------------- */
function desenhar() {
  $('#periodo').textContent = rotuloPeriodo();
  desenharAlerta();
  if (estado.visao === 'dia') desenharDia();
  else if (estado.visao === 'semana') desenharSemana();
  else desenharMes();
}

/* ---- visão diária: linha do tempo ---- */
function desenharDia() {
  const data = iso(estado.referencia);
  const cfg = estado.cobertura.config;
  const abre = emMinutos(cfg.cobertura_inicio), fecha = emMinutos(cfg.cobertura_fim);
  const dia = diaCobertura(data);
  const feriado = feriadoEm(data);
  const turnosDoDia = estado.dados.turnos.filter((t) => t.data === data);

  // A escala do trilho começa no expediente e se estica se alguém lançou turno
  // antes ou depois dele (ficar até mais tarde é permitido; só não é exigido).
  const menor = Math.min(abre, ...turnosDoDia.map((t) => emMinutos(t.inicio)));
  const maior = Math.max(fecha, ...turnosDoDia.map((t) => emMinutos(t.fim)));
  const ini = Math.floor(menor / 60) * 60, fim = Math.ceil(maior / 60) * 60;
  const pos = (min) => ((min - ini) / (fim - ini)) * 100;

  const grade = [];
  for (let m = ini + 60; m < fim; m += 60) grade.push(`<div class="grade${m === fecha ? ' fecha' : ''}" style="left:${pos(m)}%"></div>`);
  if (fecha % 60 !== 0) grade.push(`<div class="grade fecha" style="left:${pos(fecha)}%"></div>`);

  const linhas = servidoresAtivos().map((s) => {
    const af = afastamentoDe(s.id, data);
    const editavel = podeEditar(s.id);
    const blocos = af
      ? `<div class="bloco A${editavel ? '' : ' fixo'}" style="left:0;right:0" ${editavel ? `data-editar-af="${af.id}"` : ''} title="${escapar(af.tipo)} de ${dataBr(af.data_inicio)} a ${dataBr(af.data_fim)}${editavel ? ' — clique para alterar' : ''}">${icone('palmeira')} ${escapar(af.tipo)} · ${dataBr(af.data_inicio)} a ${dataBr(af.data_fim)}</div>`
      : turnosDe(s.id, data).map((t) => {
          const e = Math.max(0, pos(emMinutos(t.inicio)));
          const d = Math.min(100, pos(emMinutos(t.fim)));
          const rotulo = t.modalidade === 'P' ? 'presencial' : 'à distância';
          return `<div class="bloco ${t.modalidade}${editavel ? '' : ' fixo'}" style="left:${e}%;width:${Math.max(d - e, 2)}%" ${editavel ? `data-editar-turno="${t.id}"` : ''}
                    title="${t.inicio}–${t.fim} ${rotulo}${t.observacao ? ' — ' + escapar(t.observacao) : ''}${editavel ? ' (clique para alterar)' : ''}">${t.inicio}–${t.fim}</div>`;
        }).join('');
    const acao = editavel && !af ? `<button class="mais" data-novo="${s.id}|${data}">${icone('mais')}</button>` : '';
    return `<div class="rotulo"><span>${escapar(s.nome)}</span>${acao}</div><div class="faixa">${grade.join('')}${blocos}</div>`;
  }).join('');

  const reguas = [];
  for (let m = ini; m <= fim; m += 60) reguas.push(`<span style="left:${pos(m)}%">${hhmm(m)}</span>`);

  const cobertura = dia && dia.util
    ? `<div class="cob-dia">
         ${ini < abre ? `<div class="fora" style="left:0;width:${pos(abre)}%"></div>` : ''}
         <div style="position:absolute;top:0;bottom:0;left:${pos(abre)}%;width:${pos(fecha) - pos(abre)}%">${barraCobertura(dia, { alta: true })}</div>
         ${fim > fecha ? `<div class="fora" style="left:${pos(fecha)}%;right:0"></div>` : ''}
       </div>`
    : `<div class="cob-vazia">${feriado ? `Feriado: ${escapar(feriado.descricao)} — sem exigência de cobertura.` : 'Sem expediente neste dia.'}</div>`;

  const afastados = estado.dados.afastamentos.filter((a) => a.data_inicio <= data && a.data_fim >= data);
  const listaAfastados = afastados.length ? `
    <div class="cartao">
      <h2>${icone('palmeira')} Afastamentos que alcançam este dia</h2>
      <div class="lista">${afastados.map((a) => `
        <div class="item">
          <span class="data">${dataBr(a.data_inicio)}${a.data_inicio !== a.data_fim ? `<small>até ${dataBr(a.data_fim)}</small>` : ''}</span>
          <div class="cresce"><strong>${escapar(a.nome)}</strong> — ${escapar(a.tipo)}${a.observacao ? `<small>${escapar(a.observacao)}</small>` : ''}</div>
          ${podeEditar(a.servidor_id) ? `<button class="pequeno" data-editar-af="${a.id}">${icone('lapis')} Alterar</button>` : ''}
        </div>`).join('')}</div>
    </div>` : '';

  $('#conteudo').innerHTML = `
    <div class="cartao">
      <h2>${icone('calendario')} Linha do tempo — ${dataBonita(data)}${feriado ? ` <span class="chip A fixo">${escapar(feriado.descricao)}</span>` : ''}</h2>
      <p class="sub">Expediente das ${escapar(cfg.cobertura_inicio)} às ${escapar(cfg.cobertura_fim)}: alguém precisa estar presencial em todas as faixas até as ${escapar(cfg.cobertura_fim)}. Ficar depois disso é permitido, mas não é exigido.</p>
      <div class="rolagem"><div class="trilho">
        <div class="rotulo"><small>Horário</small></div><div class="reguas">${reguas.join('')}</div>
        <div class="rotulo"><span>Cobertura presencial</span></div>${cobertura}
        ${linhas}
      </div></div>
      ${pilulasLacunas(dia)}
    </div>
    ${listaAfastados}`;
  ligarBotoes();
}

/* ---- visão semanal: grade parecida com a planilha ---- */
function desenharSemana() {
  const seg = segundaDa(estado.referencia);
  const dias = Array.from({ length: 7 }, (_, i) => iso(somaDias(seg, i))).filter((d) => temExpediente(deIso(d)));
  const hoje = iso(new Date());
  const classeDia = (d) => `${d === hoje ? 'hoje' : ''} ${feriadoEm(d) ? 'feriado' : ''}`;

  const cabecalho = dias.map((d) => {
    const c = diaCobertura(d);
    const f = feriadoEm(d);
    return `<th class="${classeDia(d)}"><div class="dia-cab"><b>${dataBonita(d)}</b>${f ? `<span class="feriado-nome">${escapar(f.descricao)}</span>` : (c ? barraCobertura(c) : '')}</div></th>`;
  }).join('');

  const corpo = servidoresAtivos().map((s) => {
    let hp = 0, hd = 0;
    const editavel = podeEditar(s.id);
    const celulas = dias.map((d) => {
      const af = afastamentoDe(s.id, d);
      if (af) return `<td class="celula ${classeDia(d)}"><span class="chip A${editavel ? '' : ' fixo'}" ${editavel ? `data-editar-af="${af.id}"` : ''} title="${dataBr(af.data_inicio)} a ${dataBr(af.data_fim)}${editavel ? ' — clique para alterar' : ''}">${escapar(af.tipo)}</span></td>`;
      const chips = turnosDe(s.id, d).map((t) => {
        const h = (emMinutos(t.fim) - emMinutos(t.inicio)) / 60;
        if (!feriadoEm(d)) { if (t.modalidade === 'P') hp += h; else hd += h; }
        const x = editavel ? `<button data-apagar="${t.id}" title="Remover">✕</button>` : '';
        return `<span class="chip ${t.modalidade}${editavel ? '' : ' fixo'}" ${editavel ? `data-editar-turno="${t.id}"` : ''} title="${t.modalidade === 'P' ? 'Presencial' : 'À distância'} ${paraHoras(h)}h${t.observacao ? ' — ' + escapar(t.observacao) : ''}${editavel ? ' (clique para alterar)' : ''}">${t.inicio}–${t.fim} ${t.modalidade}${x}</span>`;
      }).join('');
      const mais = editavel ? `<button class="mais" data-novo="${s.id}|${d}" title="Novo turno">+</button>` : '';
      return `<td class="celula ${classeDia(d)}">${chips}${mais}</td>`;
    }).join('');
    const metaP = Number(s.meta_presencial_semanal ?? 20), metaD = Number(s.meta_distancia_semanal ?? 20);
    return `<tr><td class="nome">${escapar(s.nome)}</td>${celulas}
      <td class="total"><span class="${hp < metaP ? 'abaixo' : ''}">${paraHoras(hp)}</span> <span class="meta">/ ${paraHoras(metaP)}</span></td>
      <td class="total"><span class="${hd < metaD ? 'abaixo' : ''}">${paraHoras(hd)}</span> <span class="meta">/ ${paraHoras(metaD)}</span></td>
      <td class="total"><strong>${paraHoras(hp + hd)}</strong></td></tr>`;
  }).join('');

  const rodape = dias.map((d) => {
    const c = diaCobertura(d);
    if (!c || !c.util) return `<td class="${classeDia(d)}"><span class="vazio">${c?.feriado ? 'feriado' : '—'}</span></td>`;
    if (!c.lacunas.length) return `<td class="${classeDia(d)}"><span class="cob-ok" style="margin:0">${icone('ok')} coberto</span></td>`;
    return `<td class="${classeDia(d)}">${c.lacunas.map((l) => `<span class="lacuna" style="margin:1px 0">${icone('alerta')} ${l.inicio}–${l.fim}</span>`).join('<br>')}</td>`;
  }).join('');

  $('#conteudo').innerHTML = `
    <div class="cartao">
      <h2>${icone('calendario')} Escala da semana</h2>
      <p class="sub">Clique num turno para alterar, no ✕ para remover, no + para lançar. Horas contra a meta semanal de cada pessoa.</p>
      <div class="rolagem"><table>
        <thead><tr><th>Servidor</th>${cabecalho}<th>Presencial</th><th>À distância</th><th>Total</th></tr></thead>
        <tbody>${corpo}</tbody>
        <tfoot><tr><td class="nome">Cobertura</td>${rodape}<td colspan="3"></td></tr></tfoot>
      </table></div>
    </div>`;
  ligarBotoes();
}

/* ---- visão mensal: calendário só com os dias de expediente ---- */
function desenharMes() {
  const r = estado.referencia;
  const { inicio, fim } = intervalo();
  const hoje = iso(new Date());
  const uteis = diasUteisSemana();
  const celulas = [];
  for (let d = deIso(inicio); iso(d) <= fim; d = somaDias(d, 1)) {
    if (!uteis.includes(d.getDay())) continue;
    const data = iso(d);
    const c = diaCobertura(data);
    const fora = d.getMonth() !== r.getMonth();
    const presenciais = new Set(estado.dados.turnos.filter((t) => t.data === data && t.modalidade === 'P' && !afastamentoDe(t.servidor_id, data)).map((t) => t.nome));
    const distancia = new Set(estado.dados.turnos.filter((t) => t.data === data && t.modalidade === 'D' && !afastamentoDe(t.servidor_id, data)).map((t) => t.nome));
    const afastados = estado.dados.afastamentos.filter((a) => a.data_inicio <= data && a.data_fim >= data);
    const falha = c?.util && c.lacunas.length;
    const marca = c?.util
      ? (falha ? `<span class="marca-dia falha">${c.lacunas.length} lacuna(s)</span>` : `<span class="marca-dia ok">ok</span>`)
      : (c?.feriado ? `<span class="marca-dia feriado">feriado</span>` : '');
    celulas.push(`<div class="dia ${fora ? 'fora' : ''} ${c?.feriado ? 'feriado' : ''} ${falha ? 'falha' : ''} ${data === hoje ? 'hoje' : ''}" data-ir="${data}" title="${c?.feriado ? escapar(c.feriado) : 'Abrir a linha do tempo'}">
      <div class="num"><span>${d.getDate()}</span>${marca}</div>
      ${c?.util ? barraCobertura(c) : `<div style="height:19px"></div>`}
      <div class="miudo">
        ${c?.feriado ? `<div>${escapar(c.feriado)}</div>` : ''}
        ${presenciais.size ? `<div><b>${presenciais.size}</b> presencial(is)</div>` : (c?.util ? '<div class="abaixo">sem presencial</div>' : '')}
        ${distancia.size ? `<div><b>${distancia.size}</b> à distância</div>` : ''}
        ${afastados.length ? `<div>${icone('palmeira')} ${afastados.map((a) => escapar(a.nome.split(' ')[0])).join(', ')}</div>` : ''}
      </div></div>`);
  }
  const cabecalhos = uteis.map((n) => `<div class="cab">${DIAS_CURTO[n]}</div>`).join('');
  $('#conteudo').innerHTML = `
    <div class="cartao">
      <h2>${icone('calendario')} Calendário do mês</h2>
      <p class="sub">Só os dias com expediente. A barrinha de cada dia mostra a cobertura presencial; clique para abrir a linha do tempo.</p>
      <div class="mes" style="grid-template-columns:repeat(${uteis.length}, 1fr)">${cabecalhos}${celulas.join('')}</div>
    </div>
    ${desenharResumoHoras()}`;
  $$('[data-ir]').forEach((el) => el.addEventListener('click', () => irParaDia(el.dataset.ir)));
}

function desenharResumoHoras() {
  const horas = (estado.cobertura?.horas || []).sort((a, b) => a.nome.localeCompare(b.nome));
  if (!horas.length) return '';
  const linhas = horas.map((h) => `<tr><td class="nome">${escapar(h.nome)}</td><td class="total">${paraHoras(h.presencial)}</td><td class="total">${paraHoras(h.distancia)}</td><td class="total"><strong>${paraHoras(h.total)}</strong></td></tr>`).join('');
  return `<div class="cartao"><h2>Horas no período</h2><div class="rolagem"><table>
    <thead><tr><th>Servidor</th><th>Presencial</th><th>À distância</th><th>Total</th></tr></thead><tbody>${linhas}</tbody></table></div></div>`;
}

/* ---------------- ações nos elementos desenhados ---------------- */
function ligarBotoes() {
  $$('[data-novo]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const [servidorId, data] = b.dataset.novo.split('|');
    modalTurno({ servidor_id: servidorId, data });
  }));
  $$('[data-editar-turno]').forEach((el) => el.addEventListener('click', (e) => {
    if (e.target.closest('[data-apagar]')) return;
    e.stopPropagation();
    const t = estado.dados.turnos.find((x) => Number(x.id) === Number(el.dataset.editarTurno));
    if (t) modalTurno(t);
  }));
  $$('[data-editar-af]').forEach((el) => el.addEventListener('click', (e) => {
    e.stopPropagation();
    const a = estado.dados.afastamentos.find((x) => Number(x.id) === Number(el.dataset.editarAf));
    if (a) modalAfastamento(a);
  }));
  $$('[data-apagar]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm('Remover este turno?')) return;
    await api(`/escala/turnos/${b.dataset.apagar}`, { method: 'DELETE' });
    aviso('Turno removido');
    carregar();
  }));
}

/* ---------------- modais ---------------- */
function abrirModal(html, aoConfirmar, { rotuloOk = 'Salvar', extra = null, semOk = false } = {}) {
  const fundo = document.createElement('div');
  fundo.className = 'fundo-modal';
  fundo.innerHTML = `<div class="modal">${html}<p class="erro"></p>
    <div class="acoes">
      ${extra ? `<button class="${extra.classe || ''} esquerda" data-extra>${extra.rotulo}</button>` : ''}
      <button data-fechar>${semOk ? 'Fechar' : 'Cancelar'}</button>
      ${semOk ? '' : `<button class="primario" data-ok>${rotuloOk}</button>`}
    </div></div>`;
  $('#modais').appendChild(fundo);
  const fechar = () => fundo.remove();
  fundo.querySelector('[data-fechar]').addEventListener('click', fechar);
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
  const aoTeclar = (e) => { if (e.key === 'Escape') { fechar(); document.removeEventListener('keydown', aoTeclar); } };
  document.addEventListener('keydown', aoTeclar);
  const rodar = async (botao, acao) => {
    botao.disabled = true;
    try {
      await acao(fundo);
      fechar();
      carregar();
    } catch (erro) {
      fundo.querySelector('.erro').textContent = erro.message;
      botao.disabled = false;
    }
  };
  if (!semOk) fundo.querySelector('[data-ok]').addEventListener('click', (e) => rodar(e.currentTarget, aoConfirmar));
  if (extra) fundo.querySelector('[data-extra]').addEventListener('click', (e) => rodar(e.currentTarget, extra.acao));
  const primeiro = fundo.querySelector('input, select');
  if (primeiro) primeiro.focus();
  return fundo;
}

function opcoesServidores(selecionado) {
  const lista = ehChefia() ? estado.servidores : estado.servidores.filter((s) => Number(s.id) === Number(estado.usuario.id));
  return lista.map((s) => `<option value="${s.id}" ${Number(s.id) === Number(selecionado) ? 'selected' : ''}>${escapar(s.nome)}</option>`).join('');
}

function modalTurno(t) {
  const editando = Boolean(t.id);
  const v = (campo) => f.querySelector(campo).value;
  let f;
  f = abrirModal(`<h2>${editando ? 'Alterar turno' : 'Novo turno'}</h2>
    <p class="sub">${editando ? `Lançado para ${escapar(t.nome || '')} em ${dataBonita(t.data)}.` : 'Um dia pode ter mais de um turno, por exemplo manhã presencial e tarde à distância.'}</p>
    <label>Servidor</label><select id="m-servidor">${opcoesServidores(t.servidor_id)}</select>
    <label>Data</label><input id="m-data" type="date" value="${t.data}">
    <div class="dupla"><div><label>Início</label><input id="m-inicio" type="time" value="${t.inicio || '08:00'}" step="900"></div>
      <div><label>Fim</label><input id="m-fim" type="time" value="${t.fim || '14:00'}" step="900"></div></div>
    <label>Modalidade</label>
    <div class="opcoes">
      <label><input type="radio" name="m-mod" value="P" ${(t.modalidade || 'P') === 'P' ? 'checked' : ''}><span>Presencial</span></label>
      <label><input type="radio" name="m-mod" value="D" ${t.modalidade === 'D' ? 'checked' : ''}><span>À distância</span></label>
    </div>
    <label>Observação (opcional)</label><input id="m-obs" type="text" value="${escapar(t.observacao || '')}" placeholder="ex.: reunião de equipe">`,
    async () => {
      const corpo = {
        servidor_id: Number(v('#m-servidor')),
        data: v('#m-data'),
        inicio: v('#m-inicio'),
        fim: v('#m-fim'),
        modalidade: f.querySelector('input[name="m-mod"]:checked').value,
        observacao: v('#m-obs') || null,
      };
      if (editando) { await api(`/escala/turnos/${t.id}`, { method: 'PUT', corpo }); aviso('Turno alterado'); }
      else { await api('/escala/turnos', { method: 'POST', corpo }); aviso('Turno lançado'); }
    },
    editando ? { extra: { rotulo: 'Excluir', classe: 'perigo', acao: async () => {
      await api(`/escala/turnos/${t.id}`, { method: 'DELETE' }); aviso('Turno removido');
    } } } : {});
}

function modalAfastamento(a) {
  const editando = Boolean(a.id);
  let f;
  const v = (campo) => f.querySelector(campo).value;
  const tipos = TIPOS_AFASTAMENTO.includes(a.tipo) || !a.tipo ? TIPOS_AFASTAMENTO : [a.tipo, ...TIPOS_AFASTAMENTO];
  f = abrirModal(`<h2>${editando ? 'Alterar afastamento' : 'Férias ou afastamento'}</h2>
    <p class="sub">Nos dias marcados a pessoa sai da cobertura, e o alerta mostra na hora quem precisa cobrir.</p>
    <label>Servidor</label><select id="a-servidor">${opcoesServidores(a.servidor_id)}</select>
    <label>Tipo</label>
    <div class="opcoes">${tipos.map((tipo) => `<label><input type="radio" name="a-tipo" value="${escapar(tipo)}" ${(a.tipo || 'Férias') === tipo ? 'checked' : ''}><span>${escapar(tipo)}</span></label>`).join('')}</div>
    <div class="dupla"><div><label>De</label><input id="a-inicio" type="date" value="${a.data_inicio}"></div>
      <div><label>Até</label><input id="a-fim" type="date" value="${a.data_fim}"></div></div>
    <label>Observação (opcional)</label><input id="a-obs" type="text" value="${escapar(a.observacao || '')}">`,
    async () => {
      const corpo = {
        servidor_id: Number(v('#a-servidor')),
        data_inicio: v('#a-inicio'),
        data_fim: v('#a-fim'),
        tipo: f.querySelector('input[name="a-tipo"]:checked').value,
        observacao: v('#a-obs') || null,
      };
      if (editando) { await api(`/escala/afastamentos/${a.id}`, { method: 'PUT', corpo }); aviso('Afastamento alterado'); }
      else { await api('/escala/afastamentos', { method: 'POST', corpo }); aviso('Afastamento registrado'); }
    },
    editando ? { extra: { rotulo: 'Excluir', classe: 'perigo', acao: async () => {
      await api(`/escala/afastamentos/${a.id}`, { method: 'DELETE' }); aviso('Afastamento removido');
    } } } : {});
}

$('#btn-turno').addEventListener('click', () => modalTurno({ servidor_id: estado.usuario.id, data: iso(estado.referencia) }));
$('#btn-afastamento').addEventListener('click', () => {
  const d = iso(estado.referencia);
  modalAfastamento({ servidor_id: estado.usuario.id, data_inicio: d, data_fim: d, tipo: 'Férias' });
});

$('#btn-replicar').addEventListener('click', () => {
  const seg = iso(segundaDa(estado.referencia));
  const ate = iso(somaDias(segundaDa(estado.referencia), 7 * 8 - 3));
  abrirModal(`<h2>Repetir semana</h2>
    <p class="sub">Copia os turnos de uma semana para as semanas seguintes, como na planilha antiga.</p>
    <label>Servidor</label><select id="r-servidor">${opcoesServidores(estado.usuario.id)}</select>
    <label>Semana base (segunda-feira)</label><input id="r-base" type="date" value="${seg}">
    <label>Repetir até</label><input id="r-ate" type="date" value="${ate}">
    <label style="display:flex;align-items:center;gap:8px;margin-top:14px;font-weight:500;color:var(--texto)">
      <input id="r-substituir" type="checkbox"> Apagar o que já existir nos dias copiados</label>`,
    async (f) => {
      const r = await api('/escala/replicar', { method: 'POST', corpo: {
        servidor_id: Number(f.querySelector('#r-servidor').value),
        semana_base: f.querySelector('#r-base').value,
        ate: f.querySelector('#r-ate').value,
        substituir: f.querySelector('#r-substituir').checked,
      }});
      aviso(`${r.criados} turno(s) criado(s)`);
    }, { rotuloOk: 'Repetir' });
});

$('#btn-senha').addEventListener('click', () => {
  abrirModal(`<h2>Trocar senha</h2>
    <label>Senha atual</label><input id="s-atual" type="password" autocomplete="current-password">
    <label>Nova senha (mínimo 6 caracteres)</label><input id="s-nova" type="password" autocomplete="new-password">`,
    async (f) => {
      await api('/auth/senha', { method: 'POST', corpo: { senha_atual: f.querySelector('#s-atual').value, senha_nova: f.querySelector('#s-nova').value } });
      aviso('Senha alterada');
    });
});

$('#btn-config').addEventListener('click', async () => {
  const c = await api('/cobertura/config');
  abrirModal(`<h2>Regras de cobertura</h2>
    <p class="sub">O alerta avisa toda faixa do expediente em que ninguém está presencial.</p>
    <div class="dupla"><div><label>Expediente começa</label><input id="c-ini" type="time" value="${escapar(c.cobertura_inicio)}"></div>
      <div><label>Alguém presencial até</label><input id="c-fim" type="time" value="${escapar(c.cobertura_fim)}"></div></div>
    <label>Mínimo de pessoas presenciais em cada faixa</label><input id="c-min" type="number" min="1" max="100" value="${escapar(c.minimo_presencial)}">
    <label>Tamanho da faixa analisada (minutos)</label><input id="c-gran" type="number" min="5" max="240" step="5" value="${escapar(c.granularidade_min)}">
    <label>Dias com expediente (0=domingo … 6=sábado)</label><input id="c-dias" type="text" value="${escapar(c.dias_uteis)}">
    <p class="nota">Ficar depois do horário final é permitido; só não é exigido. Sábado e domingo ficam fora da escala enquanto não estiverem na lista de dias.</p>`,
    async (f) => {
      await api('/cobertura/config', { method: 'PUT', corpo: {
        cobertura_inicio: f.querySelector('#c-ini').value,
        cobertura_fim: f.querySelector('#c-fim').value,
        minimo_presencial: f.querySelector('#c-min').value,
        granularidade_min: f.querySelector('#c-gran').value,
        dias_uteis: f.querySelector('#c-dias').value,
      }});
      aviso('Regras atualizadas');
    });
});

/* ---- feriados: lista do ano, com inclusão e remoção (só chefia) ---- */
$('#btn-feriados').addEventListener('click', () => modalFeriados(estado.referencia.getFullYear()));

async function modalFeriados(ano) {
  const lista = await api(`/escala/feriados?ano=${ano}`);
  const itens = lista.length
    ? lista.map((f) => `<div class="item"><span class="data">${dataBonita(f.data)}</span><div class="cresce">${escapar(f.descricao)}</div>
        <button class="pequeno perigo" data-apagar-feriado="${f.data}" title="Remover">✕</button></div>`).join('')
    : '<p class="vazio">Nenhum feriado cadastrado neste ano.</p>';
  const fundo = abrirModal(`<h2>Feriados de ${ano}</h2>
    <p class="sub">Em feriado não há exigência de cobertura e as horas não contam. Os nacionais de 2026 já vieram carregados; apague o que não valer para o setor e inclua os locais.</p>
    <div style="display:flex;gap:6px;margin:6px 0 10px"><button class="pequeno" data-ano="${ano - 1}">‹ ${ano - 1}</button><span class="espaco"></span><button class="pequeno" data-ano="${ano + 1}">${ano + 1} ›</button></div>
    <div class="lista">${itens}</div>
    <div class="dupla" style="margin-top:14px"><div><label>Novo feriado</label><input id="f-data" type="date" value="${ano}-01-01"></div>
      <div><label>Descrição</label><input id="f-desc" type="text" placeholder="ex.: Aniversário da cidade"></div></div>`,
    async (f) => {
      const data = f.querySelector('#f-data').value, descricao = f.querySelector('#f-desc').value.trim();
      await api('/escala/feriados', { method: 'POST', corpo: { data, descricao } });
      aviso('Feriado incluído');
    }, { rotuloOk: 'Incluir feriado' });
  fundo.querySelectorAll('[data-apagar-feriado]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Remover este feriado? O dia volta a exigir cobertura.')) return;
    try {
      await api(`/escala/feriados/${b.dataset.apagarFeriado}`, { method: 'DELETE' });
      aviso('Feriado removido');
      fundo.remove();
      await carregar();
      modalFeriados(ano);
    } catch (erro) { fundo.querySelector('.erro').textContent = erro.message; }
  }));
  fundo.querySelectorAll('[data-ano]').forEach((b) => b.addEventListener('click', () => { fundo.remove(); modalFeriados(Number(b.dataset.ano)); }));
}

/* ---------------- entrada ---------------- */
(async () => {
  try {
    estado.usuario = await api('/auth/eu');
    if (estado.usuario) iniciar();
  } catch { /* sem sessão: mostra o login */ }
})();
