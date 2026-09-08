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

/* ---------------- utilitários ---------------- */
const $ = (sel) => document.querySelector(sel);
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const deIso = (s) => new Date(`${s}T12:00:00`);
const somaDias = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const segundaDa = (d) => { const x = new Date(d); const dia = (x.getDay() + 6) % 7; return somaDias(x, -dia); };
const emMinutos = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const paraHoras = (n) => Number(n).toFixed(1).replace('.', ',');
const escapar = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dataBonita = (s) => { const d = deIso(s); return `${DIAS_CURTO[d.getDay()]} ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`; };

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
  $('#quem').textContent = `${estado.usuario.nome}${estado.usuario.perfil === 'chefia' ? ' (chefia)' : ''}`;
  if (estado.usuario.perfil === 'chefia') $('#btn-config').classList.remove('oculto');
  await carregar();
}

/* ---------------- navegação ---------------- */
document.querySelectorAll('.abas button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.abas button').forEach((x) => x.classList.remove('ativa'));
  b.classList.add('ativa');
  estado.visao = b.dataset.visao;
  carregar();
}));
$('#ant').addEventListener('click', () => { deslocar(-1); });
$('#prox').addEventListener('click', () => { deslocar(1); });
$('#hoje').addEventListener('click', () => { estado.referencia = new Date(); carregar(); });
function deslocar(n) {
  const r = estado.referencia;
  if (estado.visao === 'dia') estado.referencia = somaDias(r, n);
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

/* ---------------- alerta de cobertura ---------------- */
function desenharAlerta() {
  const el = $('#alerta');
  let dias = (estado.cobertura?.dias || []).filter((d) => d.util && d.lacunas.length);
  if (estado.visao === 'mes') {
    // o intervalo carregado inclui semanas vizinhas; o alerta fala so do mes exibido
    const mes = String(estado.referencia.getMonth() + 1).padStart(2, '0');
    const ano = estado.referencia.getFullYear();
    dias = dias.filter((d) => d.data.startsWith(`${ano}-${mes}`));
  }
  const min = estado.cobertura?.config?.minimo_presencial || 1;
  const avisos = (estado.cobertura?.avisos || []).length
    ? `<div style="margin-top:6px"><strong>Atenção:</strong> regra de cobertura inválida no cadastro — ${escapar(estado.cobertura.avisos.join('; '))}. Corrija em "Configurações".</div>`
    : '';
  if (!dias.length) {
    el.className = avisos ? 'ruim' : 'bom';
    el.innerHTML = `<h3>Cobertura em ordem</h3>Todos os dias úteis do período têm ao menos ${min} pessoa(s) presencial(is) em cada faixa de horário.${avisos}`;
    return;
  }
  el.className = 'ruim';
  const itens = dias.slice(0, 12).map((d) => {
    const faixas = d.lacunas.map((l) => `${l.inicio}–${l.fim}`).join(', ');
    return `<li><span class="dia-link" data-dia="${d.data}">${dataBonita(d.data)}</span>: sem presencial em <strong>${faixas}</strong></li>`;
  }).join('');
  el.innerHTML = `<h3>⚠️ ${dias.length} dia(s) com horário descoberto</h3>
    <div>Faixas sem o mínimo de ${min} pessoa(s) presencial(is), considerando o expediente das ${estado.cobertura.config.cobertura_inicio} às ${estado.cobertura.config.cobertura_fim}.</div>
    <ul>${itens}</ul>${dias.length > 12 ? `<div style="margin-top:6px">…e mais ${dias.length - 12} dia(s).</div>` : ''}${avisos}`;
  el.querySelectorAll('.dia-link').forEach((s) => s.addEventListener('click', () => irParaDia(s.dataset.dia)));
}

function irParaDia(data) {
  estado.referencia = deIso(data);
  estado.visao = 'dia';
  document.querySelectorAll('.abas button').forEach((x) => x.classList.toggle('ativa', x.dataset.visao === 'dia'));
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
  const largura = (min) => ((min - abre) / (fecha - abre)) * 100;
  const dia = diaCobertura(data);

  const linhas = estado.servidores.filter((s) => s.ativo !== false).map((s) => {
    const af = afastamentoDe(s.id, data);
    const blocos = af
      ? `<div class="bloco A" style="left:0;right:0">${escapar(af.tipo)}</div>`
      : turnosDe(s.id, data).map((t) => {
          const e = Math.max(0, largura(emMinutos(t.inicio)));
          const d = Math.min(100, largura(emMinutos(t.fim)));
          return `<div class="bloco ${t.modalidade}" style="left:${e}%;width:${Math.max(d - e, 1.5)}%"
                    title="${t.inicio}–${t.fim} ${t.modalidade === 'P' ? 'presencial' : 'à distância'}">${t.inicio}–${t.fim}</div>`;
        }).join('');
    const acao = podeEditar(s.id) && !af ? `<button class="mais" data-novo="${s.id}|${data}">+ turno</button>` : '';
    return `<div class="rotulo">${escapar(s.nome)} ${acao}</div><div class="faixa">${blocos}</div>`;
  }).join('');

  const horas = [];
  for (let m = abre; m < fecha; m += 60) horas.push(`<div style="flex:1">${String(Math.floor(m / 60)).padStart(2, '0')}h</div>`);
  const rotuloFim = `<div style="position:absolute;right:0;top:0">${String(Math.floor(fecha / 60)).padStart(2, '0')}h</div>`;

  const barraCobertura = dia && dia.util
    ? `<div class="cobertura">${dia.faixas.map((f) => `<div class="${f.descoberto ? 'falta' : 'ok'}" title="${f.inicio}–${f.fim}: ${f.quantidade} presencial(is)${f.pessoas.length ? ' — ' + f.pessoas.join(', ') : ''}"></div>`).join('')}</div>`
    : '<div style="color:var(--suave);font-size:13px">Dia não útil (fim de semana ou feriado) — sem exigência de cobertura.</div>';

  const lista = turnosDe(estado.usuario.id, data).map((t) =>
    `<span class="chip ${t.modalidade}">${t.inicio}–${t.fim} ${t.modalidade}<button data-apagar="${t.id}" title="Remover">✕</button></span>`).join('') || '<span style="color:var(--suave);font-size:13px">Você ainda não lançou turnos neste dia.</span>';

  $('#conteudo').innerHTML = `
    <div class="cartao">
      <h2>Linha do tempo — ${dataBonita(data)}</h2>
      <div class="linha-tempo">
        <div class="tt" style="grid-template-columns:190px 1fr">${linhas}</div>
        <div style="display:grid;grid-template-columns:190px 1fr;margin-top:8px">
          <div></div><div class="reguas" style="display:flex;position:relative">${horas.join('')}${rotuloFim}</div>
        </div>
        <div style="display:grid;grid-template-columns:190px 1fr;margin-top:10px;align-items:center">
          <div style="font-size:12px;color:var(--suave)">Cobertura presencial</div><div>${barraCobertura}</div>
        </div>
      </div>
    </div>
    <div class="cartao">
      <h2>Minha escala neste dia</h2>
      <div>${lista}</div>
      <button class="primario" style="margin-top:12px" data-novo="${estado.usuario.id}|${data}">+ Adicionar turno</button>
    </div>`;
  ligarBotoes();
}

/* ---- visão semanal: grade parecida com a planilha ---- */
function desenharSemana() {
  const seg = segundaDa(estado.referencia);
  const dias = Array.from({ length: 5 }, (_, i) => iso(somaDias(seg, i)));
  const hoje = iso(new Date());

  const cabecalho = dias.map((d) => {
    const c = diaCobertura(d);
    const alerta = c?.util && c.lacunas.length ? ` <span title="Sem cobertura em ${c.lacunas.map((l) => `${l.inicio}-${l.fim}`).join(', ')}" style="color:var(--alerta)">⚠</span>` : '';
    return `<th class="${d === hoje ? 'hoje' : ''}">${DIAS_CURTO[deIso(d).getDay()]} ${d.slice(8)}/${d.slice(5, 7)}${alerta}</th>`;
  }).join('');

  const corpo = estado.servidores.filter((s) => s.ativo !== false).map((s) => {
    let hp = 0, hd = 0;
    const celulas = dias.map((d) => {
      const af = afastamentoDe(s.id, d);
      if (af) return `<td class="${d === hoje ? 'hoje' : ''}"><span class="chip A">${escapar(af.tipo)}</span></td>`;
      const chips = turnosDe(s.id, d).map((t) => {
        const h = (emMinutos(t.fim) - emMinutos(t.inicio)) / 60;
        if (t.modalidade === 'P') hp += h; else hd += h;
        const x = podeEditar(s.id) ? `<button data-apagar="${t.id}" title="Remover">✕</button>` : '';
        return `<span class="chip ${t.modalidade}">${t.inicio}–${t.fim} (${paraHoras(h)}h ${t.modalidade})${x}</span>`;
      }).join('');
      const mais = podeEditar(s.id) ? `<button class="mais" data-novo="${s.id}|${d}">+</button>` : '';
      return `<td class="${d === hoje ? 'hoje' : ''}">${chips || ''} ${mais}</td>`;
    }).join('');
    const metaP = Number(s.meta_presencial_semanal ?? 20), metaD = Number(s.meta_distancia_semanal ?? 20);
    return `<tr><td class="nome">${escapar(s.nome)}</td>${celulas}
      <td class="total"><span class="${hp < metaP ? 'abaixo' : ''}">${paraHoras(hp)}</span> / ${paraHoras(metaP)}</td>
      <td class="total"><span class="${hd < metaD ? 'abaixo' : ''}">${paraHoras(hd)}</span> / ${paraHoras(metaD)}</td>
      <td class="total"><strong>${paraHoras(hp + hd)}</strong></td></tr>`;
  }).join('');

  const rodape = dias.map((d) => {
    const c = diaCobertura(d);
    if (!c || !c.util) return '<td style="color:var(--suave)">—</td>';
    if (!c.lacunas.length) return `<td style="color:var(--ok)">coberto</td>`;
    return `<td style="color:var(--alerta)"><strong>descoberto</strong><br>${c.lacunas.map((l) => `${l.inicio}–${l.fim}`).join('<br>')}</td>`;
  }).join('');

  $('#conteudo').innerHTML = `
    <div class="cartao" style="overflow-x:auto">
      <h2>Escala da semana</h2>
      <table>
        <thead><tr><th>Servidor</th>${cabecalho}<th>Presencial</th><th>À distância</th><th>Total</th></tr></thead>
        <tbody>${corpo}</tbody>
        <tfoot><tr><td class="nome">Cobertura</td>${rodape}<td colspan="3"></td></tr></tfoot>
      </table>
    </div>`;
  ligarBotoes();
}

/* ---- visão mensal: calendário ---- */
function desenharMes() {
  const r = estado.referencia;
  const { inicio, fim } = intervalo();
  const hoje = iso(new Date());
  const celulas = [];
  for (let d = deIso(inicio); iso(d) <= fim; d = somaDias(d, 1)) {
    const data = iso(d);
    const c = diaCobertura(data);
    const fora = d.getMonth() !== r.getMonth();
    const fds = d.getDay() === 0 || d.getDay() === 6;
    const presenciais = new Set(estado.dados.turnos.filter((t) => t.data === data && t.modalidade === 'P').map((t) => t.nome));
    const distancia = new Set(estado.dados.turnos.filter((t) => t.data === data && t.modalidade === 'D').map((t) => t.nome));
    const afastados = estado.dados.afastamentos.filter((a) => a.data_inicio <= data && a.data_fim >= data);
    const falha = c?.util && c.lacunas.length;
    const marca = c?.util
      ? (falha ? `<span class="marca falha">${c.lacunas.length} lacuna(s)</span>` : `<span class="marca ok">ok</span>`)
      : (c?.feriado ? `<span class="marca">feriado</span>` : '');
    celulas.push(`<div class="dia ${fora ? 'fora' : ''} ${fds ? 'fds' : ''} ${falha ? 'falha' : ''}" data-ir="${data}" style="${data === hoje ? 'outline:2px solid var(--presencial)' : ''}">
      <div class="num"><span>${d.getDate()}</span>${marca}</div>
      <div class="miudo">
        ${presenciais.size ? `<div>👥 ${presenciais.size} presencial(is)</div>` : (c?.util ? '<div style="color:var(--alerta)">sem presencial</div>' : '')}
        ${distancia.size ? `<div>💻 ${distancia.size} à distância</div>` : ''}
        ${afastados.length ? `<div>🌴 ${afastados.map((a) => a.nome.split(' ')[0]).join(', ')}</div>` : ''}
      </div></div>`);
  }
  $('#conteudo').innerHTML = `
    <div class="cartao">
      <h2>Calendário do mês</h2>
      <div class="mes">${DIAS_CURTO.slice(1).concat(DIAS_CURTO[0]).map((n) => `<div class="cab">${n}</div>`).join('')}${celulas.join('')}</div>
      <p style="font-size:12px;color:var(--suave);margin:12px 0 0">Clique em um dia para abrir a linha do tempo.</p>
    </div>
    ${desenharResumoHoras()}`;
  document.querySelectorAll('[data-ir]').forEach((el) => el.addEventListener('click', () => irParaDia(el.dataset.ir)));
}

function desenharResumoHoras() {
  const horas = (estado.cobertura?.horas || []).sort((a, b) => a.nome.localeCompare(b.nome));
  if (!horas.length) return '';
  const linhas = horas.map((h) => `<tr><td class="nome">${escapar(h.nome)}</td><td class="total">${paraHoras(h.presencial)}</td><td class="total">${paraHoras(h.distancia)}</td><td class="total"><strong>${paraHoras(h.total)}</strong></td></tr>`).join('');
  return `<div class="cartao"><h2>Horas no período</h2><table>
    <thead><tr><th>Servidor</th><th>Presencial</th><th>À distância</th><th>Total</th></tr></thead><tbody>${linhas}</tbody></table></div>`;
}

/* ---------------- ações nos elementos desenhados ---------------- */
function ligarBotoes() {
  document.querySelectorAll('[data-novo]').forEach((b) => b.addEventListener('click', () => {
    const [servidorId, data] = b.dataset.novo.split('|');
    modalTurno(servidorId, data);
  }));
  document.querySelectorAll('[data-apagar]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm('Remover este turno?')) return;
    await api(`/escala/turnos/${b.dataset.apagar}`, { method: 'DELETE' });
    aviso('Turno removido');
    carregar();
  }));
}

