from pathlib import Path
import hashlib
import zipfile
from collect_lite_licenses import collect
ROOT = Path(__file__).resolve().parents[1]
archive = ROOT / 'dist/MINI68-Lite-win-x64.zip'
licenses, license_index = collect()
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9, strict_timestamps=False) as z:
    for source, name in [('dist/MINI68-Lite.exe','MINI68-Lite.exe'),
                         ('README-Lite.md','使用说明.md'),('LICENSE','LICENSE'),('THIRD_PARTY_NOTICES.md','第三方说明.md'),
                         ('docs/music-switching.md','docs/music-switching.md')]:
        z.write(ROOT / source, name)
    for source, name in licenses:
        z.write(source, name)
    z.writestr('licenses/dependencies.json', license_index)
for artifact in [ROOT / 'dist/MINI68-Lite.exe', archive]:
    digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
    artifact.with_suffix(artifact.suffix + '.sha256').write_text(f'{digest}  {artifact.name}\n')
    print(f'{artifact.name}: {artifact.stat().st_size:,} bytes ({artifact.stat().st_size/1048576:.2f} MiB) SHA256 {digest}')
