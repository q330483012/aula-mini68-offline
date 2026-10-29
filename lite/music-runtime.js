'use strict';
(() => {
  const states = new WeakMap();
  const enabledKey = 'mini68.autoMusicEnabled';
  window.__mini68MusicEnabled = () => {
    try { return localStorage.getItem(enabledKey) === 'true'; }
    catch { return false; }
  };
  window.__mini68SetMusicEnabled = (component, enabled) => {
    component.autoMusicEnabled = enabled === true;
    try { localStorage.setItem(enabledKey, String(component.autoMusicEnabled)); } catch {}
    component.message = '';
    if (component.autoMusicEnabled) {
      component.autoMusicStatus = '自动切换已开启 · 等待声音采样';
      if (!component.worker) {
        component.setupWorker();
        component.createSendWorker();
      }
    } else {
      // Termination invalidates queued frames and any sample still awaiting a response.
      if (component.worker || component.sendWorker) component.stopPolling();
      states.delete(component);
      component.currentAmplitude = component.smoothedAmplitude = 0;
      component.autoMusicStatus = '音乐自动切换已关闭 · 正在使用普通灯效';
    }
    component.loading = false;
  };
  window.__mini68PollMusic = async component => {
    const worker = component.worker;
    if (!component.autoMusicEnabled || !worker) return;
    let state = states.get(component);
    if (!state || state.worker !== worker) {
      state = { worker, gate: new Mini68MusicGate(), busy: false, active: false };
      states.set(component, state);
    }
    if (state.busy) return;
    state.busy = true;
    try {
      const response = await fetch('/api/audio/amplitude');
      if (!response.ok) throw new Error('Audio sample failed');
      const sample = await response.json();
      if (component.worker !== worker) return;
      const active = state.gate.update(sample, performance.now());
      worker.setAudible(active);
      if (!active) {
        component.currentAmplitude = component.smoothedAmplitude = 0;
        if (state.active) component.$emit('handleCloseMusic');
      }
      state.active = active;
      component.autoMusicStatus = sample.available !== true
        ? '声音设备不可用 · 正在使用普通灯效，等待声音设备恢复'
        : active ? '自动切换已开启 · 音乐律动中'
          : '自动切换已开启 · 正在使用普通灯效，等待播放声音';
      component.message = '';
      if (active) {
        component.currentAmplitude = Math.min(1, sample.amplitude / 1000);
        component.bgStep = (component.bgStep >= 360 ? 0 : component.bgStep) + 10;
        component.updateVisualizer();
      }
    } catch (error) {
      if (component.worker !== worker) return;
      state.gate.reset(); worker.setAudible(false);
      if (state.active) component.$emit('handleCloseMusic');
      state.active = false;
      component.message = '';
      component.autoMusicStatus = '声音采集暂不可用 · 已回到普通灯效，正在重试';
    } finally {
      state.busy = false;
      if (component.worker === worker) component.loading = false;
    }
  };
})();
