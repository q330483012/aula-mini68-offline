'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const keys = require('../lite/local-keys.js');

test('navigation and letter rules preserve Win32 key codes and readable labels', () => {
  assert.equal(keys.label({ modifiers: 2, key: 74, target: 36 }), 'Ctrl + J → Home');
  assert.equal(keys.label({ modifiers: 5, key: 65, target: 35 }), 'Alt + Shift + A → End');
  assert.ok(keys.keys.some(([code, name]) => code === 36 && name === 'Home'));
});

test('invalid or duplicate source chords are rejected before saving', () => {
  const rule = { modifiers: 2, key: 74, target: 36 };
  assert.equal(keys.validate([rule]), null);
  assert.match(keys.validate([rule, rule]), /重复/);
  assert.match(keys.validate([{ ...rule, modifiers: 0 }]), /修饰键/);
  assert.match(keys.validate([{ ...rule, key: 123 }]), /F12/);
  assert.match(keys.validate([{ ...rule, target: 999 }]), /按键/);
});
