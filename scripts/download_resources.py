"""Snapshot the public driver assets. Does not connect to or modify hardware."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import re
import threading
from urllib.parse import urljoin, urlsplit
import requests

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / 'vendor'
BASE = 'https://hec.aulacn.com/'
SUPPLIER = 'https://cp.driveall.cn/api/supplier/index'
local = threading.local()


def session():
    if not hasattr(local, 'session'):
        local.session = requests.Session()
        local.session.trust_env = False
        local.session.headers['User-Agent'] = 'Mozilla/5.0'
    return local.session


def destination(url):
    if url == SUPPLIER:
        return VENDOR / 'api/supplier/index'
    u = urlsplit(url)
    path = u.path.lstrip('/') or 'index.html'
    if u.netloc != 'hec.aulacn.com':
        path = 'external/' + u.netloc + '/' + path
    return VENDOR / path


def download(url):
    path = destination(url)
    if not path.exists():
        for attempt in range(3):
            r = session().get(url, timeout=(15, 45))
            if r.status_code == 200:
                break
        r.raise_for_status()
        if path.suffix in ('.js', '.css', '.wasm', '.png', '.svg', '.woff', '.ttf') and 'text/html' in r.headers.get('Content-Type', ''):
            raise ValueError('Unexpected HTML: ' + url)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(r.content)
    if url == SUPPLIER:
        payload = json.loads(path.read_text(encoding='utf-8'))
        fields = ('id', 'userename', 'nickname', 'domain_name', 'is_open', 'is_lock', 'is_update_log')
        items = [{k: v for k, v in item.items() if k in fields}
                 for item in payload['data']['list'] if item.get('userename') == 'aula']
        if not items:
            raise ValueError('AULA supplier metadata missing')
        path.write_text(json.dumps({'code': payload['code'], 'data': {'list': items}}), encoding='utf-8')
    data = path.read_bytes()
    return {'url': url, 'file': path.relative_to(VENDOR).as_posix(), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def dependencies(record):
    p = VENDOR / record['file']
    if p.suffix not in ('.html', '.js', '.css'):
        return set()
    s = p.read_text(encoding='utf-8-sig')
    urls = {urljoin(BASE, x) for x in re.findall(r'["\x27]((?:static/)[^"\x27\s]+\.(?:js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|eot))["\x27]', s)}
    urls.update(urljoin(BASE, x) for x in re.findall(r'["\x27]([a-f0-9]+\.wasm)["\x27]', s))
    if p.suffix == '.css':
        for x in re.findall(r'url\(([^)]+)\)', s):
            x = x.strip('"\x27').split('#')[0].split('?')[0]
            if not x.startswith('data:'):
                urls.add(urljoin(record['url'], x))
    for x in re.findall(r'new URL\(\w+\.p\+\w+\.u\((\d+)\)', s):
        urls.add(urljoin(BASE, 'static/js/' + x + '.e0ae770b.js'))
    return {x for x in urls if urlsplit(x).netloc == 'hec.aulacn.com'}


def main():
    pending = {BASE, SUPPLIER,
        'https://config.driveall.cn/axial.json',
        'https://config.driveall.cn/logo/aula/favicon.ico',
        'https://static.driveall.cn/static/keyboards/kb_bg.png'}
    records = {}
    failures = []
    while pending:
        batch = pending - records.keys()
        pending = set()
        if not batch:
            break
        print('Downloading batch:', len(batch), flush=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            futures = {pool.submit(download, url): url for url in batch}
            for f in concurrent.futures.as_completed(futures):
                url = futures[f]
                try:
                    record = f.result()
                    records[url] = record
                    pending.update(dependencies(record))
                except Exception as e:
                    failures.append({'url': url, 'error': str(e)})
                    print('FAILED', url, str(e), flush=True)
        print('Saved:', len(records), flush=True)
    (ROOT / 'resource-manifest.json').write_text(json.dumps({'source': BASE, 'resources': sorted(records.values(), key=lambda x: x['file']), 'failures': failures}, indent=2), encoding='utf-8')
    if failures:
        raise SystemExit('Some resources failed. See resource-manifest.json.')


if __name__ == '__main__':
    main()
