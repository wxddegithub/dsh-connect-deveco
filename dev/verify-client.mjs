// Headless simulation of DSH's client module loader + a minimal React shim.
// Executes client.js for real and asserts that apply() registers the expected slots.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const code = fs.readFileSync(path.join(root, '..', 'client.js'), 'utf8');

let captured = null;
const registered = [];
const effects = [];
const localeCalls = [];

// Minimal React shim: hooks just return inert values; components are never rendered.
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (v) => [v, () => {}],
  useEffect: (fn) => { effects.push(fn); },
  useCallback: (fn) => fn,
  useRef: (v) => ({ current: v }),
};

const require = (name) => {
  if (name === 'react') return React;
  throw new Error('unexpected require: ' + name);
};

const sandbox = {
  window: {
    __ModuleLoader__: {
      load: (spec) => { captured = spec; },
    },
  },
  navigator: { language: 'zh-CN' },
  AbortSignal: { timeout: () => ({}) },
  fetch: async () => ({ ok: true, json: async () => ({ running: true, logged_in: true }) }),
  setInterval: () => 1,
  clearInterval: () => {},
  setTimeout: () => 1,
  clearTimeout: () => {},
  console,
};
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'client.js' });

if (!captured) throw new Error('FAIL: __ModuleLoader__.load was never called');
if (captured.id !== 'dsh-connect-deveco') throw new Error('FAIL: wrong module id: ' + captured.id);
console.log('PASS: module registered with id =', captured.id);

const mod = captured.factory(require);
if (!Array.isArray(mod.inject) || !mod.inject.includes('slots')) throw new Error('FAIL: inject must include slots');
if (typeof mod.apply !== 'function') throw new Error('FAIL: apply is not a function');
console.log('PASS: factory returned { inject: [' + mod.inject.join(',') + '], apply() }');

const ctx = {
  get: (name) => {
    if (name === 'locale') {
      return {
        register: (ns, d) => { localeCalls.push(['register', ns, Object.keys(d)]); return () => {}; },
        bind: (ns) => { localeCalls.push(['bind', ns]); return (k) => null; },
      };
    }
    return null;
  },
  effect: (fn) => { effects.push(fn); return fn; },
  slots: {
    inject: (key, factory) => {
      const reg = factory();
      registered.push(['inject', key]);
      return () => {};
    },
    register: (meta, comp) => {
      registered.push(['register', meta.name, meta.id, meta.order || 0]);
      return () => {};
    },
  },
};

mod.apply(ctx);

// Run queued effects (locale register/bind + slot injections happen inside effects).
for (const fn of [...effects]) {
  try { fn(); } catch (e) { throw new Error('FAIL: effect threw: ' + e.message); }
}

console.log('PASS: effects executed:', effects.length);
console.log('PASS: locale calls:', JSON.stringify(localeCalls));

const names = registered.map((r) => r.join(':')).join(' | ');
console.log('REGISTRATIONS:', names);

for (const need of [
  'inject:conversation.composer.dock',
  'register:conversation.composer.dock:dsh-connect-deveco:10',
  'inject:settings.section',
  'register:settings.section:dsh-connect-deveco:35',
  'inject:settings.section.icon',
  'register:settings.section.icon:dsh-connect-deveco:0',
]) {
  if (!names.includes(need)) throw new Error('FAIL: missing registration -> ' + need);
}
console.log('PASS: all 6 expected slot registrations present (composer chip + settings section + icon)');
console.log('\nALL CLIENT SIMULATION CHECKS PASSED');
