#![windows_subsystem = "windows"]
// Independent portable launcher. The browser itself is supplied by Windows WebView2.
use std::{env, fs, io::{self, Write}, path::{Path,PathBuf}, process::Command};
use std::os::windows::ffi::OsStrExt;
static APP: &[u8] = include_bytes!(env!("MINI68_CORE_EXE"));
static DLL: &[u8] = include_bytes!(env!("MINI68_WEBVIEW_LOADER"));

fn unpack(directory:&Path,name:&str,bytes:&[u8]) -> io::Result<()> {
    let output=directory.join(name);
    if fs::read(&output).is_ok_and(|current|current==bytes) {return Ok(());}
    let pending=directory.join(format!("{name}-{}.part",std::process::id()));
    let mut file=fs::OpenOptions::new().write(true).create_new(true).open(&pending)?;
    file.write_all(bytes)?; file.sync_all()?; drop(file);
    if output.exists() {
        if fs::read(&output).is_ok_and(|current|current==bytes) {
            fs::remove_file(pending)?; return Ok(());
        }
        fs::remove_file(&output)?;
    }
    if let Err(error)=fs::rename(&pending,&output) {
        let _=fs::remove_file(&pending);
        if !fs::read(&output).is_ok_and(|current|current==bytes) {return Err(error);}
    }
    Ok(())
}
fn launch() -> io::Result<()> {
    let base=env::var_os("LOCALAPPDATA").ok_or_else(||io::Error::new(io::ErrorKind::NotFound,"LOCALAPPDATA"))?;
    let directory=PathBuf::from(base).join("MINI68 Lite").join("runtime").join(env!("MINI68_PAYLOAD_ID"));
    fs::create_dir_all(&directory)?;
    unpack(&directory,"MINI68-Lite-core.exe",APP)?;
    unpack(&directory,"WebView2Loader.dll",DLL)?;
    Command::new(directory.join("MINI68-Lite-core.exe")).args(env::args_os().skip(1))
        .current_dir(directory).spawn()?;
    Ok(())
}
#[link(name="user32")]
extern "system" {fn MessageBoxW(hwnd:*mut std::ffi::c_void,text:*const u16,title:*const u16,flags:u32)->i32;}
fn main() {
    if let Err(error)=launch() {
        let wide=|s:&str|std::ffi::OsStr::new(s).encode_wide().chain(Some(0)).collect::<Vec<_>>();
        let text=wide(&format!("MINI68 无法释放本地运行文件：{error}\n请检查用户缓存目录的权限和剩余空间。"));
        let title=wide("MINI68 离线配置");
        unsafe {MessageBoxW(std::ptr::null_mut(),text.as_ptr(),title.as_ptr(),0x10);}
        std::process::exit(1);
    }
}
