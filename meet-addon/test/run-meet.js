// End-to-end run of the Google Meet add-on build: teacher side panel, student side panel and the main stage,
// with Firebase, the Meet SDK and the Gemini API replaced by local stand-ins.
const pw = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(__dirname, 'site');
const SHOTS = path.join(__dirname, 'shots');
fs.rmSync(SITE, { recursive: true, force: true });
fs.mkdirSync(SITE, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
for (const f of ['index.html', 'sidepanel.html', 'mainstage.html', 'runtime-firebase.js', 'logo.png']) fs.copyFileSync(path.join(ROOT, f), path.join(SITE, f));
fs.writeFileSync(path.join(SITE, 'config.js'), `window.CLASSPULSE_CONFIG = {
  firebase: { apiKey: "test-api-key", authDomain: "classpulse-test.firebaseapp.com", databaseURL: "https://classpulse-test-default-rtdb.firebaseio.com", projectId: "classpulse-test", appId: "1:1:web:1" },
  meetCloudProjectNumber: "123456789012",
  gemini: { model: "gemini-3.8-flash", quickModel: "gemini-3.5-flash-lite" }
};`);
const MOCK_FB = fs.readFileSync(path.join(__dirname, 'mock-firebase.js'), 'utf8');
const MOCK_MEET = fs.readFileSync(path.join(__dirname, 'mock-meet.js'), 'utf8');
const url = f => 'file://' + path.join(SITE, f);
const log = (...a) => console.log('•', ...a);

function answer(prompt) {
  if (prompt.includes('Group the doubts into at most 5 themes')) {
    const docs = JSON.parse(prompt.split('\n').find(l => l.startsWith('[{')));
    const a = docs.filter((_, i) => i % 3 !== 2).map(d => d.id), b = docs.filter((_, i) => i % 3 === 2).map(d => d.id);
    return { themes: [
      { title: 'Why the base case stops recursion', insight: 'They cannot see where each call returns.', reexplain: 'Trace factorial(3) on the board, one call per line.', priority: 'high', doubtIds: a },
      { title: 'What the call stack holds', insight: 'They picture one shared variable.', reexplain: 'Stack three sticky notes, one per call.', priority: 'medium', doubtIds: b.length ? b : a.slice(0, 1) },
    ] };
  }
  if (prompt.includes('quick 3-question multiple-choice check')) return { questions: [
    { q: 'What stops factorial(n) from recursing forever?', options: ['The base case', 'Memory', 'A loop', 'The return type'], answer: 0, why: 'The base case returns without recursing.' },
    { q: 'How many frames exist at the deepest point of factorial(3)?', options: ['1', '3', '4', 'Depends'], answer: 2, why: 'factorial(3) down to factorial(0).' },
    { q: 'What does each call get its own copy of?', options: ['The program', 'Its parameters and locals', 'Globals', 'Nothing'], answer: 1, why: 'Each call has its own frame.' },
  ] };
  if (prompt.includes('simulating their class')) return { doubts: ['why does it not stop', 'where does the value go back', 'what is a stack frame', 'is base case the if', 'can loops do this', 'slower please', 'what if no base case', 'do variables get overwritten'] };
  if (prompt.includes('end-of-class report')) return { headline: 'The class followed the idea but lost track while calls returned.', summary: 'Confusion peaked while tracing returns.', struggles: [{ topic: 'Returning calls', evidence: 'Most-shared doubt.' }], wins: ['Base case understood'], nextClass: ['Trace a call stack', 'Draw frames', 'Re-run the check'], practice: ['Trace sum(3)', 'Frames in fib(3)?', 'Write factorial with a loop'] };
  return {};
}

(async () => {
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  let geminiCalls = 0, badKey = 0;
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route(/gstatic\.com\/firebasejs\//, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: /firebase-app-compat\.js$/.test(r.request().url()) ? MOCK_FB : '/* part of the mock */' }));
  await ctx.route(/gstatic\.com\/meetjs\/addons\//, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: MOCK_MEET }));
  await ctx.route(/generativelanguage\.googleapis\.com/, async r => {
    const req = r.request();
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    const key = req.headers()['x-goog-api-key'];
    if (key !== 'test-gemini-key') { badKey++; return r.fulfill({ status: 400, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.' } }) }); }
    geminiCalls++;
    const body = JSON.parse(req.postData());
    const out = answer(body.contents[0].parts[0].text);
    return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] }, finishReason: 'STOP' }] }) });
  });
  const problems = [];   // a 400 from Gemini is expected: the test tries a wrong API key first
  const watch = (p, name) => {
    p.on('pageerror', e => problems.push(`[${name}] page error: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error' && !m.text().includes('status of 400')) problems.push(`[${name}] console error: ${m.text()}`); if (m.type() === 'warning' && m.text().includes('ClassPulse')) problems.push(`[${name}] warning: ${m.text()}`); });
  };
  const open = async (name, file, vp) => {
    const p = await ctx.newPage();
    await p.setViewportSize(vp);
    watch(p, name);
    await p.goto(url(file));
    return p;
  };
  const shot = (p, n, full = true) => p.screenshot({ path: path.join(SHOTS, n + '.png'), fullPage: full });

  // ---------- Teacher opens ClassPulse in Meet's side panel ----------
  const T = await open('teacher', 'sidepanel.html', { width: 420, height: 900 });
  await T.waitForFunction(() => document.body.dataset.meet === 'sidepanel', null, { timeout: 15000 });
  log('side panel mode:', await T.evaluate(() => document.body.dataset.meet), '| hero hidden:', !(await T.isVisible('.hero-band')), '| chip:', await T.textContent('#topCtx'), '| Meet project number:', await T.evaluate(() => window.__meetProject));
  await shot(T, 'm1-sidepanel-home');
  await T.fill('#hTopic', 'Recursion');
  await T.fill('#hTitle', 'DSA Lecture 12');
  await T.click('#hostBtn');
  await T.waitForSelector('#v-host:not([hidden])');
  const code = (await T.textContent('#codeChip')).replace(/\s/g, '');
  log('class code', code, '| main-stage button:', await T.getByRole('button', { name: 'Show on main stage' }).isVisible(), '| pop-out hidden:', await T.isHidden('#pipBtn'));
  // AI without a key, then with a wrong key, then the right key
  log('AI hint without key:', await T.textContent('#themesBody'));
  await T.getByRole('button', { name: 'AI settings' }).first().click();
  await T.fill('#aiKey', 'wrong-key');
  await T.getByRole('button', { name: 'Save' }).click();
  await T.getByRole('button', { name: 'Show on main stage' }).click();
  await T.waitForTimeout(300);
  log('activity started:', await T.evaluate(() => window.__meetStarted && window.__meetStarted.additionalData), '| main stage URL:', await T.evaluate(() => window.__meetStarted && window.__meetStarted.mainStageUrl.split('/').pop()));

  // ---------- Main stage and a student who joins the activity ----------
  const M = await open('mainstage', 'mainstage.html', { width: 1280, height: 720 });
  await M.waitForSelector('#presenter:not([hidden]) .pr-code', { timeout: 15000 });
  log('main stage shows code:', (await M.textContent('.pr-code')).replace(/\s/g, ''), '| close hidden:', await M.isHidden('#prClose'));
  log('main stage join help:', await M.textContent('#prBody .pr-help'));
  await shot(M, 'm0-mainstage-join', false);
  const A = await open('student', 'sidepanel.html', { width: 400, height: 900 });
  await A.waitForSelector('#v-student:not([hidden])', { timeout: 15000 });
  await A.waitForFunction(() => document.querySelector('#sConn').textContent.includes('CONNECTED'), null, { timeout: 15000 });
  log('student auto-joined from the activity:', await A.textContent('#sTitle'), '|', await A.textContent('#sConn'));
  await A.click('.pbtn[data-p="lost"]');
  await A.fill('#doubtInput', 'Where does the return value go?');
  await A.click('#sendDoubt');
  await T.waitForFunction(() => document.querySelectorAll('#hostWall .dbt').length >= 1, null, { timeout: 15000 });
  await T.waitForFunction(() => document.querySelector('#kConf .kpi-v').textContent === '100%', null, { timeout: 15000 });
  log('teacher sees doubt + confusion:', await T.textContent('#hostWall .dbt-text'), '|', await T.textContent('#kConf .kpi-v'));
  await M.click('#prTabs button[data-v="pulse"]');
  await M.waitForFunction(() => (document.querySelector('#prBody svg.gauge') || {}).getAttribute && document.querySelector('#prBody svg.gauge').getAttribute('aria-label').includes('100%'), null, { timeout: 15000 });
  log('main stage gauge:', await M.getAttribute('#prBody svg.gauge', 'aria-label'));

  // ---------- AI through Gemini ----------
  await T.click('#simBtn');
  await T.waitForFunction(() => document.querySelectorAll('#hostWall .dbt').length >= 4, null, { timeout: 40000 });
  log('wrong key -> sim used built-in doubts; Gemini rejected calls:', badKey, '| doubts now', await T.$$eval('#hostWall .dbt', e => e.length));
  await T.getByRole('button', { name: 'AI settings' }).first().click();
  await T.fill('#aiKey', 'test-gemini-key');
  await T.getByRole('button', { name: 'Save' }).click();
  await T.getByRole('button', { name: 'Find themes' }).click();
  await T.waitForSelector('#themesBody .theme', { timeout: 15000 });
  log('themes via Gemini:', await T.$$eval('#themesBody .theme h3', els => els.map(e => e.textContent)));
  await T.getByRole('button', { name: 'Make a quick check' }).click();
  await T.getByRole('button', { name: 'Send to students' }).click({ timeout: 15000 });
  await A.waitForSelector('#sQuiz:not([hidden]) .opt', { timeout: 15000 });
  const n = await A.$$eval('#sQuiz .q', e => e.length);
  for (let i = 1; i <= n; i++) await A.click(`#sQuiz .q:nth-child(${i}) .opt:nth-child(1)`);
  await A.getByRole('button', { name: 'Submit answers' }).click();
  await T.waitForFunction(() => parseInt(document.querySelector('#quizMeta').textContent, 10) >= 1, null, { timeout: 30000 });
  await T.getByRole('button', { name: 'Reveal answers' }).click();
  await A.waitForSelector('#sQuiz .score', { timeout: 15000 });
  await M.click('#prTabs button[data-v="quiz"]');
  await M.waitForSelector('#prBody .score', { timeout: 15000 });
  log('student:', await A.textContent('#sQuiz .score'), '| main stage:', await M.textContent('#prBody .score'));
  await shot(T, 'm2-sidepanel-teacher');
  await shot(A, 'm3-sidepanel-student');
  await M.click('#prTabs button[data-v="pulse"]');
  await shot(M, 'm4-mainstage-pulse', false);

  // ---------- End of class ----------
  await T.click('#endBtn');
  await T.click('#dlgYes');
  await T.waitForSelector('#repAI .headline', { timeout: 20000 });
  log('report via Gemini:', await T.textContent('#repAI .headline'), '|', await T.textContent('#repAI .fine'));
  await M.waitForFunction(() => document.querySelector('#prBody').textContent.includes('Class ended'), null, { timeout: 15000 });
  log('main stage after class:', await M.textContent('#prBody'));

  // ---------- Plain web mode ----------
  const W = await open('web', 'index.html', { width: 1280, height: 800 });
  await W.waitForFunction(() => !document.querySelector('#homeNote').textContent.includes('Connecting'), null, { timeout: 15000 });
  log('web mode: meet attr', await W.evaluate(() => document.body.dataset.meet || 'none'), '| footer:', await W.textContent('#footNote'), '| history rows:', await W.$$eval('#historyList .hrow', e => e.length));
  log('web mode AI name on the start page:', await W.textContent('.ai-name'));
  log('Gemini calls:', geminiCalls, '| database keys:', await W.evaluate(() => Object.keys(window.__mockTree())));

  console.log('\nPROBLEMS:', problems.length ? '\n' + problems.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
