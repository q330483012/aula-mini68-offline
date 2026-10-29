#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod audio;
mod desktop;
mod hid;
mod hotkeys;
mod protocol;
mod startup;
use std::{
    borrow::Cow,
    sync::{atomic::Ordering, mpsc},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    webview::WebviewWindowBuilder,
    Manager, WebviewUrl,
};

#[tauri::command]
async fn hid_list(state: tauri::State<'_, hid::Hid>) -> Result<Vec<hid::Info>, String> {
    let (tx, rx) = mpsc::channel();
    state
        .jobs
        .send(hid::Job::List(tx))
        .map_err(|e| e.to_string())?;
    hid::answer(rx).await
}
#[tauri::command]
async fn hid_open(id: String, state: tauri::State<'_, hid::Hid>) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    state
        .jobs
        .send(hid::Job::Open(id, tx))
        .map_err(|e| e.to_string())?;
    hid::answer(rx).await
}
#[tauri::command]
async fn hid_close(id: String, state: tauri::State<'_, hid::Hid>) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    state
        .jobs
        .send(hid::Job::Close(id, tx))
        .map_err(|e| e.to_string())?;
    hid::answer(rx).await
}
#[tauri::command]
async fn hid_write(
    id: String,
    report_id: u8,
    data: Vec<u8>,
    state: tauri::State<'_, hid::Hid>,
) -> Result<(), String> {
    let (tx, rx) = mpsc::channel();
    state
        .jobs
        .send(hid::Job::Write(id, report_id, data, tx))
        .map_err(|e| e.to_string())?;
    hid::answer(rx).await
}
#[tauri::command]
fn audio_sample(state: tauri::State<audio::Audio>) -> audio::Sample {
    state.sample.lock().unwrap().clone()
}
#[tauri::command]
fn music_active(active: bool, state: tauri::State<audio::Audio>) {
    state.active.store(active, Ordering::Relaxed);
}
#[tauri::command]
fn hide_window(window: tauri::WebviewWindow) {
    let _ = window.close();
}
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}
#[tauri::command]
fn window_visible(window: tauri::WebviewWindow) -> bool {
    window.is_visible().unwrap_or(false)
}
#[tauri::command]
fn desktop_get(state: tauri::State<desktop::Desktop>) -> Result<desktop::Snapshot, String> {
    state.snapshot()
}
#[tauri::command]
fn desktop_save(
    config: desktop::Config,
    state: tauri::State<desktop::Desktop>,
) -> Result<desktop::Snapshot, String> {
    state.save(config)
}
#[tauri::command]
fn desktop_startup(
    enabled: bool,
    state: tauri::State<desktop::Desktop>,
) -> Result<desktop::Snapshot, String> {
    state.startup_set(enabled)
}
#[tauri::command]
fn desktop_test_focus(window: tauri::WebviewWindow) -> Result<(), String> {
    if std::env::var("AULA_LITE_TEST").as_deref() != Ok("1") {
        return Err("仅限独立测试实例".into());
    }
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}
#[tauri::command]
async fn desktop_test_press(
    rule: hotkeys::Rule,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    // Verify the actual foreground top-level window before emitting OS input.
    let foreground = window.hwnd().is_ok_and(|hwnd| {
        hwnd.0 == unsafe { windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow() }.0
    });
    if std::env::var("AULA_LITE_TEST").as_deref() != Ok("1") || !foreground {
        return Err("仅允许在独立测试窗口内验证输入".into());
    }
    tauri::async_runtime::spawn_blocking(move || hotkeys::test_press(&rule))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
fn desktop_test_startup(state: tauri::State<desktop::Desktop>) -> Result<Option<String>, String> {
    if std::env::var("AULA_LITE_TEST").as_deref() != Ok("1") {
        return Err("仅限独立测试实例".into());
    }
    state.test_startup_command()
}
fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
fn main() {
    let test = std::env::var("AULA_LITE_TEST").as_deref() == Ok("1");
    let mut builder = tauri::Builder::default();
    if !test {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| show(app)));
    }
    builder.invoke_handler(tauri::generate_handler![hid_list,hid_open,hid_close,hid_write,
        audio_sample,music_active,hide_window,quit_app,window_visible,
        desktop_get,desktop_save,desktop_startup,desktop_test_focus,desktop_test_press,desktop_test_startup])
    .setup(move |app| {
        let profile=std::env::var_os("AULA_LITE_TEST_PROFILE").filter(|_|test)
            .map(std::path::PathBuf::from).unwrap_or(app.path().app_local_data_dir()?.join("WebView2"));
        let desktop_path=if test {profile.join("desktop-settings.json")} else {app.path().app_local_data_dir()?.join("desktop-settings.json")};
        app.manage(desktop::Desktop::start(app.handle().clone(),desktop_path,test));
        let mut args="--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --autoplay-policy=no-user-gesture-required".to_string();
        if test {
            if let Ok(port)=std::env::var("AULA_LITE_DEBUG_PORT") {
                if port.parse::<u16>().is_ok() { args.push_str(&format!(" --remote-debugging-port={port}")); }
            }
        }
        app.manage(hid::Hid::start(app.handle().clone(),test));
        WebviewWindowBuilder::new(app,"main",WebviewUrl::App("index.html".into()))
            .title("MINI68 离线配置 · 轻量版").inner_size(1280.0,820.0).min_inner_size(1000.0,650.0)
            .visible(!std::env::args().any(|arg|arg=="--background"))
            .data_directory(profile).additional_browser_args(&args).center()
            .disable_drag_drop_handler()
            .on_new_window(|_,_|tauri::webview::NewWindowResponse::Deny)
            .on_navigation(|url|url.host_str()==Some("tauri.localhost"))
            .on_web_resource_request(|request,response| {
                let path=request.uri().path();
                let body=if path=="/api/supplier/index" {
                    Some(include_str!("../../web/config/supplier.json"))
                } else if path.starts_with("/api/") {
                    Some(r#"{"code":0,"msg":"此功能需要联网，离线版未启用。","data":{"list":[],"total":0}}"#)
                } else if path.ends_with("/update.json") { Some("[]") } else {None};
                if let Some(body)=body {
                    *response=tauri::http::Response::builder().status(200)
                        .header("Content-Type","application/json; charset=utf-8")
                        .header("Cache-Control","no-store")
                        .body(Cow::Owned(body.as_bytes().to_vec())).unwrap();
                }
            }).build()?;
        app.manage(audio::Audio::start(app.handle().clone()));
        let open=MenuItem::with_id(app,"open","打开 MINI68 配置",true,None::<&str>)?;
        let exit=MenuItem::with_id(app,"exit","退出",true,None::<&str>)?;
        let mappings=MenuItem::with_id(app,"mappings","暂停／恢复组合键映射",true,None::<&str>)?;
        let menu=Menu::with_items(app,&[&open,&mappings,&exit])?;
        TrayIconBuilder::new().icon(app.default_window_icon().unwrap().clone())
            .tooltip("MINI68 离线配置").menu(&menu).show_menu_on_left_click(false)
            .on_menu_event(|app,event|match event.id.as_ref(){"open"=>show(app),"exit"=>app.exit(0),
                "mappings"=>{let _=app.state::<desktop::Desktop>().toggle();},_=>{}})
            .on_tray_icon_event(|tray,event|if matches!(event,TrayIconEvent::DoubleClick{..}) {show(tray.app_handle())})
            .build(app)?;
        Ok(())
    })
    .on_window_event(|window,event| {
        if let tauri::WindowEvent::CloseRequested{api,..}=event {api.prevent_close();let _=window.hide();}
    })
    .run(tauri::generate_context!()).expect("无法启动 MINI68 轻量版");
}
