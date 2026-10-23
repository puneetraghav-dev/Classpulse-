// Test-only stand-in for Claude's artifact runtime (window.claude).
// db / room / user come from the app's own local runtime (shared localStorage across tabs);
// sample returns canned AI answers; students get a read-only db, like invited guests do.
(() => {
  const role = window.__mockRole || 'teacher';
  let rt = null;
  const local = () => (rt ||= window.ClassPulse.createLocalRuntime());
  const delay = (ms, signal) => new Promise((res, rej) => {
    const t = setTimeout(res, ms);
    signal && signal.addEventListener('abort', () => { clearTimeout(t); rej({ code: 'cancelled', message: 'aborted' }); });
  });
  window.__aiCalls = [];
  async function answer(prompt) {
    if (prompt.includes('Group the doubts into at most 5 themes')) {
      const json = prompt.split('\n').find(l => l.startsWith('[{'));
      const docs = JSON.parse(json);
      const a = docs.filter((_, i) => i % 3 !== 2).map(d => d.id);
      const b = docs.filter((_, i) => i % 3 === 2).map(d => d.id);
      return { themes: [
        { title: 'Why the base case stops recursion', insight: 'Students think each call runs forever because they cannot see where it returns.', reexplain: 'Trace factorial(3) on the board, one call per line, and cross each off as it returns.', priority: 'high', doubtIds: a },
        { title: 'What the call stack holds', insight: 'They picture one shared variable instead of a frame per call.', reexplain: 'Stack three sticky notes, one per call, each with its own n.', priority: 'medium', doubtIds: b.length ? b : a.slice(0, 1) },
      ] };
    }
    if (prompt.includes('quick 3-question multiple-choice check')) {
      return { questions: [
        { q: 'What stops factorial(n) from calling itself forever?', options: ['The base case n == 0 returns 1', 'The stack runs out of memory', 'The loop counter', 'The return type'], answer: 0, why: 'Recursion ends when a call hits the base case and returns without recursing.' },
        { q: 'How many stack frames exist at the deepest point of factorial(3)?', options: ['1', '3', '4', 'It depends on the CPU'], answer: 2, why: 'factorial(3), (2), (1) and (0) are all on the stack at once.' },
        { q: 'What does each recursive call get its own copy of?', options: ['The whole program', 'Its parameters and local variables', 'Global variables', 'Nothing'], answer: 1, why: 'Every call has its own frame holding its parameters and locals.' },
      ] };
    }
    if (prompt.includes('simulating their class')) {
      return { doubts: [
        'why does it not keep calling itself forever??', 'where does the return value go after the call finishes', 'is base case same as the if condition',
        'what is a stack frame exactly', 'how many times does factorial get called for 5', 'can every loop be written as recursion?',
        'i got lost when you went back up the calls', 'what happens if we forget the base case', 'do variables get overwritten in each call',
        'can u go slower on the tracing part', 'is recursion slower than loops', 'will this be in the mid sem',
      ] };
    }
    if (prompt.includes('end-of-class report')) {
      return { headline: 'Students followed the idea of recursion but lost the thread when calls returned.',
        summary: 'Confusion peaked while tracing the call stack. The quick check showed most students understand the base case but not the number of frames.',
        struggles: [{ topic: 'Unwinding the call stack', evidence: 'Peak confusion while tracing returns; the most-shared doubt asked where return values go.' }],
        wins: ['Most students identified the base case correctly.'],
        nextClass: ['Open with a 5-minute stack trace of factorial(3).', 'Draw one frame per call with its own n.', 'Re-run the frames question as a warm-up.'],
        practice: ['Trace sum(4) where sum(n) = n + sum(n-1) and sum(0) = 0.', 'How many frames does fib(3) create?', 'Rewrite factorial with a loop.'] };
    }
    return {};
  }
  const sample = async (prompt) => ({ text: JSON.stringify(await answer(prompt)), truncated: false, modelTierApplied: 'default' });
  sample.json = async (prompt, opts = {}) => { window.__aiCalls.push(prompt.slice(0, 60)); await delay(600, opts.signal); return answer(prompt); };
  sample.limits = async () => ({ maxPromptBytes: 262144 });
  const downloads = { save: async ({ filename, data }) => { window.__lastDownload = { filename, size: String(data).length }; return { status: 'saved' }; } };
  function readOnlyDb(db) {
    const deny = () => Promise.reject({ code: 'invalid_argument', message: 'view-only' });
    const wrapDoc = d => ({ ...d, set: deny, update: deny, delete: deny, collection: p => wrapCol(d.collection(p)) });
    const wrapCol = c => ({ ...c, doc: id => wrapDoc(c.doc(id)), add: deny });
    return { doc: p => wrapDoc(db.doc(p)), collection: p => wrapCol(db.collection(p)) };
  }
  window.claude = {
    use: async (name) => {
      await new Promise(r => setTimeout(r, 30));
      const L = await local().use(name);
      if (name === 'db') return role === 'student' ? readOnlyDb(L) : L;
      if (name === 'user') return role === 'student' ? { ...L, isOwner: async () => false, canEdit: async () => false, can: async () => false } : L;
      if (name === 'room') return L;
      if (name === 'sample') return sample;
      if (name === 'downloads') return downloads;
      return null;
    },
  };
})();