/* ---------------- modais ---------------- */
function abrirModal(html, aoConfirmar) {
  const fundo = document.createElement('div');
  fundo.className = 'fundo-modal';
  fundo.innerHTML = `<div class="modal">${html}<p class="erro"></p>
    <div class="acoes"><button data-fechar>Cancelar</button><button class="primario" data-ok>Salvar</button></div></div>`;
  $('#modais').appendChild(fundo);
  const fechar = () => fundo.remove();
  fundo.querySelector('[data-fechar]').addEventListener('click', fechar);
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
  fundo.querySelector('[data-ok]').addEventListener('click', async () => {
    const botao = fundo.querySelector('[data-ok]');
    botao.disabled = true;
    try {
      await aoConfirmar(fundo);
      fechar();
      carregar();
    } catch (erro) {
      fundo.querySelector('.erro').textContent = erro.message;
      botao.disabled = false;
    }
  });
  return fundo;
}

function opcoesServidores(selecionado) {
  const lista = estado.usuario.perfil === 'chefia' ? estado.servidores : estado.servidores.filter((s) => Number(s.id) === Number(estado.usuario.id));
  return lista.map((s) => `<option value="${s.id}" ${Number(s.id) === Number(selecionado) ? 'selected' : ''}>${escapar(s.nome)}</option>`).join('');
}

