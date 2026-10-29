'use strict';
// Isolated native read-only profile; configuration writes receive simulated ACKs.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(__dirname, '..');
  const port = await new Promise(resolve => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => { const p = server.address().port; server.close(() => resolve(p)); });
  });
  const exe = process.env.AULA_LITE_EXE || path.join(root, 'dist/MINI68-Lite.exe');
  const child = spawn(exe, [], { windowsHide: true, env: { ...process.env,
    AULA_LITE_TEST: '1', AULA_LITE_DEBUG_PORT: String(port),
    AULA_LITE_TEST_PROFILE: path.join(root, 'test-results', 'lighting-ui-' + Date.now())
  } });
  let browser, page;
  try {
    for (let n = 0; n < 100; n++) {
      if (child.exitCode !== null && child.exitCode !== 0) throw new Error('App exited ' + child.exitCode);
      try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    page = browser.contexts()[0].pages()[0];
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.waitForFunction(() => window.HIDDevice && document.body.innerText.includes('连接键盘'));
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.evaluate(() => {
      globalThis.__lightingAudit = { reads: 0, writes: [] };
      const send = HIDDevice.prototype.sendReport;
      HIDDevice.prototype.sendReport = function(id, data) {
        const bytes = Uint8Array.from(ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data));
        if (bytes[0] === 170 && [0,16,17,18,19,20,21,22,23,24,27,28].includes(bytes[1])) {
          __lightingAudit.reads++; return send.call(this, id, data);
        }
        __lightingAudit.writes.push(Array.from(bytes));
        setTimeout(() => globalThis.getAllDataSuper?.({ data: new DataView(bytes.buffer), device: this }), 1);
        return Promise.resolve();
      };
    });
    await page.getByText('连接键盘', { exact: true }).click();
    await page.getByText('灯效设定', { exact: true }).waitFor({ timeout: 25000 });
    await page.waitForFunction(() => __lightingAudit.reads >= 80 &&
      ![...document.querySelectorAll('.el-loading-mask')].some(e => e.getBoundingClientRect().height));
    await page.getByText('灯效设定', { exact: true }).click();
    await page.getByText('自定义', { exact: true }).click();
    await page.locator('.mini68-palette-heading').waitFor();
    // Pick a real key and use the same wheel the user sees; all HID writes stay simulated.
    await page.locator('.keyboard-item').first().click();
    const wheel = page.locator('#picker .IroWheel');
    const box = await wheel.boundingBox();
    await wheel.click({ position: { x: box.width * .85, y: box.height * .5 } });
    await page.waitForTimeout(700);
    const hex = page.getByRole('textbox', { name: 'HEX 颜色', exact: true });
    const rgb = async () => Promise.all(['R','G','B'].map(ch => page.getByRole('textbox', { name: ch + ' 颜色', exact: true }).inputValue()));
    const selected = await hex.inputValue();
    assert.notEqual(selected.toLowerCase(), '#ffffff');
    const expected = [1,3,5].map(i => parseInt(selected.slice(i, i+2), 16));
    assert.deepEqual((await rgb()).map(Number), expected, 'wheel selection must synchronize HEX and RGB');
    assert.ok(await page.evaluate(() => __lightingAudit.writes.some(b => b[1] === 36)), 'selected key color must generate a custom lighting packet');
    const beforeHex = await page.evaluate(() => __lightingAudit.writes.length);
    await hex.fill('#123456'); await hex.press('Enter');
    await page.waitForTimeout(700);
    assert.deepEqual((await rgb()).map(Number), [18,52,86]);
    assert.ok(await page.evaluate(start => __lightingAudit.writes.slice(start).some(b => b[1] === 36 &&
      b.some((value, i) => i >= 8 && value === 18 && b[i+1] === 52 && b[i+2] === 86)), beforeHex),
      'HEX input must update the selected key in custom lighting packets');
    await page.getByRole('textbox', { name: 'R 颜色', exact: true }).fill('110');
    await page.getByRole('textbox', { name: 'R 颜色', exact: true }).press('Enter');
    assert.equal((await hex.inputValue()).toLowerCase(), '#6e3456');
    await hex.focus(); // Commit the RGB blur handler before clicking a preset.
    await page.waitForFunction(() => ![...document.querySelectorAll('.el-loading-mask')].some(e => e.getBoundingClientRect().height));
    await page.locator('.device-right-funciton-color-box-select-item').nth(5).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="HEX 颜色"]').value.toLowerCase() === '#ff0000');
    assert.equal((await hex.inputValue()).toLowerCase(), '#ff0000');
    assert.deepEqual((await rgb()).map(Number), [255,0,0]);
    const snapshots = [];
    for (const size of [{ width: 1280, height: 820 }, { width: 1000, height: 650 }]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(100);
      await wheel.scrollIntoViewIfNeeded();
      const metrics = await page.evaluate(() => {
        const selectors = ['.device-right-funciton-select-item', '.device-right-funciton-title', '.device-right-funciton-color-box-bg', '.function-item'];
        return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
          fonts: selectors.map(selector => ({ selector, size: parseFloat(getComputedStyle(document.querySelector(selector)).fontSize) })),
          picker: document.querySelector('#picker').getBoundingClientRect().toJSON() };
      });
      assert.ok(metrics.fonts.every(f => f.size >= 14), 'main text must remain at least 14 px');
      assert.ok(metrics.picker.x >= 0 && metrics.picker.right <= size.width, 'picker must fit the window width');
      assert.ok(metrics.scrollWidth <= size.width, 'page must not overflow horizontally');
      snapshots.push(metrics);
      const lastPreset = page.locator('.device-right-funciton-color-box-select-item').last();
      await lastPreset.scrollIntoViewIfNeeded();
      const presetBox = await lastPreset.boundingBox();
      assert.ok(presetBox.y >= 0 && presetBox.y + presetBox.height <= size.height, 'lower palette controls must be reachable by scrolling');
      await page.screenshot({ path: path.join(root, `test-results/lighting-ui-${size.width}.png`) });
    }
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.getByText('静态恒亮', { exact: true }).click();
    await wheel.waitFor();
    assert.match(await page.locator('.mini68-palette-heading').innerText(), /HEX/);
    await page.getByText('百花争艳', { exact: true }).click();
    assert.equal(await wheel.count(), 0, 'the multicolor firmware effect does not offer single-color editing');
    await page.getByText('音乐律动', { exact: true }).click();
    await page.getByRole('switch', { name: '音乐自动切换' }).waitFor();
    const musicSnapshots = [];
    for (const size of [{ width: 1280, height: 820 }, { width: 1000, height: 650 }]) {
      await page.setViewportSize(size);
      const toggle = page.getByRole('switch', { name: '音乐自动切换' });
      await toggle.scrollIntoViewIfNeeded();
      const bounds = await toggle.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= size.width, 'music switch must fit the window');
      const controls = page.locator('.mini68-auto-music .music-list-item').last();
      await controls.scrollIntoViewIfNeeded();
      const lower = await controls.boundingBox();
      assert.ok(lower.y >= 0 && lower.y + lower.height <= size.height, 'music controls must be reachable by scrolling');
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(scrollWidth <= size.width, 'music settings must not overflow horizontally');
      musicSnapshots.push({ width: size.width, scrollWidth, switch: bounds, lower });
      await toggle.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(root, `test-results/music-ui-${size.width}.png`) });
    }
    const result = { snapshots, musicSnapshots, selected, writes: await page.evaluate(() => __lightingAudit.writes.map(b => b[1])), errors };
    fs.writeFileSync(path.join(root, 'test-results/lighting-ui.json'), JSON.stringify(result, null, 2));
    console.log('RESULT', JSON.stringify(result));
    assert.deepEqual(errors, []);
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(root, 'test-results/lighting-ui-failure.png') }).catch(() => {});
    throw error;
  } finally {
    if (page) await page.evaluate(() => window.__TAURI__.core.invoke('quit_app')).catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (child.exitCode === null) child.kill();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
