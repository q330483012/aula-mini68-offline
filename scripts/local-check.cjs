'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');

(async () => {
  const root = path.resolve(__dirname, '..');
  const profile = path.join(root, 'test-results', 'local-profile-' + Date.now());
  const exe = process.env.AULA_LITE_EXE || path.join(root, 'dist/MINI68-Lite.exe');
  const sessions = [], errors = [], outside = [], evidence = { inputSkipped: process.env.AULA_LITE_SKIP_INPUT === '1' };
  const rule = { modifiers: 2, key: 74, target: 36 };
  const invoke = (page, command, args) => page.evaluate(({ command, args }) => window.__TAURI__.core.invoke(command, args), { command, args });
  async function launch(folder, args = []) {
    const port = await new Promise(resolve => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
    });
    const child = spawn(exe, args, { windowsHide: true, env: { ...process.env,
      AULA_LITE_TEST: '1', AULA_LITE_DEBUG_PORT: String(port), AULA_LITE_TEST_PROFILE: folder
    } });
    const session = { child }; sessions.push(session);
    for (let n = 0; n < 100; n++) {
      if (child.exitCode !== null && child.exitCode !== 0) throw new Error('App exited ' + child.exitCode);
      try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    session.browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = session.browser.contexts()[0];
    session.page = context.pages()[0] || await context.waitForEvent('page');
    session.page.on('pageerror', error => errors.push(error.message));
    session.page.on('request', request => {
      if (/^https?:/.test(request.url()) && !/^http:\/\/(tauri|ipc)\.localhost/.test(request.url())) outside.push(request.url());
    });
    await session.page.locator('#mini68-local-open').waitFor();
    return session;
  }
  async function stop(session) {
    if (session.stopped) return;
    session.stopped = true;
    if (session.page) await invoke(session.page, 'quit_app').catch(() => {});
    if (session.browser) await session.browser.close().catch(() => {});
    if (session.child.exitCode === null) session.child.kill();
    // Wait for native hotkey registrations and the isolated profile to be released.
    await new Promise(resolve => setTimeout(resolve, 600));
  }
  async function save(page) {
    await page.locator('#local-save').click();
    await page.waitForFunction(() => !document.querySelector('#local-save').disabled);
  }
  async function testHome(page) {
    await invoke(page, 'desktop_test_focus');
    await page.bringToFront();
    await page.waitForFunction(() => document.hasFocus());
    await page.locator('summary').filter({ hasText: '测试映射' }).click();
    const editor = page.getByRole('textbox', { name: '映射测试输入框' });
    await editor.fill('abc\ndef\nghi');
    await editor.evaluate(element => {
      element.focus(); element.setSelectionRange(6, 6); globalThis.__keyEvents = [];
      element.addEventListener('keydown', event => __keyEvents.push({ key: event.key, ctrl: event.ctrlKey, shift: event.shiftKey }));
    });
    await invoke(page, 'desktop_test_press', { rule });
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="映射测试输入框"]').selectionStart === 4);
    const result = await editor.evaluate(element => ({ text: element.value, caret: element.selectionStart, events: __keyEvents }));
    assert.equal(result.text, 'abc\ndef\nghi');
    assert.equal(result.caret, 4, 'Home must move to this line, rather than Ctrl+Home to the document start');
    assert.ok(result.events.some(event => event.key === 'Home' && !event.ctrl && !event.shift));
    assert.ok(!result.events.some(event => event.key.toLowerCase() === 'j'));
    return result;
  }
  try {
    const first = await launch(profile), page = first.page;
    await page.locator('#mini68-local-open').click();
    assert.equal(await page.locator('#local-startup').isChecked(), false);
    assert.equal(await page.locator('#local-enabled').isChecked(), false);
    await page.locator('#local-startup').check();
    await page.waitForFunction(() => !document.querySelector('#local-startup').disabled);
    evidence.startup = await invoke(page, 'desktop_test_startup');
    assert.match(evidence.startup, /^".+MINI68-Lite(?:-core)?\.exe" --background$/i);
    await page.locator('#local-startup').uncheck();
    await page.waitForFunction(() => !document.querySelector('#local-startup').disabled);
    assert.equal(await invoke(page, 'desktop_test_startup'), null);
    await page.locator('#local-add').click();
    assert.equal(await page.locator('#local-rules tr').count(), 1);
    assert.match(await page.locator('#local-rules').innerText(), /待应用/);
    await page.locator('#local-add').click();
    assert.match(await page.locator('#local-message').innerText(), /重复/);
    await page.locator('#local-enabled').check(); await save(page);
    assert.match(await page.locator('#local-rules').innerText(), /已启用/);
    if (!evidence.inputSkipped) evidence.foreground = await testHome(page);
    await page.screenshot({ path: path.join(root, 'test-results/local-settings.png') });
    await page.locator('#local-close').click();
    await page.waitForFunction(() => document.querySelector('#mini68-local-open') === document.activeElement);
    await invoke(page, 'hide_window');
    assert.equal(await invoke(page, 'window_visible'), false);
    console.log('SETTINGS_AND_STARTUP_OK', JSON.stringify(evidence));

    const second = await launch(profile + '-conflict'), other = second.page;
    await other.locator('#mini68-local-open').click();
    await other.locator('#local-add').click(); await other.locator('#local-enabled').check(); await save(other);
    evidence.conflict = await other.locator('#local-rules').innerText();
    assert.match(evidence.conflict, /被系统或其他程序占用/);
    await other.locator('#local-enabled').uncheck(); await save(other);
    if (!evidence.inputSkipped) evidence.hidden = await testHome(other);
    await stop(second); await stop(first);
    console.log('REGISTRATION_AND_CONFLICT_OK');

    const restored = await launch(profile, ['--background']);
    evidence.backgroundVisible = await invoke(restored.page, 'window_visible');
    assert.equal(evidence.backgroundVisible, false);
    const snapshot = await invoke(restored.page, 'desktop_get');
    assert.deepEqual(snapshot.config, { enabled: true, rules: [rule] });
    assert.deepEqual(snapshot.errors, [null]);
    await invoke(restored.page, 'desktop_save', { config: { enabled: false, rules: [] } });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile, 'desktop-settings.json'), 'utf8')), { enabled: false, rules: [] });
    await stop(restored);
    assert.deepEqual(errors, []); assert.deepEqual(outside, []);
    evidence.errors = errors; evidence.outside = outside;
    fs.writeFileSync(path.join(root, 'test-results/local.json'), JSON.stringify(evidence, null, 2));
    console.log('RESULT', JSON.stringify(evidence));
  } finally {
    for (const session of sessions.reverse()) await stop(session);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
