const socket = io();
socket.on('connect_error', e => { if (e.message === 'Autenticação necessária.') location.replace('primeira-tela-login.html'); });

const $ = id => document.getElementById(id);
const BASE = 'Central Operacional';
const PRIO = { CRITICA: ['critica', 'Crítica', 4], ALTA: ['alta', 'Alta', 3], MEDIA: ['media', 'Média', 2], BAIXA: ['baixa', 'Baixa', 1] };
const STATUS = { ATIVO: 'Ativo', EM_ATENDIMENTO: 'Em atendimento', RESOLVIDO: 'Resolvido', FALSO_ALARME: 'Falso alarme' };
const ENCERRADO = s => s === 'RESOLVIDO' || s === 'FALSO_ALARME';

let alertas = [], filtro = 'ATIVO', fichaId = null, mapa = null, notasSujas = false, pendentes = 0;

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
const ts = v => { const t = Date.parse(v); return Number.isNaN(t) ? null : t; };
const dataHora = v => ts(v) ? new Date(ts(v)).toLocaleString('pt-BR') : '—';
const hora = v => ts(v) ? new Date(ts(v)).toLocaleTimeString('pt-BR') : '--:--:--';
const prio = a => PRIO[a.prioridade] || PRIO.ALTA;
const nomeDe = a => a.solicitante?.nome || `Cliente #${a.clienteId}`;
const cpfFmt = c => /^\d{11}$/.test(c || '') ? c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : (c || '—');
const pos = a => a.localizacao && Number.isFinite(+a.localizacao.latitude) && Number.isFinite(+a.localizacao.longitude);

