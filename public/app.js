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
  // 401 com sessao aberta = sessao caiu: volta para o login. Exceto quando a
  // propria chamada usa 401 para "senha atual incorreta" (Minha conta).
  if (resposta.status === 401 && estado.usuario && !opcoes.semRecarregar) { location.reload(); return; }
  const json = await resposta.json().catch(() => ({}));
  if (resposta.status === 403 && json.codigo === 'senha_provisoria') modalSenhaObrigatoria();
  if (!resposta.ok) throw new Error(json.erro || 'Falha na comunicação com o servidor');
  if (Array.isArray(json.avisos_gerados) && json.avisos_gerados.length) mostrarImpacto(json.avisos_gerados);
  return json;
}

/* ---------------- avisos de horário descoberto ----------------
   Toda mudança que abre faixa sem presencial volta com "avisos_gerados":
   quem mudou vê a faixa na hora, e a chefia recebe no menu (e por e-mail,
   quando o servidor tem RESEND_API_KEY). */
function mostrarImpacto(avisos) {
  const el = $('#impacto');
  el.innerHTML = `${icone('alerta')}<div style="flex:1"><h3>Atenção: essa mudança deixou horário sem ninguém presencial</h3>
    <ul>${avisos.map((v) => `<li><span class="dia-link" data-dia="${v.data}" style="cursor:pointer;text-decoration:underline">${escapar(v.mensagem)}</span></li>`).join('')}</ul>
    <div style="margin-top:6px">${ehChefia() ? 'Ficou registrado em "Avisos".' : 'A chefia foi avisada. Se puder, combine quem cobre.'}</div></div>
    <button class="fantasma pequeno fechar" data-fechar-impacto title="Fechar">✕</button>`;
  el.classList.remove('oculto');
  el.querySelector('[data-fechar-impacto]').addEventListener('click', () => el.classList.add('oculto'));
  el.querySelectorAll('[data-dia]').forEach((s) => s.addEventListener('click', () => irParaDia(s.dataset.dia)));
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  atualizarContadorAvisos();
}

async function atualizarContadorAvisos() {
  if (!ehChefia()) return;
  try {
    const { nao_lidos } = await api('/avisos/contagem');
    const n = $('#avisos-n');
    n.textContent = nao_lidos;
    n.classList.toggle('oculto', !nao_lidos);
  } catch { /* contador e so conforto; nao derruba a tela */ }
}

async function modalAvisos(todos = false) {
  const lista = await api(`/avisos${todos ? '?todos=1' : ''}`);
  const quando = (t) => { const d = new Date(t); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const itens = lista.length ? lista.map((v) => `<div class="item aviso-item ${v.lido ? 'lido' : ''}">
      <div class="cresce"><strong class="dia-link" data-dia="${v.data}" style="cursor:pointer">${escapar(v.mensagem)}</strong>
        <small>${escapar(v.origem || '')}</small><small>${quando(v.criado_em)}${v.autor ? ' · ' + escapar(v.autor) : ''}</small></div>
      ${v.lido ? '' : `<button class="pequeno" data-lido="${v.id}">Lido</button>`}
    </div>`).join('') : '<p class="vazio">Nenhum aviso pendente. Nenhuma mudança recente abriu horário descoberto.</p>';
  const f = abrirModal(`<h2>Avisos de horário descoberto</h2>
    <p class="sub">Gerados quando um turno, afastamento, feriado ou regra muda e deixa faixa sem ninguém presencial. Clique no aviso para abrir o dia.</p>
    <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap"><button class="pequeno" data-todos>${todos ? 'Só os pendentes' : 'Mostrar os já lidos'}</button>${lista.some((v) => !v.lido) ? '<button class="pequeno" data-todos-lidos>Marcar todos como lidos</button>' : ''}</div>
    <div class="lista">${itens}</div>`, null, { semOk: true });
  f.querySelector('[data-todos]').addEventListener('click', () => { f.remove(); modalAvisos(!todos); });
  f.querySelector('[data-todos-lidos]')?.addEventListener('click', async () => { await api('/avisos/lidos', { method: 'POST' }); f.remove(); atualizarContadorAvisos(); modalAvisos(todos); });
  f.querySelectorAll('[data-lido]').forEach((b) => b.addEventListener('click', async () => { await api(`/avisos/${b.dataset.lido}/lido`, { method: 'POST' }); f.remove(); atualizarContadorAvisos(); modalAvisos(todos); }));
  f.querySelectorAll('[data-dia]').forEach((s) => s.addEventListener('click', () => { f.remove(); irParaDia(s.dataset.dia); }));
}

const podeEditar = (servidorId) => estado.usuario.perfil === 'chefia' || Number(estado.usuario.id) === Number(servidorId);
const ehChefia = () => estado.usuario?.perfil === 'chefia';

/* ---------------- tema claro / escuro ---------------- */
function aplicarTema(tema) {
  document.documentElement.dataset.tema = tema;
  try { localStorage.setItem('escala-tema', tema); } catch { /* sem armazenamento: só nesta visita */ }
  $$('.btn-tema use').forEach((u) => u.setAttribute('href', tema === 'escuro' ? '#i-sol' : '#i-lua'));
  $$('.btn-tema').forEach((b) => { b.title = tema === 'escuro' ? 'Mudar para o tema claro' : 'Mudar para o tema escuro'; });
  $$('.btn-tema .tema-rotulo').forEach((r) => { r.textContent = tema === 'escuro' ? 'Tema claro' : 'Tema escuro'; });
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
    estado.senhaDigitada = $('#senha').value;
    estado.usuario = await api('/auth/login', { method: 'POST', corpo: { email: $('#email').value.trim(), senha: $('#senha').value } });
    entrarNoSistema();
  } catch (erro) {
    $('#erro-login').textContent = erro.message;
  }
});

$('#btn-sair').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST' }); location.reload(); });

/* ---------------- primeiro acesso: senha provisoria ----------------
   Senha dada pela chefia (do seed, de cadastro novo ou redefinida) so
   serve para entrar. Antes de qualquer tela, a pessoa define a sua; o
   servidor recusa toda rota de dados (403 senha_provisoria) ate la. */
function entrarNoSistema() {
  if (estado.usuario?.senha_provisoria) modalSenhaObrigatoria();
  else iniciar();
}

