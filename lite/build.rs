fn main() {
    let icon = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("mini68.ico");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    std::fs::copy("icons/icon.ico", &icon).expect("stage icon for GNU resource compiler");
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new().window_icon_path(icon)),
    )
    .expect("application resources");
}