function dur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), p = n => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s % 60)}`;
}
function ha(v) {
  const t = ts(v); if (t === null) return '—';
  const s = Math.floor((Date.now() - t) / 1000);
  return s < 45 ? 'agora' : s < 3600 ? `há ${Math.max(1, Math.round(s / 60))} min` : `há ${Math.round(s / 3600)} h`;
}

/* ---------- ordem da fila: ativas por prioridade e espera; encerradas mais recentes primeiro ---------- */
const rank = s => s === 'ATIVO' ? 0 : s === 'EM_ATENDIMENTO' ? 1 : 2;
function ordenar(a, b) {
  if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
  if (rank(a.status) < 2) return (prio(b)[2] - prio(a)[2]) || (ts(a.timestamp) - ts(b.timestamp));
  return ts(b.timestamp) - ts(a.timestamp);
}

/* ---------- selos informativos sobre a pessoa ---------- */
function selos(a) {
  const s = a.solicitante || {}, h = a.historico || {}, f = [];
  if (!pos(a)) f.push('<span class="flag crit">Sem localização</span>');
  if (s.idade !== null && s.idade !== undefined && s.idade < 18) f.push('<span class="flag crit">Menor de idade</span>');
  if (s.idade >= 60) f.push('<span class="flag info">Idoso</span>');
  if (h.falsosAlarmes > 0) f.push(`<span class="flag warn">${h.falsosAlarmes} falso(s) alarme(s) anterior(es)</span>`);
  else if (h.total > 0) f.push(`<span class="flag">${h.total} ocorrência(s) anterior(es)</span>`);
  return f.join('');
}
const repetido = a => a.quantidadeAcionamentos > 1 ? `<span class="rep">${a.quantidadeAcionamentos} acionamentos</span>` : '';
const precisao = a => a.localizacao?.acuraciaMetros != null ? `±${Math.round(a.localizacao.acuraciaMetros)} m` : 'precisão não informada';

/* ---------- fila ---------- */
function cardHtml(a, novo) {
  const [cls, rotulo] = prio(a), fechado = ENCERRADO(a.status), ativo = a.status === 'ATIVO';
  const fim = fechado ? ` data-until="${esc(a.encerradoEm || a.atualizadoEm)}"` : '';
  const legenda = ativo ? 'aguardando' : fechado ? 'duração' : 'aberta há';
  return `<article class="card p-${cls} s-${ativo ? 'ativo' : 'outro'}${fechado ? ' fechado' : ''}${novo ? ' novo' : ''}" data-id="${esc(a.id)}" data-since="${esc(a.timestamp)}" tabindex="0" role="button" aria-label="Abrir ocorrência de ${esc(nomeDe(a))}">
    <div class="timer"><b data-since="${esc(a.timestamp)}"${fim}>--:--:--</b><small>${legenda}</small></div>
    <div>
      <div class="top"><span class="prio">${rotulo}</span><span class="tipo">${esc(a.tipo || 'Emergência')}</span>${repetido(a)}<span>${esc(STATUS[a.status] || a.status)}</span></div>
      <h3 class="nome">${esc(nomeDe(a))}${a.solicitante?.idade != null ? `<span>${a.solicitante.idade} anos</span>` : ''}</h3>
      <div class="flags">${selos(a)}</div>
      <div class="meta">
        <span>${pos(a) ? `Local ${precisao(a)} · ${ha(a.localizacao.registradoEm)}` : 'Localização não enviada'}</span>
        ${a.atendente ? `<span>Atendente: ${esc(a.atendente)}</span>` : ''}
        <span>${esc(a.protocolo)}</span>
      </div>
    </div>
    <div class="acoes">
      <button class="btn primary" data-act="abrir" data-id="${esc(a.id)}">Abrir ficha</button>
      ${ativo ? `<button class="btn" data-act="assumir" data-id="${esc(a.id)}">Assumir</button>` : ''}
      ${!fechado ? `<button class="btn good" data-act="encerrar" data-id="${esc(a.id)}">Encerrar</button>` : ''}
    </div>
  </article>`;
}

let ultimoNovo = null;
function renderizar() {
  const n = s => alertas.filter(a => a.status === s).length;
  const ativos = n('ATIVO'), atend = n('EM_ATENDIMENTO'), res = n('RESOLVIDO'), falsos = n('FALSO_ALARME');
  const criticas = alertas.filter(a => a.status === 'ATIVO' && a.prioridade === 'CRITICA').length;
  $('metricAtivos').textContent = $('badgeAtivos').textContent = ativos;
  $('metricAtendimento').textContent = $('badgeAtendimento').textContent = atend;
  $('metricResolvidas').textContent = $('badgeResolvidas').textContent = res + falsos;
  $('metricFalsos').textContent = `${falsos} falso(s) alarme(s)`;
  $('metricCriticas').textContent = criticas ? `${criticas} crítica(s)` : 'nenhuma crítica';
  document.querySelector('.kpi.crit').classList.toggle('hot', criticas > 0);
  $('totalAlertas').textContent = alertas.length;
  document.title = ativos ? `(${ativos}) ${BASE}` : BASE;

  const lista = alertas.filter(a => filtro === 'TODOS' || (filtro === 'ENCERRADAS' ? ENCERRADO(a.status) : a.status === filtro)).sort(ordenar);
  $('alertasList').innerHTML = lista.length
    ? lista.map(a => cardHtml(a, a.id === ultimoNovo)).join('')
    : '<div class="empty"><strong>Nenhuma ocorrência nesta fila</strong>Novos acionamentos aparecem aqui sozinhos, com aviso na tela e som.</div>';
  ultimoNovo = null;
  tique();
}

/* ---------- cronômetros ---------- */
function tique() {
  $('relogio').textContent = new Date().toLocaleTimeString('pt-BR');
  document.querySelectorAll('.timer b[data-since]').forEach(el => {
    const inicio = ts(el.dataset.since);
    const fim = el.dataset.until ? ts(el.dataset.until) : Date.now();
    el.textContent = inicio !== null && fim !== null ? dur(fim - inicio) : '--:--:--';
  });
  document.querySelectorAll('.card.s-ativo').forEach(c => {
    const inicio = ts(c.dataset.since);
    const espera = inicio === null ? null : Date.now() - inicio;
    c.classList.toggle('late', espera !== null && espera > 180000 && espera <= 360000);
    c.classList.toggle('vlate', espera !== null && espera > 360000);
  });
  const maiorEspera = alertas.reduce((maior, a) => {
    if (a.status !== 'ATIVO') return maior;
    const inicio = ts(a.timestamp);
    if (inicio === null) return maior;
    const espera = Math.max(0, Date.now() - inicio);
    return maior === null ? espera : Math.max(maior, espera);
  }, null);
  $('metricEspera').textContent = maiorEspera === null ? '--:--:--' : dur(maiorEspera);
  if (document.hidden && pendentes > 0) document.title = document.title.startsWith('⚠') ? `(${pendentes}) ${BASE}` : `⚠ ${pendentes} NOVO(S) ACIONAMENTO(S)`;
}
setInterval(tique, 1000);

/* ---------- ficha da ocorrência ---------- */
const linha = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
function fichaHtml(a, notas) {
  const [cls, rotulo] = prio(a), s = a.solicitante || {}, h = a.historico || {}, fechado = ENCERRADO(a.status), L = a.localizacao;
  const velha = pos(a) && !fechado && Date.now() - ts(L.registradoEm) > 300000;
  const rota = pos(a) ? `https://www.google.com/maps/dir/?api=1&destination=${L.latitude},${L.longitude}` : '';
  return `
  <div class="f-head p-${cls}${fechado ? ' fechado' : ''}">
    <button class="f-close" data-act="fechar" aria-label="Fechar ficha">×</button>
    <div class="top"><span class="prio" style="--c:var(--${fechado ? 'muted' : 'c'})">${rotulo}</span><span class="tipo">${esc(a.tipo || 'Emergência')}</span><span>${esc(STATUS[a.status] || a.status)}</span>${repetido(a)}</div>
    <h2>${esc(nomeDe(a))}${s.idade != null ? `<span>${s.idade} anos</span>` : ''}</h2>
    <div class="f-sub">Protocolo ${esc(a.protocolo)} · recebido em ${esc(dataHora(a.timestamp))} · <b data-since="${esc(a.timestamp)}"${fechado ? ` data-until="${esc(a.encerradoEm || a.atualizadoEm)}"` : ''}></b></div>
    <div class="flags">${selos(a)}</div>
  </div>
  <div class="f-body">
    <div class="col">
      <div class="box"><h3>Onde a pessoa está</h3>
        ${pos(a) ? `<div id="mapaOcorrencia" class="mapa" aria-label="Mapa da localização"></div>
        <dl style="margin-top:12px">${linha('Coordenadas', `${(+L.latitude).toFixed(6)}, ${(+L.longitude).toFixed(6)}`)}${linha('Precisão do GPS', precisao(a))}${linha('Última posição', `<span class="${velha ? 'stale' : ''}">${esc(hora(L.registradoEm))} (${ha(L.registradoEm)})${velha ? ' · desatualizada' : ''}</span>`)}</dl>
        <div class="loc-row"><a class="btn primary" href="${rota}" target="_blank" rel="noopener">Traçar rota</a><button class="btn" data-act="copiar" data-coords="${L.latitude}, ${L.longitude}">Copiar coordenadas</button></div>`
        : '<div class="nomap">Localização não enviada. Contate a pessoa ou use o IP de origem como pista.</div>'}
      </div>
      <div class="box"><h3>Observações da equipe</h3>
        <textarea id="notas" maxlength="5000" placeholder="Registre contato feito, viatura enviada, informações da vítima…">${esc(notas)}</textarea>
        <div class="loc-row"><button class="btn" data-act="salvar" data-id="${esc(a.id)}">Salvar observações</button></div>
      </div>
    </div>
    <div class="col">
      <div class="box"><h3>Quem pediu ajuda</h3><dl>
        ${linha('Nome', esc(s.nome || '—'))}${linha('Idade', s.idade != null ? `${s.idade} anos (${esc((s.dataNascimento || '').split('-').reverse().join('/'))})` : '—')}
        ${linha('CPF', esc(cpfFmt(s.cpf)))}${linha('E-mail', esc(s.email || '—'))}${linha('ID do cliente', esc(a.clienteId))}${linha('Cadastrado em', esc(dataHora(s.cadastradoEm).split(',')[0]))}
        ${linha('Ocorrências anteriores', h.total || 0)}${linha('Falsos alarmes anteriores', h.falsosAlarmes || 0)}
      </dl></div>
      <div class="box"><h3>Sobre o acionamento</h3><dl>
        ${linha('Acionamentos do botão', a.quantidadeAcionamentos || 1)}${linha('Atendente responsável', esc(a.atendente || 'Ninguém assumiu'))}
        ${linha('Dispositivo', esc(a.dispositivo || 'Não informado'))}${linha('IP de origem', esc(a.ipOrigem || '—'))}${linha('Origem', esc(a.origem || '—'))}
        ${linha('Última atualização', esc(dataHora(a.atualizadoEm)))}${fechado ? linha('Encerrada em', esc(dataHora(a.encerradoEm))) : ''}
      </dl></div>
    </div>
  </div>
  <div class="f-actions">
    ${a.status === 'ATIVO' ? `<button class="btn primary" data-act="assumir" data-id="${esc(a.id)}">Assumir ocorrência</button>` : ''}
    <span class="sp"></span>
    ${!fechado ? `<button class="btn muted" data-act="falso" data-id="${esc(a.id)}">Marcar falso alarme</button><button class="btn good" data-act="encerrar" data-id="${esc(a.id)}">Encerrar ocorrência</button>` : ''}
  </div>`;
}