function modalTurno(servidorId, data) {
  abrirModal(`<h2>Novo turno</h2>
    <label>Servidor</label><select id="m-servidor">${opcoesServidores(servidorId)}</select>
    <label>Data</label><input id="m-data" type="date" value="${data}">
    <div class="dupla"><div><label>Início</label><input id="m-inicio" type="time" value="08:00" step="900"></div>
      <div><label>Fim</label><input id="m-fim" type="time" value="14:00" step="900"></div></div>
    <label>Modalidade</label>
    <select id="m-modalidade"><option value="P">Presencial</option><option value="D">À distância</option></select>
    <label>Observação (opcional)</label><input id="m-obs" type="text" placeholder="ex.: reunião de equipe">`,
    async (f) => {
      await api('/escala/turnos', { method: 'POST', corpo: {
        servidor_id: Number(f.querySelector('#m-servidor').value),
        data: f.querySelector('#m-data').value,
        inicio: f.querySelector('#m-inicio').value,
        fim: f.querySelector('#m-fim').value,
        modalidade: f.querySelector('#m-modalidade').value,
        observacao: f.querySelector('#m-obs').value || null,
      }});
      aviso('Turno lançado');
    });
}

$('#btn-afastamento').addEventListener('click', () => {
  const hoje = iso(estado.referencia);
  abrirModal(`<h2>Registrar afastamento</h2>
    <label>Servidor</label><select id="a-servidor">${opcoesServidores(estado.usuario.id)}</select>
    <div class="dupla"><div><label>De</label><input id="a-inicio" type="date" value="${hoje}"></div>
      <div><label>Até</label><input id="a-fim" type="date" value="${hoje}"></div></div>
    <label>Tipo</label>
    <select id="a-tipo">
      <option>Férias</option><option>Licença médica</option><option>Licença</option>
      <option>Capacitação</option><option>Folga</option><option>Outro</option>
    </select>
    <label>Observação (opcional)</label><input id="a-obs" type="text">
    <p style="font-size:12px;color:var(--suave);margin-top:12px">Nos dias de afastamento os turnos da pessoa deixam de contar para a cobertura, e o sistema reavalia se alguém precisa cobrir.</p>`,
    async (f) => {
      await api('/escala/afastamentos', { method: 'POST', corpo: {
        servidor_id: Number(f.querySelector('#a-servidor').value),
        data_inicio: f.querySelector('#a-inicio').value,
        data_fim: f.querySelector('#a-fim').value,
        tipo: f.querySelector('#a-tipo').value,
        observacao: f.querySelector('#a-obs').value || null,
      }});
      aviso('Afastamento registrado');
    });
});

