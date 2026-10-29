'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../lite/bridge.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function load() {
  const listeners = new Map(), calls = [];
  const sandbox = { console, EventTarget, Event, Map, Set, WeakMap, Promise, URL, Uint8Array, DataView,
    ArrayBuffer, DOMException, Response, location: { href: 'http://tauri.localhost/', origin: 'http://tauri.localhost' },
    localStorage: { getItem: () => 'zh' }, navigator: {},
    document: { addEventListener() {} }, fetch: async () => {},
    __TAURI__: { core: { invoke: async (name, args) => { calls.push({ name, args }); return []; } },
      event: { listen: async (name, fn) => { listeners.set(name, fn); return () => listeners.delete(name); } } }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox);
  return { window: sandbox, calls, listeners };
}
test('native IPC transactions wait for the previous ACK, including after failure', async () => {
  const { window } = load();
  const starts = [], completions = [];
  const manager = { sendReportSuperNative(command) { starts.push(command);
    return new Promise((resolve, reject) => completions.push({ resolve, reject })); } };
  const first = window.__mini68Transaction(manager, 18, [], []);
  const rejection = assert.rejects(first, /timeout/);
  const second = window.__mini68Transaction(manager, 20, [], []);
  await flush(); assert.deepEqual(starts, [18]);
  completions[0].reject(new Error('timeout')); await rejection; await flush();
  assert.deepEqual(starts, [18, 20]); completions[1].resolve('read');
  assert.equal(await second, 'read');
});
test('slow music frames coalesce to the latest frame and stop when the session terminates', async () => {
  const { window, listeners, calls } = load();
  const sent = [], finish = [];
  const manager = { sendReportSuperNative(_command, data) { sent.push(data);
    return new Promise(resolve => finish.push(resolve)); } };
  let ticks = 0;
  const timer = window.__mini68StartTicks(() => ticks++);
  timer.setAudible(true);
  await flush(); listeners.get('mini68-tick')({}); assert.equal(ticks, 1);
  for (const frame of [1, 2, 3]) window.__mini68SendMusic(manager, frame, []);
  await flush();
  assert.deepEqual(sent, [1]); finish[0](); await flush(); assert.deepEqual(sent, [1, 3]);
  window.__mini68SendMusic(manager, 4, []); timer.terminate(); finish[1](); await flush();
  assert.deepEqual(sent, [1, 3]); assert.equal(listeners.has('mini68-tick'), false);
  assert.equal(calls.filter(x => x.name === 'music_active').at(-1).args.active, false);
});
test('silence drops queued music frames without writing ordinary effects or custom colors', async () => {
  const { window } = load();
  const sent = [], finish = [];
  const manager = { sendReportSuperNative(command, data) { sent.push([command, data]);
    return new Promise(resolve => finish.push(resolve)); } };
  const session = window.__mini68StartTicks(() => {});
  window.__mini68SendMusic(manager, 'silent', []); await flush(); assert.deepEqual(sent, []);
  const read = window.__mini68Transaction(manager, 17, [], []); await flush();
  session.setAudible(true);
  window.__mini68SendMusic(manager, 'stale', []);
  window.__mini68SendMusic(manager, 'pending', []);
  session.setAudible(false);
  session.setAudible(true);
  finish[0](); await read; await flush(); assert.deepEqual(sent.map(x => x[0]), [17]);
  window.__mini68SendMusic(manager, 'fresh', []); await flush();
  assert.deepEqual(sent, [[17, []], [50, 'fresh']]);
  session.terminate(); finish[1](); await flush();
});
test('terminating music during an in-flight frame never drains pending frames into a new session', async () => {
  const { window } = load();
  const sent = [], finish = [];
  const manager = { sendReportSuperNative(_command, data) { sent.push(data);
    return new Promise(resolve => finish.push(resolve)); } };
  const first = window.__mini68StartTicks(() => {}); first.setAudible(true);
  window.__mini68SendMusic(manager, 1, []); await flush();
  window.__mini68SendMusic(manager, 2, []); first.terminate();
  const second = window.__mini68StartTicks(() => {}); second.setAudible(true);
  window.__mini68SendMusic(manager, 3, []);
  finish[0](); await flush(); assert.deepEqual(sent, [1, 3]);
  second.setAudible(false); finish[1](); await flush(); second.terminate();
});
