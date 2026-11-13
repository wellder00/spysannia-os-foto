/*
 * Шим window.claude для мобільного дзеркала (GitHub Pages).
 *
 * Той самий контракт, що й dev/claude-shim.js (claude.use("db"/"downloads")), АЛЕ колекції
 * photoFlags (кольорові позначки, опис, електродвигун насосів — вкладка «Картки ОС»),
 * mshpFlags (кольорові позначки — вкладка «Малоцінка») і cardPhotos (фото, додані з
 * телефону/комп'ютера до карток ОС) ідуть у реальний Firestore — щоб синхронізуватись
 * між усіма, хто відкриває дзеркало з різних пристроїв.
 *
 * Решта колекцій (items/requests/files/settings) — як і раніше, локальний знімок
 * data/export.json у localStorage цього браузера. Це свідомо: редагування журналу
 * списання (позиції, акти) — тільки через робочий Artifact на claude.ai, дзеркало для
 * них лишається тільки переглядом.
 *
 * FIREBASE_CONFIG нижче — публічний клієнтський apiKey, це НЕ секрет: безпека
 * забезпечується правилами Firestore (дивись firestore.rules у цій же теці), які
 * дозволяють читати/писати лише колекції photoFlags, mshpFlags і cardPhotos і нічого більше.
 */
