'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const MusicGate = require('../lite/music-gate.js');
const source = fs.readFileSync(path.join(__dirname, '../lite/music-runtime.js'), 'utf8');
function setup() {
  let now = 0, response = { available: true, amplitude: 0 }, frames = 0, closed = 0, requests = 0;
  const audible = [], storage = new Map();
  const component = { worker: null, autoMusicEnabled: false,
    setupWorker() { this.worker = { setAudible(value) { audible.push(value); } }; },
    createSendWorker() { this.sendWorker = {}; },
    stopPolling() { this.worker = this.sendWorker = null; closed++; },
    $emit: () => closed++, updateVisualizer: () => frames++ };
  const sandbox = { window: {}, Mini68MusicGate: MusicGate, performance: { now: () => now },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    fetch: async () => { requests++; return typeof response === 'function' ? response() : { ok: true, json: async () => response }; } };
  vm.runInNewContext(source, sandbox);
  return { component, audible, counts: () => ({ frames, closed, requests }),
    enable: value => sandbox.window.__mini68SetMusicEnabled(component, value),
    remembered: () => sandbox.window.__mini68MusicEnabled(),
    poll(time, value) { now = time; if (value !== undefined) response = value; return sandbox.window.__mini68PollMusic(component); } };
}

test('music defaults off, remembers the switch, and stops sampling and frames when disabled', async () => {
  const s = setup();
  assert.equal(s.remembered(), false);
  await s.poll(0, { available: true, amplitude: 90 });
  assert.equal(s.counts().requests, 0);
  s.enable(true); assert.equal(s.remembered(), true);
  await s.poll(0); await s.poll(150);
  assert.equal(s.counts().frames, 1);
  s.enable(false); assert.equal(s.remembered(), false);
  assert.equal(s.component.worker, null); assert.equal(s.component.sendWorker, null);
  assert.match(s.component.autoMusicStatus, /已关闭/);
  await s.poll(200);
  assert.deepEqual(s.counts(), { frames: 1, closed: 1, requests: 2 });
});

test('a pending response cannot reactivate music after switching off and back on', async () => {
  const s = setup(); let finish;
  s.enable(true);
  const pending = s.poll(0, () => new Promise(resolve => { finish = resolve; }));
  s.enable(false); s.enable(true);
  finish({ ok: true, json: async () => ({ available: true, amplitude: 99 }) }); await pending;
  assert.equal(s.counts().frames, 0); assert.deepEqual(s.audible, []);
  await s.poll(200, { available: true, amplitude: 90 }); await s.poll(350);
  assert.equal(s.counts().frames, 1);
});
test('ordinary to music to silence preserves short pauses and clears the preview on release', async () => {
  const s = setup();
  s.enable(true);
  await s.poll(0); assert.equal(s.counts().frames, 0);
  await s.poll(50, { available: true, amplitude: 30 });
  await s.poll(200); assert.equal(s.counts().frames, 1);
  assert.match(s.component.autoMusicStatus, /音乐律动中/);
  for (let t = 300; t <= 1600; t += 100) await s.poll(t, { available: true, amplitude: 0 });
  assert.equal(s.counts().closed, 0);
  await s.poll(1700);
  assert.equal(s.counts().closed, 1); assert.equal(s.audible.at(-1), false);
  const frames = s.counts().frames;
  await s.poll(1800); assert.equal(s.counts().frames, frames);
  assert.match(s.component.autoMusicStatus, /普通灯效/);
});
test('device loss and fetch errors stop music; sampling recovers without re-entering the page', async () => {
  const s = setup();
  s.enable(true);
  await s.poll(0, { available: true, amplitude: 30 }); await s.poll(150);
  await s.poll(200, { available: false, amplitude: 0 });
  assert.equal(s.audible.at(-1), false); assert.match(s.component.autoMusicStatus, /设备不可用/);
  await s.poll(250, () => { throw new Error('disconnected endpoint'); });
  assert.match(s.component.autoMusicStatus, /重试/); assert.equal(s.component.loading, false);
  await s.poll(300, { available: true, amplitude: 30 }); await s.poll(450);
  assert.equal(s.audible.at(-1), true);
});
test('overlapping samples coalesce and a late response after device cleanup cannot send frames', async () => {
  const s = setup(); let finish;
  s.enable(true);
  const pending = s.poll(0, () => new Promise(resolve => { finish = resolve; }));
  await s.poll(50); assert.equal(s.counts().requests, 1);
  s.component.worker = null;
  finish({ ok: true, json: async () => ({ available: true, amplitude: 99 }) }); await pending;
  assert.equal(s.counts().frames, 0); assert.deepEqual(s.audible, []);
});
