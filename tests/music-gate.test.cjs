'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const MusicGate = require('../lite/music-gate.js');
const sample = amplitude => ({ available: true, amplitude });
test('silence and isolated clicks keep ordinary lighting; sustained playback starts music', () => {
  const gate = new MusicGate();
  assert.equal(gate.update(sample(0), 0), false);
  assert.equal(gate.update(sample(20), 50), false);
  assert.equal(gate.update(sample(0), 100), false);
  assert.equal(gate.update(sample(20), 200), false);
  assert.equal(gate.update(sample(20), 300), false);
  assert.equal(gate.update(sample(20), 350), true);
});
test('quiet passages stay active and 1.5 seconds of silence releases lighting', () => {
  const gate = new MusicGate();
  gate.update(sample(30), 0); gate.update(sample(30), 150);
  assert.equal(gate.update(sample(1), 300), true);
  for (let t = 400; t <= 1700; t += 100) assert.equal(gate.update(sample(0), t), true);
  assert.equal(gate.update(sample(0), 1800), false);
  gate.update(sample(40), 1900);
  assert.equal(gate.update(sample(40), 2050), true);
});
test('unavailable, invalid and stale samples release lighting and require a fresh attack', () => {
  for (const bad of [{ available: false, amplitude: 100 }, {}, sample(NaN), sample(-1), sample(1001)]) {
    const gate = new MusicGate();
    gate.update(sample(40), 0); gate.update(sample(40), 150);
    assert.equal(gate.update(bad, 200), false);
    assert.equal(gate.update(sample(40), 250), false);
    assert.equal(gate.update(sample(40), 400), true);
    assert.equal(gate.update(sample(40), 1500), false);
    assert.equal(gate.update(sample(40), 1650), true);
  }
});
