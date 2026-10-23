/* =====================================================================
   ClassPulse runtime for the standalone and Google Meet add-on builds.

   The ClassPulse app talks to its platform through one small interface,
   window.claude.use(name), with five capabilities: db, room, user, sample
   and downloads. Inside Claude those are provided by the artifact platform.
   This file provides the same interface on:
     db, room  -> Firebase Realtime Database
     user      -> Firebase anonymous sign-in
     sample    -> Google's Gemini API, using the teacher's own API key
     downloads -> a normal browser download
   and, when the page runs as a Google Meet add-on, a bridge to the Meet
   add-ons SDK (side panel and main stage).

   It must load after the Firebase SDK and config.js, and before the app.
   ===================================================================== */
(() => {
  'use strict';
  const CFG = window.CLASSPULSE_CONFIG || {};
  const MODE = window.CLASSPULSE_MODE || 'web';          // 'web' | 'sidepanel' | 'mainstage'
  const SETTINGS_KEY = 'cp-gemini-settings';
  const DEFAULT_MODEL = (CFG.gemini && CFG.gemini.model) || 'gemini-3.8-flash';
  const DEFAULT_QUICK = (CFG.gemini && CFG.gemini.quickModel) || 'gemini-3.5-flash-lite';
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  // The website address students can open on any device (index.html sits next to this file).
  const SITE = new URL('.', location.href).href.replace(/^https?:\/\//, '').replace(/\/$/, '');

  /* ---------- Firebase: initialise and sign in anonymously ---------- */
  let rtdb = null, uid = null;
  const ready = (async () => {
    const fb = CFG.firebase || {};
    if (!window.firebase) throw new Error('The Firebase SDK did not load.');
    if (!fb.apiKey || !fb.databaseURL || /YOUR_|PASTE/.test(fb.apiKey + fb.databaseURL)) throw new Error('config.js still has placeholder Firebase values.');
    const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(fb);
    const auth = firebase.auth(app);
    rtdb = firebase.database(app);
    const restored = await new Promise(res => { const off = auth.onAuthStateChanged(u => { off(); res(u); }); });
    uid = restored ? restored.uid : (await auth.signInAnonymously()).user.uid;
    return true;
  })();
  ready.catch(e => console.error('ClassPulse: Firebase setup failed.', e));

  const dbError = e => {
    const text = String((e && (e.code || e.message)) || e);
    return { code: /permission|denied/i.test(text) ? 'invalid_argument' : 'unavailable', message: text };
  };

  /* ---------- db: the app's document paths mapped onto the database tree ----------
     sessions/{code}                -> col/sessions/{code}
     sessions/{code}/{sub}/{id}     -> sub/{code}/{sub}/{id}
     data/users/{uid}/{id}          -> priv/{uid}/{id}      (private to that user)  */
  function mapCol(col) {
    const s = col.split('/');
    if (s.length === 1) return 'col/' + s[0];
    if (s.length === 3 && s[0] === 'sessions') return `sub/${s[1]}/${s[2]}`;
    if (s.length === 3 && s[0] === 'data' && s[1] === 'users') return `priv/${s[2]}`;
    throw new TypeError('ClassPulse: unsupported collection path ' + col);
  }
  function mapDoc(path) {
    const s = path.split('/');
    if (s.length % 2) throw new TypeError('ClassPulse: not a document path ' + path);
    const id = s.pop();
    return mapCol(s.join('/')) + '/' + id;
  }
  const meta = { fromCache: false, hasPendingWrites: false };
  const docSnap = (id, val) => ({ id, exists: val != null, data: () => (val == null ? undefined : clone(val)), metadata: meta });
  // update() merges nested objects field by field, like the Claude store: {stats: {sim: 2}} only touches stats/sim.
  function flatten(obj, prefix = '', out = {}) {
    for (const [k, v] of Object.entries(obj)) {
      const p = prefix ? `${prefix}/${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) flatten(v, p, out);
      else out[p] = v === undefined ? null : v;
    }
    return out;
  }
  const test = (val, op, v) => op === '==' ? val === v : op === '!=' ? val !== v : op === '<' ? val < v : op === '<=' ? val <= v
    : op === '>' ? val > v : op === '>=' ? val >= v : op === 'in' ? v.includes(val) : op === 'not-in' ? !v.includes(val)
    : op === 'array-contains' ? Array.isArray(val) && val.includes(v) : false;
  function subscribe(makeRef, onValue, onErr) {
    let ref = null, cb = null, dead = false;
    ready.then(() => {
      if (dead) return;
      ref = makeRef();
      cb = ref.on('value', onValue, e => onErr && onErr(dbError(e)));
    }).catch(e => onErr && onErr(dbError(e)));
    return () => { dead = true; if (ref && cb) ref.off('value', cb); };
  }
  function docRef(path) {
    const rp = mapDoc(path), id = path.split('/').pop();
    const run = async fn => { await ready; try { await fn(rtdb.ref(rp)); } catch (e) { throw dbError(e); } };
    return {
      id, path,
      get: async () => { await ready; try { return docSnap(id, (await rtdb.ref(rp).once('value')).val()); } catch (e) { throw dbError(e); } },
      set: data => run(r => r.set(clone(data))),
      update: data => run(r => r.update(flatten(clone(data)))),
      delete: () => run(r => r.remove()),
      onSnapshot: (next, onErr) => subscribe(() => rtdb.ref(rp), s => next(docSnap(id, s.val())), onErr),
      collection: sub => colRef(path + '/' + sub),
    };
  }
  function query(col, filters, order, lim) {
    const rp = mapCol(col);
    const build = () => {
      const eq = filters.find(f => f[1] === '==');
      return eq ? rtdb.ref(rp).orderByChild(eq[0]).equalTo(eq[2]) : rtdb.ref(rp);
    };
    const toSnap = s => {
      let docs = [];
      s.forEach(ch => { docs.push(docSnap(ch.key, ch.val())); });
      docs = docs.filter(d => filters.every(([f, op, v]) => test((d.data() || {})[f], op, v)));
      if (order) {
        const [f, dir] = order;
        docs.sort((a, b) => {
          const x = (a.data() || {})[f], y = (b.data() || {})[f];
          if (x === y) return 0;
          if (x === undefined) return 1;
          if (y === undefined) return -1;
          return (x < y ? -1 : 1) * (dir === 'desc' ? -1 : 1);
        });
      }
      if (lim) docs = docs.slice(0, lim);
      return { docs, size: docs.length, empty: !docs.length, docChanges: () => docs.map((doc, i) => ({ type: 'added', doc, oldIndex: -1, newIndex: i })), metadata: meta };
    };
    return {
      where: (f, op, v) => query(col, [...filters, [f, op, v]], order, lim),
      orderBy: (f, dir = 'asc') => query(col, filters, [f, dir], lim),
      limit: n => query(col, filters, order, n),
      get: async () => { await ready; try { return toSnap(await build().once('value')); } catch (e) { throw dbError(e); } },
      onSnapshot: (next, onErr) => subscribe(build, s => next(toSnap(s)), onErr),
    };
  }
  function colRef(col) {
    return Object.assign(query(col, [], null, 0), {
      path: col,
      doc: id => docRef(col + '/' + (id || Math.random().toString(36).slice(2, 12))),
      add: async data => { const r = docRef(col + '/' + Math.random().toString(36).slice(2, 12)); await r.set(data); return r; },
    });
  }
  const db = { doc: docRef, collection: colRef };

  /* ---------- room: live presence under room/{name}/{peer}, removed on disconnect ---------- */
  function joinRoom(name) {
    const base = rtdb.ref('room/' + name), me = base.push(), connRef = rtdb.ref('.info/connected');
    const handlers = new Set(), connHandlers = new Set();
    let mine = {}, last = [], connected = false, gone = false;
    const write = () => (gone ? Promise.resolve() : me.set({ by: uid, p: mine, u: firebase.database.ServerValue.TIMESTAMP }));
    const onConn = connRef.on('value', s => {
      connected = !!s.val();
      if (connected && !gone) { me.onDisconnect().remove(); write().catch(e => console.warn('ClassPulse presence', e)); }
      connHandlers.forEach(fn => fn(connected));
    });
    const onVal = base.on('value', s => {
      const peers = [];
      s.forEach(ch => {
        const v = ch.val() || {};
        peers.push(Object.freeze({ peer: ch.key, by: v.by || null, isMe: v.by === uid, sameTab: ch.key === me.key, kind: 'viewer', guest: false, presence: Object.freeze(v.p || {}), updatedAt: typeof v.u === 'number' ? v.u : Date.now() }));
      });
      const before = new Map(last.map(p => [p.peer, p])), now = new Map(peers.map(p => [p.peer, p]));
      const change = {
        peers,
        joined: peers.filter(p => !before.has(p.peer)),
        left: last.filter(p => !now.has(p.peer)),
        updated: peers.filter(p => before.has(p.peer) && JSON.stringify(before.get(p.peer).presence) !== JSON.stringify(p.presence)),
      };
      last = peers;
      handlers.forEach(fn => fn(change));
    });
    return {
      name,
      presence: async patch => {
        const next = { ...mine };
        for (const [k, v] of Object.entries(patch)) { if (v === null) delete next[k]; else next[k] = clone(v); }
        mine = next;
        try { await write(); } catch (e) { throw { code: 'upstream_error', message: String(e) }; }
      },
      peers: () => last,
      onPeers(fn) { handlers.add(fn); setTimeout(() => { if (handlers.has(fn)) fn({ peers: last, joined: last, left: [], updated: [] }); }, 0); return () => handlers.delete(fn); },
      connected: () => connected,
      onConnection(fn) { connHandlers.add(fn); setTimeout(() => { if (connHandlers.has(fn)) fn(connected); }, 0); return () => connHandlers.delete(fn); },
      emit: async () => {},
      on: () => () => {},
      leave: async () => {
        gone = true;
        base.off('value', onVal); connRef.off('value', onConn);
        handlers.clear(); connHandlers.clear();
        try { await me.onDisconnect().cancel(); await me.remove(); } catch {}
      },
    };
  }
  const room = {
    join: async name => { await ready; return joinRoom(name); },
    presence: async () => {}, peers: () => [], onPeers: () => () => {}, connected: () => true, onConnection: () => () => {}, emit: async () => {}, on: () => () => {},
  };

  /* ---------- user ---------- */
  const user = {
    id: async () => { await ready; return uid; },
    isOwner: async () => true, canEdit: async () => true, can: async () => true,
    me: async () => { await ready; return { id: uid, name: '', avatarUrl: '', color: '#636b88', email: null, isOwner: true, canEdit: true }; },
    profiles: async ids => Object.fromEntries([].concat(ids).map(i => [i, { id: i, name: '', avatarUrl: '', color: '#636b88', email: null, isMe: i === uid, guest: false }])),
  };

  /* ---------- sample: Gemini with the teacher's own API key ---------- */
  function settings() { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch { return {}; } }
  function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {} window.dispatchEvent(new Event('classpulse:ai-changed')); }
  const apiKey = () => String(settings().key || '').trim();
  const fail = (code, message, userMessage) => ({ code, message, userMessage });
  async function gemini(prompt, opts = {}) {
    const key = apiKey();
    if (!key) throw fail('not_granted', 'No Gemini API key', 'Add your Gemini API key in AI settings to use AI tools.');
    const st = settings();
    const model = String(opts.modelTier === 'quick' ? (st.quickModel || DEFAULT_QUICK) : (st.model || DEFAULT_MODEL)).trim();
    let res;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        signal: opts.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.4 } }),
      });
    } catch (e) {
      if (e && e.name === 'AbortError') throw fail('cancelled', 'aborted');
      throw fail('upstream_error', String(e), "Couldn't reach Gemini. Check your connection and try again.");
    }
    let body = null;
    try { body = await res.json(); } catch {}
    if (!res.ok) {
      const msg = (body && body.error && body.error.message) || res.statusText;
      if (res.status === 429) throw fail('rate_limited', msg, 'Gemini is limiting requests for this key. Wait a minute and try again.');
      if (res.status === 400 && /api key/i.test(msg)) throw fail('not_granted', msg, 'Gemini rejected the API key. Check it in AI settings.');
      if (res.status === 403) throw fail('not_granted', msg, `This key can't use ${model}. Check the key and the model in AI settings.`);
      if (res.status === 404) throw fail('upstream_error', msg, `The model ${model} isn't available. Choose another model in AI settings.`);
      throw fail('upstream_error', msg, `Gemini returned an error (${res.status}). Try again.`);
    }
    if (body && body.promptFeedback && body.promptFeedback.blockReason) throw fail('refused', body.promptFeedback.blockReason);
    const cand = body && body.candidates && body.candidates[0];
    if (!cand) throw fail('empty_completion', 'No candidates');
    if (cand.finishReason === 'SAFETY') throw fail('refused', 'SAFETY');
    const text = ((cand.content && cand.content.parts) || []).filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
    if (!text.trim()) throw fail('empty_completion', 'Empty answer');
    return text;
  }
  function parseJsonLoose(text) {
    try { return JSON.parse(text); } catch {}
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) { try { return JSON.parse(fence[1]); } catch {} }
    const a = text.search(/[[{]/), b = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
    if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch {} }
    throw { code: 'invalid_json', message: 'The answer was not valid JSON', text };
  }
  const sample = async (prompt, opts = {}) => ({ text: await gemini(prompt, opts), truncated: false, modelTierApplied: opts.modelTier || 'default' });
  sample.json = async (prompt, opts = {}) => parseJsonLoose(await gemini(prompt, opts));
  sample.limits = async () => ({ maxPromptBytes: 262144 });

  /* ---------- downloads ---------- */
  const downloads = {
    save: async ({ filename, data }) => {
      const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: 'text/markdown' }));
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return { status: 'saved' };
    },
  };

  /* ---------- AI settings dialog (uses the app's own styles) ---------- */
  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    n.append(...kids.filter(Boolean));
    return n;
  }
  function openSettings() {
    if (document.getElementById('aiSettings')) return;
    const st = settings();
    const key = el('input', { type: 'password', id: 'aiKey', autocomplete: 'off', spellcheck: 'false', placeholder: 'Paste your Gemini API key' });
    key.value = st.key || '';
    const model = el('input', { type: 'text', id: 'aiModel', autocomplete: 'off', spellcheck: 'false' });
    model.value = st.model || DEFAULT_MODEL;
    const quick = el('input', { type: 'text', id: 'aiQuick', autocomplete: 'off', spellcheck: 'false' });
    quick.value = st.quickModel || DEFAULT_QUICK;
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    const save = () => { saveSettings({ key: key.value.trim(), model: model.value.trim() || DEFAULT_MODEL, quickModel: quick.value.trim() || DEFAULT_QUICK }); close(); };
    const show = el('button', { type: 'button', class: 'linkbtn', text: 'Show key', onclick: () => { const on = key.type === 'password'; key.type = on ? 'text' : 'password'; show.textContent = on ? 'Hide key' : 'Show key'; } });
    const field = (label, input, hint) => el('div', { class: 'field' }, el('label', { for: input.id, text: label }), input, hint ? el('p', { class: 'hint', text: hint }) : null);
    const link = el('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener noreferrer', text: 'Get a free key in Google AI Studio' });
    const dlg = el('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'aiSetTitle' },
      el('h2', { id: 'aiSetTitle', text: 'AI settings' }),
      el('p', { text: 'ClassPulse uses Google Gemini for themes, quick checks and reports. The key stays in this browser and is sent only to the Gemini API.' }),
      field('Gemini API key', key), el('div', { class: 'row-actions', style: 'margin-top:0' }, show, link),
      field('Model for themes, checks and reports', model),
      field('Fast model for simulated students', quick, 'Change these only if Google retires a model.'),
      el('div', { class: 'dlg-actions' },
        st.key ? el('button', { type: 'button', class: 'btn ghost', text: 'Remove key', onclick: () => { saveSettings({ ...settings(), key: '' }); close(); } }) : null,
        el('button', { type: 'button', class: 'btn ghost', text: 'Cancel', onclick: close }),
        el('button', { type: 'button', class: 'btn primary', text: 'Save', onclick: save })));
    const back = el('div', { class: 'dlg-back', id: 'aiSettings', onclick: e => { if (e.target === back) close(); } }, dlg);
    document.body.append(back);
    document.addEventListener('keydown', onKey);
    key.focus();
  }

  /* ---------- Google Meet add-ons SDK bridge ---------- */
  const meet = (MODE === 'sidepanel' || MODE === 'mainstage') ? new Promise(resolve => {
    const start = async () => {
      try {
        if (!window.meet || !window.meet.addon) { console.warn('ClassPulse: the Meet add-ons SDK did not load.'); resolve(null); return; }
        const session = await window.meet.addon.createAddonSession({ cloudProjectNumber: String(CFG.meetCloudProjectNumber || '') });
        const client = MODE === 'mainstage' ? await session.createMainStageClient() : await session.createSidePanelClient();
        let startCode = null;
        try {
          const st = await client.getActivityStartingState();
          const data = st && st.additionalData ? JSON.parse(st.additionalData) : null;
          const c = data ? String(data.code || '').toUpperCase() : '';
          if (/^[A-Z0-9]{6}$/.test(c)) startCode = c;
        } catch { /* no activity running yet */ }
        const base = new URL('.', location.href).href;
        resolve({
          mode: MODE,
          startCode,
          canShare: MODE === 'sidepanel',
          share: code => client.startActivity({ mainStageUrl: base + 'mainstage.html', sidePanelUrl: base + 'sidepanel.html', additionalData: JSON.stringify({ code }) }),
        });
      } catch (e) {
        console.warn('ClassPulse: Meet add-on setup failed.', e);
        resolve(null);
      }
    };
    // Google asks add-ons to create the session only after the page has loaded.
    if (document.readyState === 'complete') start(); else window.addEventListener('load', start, { once: true });
  }) : null;

  /* ---------- The interface the app uses ---------- */
  window.claude = Object.freeze({
    use: async name => {
      if (name === 'sample') return sample;
      if (name === 'downloads') return downloads;
      try { await ready; } catch { return null; }
      return ({ db, room, user })[name] || null;
    },
    aiBlocked: () => (apiKey() ? null : 'Add your Gemini API key in AI settings to use AI tools.'),
    openSettings,
    meet,
    copy: {
      aiName: 'Gemini',
      joinUrl: SITE,
      dataHint: "ClassPulse can't reach its database. Check the Firebase values in config.js and the setup steps in SETUP.md.",
      roomHint: "ClassPulse can't open a live connection. Check your internet connection and the Realtime Database rules.",
      footNote: 'Students stay anonymous. AI runs on the teacher’s own Gemini API key.',
      joinHelp: MODE === 'web'
        ? [`Share this page’s address with your students: ${SITE}`, 'They open it, tap Join a class and enter the code.', 'No students handy? Use Simulate students.']
        : ['Choose Show on main stage. Meet asks everyone in the call to open ClassPulse.', `Students without the add-on can open ${SITE} on a phone or laptop, tap Join a class and enter the code.`, 'No students handy? Use Simulate students.'],
    },
  });
})();