function modalSenhaObrigatoria() {
  if ($('#senha-obrigatoria')) return;
  const temAtual = Boolean(estado.senhaDigitada);
  const fundo = document.createElement('div');
  fundo.className = 'fundo-modal';
  fundo.id = 'senha-obrigatoria';
  fundo.innerHTML = `<div class="modal">
    <div class="marca grande"><span class="selo"><img src="simbolo.svg" alt=""></span><div><strong>Olá, ${escapar(estado.usuario.nome.split(' ')[0])}</strong><small>Defina a sua senha para começar</small></div></div>
    <p class="sub">A senha que você usou é provisória, dada pela chefia. Escolha a sua: só você vai conhecê-la, e depois ela pode ser trocada em "Minha conta".</p>
    ${temAtual ? '' : '<label>Senha provisória (a que você usou para entrar)</label><input id="o-atual" type="password" autocomplete="current-password">'}
    <label>Nova senha (mínimo 6 caracteres)</label><input id="o-nova" type="password" autocomplete="new-password">
    <label>Repita a nova senha</label><input id="o-nova2" type="password" autocomplete="new-password">
    <p class="erro"></p>
    <div class="acoes"><button class="fantasma" data-sair>Sair</button><button class="primario" data-ok>Salvar e entrar</button></div>
  </div>`;
  $('#modais').appendChild(fundo);
  fundo.querySelector('#' + (temAtual ? 'o-nova' : 'o-atual')).focus();
  fundo.querySelector('[data-sair]').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST' }); location.reload(); });
  const salvar = async () => {
    const erro = fundo.querySelector('.erro');
    erro.textContent = '';
    const nova = fundo.querySelector('#o-nova').value, nova2 = fundo.querySelector('#o-nova2').value;
    if (nova.length < 6) { erro.textContent = 'A nova senha precisa ter ao menos 6 caracteres'; return; }
    if (nova !== nova2) { erro.textContent = 'As duas senhas não são iguais'; return; }
    const atual = temAtual ? estado.senhaDigitada : fundo.querySelector('#o-atual').value;
    const botao = fundo.querySelector('[data-ok]');
    botao.disabled = true;
    try {
      const r = await api('/auth/conta', { method: 'PUT', corpo: { senha_atual: atual, senha_nova: nova }, semRecarregar: true });
      estado.usuario = { ...estado.usuario, ...r, senha_provisoria: false };
      estado.senhaDigitada = null;
      fundo.remove();
      aviso('Senha definida. Bem-vindo!');
      iniciar();
    } catch (e) {
      erro.textContent = e.message;
      botao.disabled = false;
    }
  };
  fundo.querySelector('[data-ok]').addEventListener('click', salvar);
  fundo.addEventListener('keydown', (e) => { if (e.key === 'Enter') salvar(); });
}

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
  atualizarContadorAvisos();
}

async function iniciar() {
  $('#login').classList.add('oculto');
  $('#app').classList.remove('oculto');
  estado.servidores = await api('/servidores');
  $('#quem').textContent = `${estado.usuario.nome}${ehChefia() ? ' · chefia' : ''}`;
  if (ehChefia()) { $('#btn-config').classList.remove('oculto'); $('#btn-avisos').classList.remove('oculto'); }
  $('#btn-avisos').addEventListener('click', () => modalAvisos(false));
  await carregar();
  // Aberto num sábado ou domingo: já cai no próximo dia com expediente.
  if (!temExpediente(estado.referencia)) { estado.referencia = proximoDiaUtil(estado.referencia, 1); await carregar(); }
}

