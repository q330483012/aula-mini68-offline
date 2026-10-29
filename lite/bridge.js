"use strict";
// This is a narrow WebHID adapter for the MINI68 vendor configuration collection.
// Keyboard input, consumer keys and bootloader interfaces are never exposed.
(() => {
  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;
  const devices = new Map();
  const hid = new EventTarget();
  hid.onconnect = null;
  hid.ondisconnect = null;
  if (!localStorage.getItem('lang')) localStorage.setItem('lang', 'zh');

  class MiniDevice extends EventTarget {
    constructor(info) {
      super();
      Object.assign(this, info);
      this.opened = false;
      this.collections = [{ usagePage: info.usagePage, usage: info.usage,
        inputReports: [{ reportId: 0, items: [{ reportCount: 64, reportSize: 8 }] }],
        outputReports: [{ reportId: 0, items: [{ reportCount: 64, reportSize: 8 }] }],
        featureReports: [], children: [] }];
    }
    async open() { await ready; await invoke('hid_open', { id: this.id }); this.opened = true; }
    async close() { await invoke('hid_close', { id: this.id }); this.opened = false; }
    async sendReport(reportId, data) {
      if (!this.opened) throw new DOMException('请先连接键盘', 'InvalidStateError');
      const bytes = ArrayBuffer.isView(data)
        ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
      await invoke('hid_write', { id: this.id, reportId, data: Array.from(bytes) });
    }
    async sendFeatureReport() { throw new DOMException('离线版不支持固件操作', 'NotSupportedError'); }
    async receiveFeatureReport() { throw new DOMException('离线版不支持固件操作', 'NotSupportedError'); }
    async forget() { await this.close(); }
  }
  function connection(type, device) {
    const event = new Event(type);
    Object.defineProperty(event, 'device', { value: device });
    hid.dispatchEvent(event);
    hid['on' + type]?.(event);
  }
  const ready = Promise.all([
    listen('mini68-input', ({ payload }) => {
      const device = devices.get(payload.id);
      if (!device?.opened) return;
      const event = new Event('inputreport');
      Object.defineProperties(event, {
        device: { value: device }, reportId: { value: 0 },
        data: { value: new DataView(Uint8Array.from(payload.data).buffer) }
      });
      device.dispatchEvent(event);
      device.oninputreport?.(event);
    }),
    listen('mini68-disconnect', ({ payload: id }) => {
      const device = devices.get(id);
      if (device) { device.opened = false; devices.delete(id); connection('disconnect', device); }
    })
  ]);
  hid.getDevices = async () => {
    await ready;
    const infos = await invoke('hid_list');
    const present = new Set(infos.map(d => d.id));
    for (const [id, device] of devices) if (!present.has(id)) {
      device.opened = false; devices.delete(id); connection('disconnect', device);
    }
    return infos.map(info => {
      if (!devices.has(info.id)) devices.set(info.id, new MiniDevice(info));
      return devices.get(info.id);
    });
  };
  hid.requestDevice = async () => {
    const found = await hid.getDevices();
    if (found.length <= 1) return found;
    return new Promise(resolve => {
      const dialog = document.createElement('dialog');
      dialog.style.cssText = 'padding:24px;background:#171d26;color:white;border:1px solid #657080;border-radius:12px';
      const title = document.createElement('p'); title.textContent = '选择要连接的 MINI68'; dialog.append(title);
      const finish = result => { dialog.close(); dialog.remove(); resolve(result); };
      found.forEach((device, index) => {
        const button = document.createElement('button');
        button.textContent = `${index + 1}. ${device.productName} (${device.productId.toString(16)})`;
        button.style.cssText = 'display:block;margin:10px;padding:10px';
        button.onclick = () => finish([device]); dialog.append(button);
      });
      dialog.oncancel = e => { e.preventDefault(); finish([]); };
      document.body.append(dialog); dialog.showModal();
    });
  };
  Object.defineProperty(navigator, 'hid', { value: hid, configurable: false });
  window.HIDDevice = MiniDevice;

  // The vendor protocol has one global response callback. Keep transactions in order
  // across native IPC round trips, which can take longer than a browser HID call.
  const queues = new WeakMap();
  function transaction(manager, command, data, extra, allowed = () => true) {
    const result = (queues.get(manager) || Promise.resolve()).then(() =>
      allowed() ? manager.sendReportSuperNative(command, data, extra) : undefined);
    queues.set(manager, result.catch(() => {}));
    return result;
  }
  window.__mini68Transaction = transaction;
  let musicSession = null, musicBusy = false, pendingFrame = null;
  window.__mini68SendMusic = (manager, data, extra) => {
    const session = musicSession, epoch = session?.epoch;
    if (!session?.audible) return;
    if (musicBusy) { pendingFrame = [manager, data, extra]; return; }
    musicBusy = true;
    transaction(manager, 50, data, extra, () =>
      musicSession === session && session.audible && session.epoch === epoch
    ).catch(error => console.error('音乐数据发送失败', error)).finally(() => {
      musicBusy = false;
      const next = pendingFrame; pendingFrame = null;
      if (next) window.__mini68SendMusic(...next);
    });
  };
  // Use a native clock: hidden WebView timers must not stop music effects.
  window.__mini68StartTicks = callback => {
    musicSession?.terminate();
    let stopped = false;
    const subscription = listen('mini68-tick', () => { if (!stopped) callback(); });
    invoke('music_active', { active: true }).catch(console.error);
    const session = { audible: false, epoch: 0, setAudible(active) {
      if (stopped || musicSession !== session) return;
      if (session.audible !== active) session.epoch++;
      session.audible = active;
      // MINI68 HE MAX firmware expires its transient RGB override after frames
      // stop. Do not rewrite the saved effect or custom colors on every pause.
      if (!active) pendingFrame = null;
    }, terminate() {
      if (stopped) return;
      session.setAudible(false);
      stopped = true;
      if (musicSession === session) musicSession = null;
      subscription.then(unlisten => unlisten());
      invoke('music_active', { active: false }).catch(console.error);
    } };
    musicSession = session;
    return session;
  };
  hid.addEventListener('disconnect', () => musicSession?.terminate());
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin === location.origin && url.pathname === '/api/audio/amplitude') {
      const value = await invoke('audio_sample');
      return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
    }
    return originalFetch(input, init);
  };
  document.addEventListener('keydown', event => {
    if (event.ctrlKey && event.key.toLowerCase() === 'w') { event.preventDefault(); invoke('hide_window'); }
    if (event.ctrlKey && event.key.toLowerCase() === 'q') { event.preventDefault(); invoke('quit_app'); }
  });
})();
