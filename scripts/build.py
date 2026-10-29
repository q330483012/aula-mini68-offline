"""Build a self-contained Windows x64 folder and ZIP without npm tooling."""
from pathlib import Path
import hashlib
import shutil
import subprocess
import sys
import zipfile
import requests

ROOT = Path(__file__).resolve().parents[1]
VERSION = '45.0.0'
SHA256 = 'ae53887a23bb640369c93dbd38c408a2af5c0deb86f2fa76c6c244cb444b7f47'
ARCHIVE = ROOT / 'cache/electron-mirror.zip'
DIST = ROOT / 'dist/MINI68-Offline'


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    if not ARCHIVE.exists():
        ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
        session = requests.Session()
        session.trust_env = False
        url = f'https://npmmirror.com/mirrors/electron/{VERSION}/electron-v{VERSION}-win32-x64.zip'
        print('Downloading Electron', VERSION, flush=True)
        with session.get(url, stream=True, timeout=(20, 60)) as response:
            response.raise_for_status()
            with ARCHIVE.open('wb') as output:
                for chunk in response.iter_content(1024 * 1024):
                    output.write(chunk)
    if digest(ARCHIVE) != SHA256:
        raise SystemExit('Electron checksum mismatch. Remove cache/electron-mirror.zip and retry.')
    print('Verified Electron SHA-256', flush=True)
    subprocess.run([sys.executable, '-X', 'utf8', str(ROOT / 'scripts/prepare_web.py')], cwd=ROOT, check=True)
    (ROOT / 'bin').mkdir(exist_ok=True)
    compiler = Path(r'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe')
    subprocess.run([str(compiler), '/nologo', '/target:exe', '/platform:x64', '/optimize+',
                    r'/out:bin\AudioMeter.exe', r'native\AudioMeter.cs'], cwd=ROOT, check=True)
    # Only replace our generated output beneath this repository's dist directory.
    if DIST.resolve().parent != (ROOT / 'dist').resolve():
        raise SystemExit('Invalid build output path')
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)
    with zipfile.ZipFile(ARCHIVE) as archive:
        archive.extractall(DIST)
    (DIST / 'electron.exe').rename(DIST / 'MINI68-Offline.exe')
    app = DIST / 'resources/app'
    app.mkdir(parents=True, exist_ok=True)
    for folder in ['src', 'web', 'bin']:
        shutil.copytree(ROOT / folder, app / folder)
    for filename in ['package.json', 'main.cjs', 'README.md', 'README-Electron.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'resource-manifest.json']:
        shutil.copy2(ROOT / filename, app / filename)
    for filename in ['README.md', 'README-Electron.md', 'THIRD_PARTY_NOTICES.md']:
        shutil.copy2(ROOT / filename, DIST / filename)
    shutil.copy2(ROOT / 'LICENSE', DIST / 'LICENSE-application.txt')
    output = ROOT / 'dist/MINI68-Offline-win-x64.zip'
    print('Creating portable ZIP...', flush=True)
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for file in sorted(DIST.rglob('*')):
            if file.is_file():
                archive.write(file, file.relative_to(DIST.parent))
    checksum = digest(output)
    output.with_suffix('.zip.sha256').write_text(checksum + '  ' + output.name + '\n', encoding='ascii')
    print(f'Built {output} ({output.stat().st_size / 1024 / 1024:.1f} MiB)', flush=True)
    print('SHA-256:', checksum)


if __name__ == '__main__':
    main()
