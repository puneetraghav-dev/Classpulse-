// End-to-end run of a full class: 1 teacher + 2 students (+22 simulated), with the mocked runtime.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PAGE = 'file://' + path.resolve(__dirname, '../index.html');
const SHOTS = path.resolve(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const mock = fs.readFileSync(path.join(__dirname, 'mock.js'), 'utf8');
const log = (...a) => console.log('•', ...a);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
  const problems = [];
  const watch = (page, name) => {
    page.on('console', m => {
      const t = m.text();
      if (m.type() === 'error' && !t.includes('fonts.g')) problems.push(`[${name}] console error: ${t}`);
      if (m.type() === 'warning' && t.includes('ClassPulse')) problems.push(`[${name}] warning: ${t}`);
    });
    page.on('pageerror', e => problems.push(`[${name}] page error: ${e.message}`));
  };
  async function open(name, role, vp) {
    const p = await ctx.newPage();
    if (vp) await p.setViewportSize(vp);
    await p.addInitScript(`window.__mockRole = ${JSON.stringify(role)};`);
    await p.addInitScript(mock);
    watch(p, name);
    await p.goto(PAGE);
    await p.waitForFunction(() => !document.querySelector('#homeNote').textContent.includes('Connecting'));
    return p;
  }
  const overflow = p => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const shot = (p, n, full = true) => p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: full });

  // ---------- Teacher starts a class ----------
  const T = await open('teacher', 'teacher');
  await shot(T, '01-home-desktop');
  await T.fill('#hTitle', 'Data Structures, Lecture 12');
  await T.fill('#hTopic', 'Recursion and the call stack');
  await T.fill('#hNotes', 'Factorial and Fibonacci examples; tracing the stack.');
  await T.fill('#hMeet', 'abc-defg-hij');
  await T.click('#hostBtn');
  await T.waitForSelector('#v-host:not([hidden])');
  await T.waitForFunction(() => document.querySelector('#hTitle2').textContent.includes('Data Structures'));
  const code = (await T.textContent('#codeChip')).replace(/\s/g, '');
  log('class code', code);
  await shot(T, '02-host-empty');

  // ---------- Two students join ----------
  const A = await open('studentA', 'student', { width: 390, height: 844 });
  const B = await open('studentB', 'student', { width: 390, height: 844 });
  log('student home has start form?', await A.isVisible('#startCard'));
  await shot(A, '03-student-home-mobile');
  for (const s of [A, B]) {
    await s.fill('#joinCode', code.toLowerCase());
    await s.click('#joinBtn');
    await s.waitForSelector('#v-student:not([hidden])');
  }
  await A.waitForFunction(() => document.querySelector('#sConn').textContent.includes('CONNECTED'), null, { timeout: 15000 });
  log('student A status:', await A.textContent('#sConn'), '| meet button:', await A.getAttribute('#sMeet', 'href'), await A.isVisible('#sMeet'));
  await A.click('.pbtn[data-p="lost"]');
  await B.click('.pbtn[data-p="unsure"]');
  await A.fill('#doubtInput', 'Why does the function not keep calling itself forever?');
  await A.click('#sendDoubt');
  await B.fill('#doubtInput', 'Where does the return value go after each call finishes?');
  await B.click('#sendDoubt');
  await T.waitForFunction(() => document.querySelectorAll('#hostWall .dbt').length >= 2, null, { timeout: 15000 });
  log('teacher sees doubts:', await T.$$eval('#hostWall .dbt-text', els => els.map(e => e.textContent)));
  await B.waitForFunction(() => document.querySelectorAll('#sWall .metoo').length >= 1, null, { timeout: 15000 });
  await B.click('#sWall .metoo');
  await T.waitForFunction(() => [...document.querySelectorAll('#hostWall .votes b')].some(b => b.textContent === '1'), null, { timeout: 15000 });
  await T.waitForFunction(() => document.querySelector('#kConf .kpi-v').textContent !== '–', null, { timeout: 15000 });
  log('confusion KPI (expect 75%):', await T.textContent('#kConf .kpi-v'), '| online:', await T.textContent('#kOnline .kpi-v'), '| gauge:', await T.getAttribute('#gaugeBox svg', 'aria-label'));
  await shot(A, '04-student-live-mobile');
  log('student overflow px:', await overflow(A));

  // ---------- Simulation ----------
  await T.click('#simBtn');
  await T.waitForFunction(() => document.querySelectorAll('#hostWall .dbt').length >= 12, null, { timeout: 60000 });
  log('after simulation: online', await T.textContent('#kOnline .kpi-v'), await T.textContent('#kOnline .kpi-s'), '| confusion', await T.textContent('#kConf .kpi-v'));

  // ---------- Themes ----------
  await T.getByRole('button', { name: 'Find themes' }).click();
  await T.waitForSelector('#themesBody .theme', { timeout: 15000 });
  log('themes:', await T.$$eval('#themesBody .theme h3', els => els.map(e => e.textContent)), await T.$$eval('#themesBody .th-count b', els => els.map(e => e.textContent)));

  // ---------- Quick check ----------
  await T.getByRole('button', { name: 'Make a quick check' }).click();
  await T.getByRole('button', { name: 'Send to students' }).waitFor({ timeout: 15000 });
  await shot(T, '05-host-quiz-draft');
  await T.getByRole('button', { name: 'Send to students' }).click();
  for (const [s, pick] of [[A, 0], [B, 1]]) {
    await s.waitForSelector('#sQuiz:not([hidden]) .opt', { timeout: 15000 });
    const qs = await s.$$('#sQuiz .q');
    for (let i = 0; i < qs.length; i++) {
      await s.click(`#sQuiz .q:nth-child(${i + 1}) .opt:nth-child(${pick + 1})`);
    }
    await s.getByRole('button', { name: 'Submit answers' }).click();
  }
  await shot(A, '06-student-quiz-mobile');
  await T.waitForFunction(() => parseInt(document.querySelector('#quizMeta').textContent, 10) >= 6, null, { timeout: 40000 });
  log('quiz meta:', await T.textContent('#quizMeta'));
  await T.getByRole('button', { name: 'Peek at results' }).click();
  await shot(T, '07-host-live-desktop');
  await T.getByRole('button', { name: 'Reveal answers' }).click();
  await A.waitForSelector('#sQuiz .score', { timeout: 15000 });
  log('student A score line:', await A.textContent('#sQuiz .score'));
  await shot(A, '08-student-revealed-mobile');
  await T.getByRole('button', { name: 'Close check' }).click();
  await A.waitForSelector('#sQuiz', { state: 'hidden', timeout: 15000 });

  // ---------- Dark mode + mobile host ----------
  await T.emulateMedia({ colorScheme: 'dark' });
  await shot(T, '09-host-dark-desktop');
  await T.emulateMedia({ colorScheme: 'light' });
  await T.setViewportSize({ width: 390, height: 844 });
  await T.waitForTimeout(400);
  log('host mobile overflow px:', await overflow(T));
  await shot(T, '10-host-mobile');
  await T.setViewportSize({ width: 1280, height: 900 });
  await A.emulateMedia({ colorScheme: 'dark' });
  await shot(A, '11-student-dark-mobile');
  await A.emulateMedia({ colorScheme: 'light' });

  // ---------- Presenter (share into Meet) and pop-out ----------
  await T.click('#presentBtn');
  await T.waitForSelector('#presenter:not([hidden]) .pr-pulse');
  await shot(T, '12-presenter-pulse', false);
  await T.click('#prTabs button[data-v="join"]');
  await shot(T, '12b-presenter-join', false);
  await T.keyboard.press('Escape');
  await T.waitForSelector('#presenter', { state: 'hidden' });
  await T.click('#pipBtn');
  await T.waitForTimeout(800);
  log('pop-out: dialog shown?', await T.isVisible('#dlg'), '|', await T.textContent('#dlgTitle'), '| PiP enabled in this browser:', await T.evaluate(() => !!document.pictureInPictureEnabled), '| button now:', await T.textContent('#pipBtn'), '| in PiP:', await T.evaluate(() => !!document.pictureInPictureElement));
  if (await T.isVisible('#dlg')) await T.click('#dlgNo');

  // ---------- End class ----------
  await T.waitForTimeout(16000); // let a few timeline points accumulate
  await T.click('#endBtn');
  await T.click('#dlgYes');
  await T.waitForSelector('#v-report:not([hidden])', { timeout: 15000 });
  await T.waitForSelector('#repAI .headline', { timeout: 20000 });
  log('report headline:', await T.textContent('#repAI .headline'));
  log('tiles:', await T.$$eval('#repTiles .kpi', els => els.map(e => e.innerText.replace(/\n/g, ' | '))));
  await shot(T, '13-report-desktop');
  await T.getByRole('button', { name: 'Download (.md)' }).click();
  await T.waitForTimeout(200);
  log('download:', await T.evaluate(() => JSON.stringify(window.__lastDownload)));
  await A.waitForSelector('#sEnded:not([hidden])', { timeout: 15000 });
  await shot(A, '14-student-ended-mobile');
  await T.setViewportSize({ width: 390, height: 844 });
  await T.waitForTimeout(300);
  log('report mobile overflow px:', await overflow(T));
  await shot(T, '15-report-mobile');
  await T.setViewportSize({ width: 1280, height: 900 });
  await T.getByRole('button', { name: 'All classes' }).click();
  await T.waitForSelector('#historyPanel:not([hidden])', { timeout: 10000 });
  log('history rows:', await T.$$eval('#historyList .hrow', els => els.length));
  await shot(T, '16-home-history');
  log('AI calls:', await T.evaluate(() => window.__aiCalls.length));

  console.log('\nPROBLEMS:', problems.length ? '\n' + problems.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e); process.exit(1); });
