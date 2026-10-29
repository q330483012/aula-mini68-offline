# 第三方资源

## 本仓库的开源范围

原创桌面适配代码、构建工具、测试和原创应用图标 `lite/icons/icon.ico` 使用根目录的 MIT 许可证。补丁中用于定位或适配上游代码的片段仍保留其原有权利归属。

完整应用使用的网页界面、设备定义、键盘通信逻辑、网页图标及灯效算法来自 AULA 狼蛛网页驱动 https://hec.aulacn.com/ 及其关联资源域名。相关权利属于原权利人。本项目不代表官方产品，也未将这些资源重新声明为开源软件。

公开仓库不提交 `vendor/`、`web/`、`web-lite/`、官方固件、官方品牌图标或包含官方资源的运行包；资源清单只记录公开来源和校验值。未确认官方资源允许再分发，因此不在 GitHub Release 发布本机生成的完整 EXE/ZIP。下载及自行构建仍需遵守相关资源的适用条款。

## 运行时依赖

Electron 45.0.0 使用 MIT 许可证，许可证随运行包根目录的 `LICENSE` 提供。Chromium 及其他第三方组件许可证见根目录 `LICENSES.chromium.html`。

轻量版未捆绑 Electron/Chromium 浏览器，采用系统 Microsoft Edge WebView2（适用 Microsoft 运行时条款）。Tauri、Wry、Tao、Serde、Rust Windows 绑定等依赖按各自 MIT / Apache-2.0 等许可证使用；hidapi 使用其 BSD 风格许可证。本项目只复用了先前鼠标应用的架构，没有复制其鼠标协议或 AGPL 应用代码。轻量版依赖许可证全文随 ZIP 中 `licenses/` 提供。

本地适配新增了桌面托盘、受限 WebHID 授权、本地资源服务和 Windows 播放设备音量计。运行包不包含或运行官方独立 Music.exe 插件。