(function () {
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyAt_3E_D3XgJMue4HTyAXOK6-mtAdfsVVE",
    authDomain: "spysannia-os.firebaseapp.com",
    projectId: "spysannia-os",
  };
  const FIRESTORE_VER = "10.12.2";

  const KEY = "spysannia-db";
  let store = null;
  const subs = new Set();

  const load = async () => {
    if (store) return store;
    try { const raw = localStorage.getItem(KEY); if (raw) store = JSON.parse(raw); } catch (e) {}
    /* свіжий знімок (інший exportedAt) замінює локальну копію — інакше браузер назавжди
       лишався б на першому завантаженому export.json і не бачив оновлень журналу */
    let snap = null;
    try { const r = await fetch("../data/export.json", { cache: "no-cache" }); snap = await r.json(); }
    catch (e) { console.warn("[mirror-shim] не вдалося прочитати data/export.json", e); }
    if (snap && (!store || store.exportedAt !== snap.exportedAt)) store = snap;
    if (!store) store = {};
    for (const c of ["items", "requests", "files", "settings"]) store[c] = store[c] || {};
    persist();
    return store;
  };
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { console.warn("[mirror-shim] localStorage переповнений", e); } };
  const notify = () => setTimeout(() => subs.forEach((f) => f()), 0);
  const split = (path) => { const p = path.split("/"); return { c: p.slice(0, -1).join("/"), id: p[p.length - 1] }; };
  const coll = (c) => (store[c] = store[c] || {});
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

  /* ---------- локальна частина (items/requests/files/settings) — як у claude-shim.js ---------- */
  const localDocRef = (path) => {
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
  const localCollRef = (c) => ({
    doc: (id) => localDocRef(c + "/" + id),
    onSnapshot(next, err) {
      const f = () => next({
        metadata: { fromCache: false },
        docs: Object.entries(coll(c)).map(([id, d]) => ({ id, exists: true, data: () => clone(d) })),
      });
      load().then(() => { subs.add(f); f(); }).catch(err);
      return () => subs.delete(f);
    },
  });

  /* ---------- Firestore-частина (лише photoFlags) ---------- */
  let fsReady = null;
  function loadFirestore() {
    if (fsReady) return fsReady;
    fsReady = new Promise((resolve, reject) => {
      const s1 = document.createElement("script");
      s1.src = `https://www.gstatic.com/firebasejs/${FIRESTORE_VER}/firebase-app-compat.js`;
      s1.onload = () => {
        const s2 = document.createElement("script");
        s2.src = `https://www.gstatic.com/firebasejs/${FIRESTORE_VER}/firebase-firestore-compat.js`;
        s2.onload = () => {
          try { firebase.initializeApp(FIREBASE_CONFIG); resolve(firebase.firestore()); }
          catch (e) { reject(e); }
        };
        s2.onerror = reject;
        document.head.appendChild(s2);
      };
      s1.onerror = reject;
      document.head.appendChild(s1);
    });
    return fsReady;
  }
  const firestoreDocRef = (c, id) => ({
    id,
    async get() { const fs = await loadFirestore(); const snap = await fs.collection(c).doc(id).get(); return { id, exists: snap.exists, data: () => snap.data() }; },
    async set(data) { const fs = await loadFirestore(); await fs.collection(c).doc(id).set(data); },
    async update(data) { const fs = await loadFirestore(); await fs.collection(c).doc(id).update(data); },
    async delete() { const fs = await loadFirestore(); await fs.collection(c).doc(id).delete(); },
    onSnapshot(next, err) {
      let unsub = () => {};
      loadFirestore().then((fs) => {
        unsub = fs.collection(c).doc(id).onSnapshot(
          (snap) => next({ id, exists: snap.exists, data: () => snap.data(), metadata: { fromCache: snap.metadata.fromCache } }),
          err
        );
      }).catch(err);
      return () => unsub();
    },
  });
  const firestoreCollRef = (c) => ({
    doc: (id) => firestoreDocRef(c, id),
    onSnapshot(next, err) {
      let unsub = () => {};
      loadFirestore().then((fs) => {
        unsub = fs.collection(c).onSnapshot(
          (qs) => next({ metadata: { fromCache: qs.metadata.fromCache }, docs: qs.docs.map((d) => ({ id: d.id, exists: true, data: () => d.data() })) }),
          err
        );
      }).catch(err);
      return () => unsub();
    },
  });

  const SYNCED = new Set(["photoFlags", "mshpFlags", "cardPhotos"]);
  const db = {
    collection: (c) => (SYNCED.has(c) ? firestoreCollRef(c) : localCollRef(c)),
    doc: (path) => { const { c, id } = split(path); return SYNCED.has(c) ? firestoreDocRef(c, id) : localDocRef(path); },
  };

  /* ---------- одноразове перенесення старих локальних photoFlags у Firestore ----------
   * До підключення Firestore позначки (колір/опис/двигун), поставлені на цьому дзеркалі,
   * писались у звичайний localStorage (як і items/requests). Після переходу на Firestore
   * та стара локальна копія лишається "осиротілою" — її ніхто більше не читає. Ця функція
   * один раз переносить такі записи у Firestore (не чіпаючи документи, які там вже є —
   * щоб не затерти щось новіше, поставлене вже через спільну базу).
   */
  const MIGRATE_KEY = "spysannia-pf-migrated";
  async function migrateLocalPhotoFlags() {
    try {
      if (localStorage.getItem(MIGRATE_KEY) === "1") return;
      const raw = localStorage.getItem(KEY);
      const old = raw ? JSON.parse(raw) : null;
      const pf = old && old.photoFlags;
      const ids = pf ? Object.keys(pf) : [];
      if (!ids.length) { localStorage.setItem(MIGRATE_KEY, "1"); return; }
      const fs = await loadFirestore();
      let moved = 0;
      for (const id of ids) {
        const ref = fs.collection("photoFlags").doc(id);
        const snap = await ref.get();
        if (!snap.exists) { await ref.set(pf[id]); moved++; }
      }
      localStorage.setItem(MIGRATE_KEY, "1");
      console.info(`[mirror-shim] перенесено в Firestore позначок зі старої локальної бази: ${moved} з ${ids.length}`);
    } catch (e) { console.warn("[mirror-shim] не вдалося перенести старі позначки", e); }
  }
  migrateLocalPhotoFlags();

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
  console.info("[mirror-shim] items/requests/files/settings — локально; photoFlags/mshpFlags/cardPhotos — Firestore (спільно для всіх)");
})();
