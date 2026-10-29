'use strict';
// Windows peak samples are integers from 0 to 1000. Use elapsed time, not frame
// counts, because HID round trips and background scheduling can vary.
(() => {
  class MusicGate {
    constructor() { this.reset(); this.previous = null; }
    reset() { this.active = false; this.attack = null; this.lastSound = null; }
    update(sample, now) {
      if (this.previous !== null && (now - this.previous > 500 || now < this.previous)) this.reset();
      this.previous = now;
      const peak = sample?.amplitude;
      if (sample?.available !== true || !Number.isFinite(peak) || peak < 0 || peak > 1000) {
        this.reset(); return false;
      }
      if (this.active) {
        if (peak >= 1) this.lastSound = now;
        else if (now - this.lastSound >= 1500) this.reset();
      } else if (peak >= 3) {
        this.attack ??= now;
        if (now - this.attack >= 150) { this.active = true; this.lastSound = now; }
      } else this.attack = null;
      return this.active;
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = MusicGate;
  else window.Mini68MusicGate = MusicGate;
})();
