'use strict';
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf'
};

async function createLocalServer({ webRoot, audioProvider }) {
  const root = path.resolve(webRoot);
  let origin;
  const json = (res, value, status = 200) => {
    res.writeHead(status, { 'Content-Type': types['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host ||
          (req.headers.origin && req.headers.origin !== origin) ||
          req.headers['sec-fetch-site'] === 'cross-site') {
        return json(res, { error: 'Forbidden origin' }, 403);
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, { error: 'Method not allowed' }, 405);
      const route = decodeURIComponent(req.url.split('?')[0]);
      if (route.includes('\\') || route.includes('\0') || route.split('/').includes('..')) {
        return json(res, { error: 'Invalid path' }, 400);
      }
      if (route === '/api/audio/amplitude') {
        return json(res, audioProvider?.getAmplitude() ?? { amplitude: 0, available: false });
      }
      if (route === '/update.json' || route === '//update.json') return json(res, []);
      if (route.startsWith('/api/') && route !== '/api/supplier/index') {
        return json(res, { code: 0, msg: '此功能需要联网，离线版未启用。', data: { list: [], total: 0 } });
      }
      const relative = route === '/' ? 'index.html' : route === '/api/supplier/index' ? 'config/supplier.json' : route.replace(/^\/+/, '');
      const filename = path.resolve(root, relative);
      if (!filename.startsWith(root + path.sep)) return json(res, { error: 'Invalid path' }, 400);
      const data = await fs.readFile(filename);
      res.writeHead(200, {
        'Content-Type': types[path.extname(filename)] || 'application/octet-stream',
        'Content-Length': data.length, 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'self'; frame-ancestors 'none'"
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      json(res, { error: error.code === 'ENOENT' ? 'Not found' : 'Invalid request' }, error.code === 'ENOENT' ? 404 : 400);
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    server, origin,
    async close() {
      audioProvider?.close();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  };
}
module.exports = { createLocalServer };
