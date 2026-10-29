"""Build the WebView2 frontend from the same checked offline vendor snapshot."""
from pathlib import Path
import shutil
import re

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / 'web-lite'
if WEB.exists():
    shutil.rmtree(WEB)
shutil.copytree(ROOT / 'web', WEB)
shutil.copyfile(ROOT / 'lite/bridge.js', WEB / 'offline.js')
for name in ['local-keys.js', 'local-settings.js', 'local-settings.css', 'music-gate.js', 'music-runtime.js', 'music.css', 'desktop.css']:
    shutil.copyfile(ROOT / 'lite' / name, WEB / name)
index = (WEB / 'index.html').read_text(encoding='utf8')
index = index.replace('<script src="/offline.js"></script>', '<script src="/music-gate.js"></script><script src="/offline.js"></script><script src="/music-runtime.js"></script>')
index = index.replace('</head>', '<link rel="stylesheet" href="/desktop.css"><link rel="stylesheet" href="/music.css"><link rel="stylesheet" href="/local-settings.css"><script defer src="/local-keys.js"></script><script defer src="/local-settings.js"></script></head>')
(WEB / 'index.html').write_text(index, encoding='utf8')
app = next((WEB / 'static/js').glob('app.*.js'))
s = app.read_text(encoding='utf8')
start = s.index('uS=function')
end = s.index('SS={data:', start)
anchor = 'staticClass:"music"},['
assert s[start:end].count(anchor) == 1
s = s[:start] + s[start:end].replace(anchor, '''staticClass:"music mini68-auto-music"},[i("div",{staticClass:"mini68-music-auto"},[i("div",{staticClass:"mini68-music-header"},[i("span",{attrs:{id:"mini68-music-label"}},[e._v("音乐自动切换")]),i("button",{staticClass:"mini68-music-switch",attrs:{type:"button",role:"switch","aria-labelledby":"mini68-music-label","aria-describedby":"mini68-music-help","aria-checked":String(e.autoMusicEnabled)},on:{click:function(){window.__mini68SetMusicEnabled(e,!e.autoMusicEnabled)}}},[i("span",{staticClass:"mini68-switch-track",attrs:{"aria-hidden":"true"}}),e._v(e.autoMusicEnabled?"已开启":"已关闭")])]),i("p",{attrs:{role:"status"}},[e._v(e.autoMusicStatus)]),i("p",{staticClass:"mini68-music-help",attrs:{id:"mini68-music-help"}},[e._v("开启后，有声音时律动，静音约 1.5 秒恢复原灯效。切换页面、收至托盘后仍有效；重新连接键盘后按记住的开关状态恢复。")])]),''') + s[end:]
# Keep exactly one music instance for the connected device. Only its settings
# visibility follows navigation; destroying a tab must not terminate the clock.
anchor = '2===l.RtInfo.musicVersion&&"music"===l.activeName?m("musicV2",{on:{handleMusic:l.handleMusic,handleCloseMusic:l.handleCloseMusic}}):l._e()'
assert s.count(anchor) == 1
s = s.replace(anchor, 'l._e()')
music_visible = '1==l.functionCurrent&&"music"===l.activeName&&!l.isShowSet'
anchor = 'staticClass:"device-right f1"'
assert s.count(anchor) == 1
s = s.replace(anchor, anchor + ',class:{"mini68-music-settings":' + music_visible + '&&2===l.RtInfo.musicVersion}')
anchor = '6==l.functionCurrent?m("div",[m("Social"'
assert s.count(anchor) == 1
s = s.replace(anchor, 'l.RtInfo.keys&&2===l.RtInfo.musicVersion&&l.$store.state.keyboard.List.length?m("div",{key:"mini68-music-runtime",staticClass:"mini68-music-panel",directives:[{name:"show",rawName:"v-show",value:' + music_visible + '}]},[m("musicV2",{ref:"mini68Music",on:{handleMusic:l.handleMusic,handleCloseMusic:l.handleCloseMusic}})],1):l._e(),' + anchor)
start = s.index('SS={data:')
anchor = 'loading:!1,message:""'
assert s[start:start+100].count(anchor) == 1
s = s[:start] + s[start:].replace(anchor, 'loading:!1,message:"",autoMusicEnabled:window.__mini68MusicEnabled(),autoMusicStatus:"音乐自动切换已关闭 · 正在使用普通灯效"', 1)
anchor = 'this.loading=!0,this.getCenterXY(),this.setupWorker(),this.createSendWorker(),this.smoothedActiveRings=0'
assert s.count(anchor) == 1
s = s.replace(anchor, 'this.getCenterXY(),window.__mini68SetMusicEnabled(this,this.autoMusicEnabled),this.smoothedActiveRings=0')
start = s.index('setupWorker:function', s.index('SS={data:'))
end = s.index('createSendWorker:function', start)
assert "self.postMessage('poll')" in s[start:end]
s = s[:start] + '''setupWorker:function(){if(!this.autoMusicEnabled)return;var e=this;this.worker=window.__mini68StartTicks(function(){var t=Date.now();t-e.lastPollTime>=45&&(e.fetchStatus(),e.lastPollTime=t)});this.fetchStatus();this.lastPollTime=Date.now()},''' + s[end:]
start = s.index('createSendWorker:function', s.index('SS={data:'))
s = s[:start] + s[start:].replace('createSendWorker:function(){', 'createSendWorker:function(){if(!this.autoMusicEnabled)return;', 1)
anchor = 't.bgSpeed=0,t.loading=!0'
assert s.count(anchor) == 1
s = s.replace(anchor, 't.bgSpeed=0,t.loading=!!t.worker')
start = s.index('fetchStatus:function', s.index('SS={data:'))
end = s.index('updateVisualizer:function', start)
assert 'fetch("/api/audio/amplitude")' in s[start:end]
s = s[:start] + 'fetchStatus:function(){return window.__mini68PollMusic(this)},' + s[end:]
anchor = 'sendReportSuper:function(e,i){'
assert s.count(anchor) == 1
s = s.replace(anchor, 'sendReportSuper:function(e,i){return window.__mini68Transaction(this,e,i,arguments[2]||[])},sendReportSuperNative:function(e,i){')
anchor = 'Td.sendReportSuper(50,n,[r])'
assert s.count(anchor) == 1
s = s.replace(anchor, 'window.__mini68SendMusic(Td,n,[r])')
# Keep the original picker and firmware color handlers; explain when/how it applies.
anchor = 'm("colorSelect",{ref:"color",on:{getColorStr:l.getColorStr}})'
assert s.count(anchor) == 1
s = s.replace(anchor, '''m("div",{staticClass:"mini68-palette-heading"},[m("strong",[l._v("调色盘")]),m("p",[l._v("0x80"==l.effectCurrentValue?"先点击上方按键或勾选全选，再选颜色；完成后点保存。":"拖动色盘和明暗条选色，也可输入 HEX 或 RGB。")])]),''' + anchor)
start = s.index('m("div",{staticClass:"device-right-funciton-color-box"}')
end = s.index(anchor, start)
colors = s[start:end]
colors = colors.replace('attrs:{type:"text",maxlength:7}', 'attrs:{type:"text",maxlength:7,"aria-label":"HEX 颜色"}')
for channel in ['R', 'G', 'B']:
    colors = re.sub(r'attrs:\{type:"text"\},domProps:\{value:(l\.(?:colorInfo\.deputy)?' + channel + r'Value)\}', r'attrs:{type:"text","aria-label":"' + channel + r' 颜色"},domProps:{value:\1}', colors)
s = s[:start] + colors + s[end:]
anchor = 'this.$refs.color.setHexString(this.hexVal),this.getSendReportAll()}},expandHex:function'
assert s.count(anchor) == 1
s = s.replace(anchor, 'this.$refs.color.setHexString(this.hexVal),"0x80"===this.effectCurrentValue?this.$refs.keyboard.list.flat().some(function(e){return e.isBorder})&&this.getUserPack():this.getSendReportAll()}},expandHex:function')
app.write_text(s, encoding='utf8')
# The source scales text down with the window width. Keep desktop text legible
# while preserving rem-based keyboard geometry and the original larger headings.
for css in (WEB / 'static/css').glob('*.css'):
    text = css.read_text(encoding='utf8')
    text = re.sub(r'font-size:([.\d]+rem)', r'font-size:max(14px,\1)', text)
    css.write_text(text, encoding='utf8')
print('Prepared WebView2 assets with native HID/audio bridge')