$('#btn-replicar').addEventListener('click', () => {
  const seg = iso(segundaDa(estado.referencia));
  const ate = iso(somaDias(segundaDa(estado.referencia), 7 * 8 - 3));
  abrirModal(`<h2>Repetir semana</h2>
    <p style="font-size:13px;color:var(--suave);margin:0">Copia os turnos de uma semana para as semanas seguintes, como na planilha antiga.</p>
    <label>Servidor</label><select id="r-servidor">${opcoesServidores(estado.usuario.id)}</select>
    <label>Semana base (segunda-feira)</label><input id="r-base" type="date" value="${seg}">
    <label>Repetir até</label><input id="r-ate" type="date" value="${ate}">
    <label style="display:flex;align-items:center;gap:8px;margin-top:14px">
      <input id="r-substituir" type="checkbox" style="width:auto"> Apagar o que já existir nos dias copiados</label>`,
    async (f) => {
      const r = await api('/escala/replicar', { method: 'POST', corpo: {
        servidor_id: Number(f.querySelector('#r-servidor').value),
        semana_base: f.querySelector('#r-base').value,
        ate: f.querySelector('#r-ate').value,
        substituir: f.querySelector('#r-substituir').checked,
      }});
      aviso(`${r.criados} turno(s) criado(s)`);
    });
});

