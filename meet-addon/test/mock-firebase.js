// Test-only stand-in for the Firebase compat SDK (app, auth, Realtime Database).
// The database tree lives in localStorage so several tabs share it, like several devices would.
(() => {
  const KEY = 'mock-rtdb';
  let tree = load();
  const listeners = new Set();
  const disconnects = new Map();
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } }
  function persist() { localStorage.setItem(KEY, JSON.stringify(tree)); }
  const parts = p => String(p || '').split('/').filter(Boolean);
  const clone = v => (v == null ? null : JSON.parse(JSON.stringify(v)));
  function stamp(v) {
    if (v && typeof v === 'object') {
      if (v['.sv'] === 'timestamp') return Date.now();
      for (const k of Object.keys(v)) v[k] = stamp(v[k]);
    }
    return v;
  }
  function prune(v) {   // like the real database: no nulls, no empty objects or arrays
    if (v == null) return null;
    if (Array.isArray(v)) { const a = v.map(prune).filter(x => x != null); return a.length ? a : null; }
    if (typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) { const p = prune(x); if (p != null) o[k] = p; } return Object.keys(o).length ? o : null; }
    return v;
  }
  function getAt(path) { let n = tree; for (const k of parts(path)) { if (n == null || typeof n !== 'object') return null; n = n[k]; } return n === undefined ? null : n; }
  function setAt(path, value) {
    const ks = parts(path);
    value = prune(stamp(clone(value)));
    if (!ks.length) { tree = value || {}; return; }
    let n = tree;
    const stack = [];
    for (const k of ks.slice(0, -1)) { if (n[k] == null || typeof n[k] !== 'object') n[k] = {}; stack.push([n, k]); n = n[k]; }
    const last = ks[ks.length - 1];
    if (value == null) delete n[last]; else n[last] = value;
    for (let i = stack.length - 1; i >= 0; i--) { const [p, k] = stack[i]; if (p[k] && typeof p[k] === 'object' && !Object.keys(p[k]).length) delete p[k]; }
  }
  function changed() { persist(); setTimeout(fireAll, 0); }
  window.addEventListener('storage', e => { if (e.key === KEY) { tree = load(); fireAll(); } });
  window.addEventListener('pagehide', () => { if (!disconnects.size) return; tree = load(); for (const p of disconnects.values()) setAt(p, null); persist(); });
  function snapshot(path, val, q) {
    let v = val;
    if (q && v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) if (x && x[q.child] === q.equal) o[k] = x; v = Object.keys(o).length ? o : null; }
    return {
      key: parts(path).pop() || null,
      val: () => clone(v),
      exists: () => v != null,
      forEach(fn) { if (!v || typeof v !== 'object') return false; for (const k of Object.keys(v).sort()) if (fn(snapshot(path + '/' + k, v[k])) === true) return true; return false; },
    };
  }
  function fire(l) {
    const val = l.path === '.info/connected' ? true : getAt(l.path);
    const s = snapshot(l.path, val, l.q);
    const sig = JSON.stringify(s.val());
    if (sig === l.last) return;
    l.last = sig;
    l.cb(s);
  }
  function fireAll() { for (const l of [...listeners]) fire(l); }
  let pushN = 0;
  function makeRef(path, q) {
    const ref = {
      key: parts(path).pop() || null,
      child: p => makeRef(path + '/' + p),
      set: async v => { tree = load(); setAt(path, v); changed(); },
      update: async obj => { tree = load(); for (const [k, v] of Object.entries(obj)) setAt(path + '/' + k, v); changed(); },
      remove: async () => { tree = load(); setAt(path, null); changed(); },
      push: () => makeRef(path + '/' + (Date.now().toString(36) + (pushN++).toString(36) + Math.random().toString(36).slice(2, 6))),
      once: async () => snapshot(path, path === '.info/connected' ? true : getAt(path), q),
      on(evt, cb) { const l = { path, q, cb, last: undefined, orig: cb }; listeners.add(l); setTimeout(() => fire(l), 0); return cb; },
      off(evt, cb) { for (const l of [...listeners]) if (l.path === path && (!cb || l.orig === cb)) listeners.delete(l); },
      orderByChild: child => ({ equalTo: equal => makeRef(path, { child, equal }) }),
      onDisconnect: () => ({ remove: async () => { disconnects.set(path, path); }, cancel: async () => { disconnects.delete(path); } }),
    };
    return ref;
  }
  const apps = [];
  const uidKey = 'mock-fb-uid';
  let user = null;
  try { const u = sessionStorage.getItem(uidKey); if (u) user = { uid: u, isAnonymous: true }; } catch {}
  const auth = {
    get currentUser() { return user; },
    onAuthStateChanged(cb) { setTimeout(() => cb(user), 0); return () => {}; },
    async signInAnonymously() { user = { uid: 'anon' + Math.random().toString(36).slice(2, 12), isAnonymous: true }; try { sessionStorage.setItem(uidKey, user.uid); } catch {} return { user }; },
  };
  const database = { ref: p => makeRef(p) };
  const firebase = {
    apps,
    initializeApp(cfg) { const app = { name: '[DEFAULT]', options: cfg }; apps.push(app); window.__fbConfig = cfg; return app; },
    app: () => apps[0],
    auth: () => auth,
    database: Object.assign(() => database, { ServerValue: { TIMESTAMP: { '.sv': 'timestamp' } } }),
  };
  window.firebase = firebase;
  window.__mockTree = () => clone(tree);
})();
