/*
 * Локальна заміна рантайму claude.ai (window.claude) для запуску застосунку поза Artifact.
 *
 * Реалізує лише те, що використовує сторінка:
 *   claude.use("db")        — колекції/документи з onSnapshot, get, set, update; зберігання в localStorage
 *   claude.use("downloads") — save({filename, data}) через звичайне завантаження браузера
 *
 * Перший запуск: дані підтягуються з ../data/export.json (знімок бази з claude.ai).
 * Скинути локальні дані: у консолі браузера  localStorage.removeItem("spysannia-db"); location.reload()
 * Вивантажити локальні дані:                 copy(localStorage.getItem("spysannia-db"))
 */
(function () {
  const KEY = "spysannia-db";
  let store = null;
  const subs = new Set();

  const load = async () => {
    if (store) return store;
    try { const raw = localStorage.getItem(KEY); if (raw) store = JSON.parse(raw); } catch (e) {}
    if (!store) {
      try { const r = await fetch("../data/export.json"); store = await r.json(); }
      catch (e) { console.warn("[shim] не вдалося прочитати data/export.json — стартую з порожньої бази", e); store = {}; }
    }
    for (const c of ["items", "requests", "files", "settings"]) store[c] = store[c] || {};
    persist();
    return store;
  };
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { console.warn("[shim] localStorage переповнений", e); } };
  const notify = () => setTimeout(() => subs.forEach((f) => f()), 0);
  const split = (path) => { const p = path.split("/"); return { c: p.slice(0, -1).join("/"), id: p[p.length - 1] }; };
  const coll = (c) => (store[c] = store[c] || {});
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

  const docRef = (path) => {
    const { c, id } = split(path);
    return {
      id,
      async get() { await load(); const d = coll(c)[id]; return { id, exists: d !== undefined, data: () => clone(d) }; },
      async set(data) { await load(); coll(c)[id] = clone(data); persist(); notify(); },
      async update(data) {
        await load();
        if (coll(c)[id] === undefined) { const e = new Error("not found"); e.code = "not_found"; throw e; }
        coll(c)[id] = { ...coll(c)[id], ...clone(data) }; persist(); notify();
      },
      async delete() { await load(); delete coll(c)[id]; persist(); notify(); },
      onSnapshot(next, err) {
        const f = () => { const d = coll(c)[id]; next({ id, exists: d !== undefined, data: () => clone(d), metadata: { fromCache: false } }); };
        load().then(() => { subs.add(f); f(); }).catch(err);
        return () => subs.delete(f);
      },
    };
  };
  const collRef = (c) => ({
    doc: (id) => docRef(c + "/" + id),
    onSnapshot(next, err) {
      const f = () => next({
        metadata: { fromCache: false },
        docs: Object.entries(coll(c)).map(([id, d]) => ({ id, exists: true, data: () => clone(d) })),
      });
      load().then(() => { subs.add(f); f(); }).catch(err);
      return () => subs.delete(f);
    },
  });
  const db = { collection: collRef, doc: docRef };

  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = filename || "file";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      return { status: "saved" };
    },
  };

  window.claude = { use: async (name) => (name === "db" ? db : name === "downloads" ? downloads : null) };
  console.info("[shim] локальний режим: дані в localStorage[\"" + KEY + "\"]");
})();
