"""Apply small, checked adaptations to the frozen vendor files."""
from pathlib import Path
import json
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / 'web'
if WEB.exists():
    shutil.rmtree(WEB)
shutil.copytree(ROOT / 'vendor', WEB, ignore=shutil.ignore_patterns('api'))
app = next((WEB / 'static/js').glob('app.*.js'))
s = app.read_text(encoding='utf-8-sig')


def replace_once(old, new):
    global s
    count = s.count(old)
    if count != 1:
        raise ValueError(f'Expected one patch anchor, got {count}: {old[:100]}')
    s = s.replace(old, new)


# Device configuration stays original. Only external asset addresses and desktop behavior change.
s = s.replace('https://config.driveall.cn', '/external/config.driveall.cn')
s = s.replace('https://static.driveall.cn', '/external/static.driveall.cn')
s = s.replace('https://cp.driveall.cn', '')
s = s.replace('http://127.0.0.1:9191', '')
replace_once('document.title="AULA"', 'document.title="MINI68 离线配置"')
replace_once('return e.url=window.location.origin', 'return e.url="MINI68 离线配置"')
replace_once('e.downUrl=a[0].donw_url', 'e.downUrl=a.length?a[0].donw_url:""')
replace_once('i.RetrunUrl=s[0].return_url', 'i.RetrunUrl=s.length?s[0].return_url:""')
# MINI68 has no clock display. Avoid an unrelated time-calibration write on opening the app.
replace_once('getTimeCalibration:function(){', 'getTimeCalibration:function(){if(this.RtInfo&&[10018,10019,10020].includes(this.RtInfo.productId))return;')
# Remove community/account navigation, retain hardware functions and the original model capability rules.
replace_once('setKeyBoard:function(e){var i=hr(e,this.supName),t=',
    'setKeyBoard:function(e){var i=hr(e,this.supName);if(i){i.listBtnHideIds=Array.from(new Set((i.listBtnHideIds||[]).concat([6])));i.settings=Object.assign({},i.settings,{isShowFirmware:false});}var t=')
# The native audio meter is bundled; retry locally if no playback device is available.
replace_once('handleDow:function(){window.open("/external/config.driveall.cn/music/v2/Music.exe")}',
    'handleDow:function(){this.fetchStatus()}')
replace_once('case 12:n=i.sent,(0,hS.A)(null===n||void 0===n?void 0:n.amplitude)',
    'case 12:n=i.sent;if(n.available===false){e.loading=false;e.message="music_mode_error";return i.abrupt("return")}(0,hS.A)(null===n||void 0===n?void 0:n.amplitude)')
for old, new in {
    '在这里您可以迅速配置您的设备，尝试一些与众不同的设定，并按您的喜好个性化定制您的设备。当完成配置之后，后台都不用留，只需要保存、关闭、享受即可。':
        '通过 USB 连接 MINI68，即可离线配置按键、灯光和性能。音乐律动开启后，关闭窗口可收起到托盘并继续运行。',
    '允许浏览器连接到您的设备': '连接你的 MINI68 键盘',
    '这将在URL栏旁边打开一个设备列表。在列表中选择您的设备，然后单击“连接”。': '使用 USB 数据线连接键盘，再点击连接。请先关闭其他占用键盘的驱动页面。',
    '允许浏览器访问': '允许连接键盘',
    '请下载插件，如下载请手动执行该插件': '暂未检测到播放设备，请连接耳机或音箱，检查 Windows 默认输出设备。',
    '因为网页限制无法捕捉设备音频。请下载专属插件实现音乐律动': '音频组件已内置。请检查声音输出设备，程序会自动重试。',
    '下载插件': '重新检测',
    'Please download the plugin. If downloaded, please manually execute the plugin.': 'No playback device available. Check the default Windows audio output.',
    'Download Plugin': 'Retry',
}.items():
    replace_once('"' + old + '"', '"' + new + '"')
app.write_text(s, encoding='utf-8')

index = (WEB / 'index.html').read_text(encoding='utf-8-sig')
index = re.sub(r'<script defer src="/bt-stats\.js[^>]+></script>', '', index)
index = index.replace('https://config.driveall.cn', '/external/config.driveall.cn')
index = index.replace('<title>AULA</title>', '<title>MINI68 离线配置</title>')
index = index.replace('<head>', '<head><script src="/offline.js"></script>')
(WEB / 'index.html').write_text(index, encoding='utf-8')
(WEB / 'offline.js').write_text('''"use strict";
// New application profile only: select Simplified Chinese without sharing browser data.
if (!localStorage.getItem("lang")) localStorage.setItem("lang", "zh");
// This build is for the USB MINI68 family. Keep authorization limited to that family.
const requestMiniDevice = navigator.hid.requestDevice.bind(navigator.hid);
navigator.hid.requestDevice = () => requestMiniDevice({filters: [
  {vendorId: 14502, productId: 10018},
  {vendorId: 14502, productId: 10019},
  {vendorId: 14502, productId: 10020},
  {vendorId: 10406, productId: 10018}
]});
''', encoding='utf-8')
(WEB / 'config').mkdir(exist_ok=True)
supplier = json.loads((ROOT / 'vendor/api/supplier/index').read_text(encoding='utf-8'))
supplier['data']['list'] = [{k: v for k, v in item.items() if k in ('id', 'userename', 'nickname', 'domain_name', 'is_open', 'is_lock', 'is_update_log')} for item in supplier['data']['list']]
(WEB / 'config/supplier.json').write_text(json.dumps(supplier), encoding='utf-8')
(WEB / 'update.json').write_text('[]', encoding='utf-8')
print('Prepared offline web assets:', len(list(WEB.rglob('*'))), 'entries')
