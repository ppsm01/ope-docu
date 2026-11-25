// Sincronización entre dispositivos usando Google Drive (carpeta oculta de la aplicación, "appDataFolder").
// - progreso.json: todos los tests y documentos (se fusionan por id quedándose con la versión más reciente).
// - adj-<id>: archivo adjunto de cada documento.
// Solo se pide el permiso drive.appdata: la app no puede ver el resto de tu Drive.
import { kv, items, files } from './db.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FICHERO = 'progreso.json';

let clientId = '', tok = null, tokenClient = null, enCurso = null, gisCargado = null;
const oyentes = new Set();
export const estado = { activo: false, email: null, ultimo: null, error: null, trabajando: false, caducado: false };
const avisar = () => oyentes.forEach(f => f(estado));
export const alCambiar = f => { oyentes.add(f); return () => oyentes.delete(f); };

export async function iniciar() {
  const base = (window.OPO_CONFIG || {}).googleClientId || '';
  clientId = base || (await kv.get('sync.clientId', ''));
  const s = await kv.get('sync.google');
  if (s?.vinculado) { estado.activo = true; estado.email = s.email || null; }
  tok = (await kv.get('sync.token')) || null;
  estado.caducado = estado.activo && !tokenValido();
  estado.ultimo = await kv.get('sync.ultimo');
  if (clientId && navigator.onLine !== false) cargarGIS().catch(() => {});
  avisar();
}
export const configurada = () => !!clientId;
export const clienteFijo = () => !!(window.OPO_CONFIG || {}).googleClientId;
export const configActual = () => ({ clientId });
export async function guardarConfig(id) { clientId = id.trim(); await kv.set('sync.clientId', clientId); cargarGIS().catch(() => {}); avisar(); }

const tokenValido = () => !!(tok && tok.exp > Date.now() + 60000);

function cargarGIS() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisCargado) gisCargado = new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => ok(); s.onerror = () => { gisCargado = null; ko(new Error('No se pudo cargar el inicio de sesión de Google (¿sin conexión?)')); };
    document.head.append(s);
  });
  return gisCargado;
}

// Pide un token a Google. Debe llamarse desde un toque del usuario (abre una ventana de Google).
async function pedirToken(conSeleccion) {
  if (!clientId) throw new Error('Falta el ID de cliente de Google');
  await cargarGIS(); // ya precargado en iniciar(): así la ventana se abre dentro del mismo toque (necesario en Safari)
  return new Promise((ok, ko) => {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: SCOPE,
      callback: async r => {
        if (r.error) return ko(new Error(r.error_description || r.error));
        tok = { access: r.access_token, exp: Date.now() + (r.expires_in || 3600) * 1000 };
        await kv.set('sync.token', tok);
        estado.caducado = false; ok(tok);
      },
      error_callback: e => ko(new Error(e?.type === 'popup_closed' ? 'Se cerró la ventana de Google sin terminar' : e?.type === 'popup_failed_to_open' ? 'El navegador bloqueó la ventana de Google' : (e?.message || 'Error al conectar con Google'))),
    });
    tokenClient.requestAccessToken({ prompt: conSeleccion ? 'select_account' : '', hint: estado.email || undefined });
  });
}

async function api(url, { method = 'GET', body, headers = {}, raw = false } = {}) {
  if (!tokenValido()) { estado.caducado = true; avisar(); throw new Error('SESION'); }
  const r = await fetch(url, { method, body, headers: { Authorization: 'Bearer ' + tok.access, ...headers } });
  if (r.status === 401) { tok = null; await kv.del('sync.token'); estado.caducado = true; avisar(); throw new Error('SESION'); }
  if (!r.ok) {
    let msg = r.status + ' ' + r.statusText;
    try { const j = await r.json(); msg = j.error?.message || msg; } catch {}
    throw new Error(msg);
  }
  if (raw) return r;
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const buscar = async nombre => (await api(`${API}/files?spaces=appDataFolder&q=${encodeURIComponent(`name='${nombre}' and trashed=false`)}&fields=files(id,name,modifiedTime)&pageSize=10`)).files[0] || null;

async function subir(nombre, contenido, tipo, idExistente) {
  if (idExistente) return api(`${UPLOAD}/files/${idExistente}?uploadType=media`, { method: 'PATCH', body: contenido, headers: { 'Content-Type': tipo } });
  const limite = 'opo' + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: nombre, parents: ['appDataFolder'] });
  const cuerpo = new Blob([`--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${limite}\r\nContent-Type: ${tipo}\r\n\r\n`, contenido, `\r\n--${limite}--`]);
  return api(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', body: cuerpo, headers: { 'Content-Type': `multipart/related; boundary=${limite}` } });
}