$('#btn-senha').addEventListener('click', () => {
  abrirModal(`<h2>Trocar senha</h2>
    <label>Senha atual</label><input id="s-atual" type="password">
    <label>Nova senha (mínimo 6 caracteres)</label><input id="s-nova" type="password">`,
    async (f) => {
      await api('/auth/senha', { method: 'POST', corpo: { senha_atual: f.querySelector('#s-atual').value, senha_nova: f.querySelector('#s-nova').value } });
      aviso('Senha alterada');
    });
});

$('#btn-config').addEventListener('click', async () => {
  const c = await api('/cobertura/config');
  abrirModal(`<h2>Regras de cobertura</h2>
    <div class="dupla"><div><label>Expediente começa</label><input id="c-ini" type="time" value="${escapar(c.cobertura_inicio)}"></div>
      <div><label>Expediente termina</label><input id="c-fim" type="time" value="${escapar(c.cobertura_fim)}"></div></div>
    <label>Mínimo de pessoas presenciais em cada faixa</label><input id="c-min" type="number" min="1" max="100" value="${escapar(c.minimo_presencial)}">
    <label>Tamanho da faixa analisada (minutos)</label><input id="c-gran" type="number" min="5" max="240" step="5" value="${escapar(c.granularidade_min)}">
    <label>Dias úteis (0=domingo … 6=sábado)</label><input id="c-dias" type="text" value="${escapar(c.dias_uteis)}">`,
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

/* ---------------- entrada ---------------- */
(async () => {
  try {
    estado.usuario = await api('/auth/eu');
    if (estado.usuario) iniciar();
  } catch { /* sem sessão: mostra o login */ }
})();