function desenharFicha() {
  const a = alertas.find(x => String(x.id) === String(fichaId));
  if (!a) return fecharFicha();
  const atual = $('notas');
  const notas = atual && notasSujas ? atual.value : (a.observacoes || '');
  if (mapa) { mapa.remove(); mapa = null; }
  $('modalBody').innerHTML = fichaHtml(a, notas);
  if (pos(a) && window.L) {
    const p = [+a.localizacao.latitude, +a.localizacao.longitude];
    mapa = L.map('mapaOcorrencia').setView(p, 17);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(mapa);
    const r = +a.localizacao.acuraciaMetros;
    if (r > 0) L.circle(p, { radius: r, color: '#ff4d5a', weight: 1, fillOpacity: .12 }).addTo(mapa);
    L.marker(p).addTo(mapa);
    setTimeout(() => mapa && mapa.invalidateSize(), 0);
  }
  tique();
}
function abrirFicha(id) {
  fichaId = id; notasSujas = false;
  $('modalAlerta').classList.remove('hidden'); $('modalAlerta').setAttribute('aria-hidden', 'false');
  desenharFicha();
  pendentes = 0;
}
function fecharFicha() {
  if (mapa) { mapa.remove(); mapa = null; }
  fichaId = null; notasSujas = false;
  $('modalAlerta').classList.add('hidden'); $('modalAlerta').setAttribute('aria-hidden', 'true');
}

