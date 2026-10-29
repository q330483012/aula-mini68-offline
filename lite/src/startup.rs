use windows::{
    core::{HSTRING, PCWSTR},
    Win32::{Foundation::ERROR_FILE_NOT_FOUND, System::Registry::*},
};

const VALUE: &str = "MINI68Lite";
pub struct Startup {
    key: String,
    test: bool,
}
impl Startup {
    pub fn new(test: bool) -> Self {
        Self {
            key: if test {
                format!("Software\\MINI68LiteTest-{}", std::process::id())
            } else {
                "Software\\Microsoft\\Windows\\CurrentVersion\\Run".into()
            },
            test,
        }
    }
    pub fn command(&self) -> Result<Option<String>, String> {
        unsafe {
            let mut key = HKEY::default();
            let result = RegOpenKeyExW(
                HKEY_CURRENT_USER,
                &HSTRING::from(&self.key),
                None,
                KEY_READ,
                &mut key,
            );
            if result == ERROR_FILE_NOT_FOUND {
                return Ok(None);
            }
            result.ok().map_err(|e| e.to_string())?;
            let value = HSTRING::from(VALUE);
            let mut length = 0;
            let result = RegQueryValueExW(key, &value, None, None, None, Some(&mut length));
            if result == ERROR_FILE_NOT_FOUND {
                let _ = RegCloseKey(key);
                return Ok(None);
            }
            if let Err(e) = result.ok() {
                let _ = RegCloseKey(key);
                return Err(e.to_string());
            }
            let mut bytes = vec![0u8; length as usize];
            let result = RegQueryValueExW(
                key,
                &value,
                None,
                None,
                Some(bytes.as_mut_ptr()),
                Some(&mut length),
            );
            let _ = RegCloseKey(key);
            result.ok().map_err(|e| e.to_string())?;
            let words: Vec<u16> = bytes[..length as usize]
                .chunks_exact(2)
                .map(|b| u16::from_le_bytes([b[0], b[1]]))
                .take_while(|&v| v != 0)
                .collect();
            Ok(Some(String::from_utf16_lossy(&words)))
        }
    }
    pub fn set(&self, enabled: bool) -> Result<(), String> {
        unsafe {
            let mut key = HKEY::default();
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                &HSTRING::from(&self.key),
                None,
                PCWSTR::null(),
                REG_OPTION_NON_VOLATILE,
                KEY_WRITE,
                None,
                &mut key,
                None,
            )
            .ok()
            .map_err(|e| e.to_string())?;
            let value = HSTRING::from(VALUE);
            let result = if enabled {
                let exe = std::env::current_exe().map_err(|e| e.to_string());
                let exe = match exe {
                    Ok(p) => p,
                    Err(e) => {
                        let _ = RegCloseKey(key);
                        return Err(e);
                    }
                };
                let command = format!("\"{}\" --background", exe.display());
                let bytes: Vec<u8> = command
                    .encode_utf16()
                    .chain(Some(0))
                    .flat_map(u16::to_le_bytes)
                    .collect();
                RegSetValueExW(key, &value, None, REG_SZ, Some(&bytes))
            } else {
                RegDeleteValueW(key, &value)
            };
            let _ = RegCloseKey(key);
            if self.test && !enabled {
                let _ = RegDeleteKeyW(HKEY_CURRENT_USER, &HSTRING::from(&self.key));
            }
            if !enabled && result == ERROR_FILE_NOT_FOUND {
                return Ok(());
            }
            result.ok().map_err(|e| e.to_string())
        }
    }
}
impl Drop for Startup {
    fn drop(&mut self) {
        if self.test {
            unsafe {
                let _ = RegDeleteKeyW(HKEY_CURRENT_USER, &HSTRING::from(&self.key));
            }
        }
    }
}
