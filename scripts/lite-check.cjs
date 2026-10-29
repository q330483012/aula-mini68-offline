'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');

(async () => {
  const root = path.resolve(__dirname, '..');
  const port = await new Promise(resolve => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => { const p = server.address().port; server.close(() => resolve(p)); });
  });
  const exe = process.env.AULA_LITE_EXE || path.join(root, 'dist/MINI68-Lite.exe');
  const child = spawn(exe, [], { windowsHide: true, env: { ...process.env,
    AULA_LITE_TEST: '1', AULA_LITE_DEBUG_PORT: String(port),
    AULA_LITE_TEST_PROFILE: path.join(root, 'test-results', 'lite-profile-' + Date.now())
  } });
  let browser, page;
  try {
    for (let n = 0; n < 100; n++) {
      // The single-file launcher exits successfully after starting its embedded core.
      if (child.exitCode !== null && child.exitCode !== 0) throw new Error('App exited ' + child.exitCode);
      try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) break; } catch {}
      await new Promise(r => setTimeout(r, 300));
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    page = context.pages()[0] || await context.waitForEvent('page');
    const errors = [], failures = [], outside = [], logs = [];
    page.on('pageerror', e => { errors.push(e.message); console.log('PAGE_ERROR', e.stack); });
    page.on('console', m => { if (m.type() === 'error') logs.push(m.text()); });
    page.on('requestfailed', r => failures.push({ url: r.url(), error: r.failure()?.errorText }));
    page.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith('http://tauri.localhost') && !r.url().startsWith('http://ipc.localhost')) outside.push(r.url()); });
    await page.waitForFunction(() => window.HIDDevice && document.body.innerText.includes('连接键盘'));
    const installAudit = () => {
      globalThis.__audit = { mode: 'silent', read: {}, blocked: [], received: 0, packets: 0, frames: 0, colored: 0, samples: [], trace: [] };
      const original = HIDDevice.prototype.sendReport;
      HIDDevice.prototype.sendReport = function(id, data) {
        const bytes = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
        if (bytes[0] === 170 && bytes[1] === 50) {
          __audit.packets++; if (bytes[6]) __audit.frames++;
          if (bytes.slice(8).some((v, i) => i % 4 !== 0 && v > 0)) __audit.colored++;
          const reply = bytes.slice();
          setTimeout(() => globalThis.getAllDataSuper?.({ data: new DataView(reply.buffer), device: this }), 1);
          return Promise.resolve();
        }
        if (bytes[0] !== 170 || ![0,16,17,18,19,20,21,22,23,24,27,28].includes(bytes[1])) {
          __audit.blocked.push(bytes[1]); return Promise.reject(new Error('Readonly test blocked ' + bytes[1]));
        }
        __audit.read[bytes[1]] = (__audit.read[bytes[1]] || 0) + 1;
        __audit.trace.push({ direction: 'out', bytes: Array.from(bytes.slice(0,8)), time: Date.now() });
        return original.call(this, id, data);
      };
      const open = HIDDevice.prototype.open;
      HIDDevice.prototype.open = async function() {
        this.addEventListener('inputreport', e => { __audit.received++;
          __audit.trace.push({ direction: 'in', bytes: Array.from(new Uint8Array(e.data.buffer).slice(0,8)), time: Date.now() });
        });
        return open.call(this);
      };
      const fetchOriginal = window.fetch;
      window.fetch = async (...args) => {
        const r = await fetchOriginal(...args);
        if (String(args[0]).includes('/api/audio/amplitude')) {
          __audit.samples.push(await r.clone().json());
          if (__audit.mode !== 'native') return new Response(JSON.stringify({ available: __audit.mode !== 'unavailable',
            amplitude: __audit.mode === 'sound' ? 60 : 0 }), { headers: { 'Content-Type': 'application/json' } });
        }
        return r;
      };
    };
    await page.evaluate(installAudit);
    await page.getByText('连接键盘', { exact: true }).click();
    await page.getByText('灯效设定', { exact: true }).waitFor({ timeout: 25000 });
    await page.waitForFunction(() => __audit.received >= 70 && ![...document.querySelectorAll('.el-loading-mask')].some(e => e.getBoundingClientRect().height), null, { timeout: 20000 });
    await page.waitForTimeout(6500);
    console.log('INITIAL', await page.evaluate(() => ({ read: __audit.read, received: __audit.received })));
    console.log('CONNECTED', (await page.locator('body').innerText()).slice(0, 1500));
    const pages = {};
    for (const tab of ['性能', '高级键', '宏管理器']) {
      const button = page.getByText(tab, { exact: true });
      if (await button.count() === 1 && await button.isVisible()) {
        await button.click(); await page.waitForTimeout(250);
        pages[tab] = (await page.locator('body').innerText()).slice(-3500);
      }
    }
    await page.getByText('灯效设定', { exact: true }).click();
    await page.getByText('音乐律动', { exact: true }).click();
    const musicSwitch = page.getByRole('switch', { name: '音乐自动切换' });
    assert.equal(await musicSwitch.getAttribute('aria-checked'), 'false');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => __audit.samples.length), 0, 'disabled music must not sample audio');
    await musicSwitch.click();
    await page.getByRole('status').filter({ hasText: '正在使用普通灯效' }).waitFor();
    await page.waitForTimeout(1800);
    assert.equal(await page.evaluate(() => __audit.frames), 0, 'silence must preserve ordinary lighting');
    await page.evaluate(() => { __audit.mode = 'sound'; });
    await page.waitForFunction(() => __audit.frames >= 5);
    await musicSwitch.click();
    await page.getByRole('status').filter({ hasText: '已关闭' }).waitFor();
    await page.waitForTimeout(150);
    const disabled = await page.evaluate(() => ({ frames: __audit.frames, samples: __audit.samples.length }));
    await page.waitForTimeout(400);
    assert.deepEqual(await page.evaluate(() => ({ frames: __audit.frames, samples: __audit.samples.length })), disabled);
    await musicSwitch.focus(); await page.keyboard.press('Space');
    await page.waitForFunction(n => __audit.frames > n + 2, disabled.frames);
    await page.evaluate(() => { __audit.mode = 'silent'; });
    await page.waitForTimeout(500);
    assert.match(await page.locator('.mini68-music-auto').innerText(), /音乐律动中/);
    await page.evaluate(() => { __audit.mode = 'sound'; });
    await page.waitForTimeout(350);
    await page.evaluate(() => { __audit.mode = 'unavailable'; });
    await page.getByRole('status').filter({ hasText: '声音设备不可用' }).waitFor();
    await page.waitForTimeout(150);
    const unavailableFrames = await page.evaluate(() => __audit.frames);
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => __audit.frames), unavailableFrames);
    const before = await page.evaluate(() => ({ frames: __audit.frames, samples: __audit.samples.length }));
    // Hide the WebView through the same action exposed by Ctrl+W.
    await page.evaluate(() => window.__TAURI__.core.invoke('hide_window'));
    const visible = await page.evaluate(() => window.__TAURI__.core.invoke('window_visible'));
    await page.evaluate(async () => {
      __audit.mode = 'native';
      const context = new AudioContext(); await context.resume();
      const tone = context.createOscillator(), gain = context.createGain();
      tone.frequency.value = 440; gain.gain.value = 0.04;
      tone.connect(gain).connect(context.destination); tone.start(); tone.stop(context.currentTime + 12);
      globalThis.__toneContext = context;
    });
    await page.waitForFunction(() => __audit.frames > 12 && document.querySelector('.mini68-music-auto').textContent.includes('音乐律动中'));
    await page.waitForTimeout(10500);
    const middle = await page.evaluate(() => ({ frames: __audit.frames, samples: __audit.samples.length }));
    await page.waitForTimeout(500);
    assert.ok(await page.evaluate(() => __audit.frames) > middle.frames, 'hidden playback must keep generating frames after 10 seconds');
    await page.screenshot({ path: path.join(root, 'test-results/lite-music.png') });
    await page.evaluate(async () => {
      __audit.mode = 'silent';
      await __toneContext.close();
    });
    await page.getByRole('status').filter({ hasText: '正在使用普通灯效' }).waitFor();
    await page.waitForTimeout(150);
    const silentFrames = await page.evaluate(() => __audit.frames);
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(() => __audit.frames), silentFrames, 'music frames must stop after the silence delay');
    await page.screenshot({ path: path.join(root, 'test-results/lite-music-silent.png') });
    // The switch owns music lifetime; navigation must not stop it.
    await page.evaluate(() => { __audit.mode = 'sound'; });
    await page.waitForFunction(n => __audit.frames > n + 3, silentFrames);
    const navigation = {};
    for (const tab of ['主面板灯效', '性能', '高级键', '宏管理器', '设置']) {
      await page.getByText(tab, { exact: true }).click();
      await page.waitForTimeout(150);
      const count = await page.evaluate(() => __audit.frames);
      await page.waitForTimeout(400);
      navigation[tab] = await page.evaluate(() => __audit.frames) - count;
      assert.ok(navigation[tab] > 0, 'enabled music must continue on ' + tab);
      assert.equal(await page.locator('.mini68-auto-music').count(), 1, 'navigation must keep one music instance');
    }
    await page.evaluate(() => { __audit.mode = 'silent'; });
    await page.waitForTimeout(1800);
    const stoppedFrames = await page.evaluate(() => __audit.frames);
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => __audit.frames), stoppedFrames,
      'silence must release music even away from the music tab');
    await page.locator('.set-up').getByText('返回', { exact: true }).click();
    await page.getByText('灯效设定', { exact: true }).click();
    await page.getByText('音乐律动', { exact: true }).click();
    await page.getByRole('status').filter({ hasText: '正在使用普通灯效' }).waitFor();
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => __audit.frames), stoppedFrames);
    assert.equal(await musicSwitch.getAttribute('aria-checked'), 'true', 'switch choice must survive page changes');
    await musicSwitch.click();
    await page.getByText('性能', { exact: true }).click();
    await page.getByText('灯效设定', { exact: true }).click();
    await page.getByText('音乐律动', { exact: true }).click();
    assert.equal(await musicSwitch.getAttribute('aria-checked'), 'false');
    const off = await page.evaluate(() => ({ frames: __audit.frames, samples: __audit.samples.length }));
    await page.evaluate(() => { __audit.mode = 'sound'; });
    await page.waitForTimeout(400);
    assert.deepEqual(await page.evaluate(() => ({ frames: __audit.frames, samples: __audit.samples.length })), off,
      'returning to settings must not restart a disabled session');
    const audit = await page.evaluate(() => __audit);
    const after = audit.samples.slice(before.samples);
    const result = { visible, before, middle, frames: audit.frames, packets: audit.packets,
      backgroundSamples: after.length, hiddenPlaybackFrames: middle.frames - before.frames, silentFrames, stoppedFrames,
      peak: Math.max(...after.map(s => s.amplitude)), colored: audit.colored, read: audit.read,
      received: audit.received, blocked: audit.blocked, navigation, pages, errors, failures, outside, logs, trace: audit.trace };
    await page.screenshot({ path: path.join(root, 'test-results/lite-music-final.png') });
    // A remembered enabled switch starts at device connection, before the music
    // tab has ever been visited in this new page session.
    await musicSwitch.click();
    // Install after the bridge defines HIDDevice, before the vendor app starts.
    await page.addInitScript(`Object.defineProperty(window,'HIDDevice',{configurable:true,set(value){
      Object.defineProperty(window,'HIDDevice',{value,writable:true,configurable:true});
      queueMicrotask(${installAudit.toString()});
    }});`);
    await page.reload();
    // The existing device route reconnects using its remembered device identity.
    await page.getByText('灯效设定', { exact: true }).waitFor({ timeout: 25000 });
    await page.evaluate(() => { __audit.mode = 'sound'; });
    await page.waitForFunction(() => __audit.frames >= 5);
    assert.equal(await musicSwitch.isVisible(), false, 'restored music must run without opening its settings');
    assert.equal(await page.locator('.mini68-auto-music').count(), 1);
    result.restored = await page.evaluate(() => ({ frames: __audit.frames, samples: __audit.samples.length,
      blocked: __audit.blocked }));
    assert.deepEqual(result.restored.blocked, []);
    await page.evaluate(async () => {
      const device = (await navigator.hid.getDevices()).find(d => d.opened);
      await device.close();
      await window.__TAURI__.event.emit('mini68-disconnect', device.id);
    });
    await page.waitForTimeout(200);
    result.disconnected = await page.evaluate(() => ({ frames: __audit.frames, samples: __audit.samples.length }));
    await page.waitForTimeout(400);
    assert.deepEqual(await page.evaluate(() => ({ frames: __audit.frames, samples: __audit.samples.length })),
      result.disconnected, 'disconnect must stop sampling and frames');
    fs.writeFileSync(path.join(root, 'test-results/lite.json'), JSON.stringify(result, null, 2));
    console.log('RESULT', JSON.stringify({ ...result, pages: Object.keys(pages), trace: undefined }));
    assert.equal(visible, false); assert.ok(result.hiddenPlaybackFrames >= 10);
    assert.ok(result.peak > 0); assert.ok(result.colored > 0); assert.ok(result.received >= 70);
    assert.deepEqual(audit.blocked, []); assert.deepEqual(errors, []);
    assert.deepEqual(failures, []); assert.deepEqual(outside, []);
  } catch (error) {
    if (page) {
      console.log('FAILURE_STATE', await page.evaluate(() => ({ audit: globalThis.__audit, body: document.body.innerText.slice(-4000) })).catch(() => null));
      await page.screenshot({ path: path.join(root, 'test-results/lite-failure.png') }).catch(() => {});
    }
    throw error;
  } finally {
    if (page) {
      try { await page.evaluate(() => window.__TAURI__.core.invoke('quit_app')); } catch {}
    }
    if (browser) await browser.close().catch(() => {});
    if (!child.exitCode && child.exitCode !== 0) child.kill();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