// Conectar: abre la ventana de Google y hace la primera sincronización.
export async function entrar() {
  await pedirToken(true);
  let email = null;
  try { email = (await api(`${API}/about?fields=user(emailAddress)`)).user?.emailAddress || null; } catch {}
  await kv.set('sync.google', { vinculado: true, email });
  estado.activo = true; estado.email = email; estado.error = null; avisar();
  return sincronizar({ interactivo: true });
}
export async function salir() {
  try { if (tok && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(tok.access, () => {}); } catch {}
  tok = null; await kv.del('sync.token'); await kv.del('sync.google');
  for (const it of await items.all()) if (!it.dirty) await items.putRaw({ ...it, dirty: true, fileUp: false });
  estado.activo = false; estado.email = null; estado.caducado = false; avisar();
}

// interactivo: true cuando la pide el usuario con un toque (se puede abrir la ventana de Google si la sesión caducó).
export function sincronizar({ interactivo = false } = {}) {
  if (!estado.activo || !clientId) return Promise.resolve(false);
  if (!tokenValido() && !interactivo) { estado.caducado = true; avisar(); return Promise.resolve(false); }
  if (!enCurso) enCurso = hacer(interactivo).finally(() => { enCurso = null; });
  return enCurso;
}

async function hacer(interactivo) {
  estado.trabajando = true; estado.error = null; avisar();
  let cambios = false;
  try {
    if (!tokenValido()) await pedirToken(false);
    // 1. Descargar y fusionar
    const remoto = await buscar(FICHERO);
    let lista = [];
    if (remoto) { try { lista = (await api(`${API}/files/${remoto.id}?alt=media`)).items || []; } catch (e) { if (e.message === 'SESION') throw e; lista = []; } }
    const porId = new Map(lista.map(i => [i.id, i]));
    const locales = await items.all();
    let subirFichero = !remoto;
    for (const loc of locales) {
      const r = porId.get(loc.id);
      if (!r || (loc.updated || 0) > (r.updated || 0)) { porId.set(loc.id, { id: loc.id, kind: loc.kind, data: loc.data, deleted: !!loc.deleted, updated: loc.updated }); subirFichero = true; }
    }
    for (const r of porId.values()) {
      const loc = locales.find(l => l.id === r.id);
      if (!loc || (r.updated || 0) > (loc.updated || 0)) {
        cambios = true;
        await items.putRaw({ id: r.id, kind: r.kind, data: r.data, deleted: !!r.deleted, updated: r.updated, dirty: false, fileUp: true });
        if (r.deleted) await files.del(r.id);
      }
    }
    // 2. Adjuntos pendientes
    for (const loc of await items.all()) {
      if (loc.kind !== 'doc') continue;
      if (loc.deleted && loc.dirty) { const f = await buscar('adj-' + loc.id); if (f) await api(`${API}/files/${f.id}`, { method: 'DELETE' }); }
      else if (!loc.deleted && loc.data?.hasFile && !loc.fileUp) {
        const blob = await files.get(loc.id);
        if (blob) { const f = await buscar('adj-' + loc.id); await subir('adj-' + loc.id, blob, blob.type || 'application/octet-stream', f?.id); }
      }
    }
    // 3. Subir el progreso fusionado
    if (subirFichero) await subir(FICHERO, JSON.stringify({ app: 'opo-sermas', v: 1, items: [...porId.values()] }), 'application/json', remoto?.id);
    for (const loc of await items.all()) if (loc.dirty || !loc.fileUp) await items.putRaw({ ...loc, dirty: false, fileUp: true });
    estado.ultimo = Date.now(); await kv.set('sync.ultimo', estado.ultimo);
  } catch (e) {
    estado.error = e.message === 'SESION' ? (interactivo ? 'La sesión de Google ha caducado: vuelve a pulsar Sincronizar' : null) : (e.message || String(e));
  }
  estado.trabajando = false; avisar();
  return cambios;
}

// Descarga el adjunto de un documento creado en otro dispositivo.
export async function bajarFichero(id) {
  if (!estado.activo) return null;
  if (!tokenValido()) await pedirToken(false);
  const f = await buscar('adj-' + id);
  if (!f) return null;
  const blob = await (await api(`${API}/files/${f.id}?alt=media`, { raw: true })).blob();
  await files.set(id, blob);
  return blob;
}
