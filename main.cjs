'use strict';
const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, session, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { createLocalServer } = require('./src/server.cjs');
const { createAudioProvider } = require('./src/audio.cjs');

app.setName('MINI68 Offline');
app.setPath('userData', process.env.AULA_TEST_PROFILE || path.join(app.getPath('appData'), 'MINI68 Offline'));
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
// Avoid Chromium treating an occluded configuration window as an idle page.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const testing = process.env.AULA_TEST === '1';
let window, tray, server;
let quitting = false;
let notified = false;
const allowsDevice = device =>
  (device.vendorId === 14502 && [10018, 10019, 10020].includes(device.productId)) ||
  (device.vendorId === 10406 && device.productId === 10018);

if (!testing && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    const audio = createAudioProvider(path.join(__dirname, 'bin', 'AudioMeter.exe'));
    server = await createLocalServer({ webRoot: path.join(__dirname, 'web'), audioProvider: audio });
    // Stable application origin preserves browser-local profiles and HID grants across random HTTP ports.
    const localSession = session.fromPartition('persist:mini68-offline');
    const origin = 'https://mini68.local';
    localSession.protocol.handle('https', async request => {
      const url = new URL(request.url);
      if (url.origin !== origin) return new Response('Offline build', { status: 403 });
      const response = await fetch(server.origin + url.pathname + url.search, {
        method: request.method, headers: { Host: new URL(server.origin).host }
      });
      return new Response(response.body, { status: response.status, headers: response.headers });
    });
    localSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed = details.url.startsWith(origin + '/') || /^(data|blob):/.test(details.url);
      callback({ cancel: !allowed });
    });
    const isLocalOrigin = value => { try { return new URL(value).origin === origin; } catch { return false; } };
    localSession.setPermissionCheckHandler((contents, permission, requestingOrigin) =>
      contents?.id === window?.webContents.id && permission === 'hid' && isLocalOrigin(requestingOrigin));
    const grantPath = path.join(app.getPath('userData'), 'hid-grants.json');
    let grants = [];
    try {
      const saved = JSON.parse(fs.readFileSync(grantPath, 'utf8'));
      if (Array.isArray(saved)) grants = saved.filter(value => typeof value === 'string');
    } catch { /* First run or damaged grant file; require a new connection. */ }
    const key = device => `${device.vendorId}:${device.productId}:${device.serialNumber || ''}`;
    localSession.setDevicePermissionHandler(details =>
      isLocalOrigin(details.origin) && details.deviceType === 'hid' && allowsDevice(details.device) && grants.includes(key(details.device)));
    localSession.on('select-hid-device', async (event, details, callback) => {
      event.preventDefault();
      const candidates = details.deviceList.filter(allowsDevice);
      if (!candidates.length) return callback('');
      let chosen;
      if (candidates.length === 1 || testing) chosen = candidates[0];
      else {
        const result = await dialog.showMessageBox(window, {
          type: 'question', title: '选择 MINI68', message: '请选择要连接的键盘',
          buttons: [...candidates.map(d => `${d.name || 'MINI68'} (${d.productId.toString(16)})`), '取消'],
          cancelId: candidates.length
        });
        chosen = candidates[result.response];
      }
      if (!chosen) return callback('');
      grants = [...new Set([...grants, key(chosen)])];
      fs.mkdirSync(path.dirname(grantPath), { recursive: true });
      fs.writeFileSync(grantPath, JSON.stringify(grants));
      callback(chosen.deviceId);
    });
    window = new BrowserWindow({
      width: 1440, height: 960, minWidth: 1040, minHeight: 720,
      title: 'MINI68 离线配置', show: false, backgroundColor: '#f4f4f4',
      webPreferences: { session: localSession, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, offscreen: testing && process.env.AULA_TEST_OFFSCREEN !== '0' }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(origin + '/')) event.preventDefault(); });
    window.on('close', event => {
      if (!quitting) {
        event.preventDefault(); window.hide();
        if (!notified && !testing) {
          notified = true;
          tray.displayBalloon({ title: 'MINI68 已收起到托盘', content: '已开启的音乐律动继续运行。右键托盘图标可退出。' });
        }
      }
    });
    const iconPath = path.join(__dirname, 'web/external/config.driveall.cn/logo/aula/favicon.ico');
    tray = new Tray(nativeImage.createFromPath(iconPath));
    tray.setToolTip('MINI68 离线配置 · 双击打开');
    tray.on('double-click', () => { window.show(); window.focus(); });
    const quit = () => { quitting = true; app.quit(); };
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开配置窗口', click: () => { window.show(); window.focus(); } },
      { label: '退出', click: quit }
    ]));
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'MINI68', submenu: [
        { label: '收起到托盘（保持音乐律动）', accelerator: 'Ctrl+W', click: () => window.close() },
        { label: '打开使用说明', click: () => shell.openPath(path.join(__dirname, 'README.md')) },
        { type: 'separator' }, { label: '退出程序', accelerator: 'Ctrl+Q', click: quit }
      ]},
      { label: '显示', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] }
    ]));
    await window.loadURL(origin + '/');
    if (!testing) window.show();
  }).catch(error => {
    console.error(error);
    if (!testing) dialog.showErrorBox('MINI68 启动失败', error.message);
    quitting = true; app.quit();
  });
  app.on('before-quit', () => { quitting = true; server?.close(); tray?.destroy(); });
}
