const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLocalServer } = require('../src/server.cjs');

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aula-offline-test-'));
  const webRoot = path.join(root, 'web');
  await fs.mkdir(path.join(webRoot, 'static'), { recursive: true });
  await fs.mkdir(path.join(webRoot, 'config'), { recursive: true });
  await fs.writeFile(path.join(webRoot, 'index.html'), '<!doctype html><title>Offline MINI68</title>');
  await fs.writeFile(path.join(webRoot, 'static', 'data.wasm'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  await fs.writeFile(path.join(webRoot, 'config', 'supplier.json'), JSON.stringify({
    code: 1, data: { list: [{ userename: 'aula', realname: 'Offline supplier' }] },
  }));
  await fs.writeFile(path.join(root, 'private.txt'), 'OUTSIDE_WEB_ROOT_SECRET');
  const app = await createLocalServer({ webRoot, ...options });
  t.after(async () => {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return app;
}

test('local driver serves its index only on a loopback listener', async (t) => {
  const app = await fixture(t);
  const address = app.server.address();
  assert.equal(address.address, '127.0.0.1');
  assert.ok(address.port > 0);
  assert.equal(app.origin, `http://127.0.0.1:${address.port}`);
  const response = await fetch(app.origin + '/');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html\b/);
  assert.match(await response.text(), /Offline MINI68/);
});

test('local WASM retains its bytes and application/wasm type', async (t) => {
  const app = await fixture(t);
  const response = await fetch(app.origin + '/static/data.wasm');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^application\/wasm\b/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
});

test('audio endpoint returns the current local meter value', async (t) => {
  let amplitude = 123;
  const app = await fixture(t, {
    audioProvider: { getAmplitude: () => ({ amplitude, available: true }), close() {} },
  });
  const first = await fetch(app.origin + '/api/audio/amplitude');
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { amplitude: 123, available: true });
  amplitude = 456;
  const second = await fetch(app.origin + '/api/audio/amplitude');
  assert.deepEqual(await second.json(), { amplitude: 456, available: true });
});

test('supplier data comes from the bundled snapshot', async (t) => {
  const app = await fixture(t);
  const response = await fetch(app.origin + '/api/supplier/index');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    code: 1, data: { list: [{ userename: 'aula', realname: 'Offline supplier' }] },
  });
});

test('firmware update manifest is empty in the offline build', async (t) => {
  const app = await fixture(t);
  const response = await fetch(app.origin + '/update.json');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
});

test('online-only API routes return an explicit offline result', async (t) => {
  const app = await fixture(t);
  const response = await fetch(app.origin + '/api/fileinfo/list');
  const body = await response.json();
  assert.equal(body.code, 0);
  assert.equal(typeof body.msg, 'string');
  assert.ok(body.msg.trim().length > 0);
});

test('an unrelated web origin cannot read local audio or supplier APIs', async (t) => {
  const app = await fixture(t, {
    audioProvider: { getAmplitude: () => ({ amplitude: 123, available: true }), close() {} },
  });
  for (const route of ['/api/audio/amplitude', '/api/supplier/index']) {
    const response = await fetch(app.origin + route, { headers: { Origin: 'https://unrelated.example' } });
    assert.equal(response.status, 403, route);
    assert.notEqual(response.headers.get('access-control-allow-origin'), '*');
  }
  const ownOrigin = await fetch(app.origin + '/api/audio/amplitude', { headers: { Origin: app.origin } });
  assert.equal(ownOrigin.status, 200);
});

test('encoded path traversal cannot expose files above the web root', async (t) => {
  const app = await fixture(t);
  for (const route of ['/%2e%2e%2fprivate.txt', '/static/%2e%2e%2f%2e%2e%2fprivate.txt', '/%2e%2e%5cprivate.txt']) {
    const response = await fetch(app.origin + route);
    assert.ok([400, 403, 404].includes(response.status), `${route}: ${response.status}`);
    assert.doesNotMatch(await response.text(), /OUTSIDE_WEB_ROOT_SECRET/);
  }
});

test('missing static assets return 404 rather than the application shell', async (t) => {
  const app = await fixture(t);
  const response = await fetch(app.origin + '/static/does-not-exist.js');
  assert.equal(response.status, 404);
  assert.doesNotMatch(await response.text(), /Offline MINI68/);
});
