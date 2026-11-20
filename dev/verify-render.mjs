// Executes the actual component functions from client.js with a hook shim,
// across every status state the UI can see. Catches render-time exceptions
// that registration-only tests miss (blank panel / blank chip).
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const code = fs.readFileSync(path.join(root, '..', 'client.js'), 'utf8');

let captured = null;
let outerEl = null;
let hookIdx = 0;
let statusValue = null; // useProxy statusState[0]
const busyValue = null;

function resetHooks() { hookIdx = 0; }

const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  // useProxy hook order: status(0), busy(1), note(2); then 3 useRef; then 2 useCallback
  useState: () => {
    const i = hookIdx++;
    if (i === 0) return [statusValue, () => {}];
    if (i === 1) return [busyValue, () => {}];
    if (i === 2) return ['', () => {}];
    return [undefined, () => {}];
  },
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: (v) => ({ current: v }),
};
const require = (name) => { if (name === 'react') return React; throw new Error('unexpected require: ' + name); };
const sandbox = {
  window: { __ModuleLoader__: { load: (spec) => { captured = spec; } } },
  navigator: { language: 'zh-CN' },
  AbortSignal: { timeout: () => ({}) },
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1, clearTimeout: () => {},
  console,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'client.js' });

const mod = captured.factory(require);
const effects = [];
const compsByName = {};
const ctx = {
  get: () => null, // inline fallback dictionary
  effect: (fn) => { effects.push(fn); return fn; },
  slots: {
    inject: (key, factory) => { factory(); return () => {}; },
    register: (meta, comp) => { compsByName[meta.name] = comp; return () => {}; },
  },
};
mod.apply(ctx);
for (const fn of [...effects]) { try { fn(); } catch (e) { throw new Error('effect threw: ' + e.message); } }

function render(slotName) {
  const outer = compsByName[slotName];
  if (typeof outer !== 'function') throw new Error('no component for ' + slotName);
  resetHooks();
  const wrapper = outer();
  const Inner = wrapper && wrapper.type;
  if (typeof Inner !== 'function') throw new Error(slotName + ': wrapper returned no function type');
  resetHooks();
  const tree = Inner({ close: () => {} });
  return tree;
}

const states = [
  ['first-render (null)', null],
  ['valid + expiry', { running: true, logged_in: true, auth_state: 'valid', user: 'test-user', auth_expiry_at: 1797601406000, expires_in_ms: 120000, auto_restarts: 0 }],
  ['valid (no auto_restarts)', { running: true, logged_in: true, auth_state: 'valid', user: 'u' }],
  ['expired', { running: true, logged_in: true, auth_state: 'expired', user: 'u', auth_expiry_at: 1000 }],
  ['logged_out', { running: true, logged_in: false, auth_state: 'logged_out' }],
  ['legacy logged in (no auth_state)', { running: true, logged_in: true, user: 'u' }],
  ['legacy logged out (no auth_state)', { running: true, logged_in: false }],
  ['stopped', { running: false }],
  ['unreachable', { unreachable: true }],
];

let fails = 0;
for (const [label, st] of states) {
  statusValue = st;
  const row = [];
  for (const slot of ['settings.section', 'conversation.composer.dock']) {
    try {
      const tree = render(slot);
      row.push(slot + '=OK(root:' + (tree && tree.type) + ')');
    } catch (e) {
      fails++;
      row.push(slot + '=FAIL(' + (e && e.message) + ')');
    }
  }
  console.log(label + ' -> ' + row.join(' | '));
}
console.log('\nrender failures:', fails);
if (fails) process.exitCode = 1;
else console.log('ALL RENDER STATES PASSED');
