'use strict';
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

// Read the real keyboard, but intercept lighting writes and emulate acknowledgements.
// This validates desktop audio -> vendor effects -> HID packets without changing LEDs/settings.
(async () => {
  const root = path.resolve(__dirname, '..');
  const env = { ...process.env, AULA_TEST: '1', AULA_TEST_PROFILE: path.join(root, 'test-results/music-profile') };
  const windowed = process.argv.includes('--windowed');
  if (windowed) env.AULA_TEST_OFFSCREEN = '0';
  delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.argv.includes('--packaged');
  const app = await electron.launch({ executablePath: path.join(root, packaged ? 'dist/MINI68-Offline/MINI68-Offline.exe' : 'cache/electron/electron.exe'), args: packaged ? [] : [root], env });
  try {
    const page = await app.firstWindow();
    if (windowed) await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
    const errors = [], failures = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('requestfailed', r => failures.push({ url: r.url(), error: r.failure()?.errorText }));
    page.on('response', r => { if (r.status() >= 400) failures.push({ url: r.url(), status: r.status() }); });
    await page.addInitScript(() => {
      globalThis.__musicAudit = { packets: 0, frames: 0, colored: 0, blocked: [], read: 0, samples: [] };
      const original = HIDDevice.prototype.sendReport;
      HIDDevice.prototype.sendReport = function(id, data) {
        const bytes = new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength);
        if (bytes[0] === 170 && bytes[1] === 50) {
          __musicAudit.packets++;
          if (bytes[6]) __musicAudit.frames++;
          if (bytes.slice(8).some((v, i) => i % 4 !== 0 && v > 0)) __musicAudit.colored++;
          const reply = bytes.slice();
          setTimeout(() => globalThis.getAllDataSuper?.({ data: new DataView(reply.buffer), device: this }), 1);
          return Promise.resolve();
        }
        if (bytes[0] !== 170 || ![0,16,17,18,19,20,21,22,23,24,27,28].includes(bytes[1])) {
          __musicAudit.blocked.push(bytes[1]);
          return Promise.reject(new Error('Hardware write blocked: ' + bytes[1]));
        }
        __musicAudit.read++;
        return original.call(this, id, data);
      };
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (...args) => {
        const response = await originalFetch(...args);
        if (String(args[0]).includes('/api/audio/amplitude')) {
          const sample = await response.clone().json();
          __musicAudit.samples.push({ ...sample, time: Date.now() });
        }
        return response;
      };
    });
    await page.waitForURL('https://mini68.local/**');
    await page.waitForLoadState('networkidle');
    await page.reload();
    await page.waitForLoadState('networkidle');
    if (await page.getByText('连接键盘', { exact: true }).isVisible()) await page.getByText('连接键盘', { exact: true }).click();
    await page.getByText('灯效设定', { exact: true }).waitFor({ timeout: 20000 });
    await page.getByText('灯效设定', { exact: true }).click();
    await page.getByText('音乐律动', { exact: true }).click();
    await page.waitForFunction(() => __musicAudit.frames >= 5 && __musicAudit.samples.some(s => s.available), null, { timeout: 15000 });
    console.log('MUSIC_UI', (await page.locator('body').innerText()).slice(-2400));
    const before = await page.evaluate(() => ({ frames: __musicAudit.frames, samples: __musicAudit.samples.length }));
    const state = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.close();
      return { destroyed: w.isDestroyed(), visible: w.isVisible(), throttling: w.webContents.getBackgroundThrottling() };
    });
    // Quiet two-second tone through the Windows playback endpoint; no volume changes.
    await page.evaluate(async () => {
      const context = new AudioContext();
      await context.resume();
      const tone = context.createOscillator(), gain = context.createGain();
      tone.frequency.value = 440;
      gain.gain.value = 0.04;
      tone.connect(gain).connect(context.destination);
      tone.start(); tone.stop(context.currentTime + 2);
      await new Promise(resolve => { tone.onended = resolve; });
      await context.close();
    });
    await page.waitForFunction(n => __musicAudit.frames >= n + 20, before.frames, { timeout: 10000 });
    const audit = await page.evaluate(() => __musicAudit);
    const backgroundSamples = audit.samples.slice(before.samples);
    const summary = { state, before, frames: audit.frames, packets: audit.packets, colored: audit.colored, blocked: audit.blocked, peak: Math.max(...backgroundSamples.map(s => s.amplitude)), backgroundSamples: backgroundSamples.length, errors, failures };
    console.log('RESULT', JSON.stringify(summary));
    fs.writeFileSync(path.join(root, 'test-results/music.json'), JSON.stringify(summary, null, 2));
    if (!windowed) {
      const shot = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
      fs.writeFileSync(path.join(root, 'test-results/music.png'), Buffer.from(shot, 'base64'));
    }
    assert.equal(state.destroyed, false);
    assert.equal(state.visible, false);
    assert.equal(state.throttling, false);
    assert.ok(backgroundSamples.length >= 20, 'audio polling continues hidden');
    assert.ok(summary.peak > 0, 'native meter detects actual playback');
    assert.ok(audit.colored > 0, 'audio generates colored lighting packets');
    assert.deepEqual(audit.blocked, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(failures, []);
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
