'use strict';
const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const root = path.resolve(__dirname, '..');
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  const env = { ...process.env, AULA_TEST: '1', AULA_TEST_PROFILE: path.join(root, 'test-results/profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.argv.includes('--packaged');
  const app = await electron.launch({ executablePath: path.join(root, packaged ? 'dist/MINI68-Offline/MINI68-Offline.exe' : 'cache/electron/electron.exe'), args: packaged ? [] : [root], env, timeout: 30000 });
  try {
    const page = await app.firstWindow();
    const errors = [];
    const failures = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', req => failures.push({ url: req.url(), error: req.failure()?.errorText }));
    page.on('response', response => { if (response.status() >= 400) failures.push({ url: response.url(), status: response.status() }); });
    await page.waitForLoadState('networkidle');
    console.log('TITLE', await page.title());
    console.log('TEXT', (await page.locator('body').innerText()).slice(0,7000));
    console.log('HID', await page.evaluate(() => ({ secure: isSecureContext, available: Boolean(navigator.hid) })));
    const shot = await app.evaluate(async ({BrowserWindow}) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
    fs.writeFileSync(path.join(root, 'test-results/startup.png'), Buffer.from(shot, 'base64'));
    console.log('ERRORS', JSON.stringify(errors));
    console.log('FAILURES', JSON.stringify(failures));
    const state = await app.evaluate(({BrowserWindow}) => {
      const w=BrowserWindow.getAllWindows()[0]; w.close(); return {destroyed:w.isDestroyed(),visible:w.isVisible(),throttling:w.webContents.getBackgroundThrottling()};
    });
    console.log('CLOSE_STATE', state);
    fs.writeFileSync(path.join(root,'test-results/smoke.json'),JSON.stringify({errors,failures,state},null,2));
    if(errors.length || failures.length) process.exitCode=1;
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
