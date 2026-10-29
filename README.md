# MINI68 Offline / MINI68 离线配置

用于 AULA 狼蛛 MINI68 系列的非官方 Windows 桌面适配项目。当前轻量版基于 **Tauri + Rust + 系统 WebView2**，提供 USB 配置桥接、托盘运行，以及“平时保持原灯效，有声音时自动音乐律动”。

**本仓库开源原创桌面适配代码，不包含官方网页资源、固件或内嵌这些资源的 EXE。** 完整界面仍依赖官方网页资源；这些资源需要在本机另行获取，并遵守其适用条款。仓库的 MIT 许可证不覆盖它们，详见 [第三方说明](THIRD_PARTY_NOTICES.md)。项目与 AULA 官方没有隶属或授权关系。

## 当前功能

- 原生 Windows HID 通信，限定 MINI68 厂商配置接口。
- 保留原网页的按键、宏、灯光、性能与高级键设置流程。
- 音乐自动切换开关：有声时律动，持续静音约 1.5 秒后停止音乐帧，由固件恢复已保存的普通灯效。
- 开启后可切换设置页、收至托盘；重新连接后按记住的开关状态恢复。
- Windows 默认播放设备音量采集，不使用麦克风、不保存录音。
- 可选登录启动、Windows 全局组合键到单键映射。
- 本地资源运行，不依赖官方独立音乐插件；运行时无需联网。

OpenRGB 接入**尚未实现**。组合键映射属于 Windows 系统功能，不是写入键盘的固件级组合键。

本机验证设备为 **MINI68 HE MAX，USB VID `38A6` / PID `2724`**。其他 MINI68 变体、接收器和蓝牙未逐项验证。此项目不提供固件升级。

使用详情和验证边界见 [轻量版说明](README-Lite.md)，固件临时灯光接口的依据见 [音乐切换机制](docs/music-switching.md)。早期 Electron 实现保留用于参考，见 [Electron 版说明](README-Electron.md)。

## 本地构建

需要 Windows 10/11 x64、Microsoft Edge WebView2 Runtime，以及以下开发工具：

- Rust stable 和 `x86_64-pc-windows-gnu` 工具链。
- MinGW-w64 的 `gcc`、`ar`、`windres`，已加入 `PATH`。
- Python 3.11+；测试需要 Node.js 22+。

首次获取第三方资源和 Cargo 依赖需要联网；准备完成后可离线构建、离线运行。

```powershell
python -m pip install -r requirements.txt
rustup toolchain install stable-x86_64-pc-windows-gnu
rustup override set stable-x86_64-pc-windows-gnu

# 在本机获取官方网页资源；这些文件不会提交到仓库。
python -X utf8 scripts/download_resources.py
.\scripts\build-lite.ps1
.\scripts\package-lite.ps1
```

产物为 `dist/MINI68-Lite.exe` 和 `dist/MINI68-Lite-win-x64.zip`。`vendor/`、`web/`、`web-lite/`、`dist/` 和个人配置均不属于公开源码。自行构建不意味着取得了第三方资源的再分发授权。

构建脚本保留现有的 `CARGO_HOME`、`RUSTUP_HOME` 和 `PATH`。默认将构建缓存放在 `%LOCALAPPDATA%\mini68-build\target`；若该路径含非 ASCII 字符，或希望改用其他磁盘，可在构建和打包前设置 `$env:CARGO_TARGET_DIR = 'C:\mini68-build\target'`。已有依赖缓存时可用 `build-lite.ps1 -Offline`。

网页适配使用检查过的补丁锚点。上游资源变更可能导致构建停止，需要重新检查适配；不能保证未来下载的网页版本始终兼容。资源来源及此前验证的摘要记录在 `resource-manifest.json`。

## 验证

不需要键盘、官方网页资源或第三方 Node 包即可运行 23 项源码测试：

```powershell
node --test tests/*.test.cjs
python -m compileall -q scripts
```

原生 Rust 测试由构建脚本运行。真实 WebView2 集成验证另需本地构建产物、Playwright 和 MINI68 USB 连接：

```powershell
npm install --no-save --package-lock=false playwright
node scripts/lite-check.cjs
node scripts/lighting-ui-check.cjs
```

集成测试使用独立配置目录，原生端强制只读；灯光报文在测试中拦截并模拟应答，不等同于实物灯光视觉验收。音乐测试会播放约 12 秒低音量测试音。本地增强测试见 `README-Lite.md`，会在自己的测试窗口内发送真实系统按键。

CI 仅运行无需设备和官方资源的源码测试，不代表硬件功能已由 CI 验证。

## 源码结构

| 目录 | 内容 |
| --- | --- |
| `lite/` | Tauri 程序、HID/声音/托盘/热键，以及前端适配 |
| `scripts/` | 资源获取、本地补丁、构建、打包和集成验证 |
| `tests/` | 通信排序、音乐门控、开关、映射与本地服务测试 |
| `docs/` | 固件接口依据与行为说明 |
| `src/`、`native/`、`main.cjs` | 早期 Electron 版本 |

## 许可证与反馈

本项目原创代码和原创应用图标使用 [MIT](LICENSE) 许可证。第三方依赖按各自许可证使用；官方网页资源、固件、品牌标识和补丁中用于匹配上游代码的片段不因本项目而改为 MIT。

提交问题时请提供型号、固件版本、USB/接收器连接方式和复现步骤，不要上传个人配置、访问凭据或未获授权的固件/网页资源。改动灯光发送逻辑时，请保留串行通信、过期帧取消和停止后的原灯效恢复行为。