/* ---------------- navegação ---------------- */
$$('[data-visao]').forEach((b) => b.addEventListener('click', () => {
  $$('[data-visao]').forEach((x) => x.classList.remove('ativa'));
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

// Ordem das pessoas nas visoes: quem esta fica em cima, quem esta afastado
// vai para o fim (quanto mais dias afastado no periodo, mais para baixo).
// Sem isso, ferias no meio da lista cortavam a leitura de quem esta.
function ordenarPorPresenca(dias) {
  const lista = servidoresAtivos().map((s) => ({ s, fora: dias.filter((d) => afastamentoDe(s.id, d)).length }));
  lista.sort((x, y) => x.fora - y.fora || x.s.nome.localeCompare(y.s.nome));
  return lista;
}
function textoPeriodo() {
  const c = estado.cobertura?.config || {};
  if (!c.periodo_inicio && !c.periodo_fim) return '';
  if (c.periodo_inicio && c.periodo_fim) return `Período híbrido de ${dataBr(c.periodo_inicio)} a ${dataBr(c.periodo_fim)}.`;
  if (c.periodo_inicio) return `Período híbrido desde ${dataBr(c.periodo_inicio)}.`;
  return `Período híbrido até ${dataBr(c.periodo_fim)}.`;
}

/* ---------------- com quem posso contar ----------------
   Para um dia: quem esta presencial (com horario), quem esta a distancia,
   quem esta afastado e quem nao lancou nada. E a pergunta que a chefia faz
   de manha; o mesmo quadro aparece no dia e, compactado, na semana. */
function contarDia(data) {
  const grupos = { presencial: [], distancia: [], afastados: [], sem: [] };
  for (const s of servidoresAtivos()) {
    const af = afastamentoDe(s.id, data);
    if (af) { grupos.afastados.push({ nome: s.nome, detalhe: af.tipo }); continue; }
    const turnos = turnosDe(s.id, data);
    const p = turnos.filter((t) => t.modalidade === 'P');
    const d = turnos.filter((t) => t.modalidade === 'D');
    if (p.length) grupos.presencial.push({ nome: s.nome, detalhe: p.map((t) => `${t.inicio}–${t.fim}`).join(', ') + (d.length ? ' · à distância ' + d.map((t) => `${t.inicio}–${t.fim}`).join(', ') : '') });
    else if (d.length) grupos.distancia.push({ nome: s.nome, detalhe: d.map((t) => `${t.inicio}–${t.fim}`).join(', ') });
    else grupos.sem.push({ nome: s.nome, detalhe: '' });
  }
  return grupos;
}

const GRUPOS_CONTAR = [
  ['presencial', 'Presencial', 'P'],
  ['distancia', 'À distância', 'D'],
  ['afastados', 'Afastados', 'A'],
  ['sem', 'Sem lançamento', 'S'],
];

function cartaoContarDia(data) {
  const g = contarDia(data);
  const c = diaCobertura(data);
  const colunas = GRUPOS_CONTAR.map(([chave, rotulo, classe]) => `
    <div class="contar-grupo ${classe}">
      <div class="contar-titulo"><i class="ponto ${classe}"></i>${rotulo} <b>${g[chave].length}</b></div>
      ${g[chave].length ? `<ul>${g[chave].map((p) => `<li><strong>${escapar(p.nome)}</strong>${p.detalhe ? `<small>${escapar(p.detalhe)}</small>` : ''}</li>`).join('')}</ul>` : '<p class="vazio">ninguém</p>'}
    </div>`).join('');
  const resumo = !c || !c.util
    ? ''
    : (c.lacunas.length
      ? `<span class="lacuna">${icone('alerta')} Sem presencial em ${c.lacunas.map((l) => `${l.inicio}–${l.fim}`).join(', ')}</span>`
      : `<span class="cob-ok" style="margin:0">${icone('ok')} Presencial garantido das ${estado.cobertura.config.cobertura_inicio} às ${estado.cobertura.config.cobertura_fim}</span>`);
  return `<div class="cartao">
    <h2>${icone('ok')} Com quem posso contar — ${dataBonita(data)}</h2>
    <div class="contar">${colunas}</div>
    ${resumo ? `<div style="margin-top:10px">${resumo}</div>` : ''}
  </div>`;
}

function cartaoContarSemana(dias) {
  const porDia = dias.map((d) => ({ d, g: contarDia(d), c: diaCobertura(d), f: feriadoEm(d) }));
  const primeiro = (n) => escapar(n.split(' ')[0]);
  const linhas = GRUPOS_CONTAR.map(([chave, rotulo, classe]) => `<tr>
      <td class="nome"><i class="ponto ${classe}"></i>${rotulo}</td>
      ${porDia.map(({ d, g, c, f }) => (c && !c.util)
        ? `<td class="${f ? 'feriado' : ''}"><span class="vazio">${f ? 'feriado' : (c.fora_periodo ? 'fora do período' : '—')}</span></td>`
        : `<td>${g[chave].length ? g[chave].map((p) => `<span class="pessoa ${classe}" title="${escapar(p.detalhe)}">${primeiro(p.nome)}</span>`).join('') : '<span class="vazio">ninguém</span>'}</td>`).join('')}
    </tr>`).join('');
  return `<div class="cartao">
    <h2>${icone('ok')} Com quem posso contar nesta semana</h2>
    <p class="sub">Passe o mouse no nome para ver o horário. Presencial garante a cobertura; à distância conta para o trabalho, não para o atendimento presencial.</p>
    <div class="rolagem"><table class="contar-semana">
      <thead><tr><th></th>${porDia.map(({ d }) => `<th>${dataBonita(d)}</th>`).join('')}</tr></thead>
      <tbody>${linhas}</tbody>
    </table></div>
  </div>`;
}

/* ---------------- cobertura do setor no dia ----------------
   Um retrato do setor por faixa de meia hora: quantas pessoas presenciais
   (azul) e quantas a distancia (verde) em cada horario, a linha do minimo
   exigido e as faixas descobertas listradas. Responde "como fica o setor
   as 14h?" sem precisar ler a linha do tempo pessoa por pessoa. */
function cartaoCoberturaSetor(data) {
  const dia = diaCobertura(data);
  const cfg = estado.cobertura?.config || {};
  if (!dia) return '';
  if (!dia.util) return '';
  const minimo = Number(dia.minimo || cfg.minimo_presencial || 1);
  const total = Math.max(1, servidoresAtivos().length);
  const turnosD = estado.dados.turnos.filter((t) => t.data === data && t.modalidade === 'D' && !afastamentoDe(t.servidor_id, data));
  const faixas = dia.faixas.map((f) => {
    const m = emMinutos(f.inicio);
    const dist = turnosD.filter((t) => emMinutos(t.inicio) <= m && emMinutos(t.fim) > m);
    return { ...f, distancia: dist.length, nomesD: dist.map((t) => t.nome) };
  });
  const presenciais = faixas.map((f) => f.quantidade);
  const minP = Math.min(...presenciais), maxP = Math.max(...presenciais);
  const maxD = Math.max(0, ...faixas.map((f) => f.distancia));
  const pessoasDia = new Set(estado.dados.turnos.filter((t) => t.data === data && !afastamentoDe(t.servidor_id, data)).map((t) => t.servidor_id)).size;
  const alturaMin = Math.min(100, (minimo / total) * 100);

  const colunas = faixas.map((f) => {
    const p = (f.quantidade / total) * 100, d = (f.distancia / total) * 100;
    const titulo = `${f.inicio}–${f.fim}: ${f.quantidade} presencial(is)${f.pessoas.length ? ' (' + f.pessoas.join(', ') + ')' : ''}; ${f.distancia} à distância${f.nomesD.length ? ' (' + f.nomesD.join(', ') + ')' : ''}${f.descoberto ? ' — ABAIXO DO MÍNIMO' : ''}`;
    return `<div class="col${f.descoberto ? ' falta' : ''}" title="${escapar(titulo)}">
      <span class="n">${f.quantidade}</span>
      <div class="barra-d" style="height:${d}%"></div>
      <div class="barra-p" style="height:${p}%"></div>
    </div>`;
  }).join('');
  const eixo = faixas.map((f) => `<div>${emMinutos(f.inicio) % 60 === 0 ? f.inicio.slice(0, 2) + 'h' : ''}</div>`).join('');
  const fimEixo = cfg.cobertura_fim ? `<div class="fim-eixo">${escapar(cfg.cobertura_fim.slice(0, 2))}h</div>` : '';

  return `<div class="cartao">
    <h2>${icone('calendario')} Cobertura do setor — ${dataBonita(data)}</h2>
    <p class="sub">Cada coluna é uma faixa de ${escapar(cfg.granularidade_min || 30)} minutos. Azul: pessoas presenciais; verde: à distância. A linha tracejada é o mínimo exigido (${minimo}). Passe o mouse para ver quem está.</p>
    <div class="setor-stats">
      <div><b>${minP}–${maxP}</b><small>presenciais ao longo do dia</small></div>
      <div><b>${maxD}</b><small>à distância no pico</small></div>
      <div><b>${pessoasDia}/${total}</b><small>pessoas trabalhando hoje</small></div>
      <div class="${dia.lacunas.length ? 'ruim' : 'bom'}"><b>${dia.lacunas.length}</b><small>faixa(s) descoberta(s)</small></div>
    </div>
    <div class="rolagem"><div class="setor-grafico-caixa">
      <div class="setor-grafico" style="grid-template-columns:repeat(${faixas.length},1fr)">${colunas}<div class="linha-min" style="bottom:${alturaMin}%"></div></div>
      <div class="setor-eixo" style="grid-template-columns:repeat(${faixas.length},1fr)">${eixo}${fimEixo}</div>
    </div></div>
    ${pilulasLacunas(dia)}
  </div>`;
}

/* ---------------- barra de cobertura ----------------
   Azul = faixa com alguém presencial (mais forte com 2 ou mais); listrado
   com borda vermelha = ninguém presencial. É a mesma peça no dia, na semana
   e no mês, só muda a altura. */
function barraCobertura(dia, { alta = false } = {}) {
  if (!dia) return '';
  if (!dia.util) return `<div class="cob-vazia">${dia.feriado ? `Feriado: ${escapar(dia.feriado)}` : (dia.fora_periodo ? 'Fora do período híbrido' : 'Sem expediente')}</div>`;
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
    el.innerHTML = `${icone('ok')}<div><h3>Cobertura em ordem</h3>Todos os dias com expediente têm ao menos ${min} pessoa(s) presencial(is) das ${escapar(cfg.cobertura_inicio)} às ${escapar(cfg.cobertura_fim)}. ${textoPeriodo()}${avisos}</div>`;
    return;
  }
  el.className = 'ruim';
  const itens = dias.slice(0, 15).map((d) => {
    const faixas = d.lacunas.map((l) => `${l.inicio}–${l.fim}`).join(', ');
    return `<span class="dia-link" data-dia="${d.data}">${dataBonita(d.data)} <b>${faixas}</b></span>`;
  }).join('');
  el.innerHTML = `${icone('alerta')}<div><h3>${dias.length} dia(s) com horário descoberto</h3>
    <div>Alguém precisa estar presencial das ${escapar(cfg.cobertura_inicio)} às ${escapar(cfg.cobertura_fim)}. ${textoPeriodo()} Clique no dia para ver quem está e ajustar.</div>
    <div class="dias">${itens}${dias.length > 15 ? `<span class="dia-link" style="cursor:default">…e mais ${dias.length - 15}</span>` : ''}</div>${avisos}</div>`;
  el.querySelectorAll('.dia-link[data-dia]').forEach((s) => s.addEventListener('click', () => irParaDia(s.dataset.dia)));
}

function irParaDia(data) {
  estado.referencia = deIso(data);
  estado.visao = 'dia';
  $$('[data-visao]').forEach((x) => x.classList.toggle('ativa', x.dataset.visao === 'dia'));
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

  const ordenados = ordenarPorPresenca([data]);
  const linhas = ordenados.map(({ s, fora }, i) => {
    const separador = fora && (i === 0 || !ordenados[i - 1].fora) ? `<div class="separador">${icone('ferias')} Afastados neste dia</div>` : '';
    const af = afastamentoDe(s.id, data);
    const editavel = podeEditar(s.id);
    const blocos = af
      ? `<div class="bloco A${editavel ? '' : ' fixo'}" style="left:0;right:0" ${editavel ? `data-editar-af="${af.id}"` : ''} title="${escapar(af.tipo)} de ${dataBr(af.data_inicio)} a ${dataBr(af.data_fim)}${editavel ? ' — clique para alterar' : ''}">${icone('ferias')} ${escapar(af.tipo)} · ${dataBr(af.data_inicio)} a ${dataBr(af.data_fim)}</div>`
      : turnosDe(s.id, data).map((t, idx, lista) => {
          // Entre este turno e o seguinte, se sobrar 30 min ou mais, marca o intervalo
          let intervalo = '';
          const seguinte = lista[idx + 1];
          if (seguinte && emMinutos(seguinte.inicio) - emMinutos(t.fim) >= 30) {
            const ie = pos(emMinutos(t.fim)), id = pos(emMinutos(seguinte.inicio));
            intervalo = `<div class="intervalo" style="left:${ie}%;width:${id - ie}%" title="Intervalo ${t.fim}–${seguinte.inicio}"><span>intervalo ${t.fim}–${seguinte.inicio}</span></div>`;
          }
          const e = Math.max(0, pos(emMinutos(t.inicio)));
          const d = Math.min(100, pos(emMinutos(t.fim)));
          const rotulo = t.modalidade === 'P' ? 'presencial' : 'à distância';
          return `<div class="bloco ${t.modalidade}${editavel ? '' : ' fixo'}" style="left:${e}%;width:${Math.max(d - e, 2)}%" ${editavel ? `data-editar-turno="${t.id}"` : ''}
                    title="${t.inicio}–${t.fim} ${rotulo}${t.observacao ? ' — ' + escapar(t.observacao) : ''}${editavel ? ' (clique para alterar)' : ''}">${t.inicio}–${t.fim}</div>${intervalo}`;
        }).join('');
    const acao = editavel && !af ? `<button class="mais" data-novo="${s.id}|${data}">${icone('mais')}</button>` : '';
    return `${separador}<div class="rotulo${af ? ' afastado' : ''}"><span>${escapar(s.nome)}</span>${acao}</div><div class="faixa${af ? ' afastado' : ''}">${grade.join('')}${blocos}</div>`;
  }).join('');

  const reguas = [];
  for (let m = ini; m <= fim; m += 60) reguas.push(`<span style="left:${pos(m)}%">${hhmm(m)}</span>`);

  const cobertura = dia && dia.util
    ? `<div class="cob-dia">
         ${ini < abre ? `<div class="fora" style="left:0;width:${pos(abre)}%"></div>` : ''}
         <div style="position:absolute;top:0;bottom:0;left:${pos(abre)}%;width:${pos(fecha) - pos(abre)}%">${barraCobertura(dia, { alta: true })}</div>
         ${fim > fecha ? `<div class="fora" style="left:${pos(fecha)}%;right:0"></div>` : ''}
       </div>`
    : `<div class="cob-vazia">${feriado ? `Feriado: ${escapar(feriado.descricao)} — sem exigência de cobertura.` : (dia?.fora_periodo ? 'Fora do período híbrido — sem exigência de cobertura.' : 'Sem expediente neste dia.')}</div>`;

  const afastados = estado.dados.afastamentos.filter((a) => a.data_inicio <= data && a.data_fim >= data);
  const listaAfastados = afastados.length ? `
    <div class="cartao">
      <h2>${icone('ferias')} Afastamentos que alcançam este dia</h2>
      <div class="lista">${afastados.map((a) => `
        <div class="item">
          <span class="data">${dataBr(a.data_inicio)}${a.data_inicio !== a.data_fim ? `<small>até ${dataBr(a.data_fim)}</small>` : ''}</span>
          <div class="cresce"><strong>${escapar(a.nome)}</strong> — ${escapar(a.tipo)}${a.observacao ? `<small>${escapar(a.observacao)}</small>` : ''}</div>
          ${podeEditar(a.servidor_id) ? `<button class="pequeno" data-editar-af="${a.id}">${icone('lapis')} Alterar</button>` : ''}
        </div>`).join('')}</div>
    </div>` : '';

  $('#conteudo').innerHTML = `
    ${cartaoCoberturaSetor(data)}
    ${cartaoContarDia(data)}
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
    return `<th class="${classeDia(d)}"><div class="dia-cab"><b>${dataBonita(d)}</b>${f ? `<span class="feriado-nome">${escapar(f.descricao)}</span>` : (c?.fora_periodo ? '<span class="fora-periodo">fora do período</span>' : (c ? barraCobertura(c) : ''))}</div></th>`;
  }).join('');

  const ordenados = ordenarPorPresenca(dias);
  const corpo = ordenados.map(({ s, fora }, i) => {
    const semanaToda = fora === dias.length;
    const separador = semanaToda && (i === 0 || ordenados[i - 1].fora !== dias.length) ? `<tr class="separador"><td colspan="${dias.length + 4}">${icone('ferias')} Afastados a semana toda</td></tr>` : '';
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
    return `${separador}<tr class="${semanaToda ? 'afastado' : (fora ? 'parcial' : '')}"><td class="nome">${escapar(s.nome)}${fora && !semanaToda ? ` <small class="meta">(${fora} dia${fora > 1 ? 's' : ''} fora)</small>` : ''}</td>${celulas}
      <td class="total"><span class="${hp < metaP ? 'abaixo' : ''}">${paraHoras(hp)}</span> <span class="meta">/ ${paraHoras(metaP)}</span></td>
      <td class="total"><span class="${hd < metaD ? 'abaixo' : ''}">${paraHoras(hd)}</span> <span class="meta">/ ${paraHoras(metaD)}</span></td>
      <td class="total"><strong>${paraHoras(hp + hd)}</strong></td></tr>`;
  }).join('');

  const rodape = dias.map((d) => {
    const c = diaCobertura(d);
    if (!c || !c.util) return `<td class="${classeDia(d)}"><span class="vazio">${c?.feriado ? 'feriado' : (c?.fora_periodo ? 'fora do período' : '—')}</span></td>`;
    if (!c.lacunas.length) return `<td class="${classeDia(d)}"><span class="cob-ok" style="margin:0">${icone('ok')} coberto</span></td>`;
    return `<td class="${classeDia(d)}">${c.lacunas.map((l) => `<span class="lacuna" style="margin:1px 0">${icone('alerta')} ${l.inicio}–${l.fim}</span>`).join('<br>')}</td>`;
  }).join('');

  $('#conteudo').innerHTML = `
    ${cartaoContarSemana(dias)}
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
      : (c?.feriado ? `<span class="marca-dia feriado">feriado</span>` : (c?.fora_periodo ? `<span class="marca-dia periodo">fora do período</span>` : ''));
    celulas.push(`<div class="dia ${fora ? 'fora' : ''} ${c?.feriado ? 'feriado' : ''} ${c?.fora_periodo ? 'fora-periodo' : ''} ${falha ? 'falha' : ''} ${data === hoje ? 'hoje' : ''}" data-ir="${data}" title="${c?.feriado ? escapar(c.feriado) : 'Abrir a linha do tempo'}">
      <div class="num"><span>${d.getDate()}</span>${marca}</div>
      ${c?.util ? barraCobertura(c) : `<div style="height:19px"></div>`}
      <div class="miudo">
        ${c?.feriado ? `<div>${escapar(c.feriado)}</div>` : ''}
        ${presenciais.size ? `<div><b>${presenciais.size}</b> presencial(is)</div>` : (c?.util ? '<div class="abaixo">sem presencial</div>' : '')}
        ${distancia.size ? `<div><b>${distancia.size}</b> à distância</div>` : ''}
        ${afastados.length ? `<div>${icone('ferias')} ${afastados.map((a) => escapar(a.nome.split(' ')[0])).join(', ')}</div>` : ''}
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
  let f;
  const v = (campo) => f.querySelector(campo).value;
  // Ao criar, o formulario aceita varios horarios do mesmo dia de uma vez
  // (ex.: 08:00-14:00 presencial e 16:00-19:00 a distancia): cada linha vira
  // um turno, e o espaco entre elas aparece como intervalo na linha do tempo.
  const linhaHorario = (h) => `<div class="horario-linha">
      <input class="h-ini" type="time" value="${h.inicio}" step="900" title="Início">
      <span class="ate">até</span>
      <input class="h-fim" type="time" value="${h.fim}" step="900" title="Fim">
      <div class="opcoes">
        <label><input type="radio" name="m-mod-${h.n}" value="P" ${h.modalidade !== 'D' ? 'checked' : ''}><span>Presencial</span></label>
        <label><input type="radio" name="m-mod-${h.n}" value="D" ${h.modalidade === 'D' ? 'checked' : ''}><span>À distância</span></label>
      </div>
      ${editando ? '' : '<button type="button" class="fantasma pequeno" data-tirar title="Tirar este horário">✕</button>'}
    </div>`;
  let n = 0;
  const proximo = (ultimoFim) => {
    const [h] = ultimoFim.split(':').map(Number);
    const ini = Math.min(h + 2, 21), fimH = Math.min(ini + 3, 23);
    return { inicio: `${String(ini).padStart(2, '0')}:00`, fim: `${String(fimH).padStart(2, '0')}:00` };
  };
  f = abrirModal(`<h2>${editando ? 'Alterar turno' : 'Novo turno'}</h2>
    <p class="sub">${editando ? `Lançado para ${escapar(t.nome || '')} em ${dataBonita(t.data)}.` : 'Um dia pode ter mais de um horário, por exemplo 08:00–14:00 presencial e 16:00–19:00 à distância. O espaço entre eles aparece como intervalo.'}</p>
    <label>Servidor</label><select id="m-servidor">${opcoesServidores(t.servidor_id)}</select>
    <label>Data</label><input id="m-data" type="date" value="${t.data}">
    <label>Horário${editando ? '' : 's'}</label>
    <div id="m-horarios">${linhaHorario({ n: n++, inicio: t.inicio || '08:00', fim: t.fim || '14:00', modalidade: t.modalidade || 'P' })}</div>
    ${editando ? '' : `<button type="button" class="pequeno" id="m-mais" style="margin-top:8px">${icone('mais')} Outro horário no mesmo dia</button>`}
    <label>Observação (opcional)</label><input id="m-obs" type="text" value="${escapar(t.observacao || '')}" placeholder="ex.: reunião de equipe">`,
    async () => {
      const linhas = [...f.querySelectorAll('.horario-linha')].map((l) => ({
        inicio: l.querySelector('.h-ini').value,
        fim: l.querySelector('.h-fim').value,
        modalidade: l.querySelector('input[type="radio"]:checked').value,
      }));
      const base = { servidor_id: Number(v('#m-servidor')), data: v('#m-data'), observacao: v('#m-obs') || null };
      if (editando) {
        await api(`/escala/turnos/${t.id}`, { method: 'PUT', corpo: { ...base, ...linhas[0] } });
        aviso('Turno alterado');
        return;
      }
      // Confere sobreposicao entre as proprias linhas antes de gravar qualquer uma
      const ordenadas = [...linhas].sort((x, y) => x.inicio.localeCompare(y.inicio));
      for (let i = 1; i < ordenadas.length; i++) {
        if (ordenadas[i].inicio < ordenadas[i - 1].fim) throw new Error(`Os horários ${ordenadas[i - 1].inicio}–${ordenadas[i - 1].fim} e ${ordenadas[i].inicio}–${ordenadas[i].fim} se sobrepõem`);
      }
      let gravados = 0;
      try {
        for (const h of linhas) { await api('/escala/turnos', { method: 'POST', corpo: { ...base, ...h } }); gravados++; }
      } catch (erro) {
        if (gravados) { await carregar(); throw new Error(`${gravados} horário(s) gravado(s); o seguinte falhou: ${erro.message}`); }
        throw erro;
      }
      aviso(gravados === 1 ? 'Turno lançado' : `${gravados} horários lançados`);
    },
    editando ? { extra: { rotulo: 'Excluir', classe: 'perigo', acao: async () => {
      await api(`/escala/turnos/${t.id}`, { method: 'DELETE' }); aviso('Turno removido');
    } } } : {});
  const caixa = f.querySelector('#m-horarios');
  const ligarTirar = () => caixa.querySelectorAll('[data-tirar]').forEach((b) => { b.onclick = () => { if (caixa.children.length > 1) b.closest('.horario-linha').remove(); }; });
  ligarTirar();
  f.querySelector('#m-mais')?.addEventListener('click', () => {
    const ultima = caixa.lastElementChild;
    const p = proximo(ultima.querySelector('.h-fim').value || '14:00');
    caixa.insertAdjacentHTML('beforeend', linhaHorario({ n: n++, ...p, modalidade: ultima.querySelector('input[type="radio"]:checked').value === 'P' ? 'D' : 'P' }));
    ligarTirar();
    caixa.lastElementChild.querySelector('.h-ini').focus();
  });
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

/* ---- minha conta: cada pessoa escolhe como entra, o nome e a senha ---- */
$('#btn-conta').addEventListener('click', () => {
  const u = estado.usuario;
  abrirModal(`<h2>Minha conta</h2>
    <p class="sub">Escolha como você entra no sistema e a sua senha. Qualquer mudança pede a senha atual.</p>
    <label>Nome</label><input id="u-nome" type="text" value="${escapar(u.nome)}">
    <label>Login (usuário ou e-mail para entrar)</label><input id="u-login" type="text" value="${escapar(u.email)}" autocapitalize="none" spellcheck="false" placeholder="ex.: dayana ou nome@email.com">
    <label>Senha atual (obrigatória)</label><input id="u-atual" type="password" autocomplete="current-password">
    <div class="dupla"><div><label>Nova senha (opcional)</label><input id="u-nova" type="password" autocomplete="new-password"></div>
      <div><label>Repita a nova senha</label><input id="u-nova2" type="password" autocomplete="new-password"></div></div>
    <p class="nota">O login pode ser um nome de usuário (letras, números, ponto; 3 a 40 caracteres) ou um e-mail. Maiúsculas e minúsculas não fazem diferença. A nova senha precisa ter ao menos 6 caracteres.</p>`,
    async (f) => {
      const nova = f.querySelector('#u-nova').value, nova2 = f.querySelector('#u-nova2').value;
      if (nova !== nova2) throw new Error('As duas senhas novas não são iguais');
      const corpo = { nome: f.querySelector('#u-nome').value.trim(), login: f.querySelector('#u-login').value.trim(), senha_atual: f.querySelector('#u-atual').value };
      if (nova) corpo.senha_nova = nova;
      const r = await api('/auth/conta', { method: 'PUT', corpo, semRecarregar: true });
      estado.usuario = { ...estado.usuario, ...r };
      $('#quem').textContent = `${estado.usuario.nome}${ehChefia() ? ' · chefia' : ''}`;
      aviso(nova ? 'Conta e senha atualizadas' : 'Conta atualizada');
    });
});

$('#btn-config').addEventListener('click', () => modalConfiguracoes('periodo'));

/* ---------------- configurações (chefia) ----------------
   Um painel com abas: período híbrido, pessoas no acompanhamento, feriados
   e regras de cobertura. Cada aba desenha o próprio conteúdo e cuida dos
   próprios botões; salvar recarrega a escala por trás. */
const ABAS_CONFIG = [['periodo', 'Período híbrido'], ['pessoas', 'Pessoas'], ['feriados', 'Feriados'], ['regras', 'Regras de cobertura']];

function modalConfiguracoes(abaInicial = 'periodo') {
  const fundo = document.createElement('div');
  fundo.className = 'fundo-modal';
  fundo.innerHTML = `<div class="modal larga">
    <div class="painel-topo"><h2>${icone('engrenagem')} Configurações</h2><button class="fantasma" data-fechar title="Fechar">✕</button></div>
    <nav class="abas painel-abas">${ABAS_CONFIG.map(([id, rotulo]) => `<button data-aba="${id}">${rotulo}</button>`).join('')}</nav>
    <div class="painel-corpo"></div>
    <p class="erro"></p>
  </div>`;
  $('#modais').appendChild(fundo);
  const aoTeclar = (e) => { if (e.key === 'Escape' && $('#modais').lastElementChild === fundo) fechar(); };
  const fechar = () => { fundo.remove(); document.removeEventListener('keydown', aoTeclar); };
  document.addEventListener('keydown', aoTeclar);
  fundo.querySelector('[data-fechar]').addEventListener('click', fechar);
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });

  const painel = { fundo, corpo: fundo.querySelector('.painel-corpo'), erro: fundo.querySelector('.erro'), ano: estado.referencia.getFullYear() };
  painel.mostrar = async (aba) => {
    fundo.querySelectorAll('[data-aba]').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === aba));
    painel.erro.textContent = '';
    painel.corpo.innerHTML = '<p class="vazio">Carregando…</p>';
    try { await ABAS[aba](painel); } catch (erro) { painel.erro.textContent = erro.message; }
  };
  fundo.querySelectorAll('[data-aba]').forEach((b) => b.addEventListener('click', () => painel.mostrar(b.dataset.aba)));
  painel.mostrar(abaInicial);
}

// Roda uma gravação; sucesso recarrega a escala e redesenha a aba, erro fica no painel.
async function tentar(painel, acao, depois) {
  painel.erro.textContent = '';
  // A aba redesenha antes da escala: a aba Pessoas recarrega a lista de
  // servidores, e a escala precisa dessa lista nova para esconder quem saiu.
  try { await acao(); if (depois) await depois(); await carregar(); } catch (erro) { painel.erro.textContent = erro.message; }
}

async function abaPeriodo(p) {
  const c = await api('/cobertura/config');
  p.corpo.innerHTML = `<p class="sub">Entre essas datas vale a escala híbrida e o alerta de cobertura. Antes do início e depois do fim, os dias aparecem como "fora do período" e não geram alerta.</p>
    <div class="dupla"><div><label>Início do período híbrido</label><input id="p-ini" type="date" value="${escapar(c.periodo_inicio || '')}"></div>
      <div><label>Fim do período (vazio = ainda sem fim)</label><input id="p-fim" type="date" value="${escapar(c.periodo_fim || '')}"></div></div>
    <div class="acoes"><button class="primario" data-salvar>Salvar período</button></div>`;
  p.corpo.querySelector('[data-salvar]').addEventListener('click', () => tentar(p, async () => {
    await api('/cobertura/config', { method: 'PUT', corpo: { periodo_inicio: p.corpo.querySelector('#p-ini').value, periodo_fim: p.corpo.querySelector('#p-fim').value } });
    aviso('Período salvo');
  }, () => p.mostrar('periodo')));
}

async function abaPessoas(p) {
  const lista = await api('/servidores');
  estado.servidores = lista;
  const itens = lista.map((s) => `<div class="item ${s.ativo === false ? 'inativo' : ''}">
      <div class="cresce"><strong>${escapar(s.nome)}</strong>${s.perfil === 'chefia' ? '<span class="badge">chefia</span>' : ''}${s.ativo === false ? '<span class="badge cinza">fora do acompanhamento</span>' : ''}
        <small>${escapar(s.email)} · metas ${paraHoras(s.meta_presencial_semanal ?? 20)}h presencial + ${paraHoras(s.meta_distancia_semanal ?? 20)}h à distância</small></div>
      <button class="pequeno" data-editar="${s.id}">${icone('lapis')} Editar</button>
      ${Number(s.id) === Number(estado.usuario.id) ? '' : `<button class="pequeno" data-ativo="${s.id}|${s.ativo === false ? 'true' : 'false'}">${s.ativo === false ? 'Incluir' : 'Tirar'}</button>`}
    </div>`).join('');
  p.corpo.innerHTML = `<p class="sub">Quem está no acompanhamento aparece na escala e conta para a cobertura. Tirar alguém não apaga nada: a pessoa some das visões e volta quando for incluída de novo.</p>
    <div class="acoes" style="margin:0 0 10px;justify-content:flex-start"><button class="primario" data-nova>${icone('mais')} Nova pessoa</button></div>
    <div class="lista">${itens}</div>`;
  p.corpo.querySelector('[data-nova]').addEventListener('click', () => modalPessoa({}, () => p.mostrar('pessoas')));
  p.corpo.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => modalPessoa(lista.find((s) => Number(s.id) === Number(b.dataset.editar)), () => p.mostrar('pessoas'))));
  p.corpo.querySelectorAll('[data-ativo]').forEach((b) => b.addEventListener('click', () => {
    const [id, ativo] = b.dataset.ativo.split('|');
    tentar(p, async () => {
      await api(`/servidores/${id}`, { method: 'PUT', corpo: { ativo: ativo === 'true' } });
      aviso(ativo === 'true' ? 'Pessoa incluída no acompanhamento' : 'Pessoa tirada do acompanhamento');
    }, () => p.mostrar('pessoas'));
  }));
}

function modalPessoa(s, depois) {
  const nova = !s.id;
  const proprio = !nova && Number(s.id) === Number(estado.usuario.id);
  const f = abrirModal(`<h2>${nova ? 'Nova pessoa' : 'Editar pessoa'}</h2>
    <label>Nome</label><input id="s-nome" type="text" value="${escapar(s.nome || '')}">
    <label>Login (usuário ou e-mail para entrar)</label><input id="s-email" type="text" value="${escapar(s.email || '')}" autocapitalize="none" spellcheck="false" placeholder="ex.: fernanda ou nome@email.com">
    ${nova ? '<label>Senha inicial (vazio = mudar123)</label><input id="s-senha" type="text" autocomplete="off">' : ''}
    <label>Perfil</label>
    ${proprio ? `<p class="nota" style="margin:0 0 6px">Você é chefia. Ninguém tira a própria chefia: para passar o comando, promova a outra pessoa primeiro.</p>` : ''}
    <div class="opcoes"><label><input type="radio" name="s-perfil" value="servidor" ${(s.perfil || 'servidor') === 'servidor' ? 'checked' : ''} ${proprio ? 'disabled' : ''}><span>Servidor</span></label>
      <label><input type="radio" name="s-perfil" value="chefia" ${s.perfil === 'chefia' ? 'checked' : ''} ${proprio ? 'disabled' : ''}><span>Chefia</span></label></div>
    <div class="dupla"><div><label>Meta semanal presencial (h)</label><input id="s-mp" type="number" min="0" max="60" step="0.5" value="${Number(s.meta_presencial_semanal ?? 20)}"></div>
      <div><label>Meta semanal à distância (h)</label><input id="s-md" type="number" min="0" max="60" step="0.5" value="${Number(s.meta_distancia_semanal ?? 20)}"></div></div>
    ${nova ? '' : '<p class="nota">Esqueceu a senha? <a href="#" data-redefinir>Redefinir para a senha padrão</a>.</p>'}`,
    async (m) => {
      const corpo = {
        nome: m.querySelector('#s-nome').value,
        email: m.querySelector('#s-email').value,
        perfil: m.querySelector('input[name="s-perfil"]:checked').value,
        meta_presencial_semanal: m.querySelector('#s-mp').value,
        meta_distancia_semanal: m.querySelector('#s-md').value,
      };
      if (nova) {
        const senha = m.querySelector('#s-senha').value;
        if (senha) corpo.senha = senha;
        await api('/servidores', { method: 'POST', corpo });
        aviso('Pessoa cadastrada');
      } else {
        await api(`/servidores/${s.id}`, { method: 'PUT', corpo });
        aviso('Pessoa atualizada');
      }
      if (depois) depois();
    });
  const link = f.querySelector('[data-redefinir]');
  if (link) link.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!confirm(`Redefinir a senha de ${s.nome} para a senha padrão?`)) return;
    try { const r = await api(`/servidores/${s.id}/senha`, { method: 'POST', corpo: {} }); aviso(`Senha redefinida para ${r.senha}`); }
    catch (erro) { f.querySelector('.erro').textContent = erro.message; }
  });
}

async function abaFeriados(p) {
  const ano = p.ano;
  const lista = await api(`/escala/feriados?ano=${ano}`);
  const itens = lista.length
    ? lista.map((f) => `<div class="item"><span class="data">${dataBonita(f.data)}</span><div class="cresce">${escapar(f.descricao)}</div>
        <button class="pequeno perigo" data-apagar-feriado="${f.data}" title="Remover">✕</button></div>`).join('')
    : '<p class="vazio">Nenhum feriado cadastrado neste ano.</p>';
  p.corpo.innerHTML = `<p class="sub">Em feriado não há exigência de cobertura e as horas não contam. Os nacionais de 2026 já vieram carregados; apague o que não valer para o setor e inclua os locais.</p>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><button class="pequeno" data-ano="${ano - 1}">‹ ${ano - 1}</button><strong style="flex:1;text-align:center">${ano}</strong><button class="pequeno" data-ano="${ano + 1}">${ano + 1} ›</button></div>
    <div class="lista">${itens}</div>
    <div class="dupla" style="margin-top:14px"><div><label>Novo feriado</label><input id="f-data" type="date" value="${ano}-01-01"></div>
      <div><label>Descrição</label><input id="f-desc" type="text" placeholder="ex.: Aniversário da cidade"></div></div>
    <div class="acoes"><button class="primario" data-incluir>Incluir feriado</button></div>`;
  p.corpo.querySelector('[data-incluir]').addEventListener('click', () => tentar(p, async () => {
    await api('/escala/feriados', { method: 'POST', corpo: { data: p.corpo.querySelector('#f-data').value, descricao: p.corpo.querySelector('#f-desc').value.trim() } });
    aviso('Feriado incluído');
  }, () => p.mostrar('feriados')));
  p.corpo.querySelectorAll('[data-apagar-feriado]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Remover este feriado? O dia volta a exigir cobertura.')) return;
    tentar(p, async () => { await api(`/escala/feriados/${b.dataset.apagarFeriado}`, { method: 'DELETE' }); aviso('Feriado removido'); }, () => p.mostrar('feriados'));
  }));
  p.corpo.querySelectorAll('[data-ano]').forEach((b) => b.addEventListener('click', () => { p.ano = Number(b.dataset.ano); p.mostrar('feriados'); }));
}

async function abaRegras(p) {
  const c = await api('/cobertura/config');
  p.corpo.innerHTML = `<p class="sub">O alerta avisa toda faixa do expediente em que ninguém está presencial. Ficar depois do horário final é permitido; só não é exigido.</p>
    <div class="dupla"><div><label>Expediente começa</label><input id="c-ini" type="time" value="${escapar(c.cobertura_inicio)}"></div>
      <div><label>Alguém presencial até</label><input id="c-fim" type="time" value="${escapar(c.cobertura_fim)}"></div></div>
    <div class="dupla"><div><label>Mínimo de pessoas presenciais por faixa</label><input id="c-min" type="number" min="1" max="100" value="${escapar(c.minimo_presencial)}"></div>
      <div><label>Tamanho da faixa analisada (minutos)</label><input id="c-gran" type="number" min="5" max="240" step="5" value="${escapar(c.granularidade_min)}"></div></div>
    <label>Dias com expediente (0=domingo … 6=sábado)</label><input id="c-dias" type="text" value="${escapar(c.dias_uteis)}">
    <p class="nota">Sábado e domingo ficam fora da escala enquanto não estiverem nessa lista.</p>
    <div class="acoes"><button class="primario" data-salvar>Salvar regras</button></div>`;
  p.corpo.querySelector('[data-salvar]').addEventListener('click', () => tentar(p, async () => {
    await api('/cobertura/config', { method: 'PUT', corpo: {
      cobertura_inicio: p.corpo.querySelector('#c-ini').value,
      cobertura_fim: p.corpo.querySelector('#c-fim').value,
      minimo_presencial: p.corpo.querySelector('#c-min').value,
      granularidade_min: p.corpo.querySelector('#c-gran').value,
      dias_uteis: p.corpo.querySelector('#c-dias').value,
    }});
    aviso('Regras atualizadas');
  }, () => p.mostrar('regras')));
}

const ABAS = { periodo: abaPeriodo, pessoas: abaPessoas, feriados: abaFeriados, regras: abaRegras };

/* ---------------- entrada ---------------- */
(async () => {
  try {
    estado.usuario = await api('/auth/eu');
    if (estado.usuario) entrarNoSistema();
  } catch { /* sem sessão: mostra o login */ }
})();
