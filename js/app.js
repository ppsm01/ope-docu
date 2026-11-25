import { md, esc } from './md.js';
import { kv, items, files, borrarTodo } from './db.js';
import * as sync from './sync.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const main = $('#main');
const NIVEL = { 1: 'Fácil', 2: 'Intermedio', 3: 'Difícil', 0: 'Mixta' };
const TAM = { 30: 'Corto', 50: 'Intermedio', 100: 'Normal' };
const PEN = { 0: 'Sin penalización', 3: 'Cada fallo resta 1/3', 4: 'Cada fallo resta 1/4' };

const S = {
  indice: null, temas: new Map(), porId: new Map(), // porId: tema del índice
  tests: [], docs: [], stats: new Map(),
  curso: null, // test en marcha
  cfgTest: null,
};

/* ---------- utilidades ---------- */
const barajar = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const fecha = ts => new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
const fechaHora = ts => new Date(ts).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dur = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const tamano = b => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('ver'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('ver'), 3200); }
const todosTemas = () => S.indice.partes.flatMap(p => p.bloques.flatMap(b => b.temas));
const temasDe = pid => S.indice.partes.find(p => p.id === pid).bloques.flatMap(b => b.temas);

async function cargarTema(id) {
  if (!S.temas.has(id)) {
    const r = await fetch(`data/temas/${id}.json?v=${S.indice.version}`);
    if (!r.ok) throw new Error('No se pudo cargar el tema ' + id);
    const t = await r.json();
    t.pq = new Map(t.preguntas.map(p => [p.id, p]));
    S.temas.set(id, t);
  }
  return S.temas.get(id);
}
const cargarTemas = ids => Promise.all(ids.map(cargarTema));
const temaDePregunta = qid => qid.split('-')[0];
const pregunta = qid => S.temas.get(temaDePregunta(qid))?.pq.get(qid);

/* ---------- datos del usuario ---------- */
async function recargarUsuario() {
  const todo = await items.all();
  S.tests = todo.filter(i => i.kind === 'test' && !i.deleted).sort((a, b) => b.data.ts - a.data.ts);
  S.docs = todo.filter(i => i.kind === 'doc' && !i.deleted).sort((a, b) => b.updated - a.updated);
  S.stats = new Map();
  for (const t of [...S.tests].reverse()) for (const [q, e, ok] of t.data.r) {
    if (e < 0) continue;
    const s = S.stats.get(q) || { v: 0, a: 0, ok: false };
    s.v++; s.a += ok; s.ok = !!ok; S.stats.set(q, s);
  }
}
function resumenTemas(ids) {
  let total = 0, vistas = 0, resp = 0, aciertos = 0, falladas = 0;
  for (const id of ids) {
    const t = S.porId.get(id); if (!t) continue;
    total += t.total;
  }
  const set = new Set(ids);
  for (const [q, s] of S.stats) if (set.has(temaDePregunta(q))) { vistas++; resp += s.v; aciertos += s.a; if (!s.ok) falladas++; }
  return { total, vistas, resp, aciertos, falladas };
}

/* ---------- navegación ---------- */
const rutas = {};
function ir(h) { if (location.hash === h) render(); else location.hash = h; }
async function render() {
  const [, ruta = 'inicio', ...args] = location.hash.split('/');
  const vista = rutas[ruta] || rutas.inicio;
  document.body.classList.toggle('en-test', ruta === 'hacer');
  $$('#nav a').forEach(a => a.classList.toggle('activo', a.dataset.tab === (ruta === 'hacer' || ruta === 'resultado' ? 'test' : ruta === 'docs' ? 'teoria' : ruta)));
  try { await vista(...args.map(decodeURIComponent)); }
  catch (e) { console.error(e); main.innerHTML = `<section class="pag"><h1>Algo ha fallado</h1><p class="aviso err">${esc(e.message)}</p><p><a class="btn" href="#/inicio">Volver al inicio</a></p></section>`; }
  if (ruta !== 'hacer') window.scrollTo(0, 0);
}
window.addEventListener('hashchange', render);

/* ---------- INICIO ---------- */
rutas.inicio = async () => {
  const r = resumenTemas(todosTemas().map(t => t.id));
  const ult = S.tests.slice(0, 3);
  main.innerHTML = `<section class="pag">
    <header class="cab"><h1>Documentación Sanitaria</h1><p class="sub">Oposición SERMAS · estudio por test</p></header>
    ${S.curso ? `<div class="tarjeta destacada"><div><strong>Tienes un test a medias</strong><br><span class="sub">${S.curso.resp.filter(x => x != null).length} de ${S.curso.qs.length} respondidas · ${esc(S.curso.cfg.etiqueta)}</span></div><a class="btn pri" href="#/hacer">Continuar</a></div>` : ''}
    <div class="cifras">
      <div><b>${S.tests.length}</b><span>tests hechos</span></div>
      <div><b>${pct(r.aciertos, r.resp)}%</b><span>de acierto</span></div>
      <div><b>${pct(r.vistas, r.total)}%</b><span>del banco visto</span></div>
      <div><b>${r.falladas}</b><span>por repasar</span></div>
    </div>
    <div class="acciones">
      <a class="btn pri grande" href="#/test">Nuevo test</a>
      <button class="btn grande" data-act="rapido" data-n="30">Test rápido · 30 preguntas de todo</button>
      ${r.falladas ? `<button class="btn grande" data-act="fallos">Repasar mis fallos (${r.falladas})</button>` : ''}
      <a class="btn grande" href="#/teoria">Consultar la teoría</a>
    </div>
    ${ult.length ? `<h2>Últimos tests</h2><ul class="lista">${ult.map(filaTest).join('')}</ul>` : `<p class="aviso">El banco tiene <b>${r.total.toLocaleString('es-ES')}</b> preguntas repartidas en ${todosTemas().length} temas (temario común y específico), con tres niveles de dificultad.</p>`}
  </section>`;
};
const filaTest = t => `<li><a href="#/resultado/${t.id}"><span class="nota ${t.data.nota >= 5 ? 'ok' : 'ko'}">${t.data.nota.toFixed(1)}</span><span class="cuerpo"><b>${esc(t.data.etiqueta)}</b><small>${fechaHora(t.data.ts)} · ${t.data.r.length} preguntas · ${NIVEL[t.data.nivel]} · ${t.data.modo === 'examen' ? 'Examen' : 'Estudio'}</small></span></a></li>`;

