// Almacenamiento local (IndexedDB): elementos sincronizables (tests, documentos), ficheros y ajustes.
let dbp;
function abrir() {
  if (!dbp) dbp = new Promise((ok, ko) => {
    const r = indexedDB.open('opo-sermas', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('items', { keyPath: 'id' });
      d.createObjectStore('files');
      d.createObjectStore('kv');
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
  return dbp;
}
async function tx(store, modo, fn) {
  const d = await abrir();
  return new Promise((ok, ko) => {
    const t = d.transaction(store, modo);
    const res = fn(t.objectStore(store));
    t.oncomplete = () => ok(res && 'result' in res ? res.result : res);
    t.onerror = t.onabort = () => ko(t.error);
  });
}
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2));

export const kv = {
  get: (k, def = null) => tx('kv', 'readonly', s => s.get(k)).then(v => v ?? def),
  set: (k, v) => tx('kv', 'readwrite', s => s.put(v, k)),
  del: k => tx('kv', 'readwrite', s => s.delete(k)),
};
export const files = {
  get: id => tx('files', 'readonly', s => s.get(id)),
  set: (id, blob) => tx('files', 'readwrite', s => s.put(blob, id)),
  del: id => tx('files', 'readwrite', s => s.delete(id)),
};
// item: { id, kind: 'test'|'doc', data, deleted, updated, dirty }
export const items = {
  all: () => tx('items', 'readonly', s => s.getAll()),
  get: id => tx('items', 'readonly', s => s.get(id)),
  putRaw: it => tx('items', 'readwrite', s => s.put(it)),
  async save(kind, data, id = uid()) {
    const it = { id, kind, data, deleted: false, updated: Date.now(), dirty: true };
    await items.putRaw(it); return it;
  },
  async remove(id) {
    const it = await items.get(id); if (!it) return;
    await items.putRaw({ ...it, data: { titulo: it.data?.titulo }, deleted: true, updated: Date.now(), dirty: true });
    await files.del(id);
  },
  clear: () => tx('items', 'readwrite', s => s.clear()),
};
export async function borrarTodo() {
  await tx('items', 'readwrite', s => s.clear());
  await tx('files', 'readwrite', s => s.clear());
  await tx('kv', 'readwrite', s => s.clear());
}
