"""Collect license texts from the locked, cached Windows dependency graph."""
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def collect():
    metadata = json.loads(subprocess.run(
        ['cargo', 'metadata', '--offline', '--locked', '--format-version', '1',
         '--filter-platform', 'x86_64-pc-windows-gnu'],
        cwd=ROOT, check=True, capture_output=True, encoding='utf-8').stdout)
    ids = {node['id'] for node in metadata['resolve']['nodes']}
    fallback = {
        'alloc-stdlib': 'alloc-BSD-3-Clause.txt',
        'selectors': 'MPL-2.0.txt',
        'webview2-com': 'webview2-MIT.txt',
        'webview2-com-macros': 'webview2-MIT.txt',
        'webview2-com-sys': 'webview2-MIT.txt',
    }
    files, index = [], []
    for package in sorted(metadata['packages'], key=lambda p: (p['name'], p['version'])):
        if package['id'] not in ids or package['source'] is None:
            continue
        directory = Path(package['manifest_path']).parent
        texts = [f for f in directory.iterdir() if f.is_file() and
                 f.name.lower().startswith(('license', 'licence', 'copying', 'notice'))]
        if not texts and package['name'] in fallback:
            texts = [ROOT / 'lite/licenses' / fallback[package['name']]]
        if not texts:
            raise RuntimeError(f"Missing dependency license: {package['name']}")
        label = f"{package['name']}-{package['version']}"
        files.extend((f, f'licenses/{label}/{f.name}') for f in texts)
        index.append({'name': package['name'], 'version': package['version'],
                      'license': package['license'], 'repository': package['repository'],
                      'source': f"https://crates.io/api/v1/crates/{package['name']}/{package['version']}/download"})
    # Includes build dependencies conservatively. Upstream source is unmodified;
    # the index also provides the corresponding source for MPL components.
    return files, json.dumps(index, ensure_ascii=False, indent=2) + '\n'