async function mudarStatus(id, status, comNotas) {
  const corpo = { status };
  if (comNotas && $('notas')) corpo.observacoes = $('notas').value;
  try {
    const r = await fetch(`/api/emergencia/${encodeURIComponent(id)}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
    const j = await r.json();
    if (!r.ok || !j.sucesso) throw new Error(j.mensagem || 'Falha ao atualizar ocorrência.');
    notasSujas = false;
    if (ENCERRADO(status) && String(fichaId) === String(id)) fecharFicha();
  } catch (e) { alert(`Não foi possível atualizar: ${e.message}`); }
}

/* ---------- avisos na tela ---------- */
function aviso(a, repetida) {
  const [cls, rotulo] = prio(a);
  document.querySelectorAll(`.toast[data-id="${CSS.escape(String(a.id))}"]`).forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = `toast p-${cls}`; t.dataset.id = a.id; t.setAttribute('role', 'alert');
  t.innerHTML = `<button class="x" data-act="aviso-x" aria-label="Dispensar aviso">×</button>
    <h4>${repetida ? `Acionamento repetido (${a.quantidadeAcionamentos}×) · ` : 'Novo acionamento · '}Prioridade ${rotulo.toLowerCase()}</h4>
    <p>${esc(nomeDe(a))}${a.solicitante?.idade != null ? `, ${a.solicitante.idade} anos` : ''}<small>${esc(a.tipo || 'Emergência')} · ${pos(a) ? `local ${precisao(a)}` : 'sem localização'}${a.solicitante?.idade < 18 ? ' · menor de idade' : ''}</small></p>
    <div class="acoes"><button class="btn primary" data-act="abrir" data-id="${esc(a.id)}">Abrir ficha</button>${a.status === 'ATIVO' ? `<button class="btn" data-act="assumir" data-id="${esc(a.id)}">Assumir</button>` : ''}</div>`;
  const box = $('toasts'); box.prepend(t);
  while (box.children.length > 4) box.lastElementChild.remove();
  if (a.prioridade !== 'CRITICA' && a.prioridade !== 'ALTA') setTimeout(() => t.remove(), 20000);
}

/* ---------- som ---------- */
let ctx = null, somAtivo = true;
try { somAtivo = localStorage.getItem('somAtivo') !== '0'; } catch { /* sem storage */ }
function audio() { if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (C) ctx = new C(); } return ctx; }
function rotuloSom() {
  const b = $('btnSom'), ok = ctx && ctx.state === 'running';
  b.textContent = !somAtivo ? 'Som desligado' : ok ? 'Som ligado' : 'Ativar som';
  b.classList.toggle('off', !somAtivo); b.classList.toggle('attn', somAtivo && !ok);
  b.setAttribute('aria-pressed', String(somAtivo));
}
function destravar() { const c = audio(); if (c && c.state === 'suspended') c.resume().then(rotuloSom).catch(() => {}); rotuloSom(); }
function tom(f, t, d) {
  const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'square'; o.frequency.value = f;
  g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.12, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + d);
  o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + d + .02);
}
function tocar(critico) {
  if (!somAtivo || !ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  (critico ? [880, 660, 880, 660, 880, 660] : [740, 988]).forEach((f, i) => tom(f, t + i * .2, .17));
}
['pointerdown', 'keydown'].forEach(e => document.addEventListener(e, destravar));
$('btnSom').addEventListener('click', () => {
  somAtivo = !somAtivo;
  try { localStorage.setItem('somAtivo', somAtivo ? '1' : '0'); } catch { /* ignora */ }
  destravar(); if (somAtivo) tocar(false);
});

/* ---------- eventos em tempo real ---------- */
function marca() { $('ultimaAtualizacao').textContent = `atualizado às ${new Date().toLocaleTimeString('pt-BR')}`; }
function chegou(a, repetida) {
  alertas = [a, ...alertas.filter(x => x.id !== a.id)];
  ultimoNovo = a.id; renderizar(); marca();
  aviso(a, repetida); tocar(a.prioridade === 'CRITICA');
  if (String(fichaId) === String(a.id)) desenharFicha();
  if (document.hidden) {
    pendentes++;
    if ('Notification' in window && Notification.permission === 'granted') new Notification(repetida ? 'Acionamento repetido' : 'Novo acionamento de emergência', { body: `${nomeDe(a)} — ${a.tipo || 'Emergência'}` });
  }
}
socket.on('connect', () => { $('statusConexao').innerHTML = '<i class="dot on"></i>Online'; marca(); });
socket.on('disconnect', () => { $('statusConexao').innerHTML = '<i class="dot off"></i>Offline'; });
socket.on('carregar-alertas', d => { alertas = Array.isArray(d) ? d : []; renderizar(); marca(); });
socket.on('novo-alerta', a => chegou(a, false));
socket.on('novo-acionamento', a => chegou(a, true));
socket.on('alerta-atualizado', a => {
  const i = alertas.findIndex(x => x.id === a.id);
  if (i !== -1) alertas[i] = a; else alertas.unshift(a);
  if (a.status !== 'ATIVO') document.querySelectorAll(`.toast[data-id="${CSS.escape(String(a.id))}"]`).forEach(t => t.remove());
  renderizar(); marca();
  if (String(fichaId) === String(a.id)) desenharFicha();
});
socket.on('usuarios-conectados', n => { $('usuariosConectados').textContent = n; });

/* ---------- interação ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) {
    const card = e.target.closest('.card'); if (card) abrirFicha(card.dataset.id);
    if (e.target === $('modalAlerta')) fecharFicha();
    return;
  }
  const id = b.dataset.id;
  switch (b.dataset.act) {
    case 'abrir': abrirFicha(id); break;
    case 'assumir': mudarStatus(id, 'EM_ATENDIMENTO', String(fichaId) === String(id)); break;
    case 'encerrar': mudarStatus(id, 'RESOLVIDO', String(fichaId) === String(id)); break;
    case 'falso': if (confirm('Marcar esta ocorrência como falso alarme?')) mudarStatus(id, 'FALSO_ALARME', true); break;
    case 'salvar': { const a = alertas.find(x => String(x.id) === String(id)); if (a) mudarStatus(id, a.status, true); break; }
    case 'copiar': navigator.clipboard?.writeText(b.dataset.coords).then(() => { b.textContent = 'Copiado'; setTimeout(() => { b.textContent = 'Copiar coordenadas'; }, 1500); }); break;
    case 'fechar': fecharFicha(); break;
    case 'aviso-x': b.closest('.toast').remove(); break;
  }
});
document.addEventListener('input', e => { if (e.target.id === 'notas') notasSujas = true; });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') fecharFicha();
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('card')) { e.preventDefault(); abrirFicha(e.target.dataset.id); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) { pendentes = 0; renderizar(); } });
document.querySelectorAll('.filtro').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.filtro').forEach(x => x.classList.remove('active')); b.classList.add('active');
  filtro = b.dataset.filtro; renderizar();
}));

fetch('/api/auth/me', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).then(d => {
  const n = d?.usuario?.nome || d?.usuario?.usuario;
  if (n) { $('nomeUsuario').textContent = n; $('usuarioLogado').hidden = false; }
}).catch(() => {});
if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
rotuloSom(); renderizar();
