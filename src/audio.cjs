'use strict';
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');

function createAudioProvider(executable) {
  let child = null;
  let latest = { amplitude: 0, available: false };
  let updated = 0;
  let retryAfter = 0;
  return {
    getAmplitude() {
      if (!child && Date.now() >= retryAfter) {
        child = spawn(executable, [], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
        const current = child;
        const lines = createInterface({ input: current.stdout });
        lines.on('line', line => {
          try {
            const value = JSON.parse(line);
            if (Number.isFinite(value.amplitude)) {
              latest = { amplitude: Math.max(0, Math.min(1000, value.amplitude)), available: value.available === true };
              updated = Date.now();
            }
          } catch { /* Ignore incomplete diagnostic lines. */ }
        });
        const ended = () => {
          if (child === current) child = null;
          retryAfter = Date.now() + 2000;
          latest = { amplitude: 0, available: false };
          lines.close();
        };
        current.once('error', ended);
        current.once('exit', ended);
      }
      if (Date.now() - updated > 2000) return { amplitude: 0, available: false };
      return latest;
    },
    close() { if (child) child.kill(); child = null; }
  };
}
module.exports = { createAudioProvider };