/* ---------- CONFIGURAR TEST ---------- */
function cfgPorDefecto() {
  return { tam: 30, nivel: 2, modo: 'estudio', pen: 0, soloFalladas: false, temas: new Set(todosTemas().map(t => t.id)) };
}
function etiquetaAmbito(sel) {
  const all = todosTemas();
  if (sel.size === all.length) return 'Temario completo';
  for (const p of S.indice.partes) {
    const ids = temasDe(p.id).map(t => t.id);
    if (ids.length === sel.size && ids.every(i => sel.has(i))) return p.titulo.replace(/ \(.*/, '');
  }
  const bloques = S.indice.partes.flatMap(p => p.bloques);
  const completos = bloques.filter(b => b.temas.every(t => sel.has(t.id)));
  const nCompletos = completos.reduce((n, b) => n + b.temas.length, 0);
  if (completos.length && nCompletos === sel.size) return completos.length === 1 ? completos[0].titulo : completos.length + ' bloques';
  if (sel.size === 1) return S.porId.get([...sel][0]).titulo;
  return sel.size + ' temas';
}
function disponibles(c) {
  let n = 0;
  for (const id of c.temas) { const t = S.porId.get(id); n += c.nivel ? t.n[c.nivel] : t.total; }
  return n;
}
rutas.test = async () => {
  const c = S.cfgTest || (S.cfgTest = cfgPorDefecto());
  const chips = (campo, ops) => `<div class="chips">${(Array.isArray(ops) ? ops : Object.entries(ops)).map(([v, t]) => `<button class="chip ${String(c[campo]) === String(v) ? 'sel' : ''}" data-act="cfg" data-campo="${campo}" data-valor="${v}">${t}</button>`).join('')}</div>`;
  const arbol = S.indice.partes.map(p => {
    const idsP = temasDe(p.id).map(t => t.id), nP = idsP.filter(i => c.temas.has(i)).length;
    return `<details class="parte" ${nP && nP < idsP.length ? 'open' : ''}><summary><label class="chk" data-stop><input type="checkbox" data-act="selgrupo" data-ids="${idsP.join(',')}" ${nP === idsP.length ? 'checked' : ''} ${nP && nP < idsP.length ? 'data-medio' : ''}><span>${esc(p.titulo)}</span></label><em>${nP}/${idsP.length}</em></summary>
    ${p.bloques.map(b => {
      const ids = b.temas.map(t => t.id), nB = ids.filter(i => c.temas.has(i)).length;
      return `<details class="bloque" ${nB && nB < ids.length ? 'open' : ''}><summary><label class="chk" data-stop><input type="checkbox" data-act="selgrupo" data-ids="${ids.join(',')}" ${nB === ids.length ? 'checked' : ''} ${nB && nB < ids.length ? 'data-medio' : ''}><span>${esc(b.titulo)}</span></label><em>${nB}/${ids.length}</em></summary>
      ${b.temas.map(t => `<label class="chk tema"><input type="checkbox" data-act="seltema" data-id="${t.id}" ${c.temas.has(t.id) ? 'checked' : ''}><span>${esc(t.titulo)}</span></label>`).join('')}</details>`;
    }).join('')}</details>`;
  }).join('');
  const disp = disponibles(c), fall = resumenTemas([...c.temas]).falladas;
  main.innerHTML = `<section class="pag">
    <header class="cab"><h1>Nuevo test</h1></header>
    <h2>Extensión</h2>
    ${chips('tam', { 30: 'Corto · 30', 50: 'Intermedio · 50', 100: 'Normal · 100' })}
    <h2>Dificultad</h2>
    ${chips('nivel', [[1, 'Fácil'], [2, 'Intermedio'], [3, 'Difícil'], [0, 'Mixta']])}
    <h2>Modo</h2>
    ${chips('modo', { estudio: 'Estudio', examen: 'Examen' })}
    <p class="sub nota-modo">${c.modo === 'estudio' ? 'Tras cada respuesta verás si has acertado, la respuesta correcta y la teoría que la explica.' : 'Sin correcciones hasta el final, con cronómetro. Al terminar revisas los fallos con su teoría.'}</p>
    ${c.modo === 'examen' ? `<h2>Penalización</h2>${chips('pen', PEN)}` : ''}
    <h2>Temario</h2>
    <div class="chips">
      <button class="chip" data-act="preset" data-p="todo">Completo</button>
      <button class="chip" data-act="preset" data-p="comun">Común</button>
      <button class="chip" data-act="preset" data-p="especifico">Específico</button>
      <button class="chip" data-act="preset" data-p="nada">Ninguno</button>
    </div>
    <p class="sub">Marca partes, bloques o temas sueltos. Puedes combinar varios bloques.</p>
    <div class="arbol">${arbol}</div>
    <label class="chk suelto"><input type="checkbox" data-act="cfgbool" data-campo="soloFalladas" ${c.soloFalladas ? 'checked' : ''}><span>Solo preguntas que he fallado antes (${fall} en esta selección)</span></label>
    <div class="pie-fijo">
      <div class="sub"><b>${esc(c.temas.size ? etiquetaAmbito(c.temas) : 'Sin temas')}</b> · ${disp.toLocaleString('es-ES')} preguntas disponibles${disp && disp < c.tam && !c.soloFalladas ? ` (el test tendrá ${disp})` : ''}</div>
      <button class="btn pri grande" data-act="empezar" ${c.temas.size && disp ? '' : 'disabled'}>Empezar test</button>
    </div>
  </section>`;
  $$('input[data-medio]', main).forEach(i => (i.indeterminate = true));
};

async function crearTest(c) {
  const ids = [...c.temas];
  main.innerHTML = '<p class="cargando">Preparando el test…</p>';
  const temas = await cargarTemas(ids);
  const colas = barajar(temas).map(t => {
    let cand = t.preguntas.filter(p => !c.nivel || p.d === +c.nivel);
    if (c.soloFalladas) cand = cand.filter(p => S.stats.has(p.id) && !S.stats.get(p.id).ok);
    const prio = p => { const s = S.stats.get(p.id); return !s ? 0 : !s.ok ? 1 : 2; };
    return barajar(cand).sort((a, b) => prio(a) - prio(b));
  }).filter(q => q.length);
  const elegidas = [];
  for (let vuelta = 0; elegidas.length < c.tam && colas.some(q => q[vuelta]); vuelta++)
    for (const q of colas) { if (elegidas.length >= c.tam) break; if (q[vuelta]) elegidas.push(q[vuelta]); }
  if (!elegidas.length) { toast('No hay preguntas con esos criterios'); return ir('#/test'); }
  S.curso = {
    cfg: { tam: +c.tam, nivel: +c.nivel, modo: c.modo, pen: c.modo === 'examen' ? +c.pen : 0, etiqueta: (c.soloFalladas ? 'Repaso de fallos · ' : '') + etiquetaAmbito(c.temas), temas: ids },
    qs: barajar(elegidas).map(p => ({ id: p.id, perm: barajar([0, 1, 2, 3]) })),
    resp: Array(elegidas.length).fill(null), marcas: [], i: 0, seg: 0,
  };
  await kv.set('curso', S.curso);
  if (elegidas.length < c.tam) toast(`Solo hay ${elegidas.length} preguntas con esos criterios`);
  ir('#/hacer');
}

/* ---------- HACER TEST ---------- */
let reloj;
function bloqueTeoria(p, abierto) {
  const t = S.temas.get(temaDePregunta(p.id));
  const sec = t?.secciones.find(s => s.n === p.sec);
  if (!sec) return '';
  return `<details class="teo" ${abierto ? 'open' : ''}><summary>Teoría · ${esc(sec.titulo)}</summary><div class="md">${md(sec.md)}</div><p class="sub origen">${esc(t.titulo)} · <a href="#/teoria/${t.id}/${sec.n}">abrir en Teoría</a></p></details>`;
}
function bloqueCorreccion(p, elegida) {
  const ok = elegida === p.c;
  return `<div class="corr ${ok ? 'ok' : 'ko'}">
    <p class="veredicto">${ok ? '✓ Correcta' : elegida == null || elegida < 0 ? 'Sin responder' : '✗ Incorrecta'}</p>
    ${ok ? '' : `<p><b>Respuesta correcta:</b> ${esc(p.o[p.c])}</p>`}
    <p>${esc(p.exp)}</p>
    ${bloqueTeoria(p, !ok)}
  </div>`;
}
rutas.hacer = async () => {
  const T = S.curso;
  if (!T) return ir('#/test');
  await cargarTemas([...new Set(T.qs.map(q => temaDePregunta(q.id)))]);
  const estudio = T.cfg.modo === 'estudio';
  const q = T.qs[T.i], p = pregunta(q.id), r = T.resp[T.i];
  const corregida = estudio && r != null;
  const hechas = T.resp.filter(x => x != null).length;
  const tema = S.porId.get(temaDePregunta(q.id));
  main.innerHTML = `<section class="pag hacer">
    <header class="barra-test">
      <button class="btn mini" data-act="salirtest" aria-label="Salir del test">✕</button>
      <div class="prog"><div style="width:${pct(hechas, T.qs.length)}%"></div></div>
      <span class="cuenta">${T.i + 1}/${T.qs.length}</span>
      ${estudio ? '' : `<span class="crono" id="crono">${dur(T.seg)}</span>`}
    </header>
    <p class="sub meta">${esc(tema.titulo)} · ${NIVEL[p.d]}</p>
    <h2 class="enunciado">${esc(p.q)}</h2>
    <div class="opciones">${q.perm.map((orig, k) => {
      let cl = '';
      if (corregida) cl = orig === p.c ? 'bien' : orig === r ? 'mal' : 'gris';
      else if (r === orig) cl = 'sel';
      return `<button class="op ${cl}" data-act="resp" data-o="${orig}" ${corregida ? 'disabled' : ''}><span class="letra">${'ABCD'[k]}</span><span>${esc(p.o[orig])}</span></button>`;
    }).join('')}</div>
    ${corregida ? bloqueCorreccion(p, r) : ''}
    <footer class="pie-test">
      ${estudio ? '' : `<button class="btn" data-act="mov" data-d="-1" ${T.i ? '' : 'disabled'}>‹ Anterior</button>
        <button class="btn ${T.marcas.includes(T.i) ? 'marcada' : ''}" data-act="marcar">⚑ ${T.marcas.includes(T.i) ? 'Marcada' : 'Dudosa'}</button>`}
      ${estudio
        ? (corregida ? `<button class="btn pri grande" data-act="${T.i < T.qs.length - 1 ? 'sig' : 'fin'}">${T.i < T.qs.length - 1 ? 'Siguiente' : 'Ver resultado'}</button>` : `<button class="btn" data-act="sig-saltar">${T.i < T.qs.length - 1 ? 'Saltar' : 'Terminar'}</button>`)
        : (T.i < T.qs.length - 1 ? `<button class="btn pri" data-act="mov" data-d="1">Siguiente ›</button>` : `<button class="btn pri" data-act="finexamen">Finalizar</button>`)}
    </footer>
    ${estudio ? '' : `<details class="mapa"><summary>Ver todas las preguntas (${hechas} respondidas${T.marcas.length ? ', ' + T.marcas.length + ' dudosas' : ''})</summary><div class="rejilla">${T.qs.map((_, k) => `<button data-act="saltar" data-k="${k}" class="${T.resp[k] != null ? 'hecha' : ''} ${T.marcas.includes(k) ? 'duda' : ''} ${k === T.i ? 'actual' : ''}">${k + 1}</button>`).join('')}</div><button class="btn pri" data-act="finexamen">Finalizar examen</button></details>`}
  </section>`;
  clearInterval(reloj);
  reloj = setInterval(() => {
    if (!S.curso || !location.hash.startsWith('#/hacer')) return clearInterval(reloj);
    if (document.hidden) return;
    S.curso.seg++;
    const c = $('#crono'); if (c) c.textContent = dur(S.curso.seg);
    if (S.curso.seg % 15 === 0) kv.set('curso', S.curso);
  }, 1000);
};

async function terminarTest() {
  const T = S.curso; if (!T) return;
  clearInterval(reloj);
  const r = T.qs.map((q, k) => { const e = T.resp[k] ?? -1; return [q.id, e, e === pregunta(q.id).c ? 1 : 0]; });
  const ac = r.filter(x => x[2]).length, bl = r.filter(x => x[1] < 0).length, fa = r.length - ac - bl;
  if (ac + fa === 0) { S.curso = null; await kv.del('curso'); toast('Test descartado (sin respuestas)'); return ir('#/inicio'); }
  // En modo estudio, las preguntas no contestadas no cuentan: se evalúa lo respondido.
  const base = T.cfg.modo === 'estudio' ? ac + fa : r.length;
  const netos = Math.max(0, ac - (T.cfg.pen ? fa / T.cfg.pen : 0));
  const data = { ...T.cfg, ts: Date.now(), dur: T.seg, r: T.cfg.modo === 'estudio' ? r.filter(x => x[1] >= 0) : r, ac, fa, bl: T.cfg.modo === 'estudio' ? 0 : bl, nota: Math.round((netos / base) * 1000) / 100 };
  const it = await items.save('test', data);
  S.curso = null; await kv.del('curso');
  await recargarUsuario();
  sync.sincronizar();
  ir('#/resultado/' + it.id);
}

/* ---------- RESULTADO ---------- */
rutas.resultado = async (id, filtro = 'fallos') => {
  const t = S.tests.find(x => x.id === id);
  if (!t) return ir('#/progreso');
  const d = t.data;
  await cargarTemas([...new Set(d.r.map(x => temaDePregunta(x[0])))]);
  const porTema = new Map();
  for (const [q, e, ok] of d.r) { const k = temaDePregunta(q); const o = porTema.get(k) || { n: 0, a: 0 }; o.n++; o.a += ok; porTema.set(k, o); }
  const lista = d.r.map((x, k) => ({ x, k })).filter(({ x }) => filtro === 'todas' || !x[2]);
  main.innerHTML = `<section class="pag">
    <header class="cab"><h1>Resultado</h1><p class="sub">${esc(d.etiqueta)} · ${NIVEL[d.nivel]} · ${d.modo === 'examen' ? 'Examen' : 'Estudio'} · ${fechaHora(d.ts)}</p></header>
    <div class="marcador ${d.nota >= 5 ? 'ok' : 'ko'}"><b>${d.nota.toFixed(2)}</b><span>sobre 10${d.pen ? ' · ' + PEN[d.pen].toLowerCase() : ''}</span></div>
    <div class="cifras">
      <div class="v"><b>${d.ac}</b><span>aciertos</span></div>
      <div class="r"><b>${d.fa}</b><span>fallos</span></div>
      <div><b>${d.bl}</b><span>en blanco</span></div>
      <div><b>${dur(d.dur || 0)}</b><span>tiempo</span></div>
    </div>
    ${porTema.size > 1 ? `<h2>Por tema</h2><ul class="barras">${[...porTema].sort((a, b) => a[1].a / a[1].n - b[1].a / b[1].n).map(([k, o]) => `<li><span>${esc(S.porId.get(k)?.titulo || k)}</span><i><u style="width:${pct(o.a, o.n)}%"></u></i><em>${o.a}/${o.n}</em></li>`).join('')}</ul>` : ''}
    <div class="acciones fila">
      ${d.fa + d.bl ? `<button class="btn pri" data-act="repetirfallos" data-id="${id}">Repetir las falladas</button>` : ''}
      <a class="btn" href="#/test">Nuevo test</a>
    </div>
    <h2>Revisión</h2>
    <div class="chips"><a class="chip ${filtro !== 'todas' ? 'sel' : ''}" href="#/resultado/${id}/fallos">Fallos y en blanco (${d.fa + d.bl})</a><a class="chip ${filtro === 'todas' ? 'sel' : ''}" href="#/resultado/${id}/todas">Todas (${d.r.length})</a></div>
    ${lista.length ? lista.map(({ x: [q, e], k }) => {
      const p = pregunta(q);
      if (!p) return `<article class="rev"><p class="sub">Pregunta ${k + 1}: ya no está en el banco.</p></article>`;
      return `<article class="rev"><p class="sub meta">${k + 1} · ${esc(S.porId.get(temaDePregunta(q))?.titulo || '')}</p><h3>${esc(p.q)}</h3>
        <ul class="ops">${p.o.map((o, i) => `<li class="${i === p.c ? 'bien' : i === e ? 'mal' : ''}">${esc(o)}${i === e && i !== p.c ? ' <em>(tu respuesta)</em>' : ''}</li>`).join('')}</ul>
        ${bloqueCorreccion(p, e).replace(/<details class="teo" open>/, '<details class="teo">')}</article>`;
    }).join('') : '<p class="aviso">¡Pleno! No hay fallos que revisar.</p>'}
  </section>`;
};

/* ---------- TEORÍA ---------- */
rutas.teoria = async (id, sec) => {
  if (id) return vistaTema(id, sec);
  main.innerHTML = `<section class="pag">
    <header class="cab"><h1>Teoría</h1><p class="sub">Todo el temario, tus apuntes y documentos</p></header>
    <input type="search" id="busca" placeholder="Buscar en toda la teoría…" autocomplete="off">
    <div id="resbusca"></div>
    <div id="indiceTeoria">
    <div class="acciones fila"><a class="btn" href="#/docs">Mis documentos (${S.docs.length})</a><button class="btn" data-act="nuevodoc">+ Añadir documentación</button></div>
    ${S.indice.partes.map(p => `<h2>${esc(p.titulo)}</h2>${p.bloques.map(b => `<details class="bloque teoria" ><summary><span>${esc(b.titulo)}</span><em>${b.temas.length} temas</em></summary><ul class="lista">${b.temas.map(t => {
      const nd = S.docs.filter(d => d.data.tema === t.id).length;
      return `<li><a href="#/teoria/${t.id}"><span class="cuerpo"><b>${esc(t.titulo)}</b><small>${t.secs} apartados · ${t.total} preguntas${nd ? ' · ' + nd + ' doc. propios' : ''}</small></span><span class="flecha">›</span></a></li>`;
    }).join('')}</ul></details>`).join('')}`).join('')}
    </div>
  </section>`;
  let tb;
  $('#busca').addEventListener('input', e => { clearTimeout(tb); tb = setTimeout(() => buscar(e.target.value), 250); });
};
const sinTildes = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
async function buscar(texto) {
  const caja = $('#resbusca'), ind = $('#indiceTeoria');
  const q = sinTildes(texto.trim());
  if (q.length < 3) { caja.innerHTML = ''; ind.hidden = false; return; }
  ind.hidden = true;
  if (S.temas.size < todosTemas().length) caja.innerHTML = '<p class="cargando">Buscando…</p>';
  await cargarTemas(todosTemas().map(t => t.id));
  if (sinTildes($('#busca')?.value.trim() || '') !== q) return;
  const res = [];
  for (const t of S.temas.values()) for (const s of t.secciones) {
    const plano = sinTildes(s.titulo + '\n' + s.md), pos = plano.indexOf(q);
    if (pos < 0) continue;
    const orig = s.titulo + '\n' + s.md, ini = Math.max(0, pos - 70);
    res.push({ t, s, frag: (ini ? '…' : '') + orig.slice(ini, pos + q.length + 110).replace(/[#*|>]/g, '').replace(/\s+/g, ' ') + '…', n: plano.split(q).length - 1 });
  }
  for (const d of S.docs) if (sinTildes((d.data.titulo || '') + ' ' + (d.data.texto || '')).includes(q)) res.push({ doc: d, n: 99 });
  res.sort((a, b) => b.n - a.n);
  caja.innerHTML = res.length ? `<p class="sub">${res.length} resultados</p><ul class="lista">${res.slice(0, 60).map(r => r.doc
    ? `<li><a href="#/docs/${r.doc.id}"><span class="cuerpo"><b>📎 ${esc(r.doc.data.titulo)}</b><small>Documento propio</small></span></a></li>`
    : `<li><a href="#/teoria/${r.t.id}/${r.s.n}"><span class="cuerpo"><b>${esc(r.s.titulo)}</b><small>${esc(r.t.titulo)}</small><small class="frag">${esc(r.frag)}</small></span></a></li>`).join('')}</ul>` : '<p class="aviso">Sin resultados.</p>';
}
async function vistaTema(id, sec) {
  const t = await cargarTema(id), meta = S.porId.get(id);
  const docs = S.docs.filter(d => d.data.tema === id);
  const r = resumenTemas([id]);
  main.innerHTML = `<section class="pag tema">
    <p class="miga"><a href="#/teoria">‹ Teoría</a></p>
    <header class="cab"><h1>${esc(t.titulo)}</h1><p class="sub">${t.secciones.length} apartados · ${meta.total} preguntas · ${r.vistas ? pct(r.aciertos, r.resp) + '% de acierto' : 'sin practicar'}</p></header>
    <div class="acciones fila"><button class="btn pri" data-act="testtema" data-id="${id}">Hacer test de este tema</button><button class="btn" data-act="nuevodoc" data-tema="${id}">+ Añadir documentación</button><button class="btn" data-act="abrirtodo">Desplegar todo</button></div>
    ${docs.length ? `<h2>Mi documentación de este tema</h2><ul class="lista">${docs.map(filaDoc).join('')}</ul>` : ''}
    <h2>Apartados</h2>
    ${t.secciones.map(s => `<details class="sec" id="sec-${s.n}" ${String(s.n) === String(sec) ? 'open' : ''}><summary>${s.n}. ${esc(s.titulo)}</summary><div class="md">${md(s.md)}</div></details>`).join('')}
  </section>`;
  if (sec) setTimeout(() => $('#sec-' + sec)?.scrollIntoView({ block: 'start' }), 60);
}

/* ---------- DOCUMENTOS PROPIOS ---------- */
const filaDoc = d => `<li><a href="#/docs/${d.id}"><span class="cuerpo"><b>${d.data.hasFile ? '📎 ' : '📝 '}${esc(d.data.titulo)}</b><small>${d.data.tema ? esc(S.porId.get(d.data.tema)?.titulo || '') + ' · ' : ''}${fecha(d.updated)}${d.data.hasFile ? ' · ' + esc(d.data.fileName) + ' (' + tamano(d.data.fileSize) + ')' : ''}</small></span><span class="flecha">›</span></a></li>`;
rutas.docs = async (id, extra) => {
  if (id === 'nuevo' || extra === 'editar') return formDoc(id === 'nuevo' ? null : id, id === 'nuevo' ? extra : null);
  if (id) return verDoc(id);
  main.innerHTML = `<section class="pag">
    <p class="miga"><a href="#/teoria">‹ Teoría</a></p>
    <header class="cab"><h1>Mis documentos</h1><p class="sub">Apuntes, esquemas, PDF y fotos que añades tú</p></header>
    <div class="acciones fila"><button class="btn pri" data-act="nuevodoc">+ Añadir documentación</button></div>
    ${S.docs.length ? `<ul class="lista">${S.docs.map(filaDoc).join('')}</ul>` : '<p class="aviso">Aún no has añadido nada. Puedes pegar texto (apuntes, artículos de una ley, esquemas) o adjuntar un archivo (PDF, imagen, Word…) y asignarlo a un tema para tenerlo junto a su teoría.</p>'}
  </section>`;
};
function formDoc(id, temaPre) {
  const d = id ? S.docs.find(x => x.id === id) : null;
  if (id && !d) return ir('#/docs');
  const v = d?.data || { titulo: '', tema: temaPre || '', texto: '' };
  main.innerHTML = `<section class="pag">
    <p class="miga"><a href="${d ? '#/docs/' + id : temaPre ? '#/teoria/' + temaPre : '#/docs'}">‹ Cancelar</a></p>
    <header class="cab"><h1>${d ? 'Editar documento' : 'Añadir documentación'}</h1></header>
    <form id="fdoc" class="form">
      <label>Título<input name="titulo" required maxlength="140" value="${esc(v.titulo)}" placeholder="p. ej. Esquema de plazos de conservación"></label>
      <label>Tema al que pertenece<select name="tema"><option value="">General (sin tema)</option>${S.indice.partes.map(p => p.bloques.map(b => `<optgroup label="${esc(b.titulo)}">${b.temas.map(t => `<option value="${t.id}" ${v.tema === t.id ? 'selected' : ''}>${esc(t.titulo)}</option>`).join('')}</optgroup>`).join('')).join('')}</select></label>
      <label>Texto / apuntes <small>(opcional; admite **negrita**, listas con - y títulos con ##)</small><textarea name="texto" rows="10" placeholder="Pega o escribe aquí el contenido…">${esc(v.texto || '')}</textarea></label>
      <label>Archivo adjunto <small>(opcional: PDF, imagen, Word… máx. 25 MB)</small><input type="file" name="fichero">${v.hasFile ? `<small>Actual: ${esc(v.fileName)} — elige otro para sustituirlo</small>` : ''}</label>
      <button class="btn pri grande">Guardar</button>
    </form>
  </section>`;
  $('#fdoc').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target), fich = f.get('fichero');
    const texto = f.get('texto').trim();
    const hayFich = fich && fich.size > 0;
    if (!texto && !hayFich && !v.hasFile) return toast('Escribe un texto o adjunta un archivo');
    if (hayFich && fich.size > 25 * 1048576) return toast('El archivo supera los 25 MB');
    const data = { titulo: f.get('titulo').trim(), tema: f.get('tema') || null, texto, hasFile: hayFich || !!v.hasFile, fileName: hayFich ? fich.name : v.fileName, fileType: hayFich ? fich.type : v.fileType, fileSize: hayFich ? fich.size : v.fileSize };
    const it = await items.save('doc', data, id || undefined);
    if (hayFich) await files.set(it.id, fich);
    else if (d?.fileUp) await items.putRaw({ ...it, fileUp: true });
    await recargarUsuario(); sync.sincronizar();
    toast('Documento guardado'); ir('#/docs/' + it.id);
  });
}
async function verDoc(id) {
  const d = S.docs.find(x => x.id === id);
  if (!d) return ir('#/docs');
  const v = d.data;
  main.innerHTML = `<section class="pag tema">
    <p class="miga"><a href="${v.tema ? '#/teoria/' + v.tema : '#/docs'}">‹ ${v.tema ? esc(S.porId.get(v.tema)?.titulo || 'Tema') : 'Mis documentos'}</a></p>
    <header class="cab"><h1>${esc(v.titulo)}</h1><p class="sub">Documento propio · ${fecha(d.updated)}</p></header>
    <div class="acciones fila"><a class="btn" href="#/docs/${id}/editar">Editar</a><button class="btn peligro" data-act="borrardoc" data-id="${id}">Eliminar</button></div>
    ${v.hasFile ? `<div class="tarjeta" id="adj"><div><strong>📎 ${esc(v.fileName)}</strong><br><span class="sub">${tamano(v.fileSize)}</span></div><button class="btn pri" data-act="abrirfich" data-id="${id}">Abrir</button></div><div id="vistafich"></div>` : ''}
    ${v.texto ? `<div class="md suelto">${md(v.texto)}</div>` : ''}
  </section>`;
  if (v.hasFile && /^image\//.test(v.fileType || '')) { const b = await obtenerFichero(id).catch(() => null); if (b && $('#vistafich')) $('#vistafich').innerHTML = `<img src="${URL.createObjectURL(b)}" alt="">`; }
}
async function obtenerFichero(id) {
  let b = await files.get(id);
  if (!b) { toast('Descargando archivo…'); b = await sync.bajarFichero(id); }
  if (!b) throw new Error('El archivo no está en este dispositivo. Activa la sincronización para traerlo.');
  return b;
}

/* ---------- PROGRESO ---------- */
rutas.progreso = async () => {
  const g = resumenTemas(todosTemas().map(t => t.id));
  const fila = (titulo, ids, cls = '') => { const r = resumenTemas(ids); return `<li class="${cls}"><span>${esc(titulo)}</span><i><u style="width:${pct(r.aciertos, r.resp)}%"></u></i><em>${r.resp ? pct(r.aciertos, r.resp) + '%' : '—'}<small>${pct(r.vistas, r.total)}% visto</small></em></li>`; };
  main.innerHTML = `<section class="pag">
    <header class="cab"><h1>Progreso</h1></header>
    <div class="cifras">
      <div><b>${S.tests.length}</b><span>tests</span></div>
      <div><b>${g.resp.toLocaleString('es-ES')}</b><span>respuestas</span></div>
      <div><b>${pct(g.aciertos, g.resp)}%</b><span>de acierto</span></div>
      <div><b>${g.vistas}/${g.total}</b><span>preguntas vistas</span></div>
    </div>
    ${S.tests.length ? '' : '<p class="aviso">Cuando hagas tu primer test verás aquí tu acierto por bloque y tema.</p>'}
    <h2>Acierto por bloque y tema</h2>
    ${S.indice.partes.map(p => `<h3>${esc(p.titulo)}</h3>${p.bloques.map(b => `<details class="bloque"><summary class="conbarra"><ul class="barras">${fila(b.titulo, b.temas.map(t => t.id))}</ul></summary><ul class="barras sub2">${b.temas.map(t => fila(t.titulo, [t.id])).join('')}</ul></details>`).join('')}`).join('')}
    ${S.tests.length ? `<h2>Historial</h2><ul class="lista">${S.tests.slice(0, 100).map(filaTest).join('')}</ul>` : ''}
  </section>`;
};

/* ---------- AJUSTES ---------- */
rutas.ajustes = async () => {
  const e = sync.estado, tema = await kv.get('tema', 'auto'), letra = await kv.get('letra', 'normal');
  const cfg = sync.configActual();
  main.innerHTML = `<section class="pag">
    <header class="cab"><h1>Ajustes</h1></header>
    <h2>Sincronización con Google Drive</h2>
    ${e.activo ? `<div class="tarjeta"><div><strong>Conectado${e.email ? ' como ' + esc(e.email) : ' a Google Drive'}</strong><br><span class="sub" id="estsync">${textoSync(e)}</span></div><button class="btn pri" data-act="syncya">Sincronizar</button></div>
      <p class="sub">Los datos se guardan en una carpeta oculta de tu Google Drive que solo esta app puede ver. Conecta la misma cuenta de Google en el iPhone y en el PC.</p>
      <button class="btn" data-act="syncsalir">Desconectar este dispositivo</button>`
      : `<p class="sub">Conecta tu cuenta de Google para compartir tests, estadísticas y documentos entre el iPhone y el PC. Se guardan en una carpeta oculta de tu Google Drive que solo esta app puede ver.</p>
      ${sync.clienteFijo() ? '' : `<details class="bloque" ${sync.configurada() ? '' : 'open'}><summary><span>ID de cliente de Google</span><em>${sync.configurada() ? 'configurado' : 'pendiente'}</em></summary><form id="fcfg" class="form"><p class="sub">Se obtiene una sola vez en Google Cloud Console (pasos en LEEME.md). Si lo pones en <b>config.js</b> no hará falta escribirlo en cada dispositivo.</p><label>ID de cliente OAuth<input name="cid" required placeholder="xxxx.apps.googleusercontent.com" value="${esc(cfg.clientId || '')}"></label><button class="btn">Guardar</button></form></details>`}
      ${sync.configurada() ? `<button class="btn pri grande" data-act="syncentrar">Conectar con Google</button>` : ''}
      ${e.error ? `<p class="aviso err">${esc(e.error)}</p>` : ''}`}
    <h2>Apariencia</h2>
    <div class="chips">${Object.entries({ auto: 'Automático', claro: 'Claro', oscuro: 'Oscuro' }).map(([v, t]) => `<button class="chip ${tema === v ? 'sel' : ''}" data-act="tema" data-v="${v}">${t}</button>`).join('')}</div>
    <div class="chips">${Object.entries({ normal: 'Letra normal', grande: 'Letra grande' }).map(([v, t]) => `<button class="chip ${letra === v ? 'sel' : ''}" data-act="letra" data-v="${v}">${t}</button>`).join('')}</div>
    <h2>Instalar en el iPhone</h2>
    <p class="sub">Abre esta página en <b>Safari</b>, pulsa <b>Compartir</b> y elige <b>«Añadir a pantalla de inicio»</b>. Se abrirá a pantalla completa y funcionará sin conexión.</p>
    <button class="btn" data-act="offline">Descargar todo el temario para usarlo sin conexión</button>
    <h2>Copia de seguridad</h2>
    <div class="acciones fila"><button class="btn" data-act="exportar">Exportar progreso</button><label class="btn">Importar<input type="file" id="fimport" accept="application/json,.json" hidden></label></div>
    <p class="sub">La copia incluye tests y documentos de texto (no los archivos adjuntos).</p>
    <h2>Zona de peligro</h2>
    <button class="btn peligro" data-act="reset">Borrar todo el progreso de este dispositivo</button>
    <p class="sub pie">Banco: ${todosTemas().reduce((n, t) => n + t.total, 0).toLocaleString('es-ES')} preguntas · ${todosTemas().length} temas · contenido ${esc(S.indice.version)}</p>
  </section>`;
  $('#fcfg')?.addEventListener('submit', async ev => { ev.preventDefault(); const id = new FormData(ev.target).get('cid').trim(); if (!/\.apps\.googleusercontent\.com$/.test(id)) return toast('El ID debe terminar en .apps.googleusercontent.com'); await sync.guardarConfig(id); toast('Guardado'); render(); });
  $('#fimport')?.addEventListener('change', async ev => {
    try {
      const j = JSON.parse(await ev.target.files[0].text()); let n = 0;
      for (const it of j.items || []) { const loc = await items.get(it.id); if (!loc || loc.updated < it.updated) { await items.putRaw({ ...it, dirty: true }); n++; } }
      await recargarUsuario(); sync.sincronizar(); toast(`Importados ${n} elementos`); render();
    } catch { toast('El archivo no es una copia válida'); }
  });
};
const textoSync = e => e.trabajando ? 'Sincronizando…' : e.error ? 'Error: ' + e.error : e.caducado ? 'Sesión caducada: pulsa Sincronizar' : e.ultimo ? 'Última sincronización: ' + fechaHora(e.ultimo) : 'Pendiente de sincronizar';
sync.alCambiar(e => { const el = $('#estsync'); if (el) el.textContent = textoSync(e); });

async function aplicarAspecto() {
  const tema = await kv.get('tema', 'auto'), letra = await kv.get('letra', 'normal');
  if (tema === 'auto') delete document.documentElement.dataset.tema; else document.documentElement.dataset.tema = tema;
  document.documentElement.dataset.letra = letra;
}

/* ---------- acciones (delegación de eventos) ---------- */
const acciones = {
  cfg(el) { const c = S.cfgTest; c[el.dataset.campo] = /^\d+$/.test(el.dataset.valor) ? +el.dataset.valor : el.dataset.valor; conservarScroll(render); },
  cfgbool(el) { S.cfgTest[el.dataset.campo] = el.checked; conservarScroll(render); },
  preset(el) { const p = el.dataset.p; S.cfgTest.temas = new Set(p === 'nada' ? [] : p === 'todo' ? todosTemas().map(t => t.id) : temasDe(p).map(t => t.id)); conservarScroll(render); },
  selgrupo(el) { const abiertos = detallesAbiertos(); for (const id of el.dataset.ids.split(',')) el.checked ? S.cfgTest.temas.add(id) : S.cfgTest.temas.delete(id); conservarScroll(render, abiertos); },
  seltema(el) { const abiertos = detallesAbiertos(); el.checked ? S.cfgTest.temas.add(el.dataset.id) : S.cfgTest.temas.delete(el.dataset.id); conservarScroll(render, abiertos); },
  empezar() { if (S.curso && !confirm('Tienes un test a medias. ¿Descartarlo y empezar uno nuevo?')) return; crearTest(S.cfgTest); },
  rapido(el) { if (S.curso && !confirm('Tienes un test a medias. ¿Descartarlo y empezar uno nuevo?')) return; crearTest({ ...cfgPorDefecto(), tam: +el.dataset.n, nivel: 0 }); },
  fallos() { if (S.curso && !confirm('Tienes un test a medias. ¿Descartarlo y empezar uno nuevo?')) return; crearTest({ ...cfgPorDefecto(), tam: 30, nivel: 0, soloFalladas: true }); },
  testtema(el) { S.cfgTest = { ...(S.cfgTest || cfgPorDefecto()), temas: new Set([el.dataset.id]) }; ir('#/test'); },
  async repetirfallos(el) {
    const t = S.tests.find(x => x.id === el.dataset.id); if (!t) return;
    const ids = t.data.r.filter(x => !x[2]).map(x => x[0]);
    await cargarTemas([...new Set(ids.map(temaDePregunta))]);
    const qs = ids.filter(pregunta);
    S.curso = { cfg: { tam: qs.length, nivel: t.data.nivel, modo: 'estudio', pen: 0, etiqueta: 'Repetición de fallos · ' + t.data.etiqueta, temas: t.data.temas }, qs: barajar(qs).map(id => ({ id, perm: barajar([0, 1, 2, 3]) })), resp: Array(qs.length).fill(null), marcas: [], i: 0, seg: 0 };
    await kv.set('curso', S.curso); ir('#/hacer');
  },
  async resp(el) { const T = S.curso; T.resp[T.i] = T.resp[T.i] === +el.dataset.o && T.cfg.modo === 'examen' ? null : +el.dataset.o; await kv.set('curso', T); await render(); if (T.cfg.modo === 'estudio') $('.corr')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); },
  async sig() { S.curso.i++; await kv.set('curso', S.curso); await render(); window.scrollTo(0, 0); },
  'sig-saltar'() { const T = S.curso; if (T.i < T.qs.length - 1) return acciones.sig(); terminarTest(); },
  fin() { terminarTest(); },
  async mov(el) { S.curso.i += +el.dataset.d; await kv.set('curso', S.curso); await render(); window.scrollTo(0, 0); },
  async saltar(el) { S.curso.i = +el.dataset.k; await kv.set('curso', S.curso); await render(); window.scrollTo(0, 0); },
  async marcar() { const T = S.curso, k = T.marcas.indexOf(T.i); k < 0 ? T.marcas.push(T.i) : T.marcas.splice(k, 1); await kv.set('curso', T); conservarScroll(render); },
  finexamen() { const bl = S.curso.resp.filter(x => x == null).length; if (confirm(bl ? `Te quedan ${bl} preguntas en blanco. ¿Finalizar el examen?` : '¿Finalizar el examen?')) terminarTest(); },
  async salirtest() {
    const T = S.curso, hechas = T.resp.filter(x => x != null).length;
    if (!hechas) { if (confirm('¿Salir y descartar este test?')) { S.curso = null; await kv.del('curso'); ir('#/inicio'); } return; }
    if (T.cfg.modo === 'estudio' && confirm(`Has respondido ${hechas} de ${T.qs.length}.\n\nAceptar: terminar ahora y guardar el resultado.\nCancelar: salir y continuar más tarde.`)) return terminarTest();
    ir('#/inicio');
  },
  nuevodoc(el) { ir('#/docs/nuevo' + (el.dataset.tema ? '/' + el.dataset.tema : '')); },
  async borrardoc(el) { if (!confirm('¿Eliminar este documento?')) return; await items.remove(el.dataset.id); await recargarUsuario(); sync.sincronizar(); toast('Documento eliminado'); ir('#/docs'); },
  async abrirfich(el) {
    try {
      const d = S.docs.find(x => x.id === el.dataset.id), b = await obtenerFichero(d.id);
      const url = URL.createObjectURL(new Blob([b], { type: d.data.fileType || b.type || 'application/octet-stream' }));
      const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener';
      if (!/pdf|image|text/.test(d.data.fileType || '')) a.download = d.data.fileName;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (e) { toast(e.message); }
  },
  abrirtodo(el) { const ds = $$('details.sec'), abrir = ds.some(d => !d.open); ds.forEach(d => (d.open = abrir)); el.textContent = abrir ? 'Plegar todo' : 'Desplegar todo'; },
  async tema(el) { await kv.set('tema', el.dataset.v); await aplicarAspecto(); render(); },
  async letra(el) { await kv.set('letra', el.dataset.v); await aplicarAspecto(); render(); },
  async syncya() { const c = await sync.sincronizar({ interactivo: true }); if (c) await recargarUsuario(); toast(sync.estado.error ? 'Error: ' + sync.estado.error : 'Sincronizado'); },
  async syncentrar(el) { el.disabled = true; try { await sync.entrar(); await recargarUsuario(); toast(sync.estado.error ? 'Error: ' + sync.estado.error : 'Google Drive conectado'); } catch (err) { sync.estado.error = err.message; } render(); },
  async syncsalir() { await sync.salir(); render(); },
  async offline(el) { el.disabled = true; el.textContent = 'Descargando…'; try { await cargarTemas(todosTemas().map(t => t.id)); el.textContent = 'Temario descargado ✓'; } catch { el.textContent = 'No se pudo descargar (¿sin conexión?)'; el.disabled = false; } },
  async exportar() {
    const todo = (await items.all()).map(({ dirty, fileUp, ...r }) => r);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ app: 'opo-sermas', fecha: new Date().toISOString(), items: todo })], { type: 'application/json' }));
    a.download = `opo-sermas-progreso-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  },
  async reset() { if (!confirm('Se borrarán los tests, documentos y ajustes guardados en ESTE dispositivo. Si tienes la sincronización activa, lo que esté en la nube se conserva. ¿Continuar?')) return; await borrarTodo(); location.hash = '#/inicio'; location.reload(); },
};
const detallesAbiertos = () => $$('.arbol details').map(d => d.open);
async function conservarScroll(fn, abiertos) { const y = window.scrollY; abiertos = abiertos || detallesAbiertos(); await fn(); $$('.arbol details').forEach((d, i) => { if (abiertos[i] != null) d.open = abiertos[i]; }); window.scrollTo(0, y); }
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'INPUT') return;
  if (el.disabled) return;
  e.preventDefault(); acciones[el.dataset.act]?.(el);
});
document.addEventListener('change', e => { const el = e.target.closest('input[data-act]'); if (el) acciones[el.dataset.act]?.(el); });
document.addEventListener('keydown', e => {
  if (!location.hash.startsWith('#/hacer') || !S.curso || e.target.matches('input,textarea,select')) return;
  const k = e.key.toLowerCase(), n = { 1: 0, 2: 1, 3: 2, 4: 3, a: 0, b: 1, c: 2, d: 3 }[k];
  if (n != null) $$('.op:not([disabled])')[n]?.click();
  else if (k === 'enter' || k === 'arrowright') $('.pie-test .pri')?.click();
  else if (k === 'arrowleft') $('[data-act="mov"][data-d="-1"]')?.click();
});

/* ---------- arranque ---------- */
async function arrancar() {
  await aplicarAspecto();
  const r = await fetch('data/indice.json', { cache: 'no-cache' }).catch(() => null) || await fetch('data/indice.json');
  S.indice = await r.json();
  for (const t of todosTemas()) S.porId.set(t.id, t);
  S.curso = await kv.get('curso');
  if (S.curso && !S.curso.qs.every(q => S.porId.has(temaDePregunta(q.id)))) { S.curso = null; await kv.del('curso'); }
  await recargarUsuario();
  await sync.iniciar();
  if (!location.hash) location.hash = '#/inicio';
  await render();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.storage?.persist?.();
  const resinc = async () => { if (await sync.sincronizar()) { await recargarUsuario(); if (!/^#\/(hacer|docs\/nuevo)/.test(location.hash) && !/editar$/.test(location.hash)) render(); } };
  resinc();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resinc(); });
  window.addEventListener('online', resinc);
  // Descarga en segundo plano de todo el temario para poder estudiar sin conexión.
  const ocioso = window.requestIdleCallback || (f => setTimeout(f, 3000));
  ocioso(async () => { for (const t of todosTemas()) { try { await cargarTema(t.id); } catch { break; } } });
}
arrancar().catch(e => { console.error(e); main.innerHTML = `<section class="pag"><h1>No se pudo iniciar</h1><p class="aviso err">${esc(e.message)}</p></section>`; });
