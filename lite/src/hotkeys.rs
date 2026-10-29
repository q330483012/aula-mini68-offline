use serde::{Deserialize, Serialize};
use std::{collections::HashSet, sync::mpsc, time::Duration};
use tauri::Emitter;
use windows::Win32::UI::{
    Input::KeyboardAndMouse::*,
    WindowsAndMessaging::{PeekMessageW, MSG, PM_REMOVE, WM_HOTKEY},
};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Rule {
    pub modifiers: u32,
    pub key: u32,
    pub target: u32,
}
pub fn valid_key(key: u32) -> bool {
    matches!(key, 8|9|13|27|32..=40|45..=46|48..=57|65..=90|112..=123|186..=192|219..=222)
}
pub fn validate(rules: &[Rule]) -> Result<(), String> {
    if rules.len() > 32 {
        return Err("最多保存 32 条映射".into());
    }
    let mut used = HashSet::new();
    for rule in rules {
        if !(1..=15).contains(&rule.modifiers) {
            return Err("请至少选择一个修饰键".into());
        }
        if !valid_key(rule.key) || !valid_key(rule.target) {
            return Err("无效的来源或目标按键".into());
        }
        if rule.key == 123 {
            return Err("F12 是 Windows 调试保留键".into());
        }
        if rule.modifiers & 3 == 3 && rule.key == 46 {
            return Err("Ctrl+Alt+Delete 是系统保留组合".into());
        }
        if !used.insert((rule.modifiers, rule.key)) {
            return Err("来源组合键重复".into());
        }
    }
    Ok(())
}

type Reply = mpsc::Sender<Vec<Option<String>>>;
pub struct Hotkeys {
    tx: mpsc::Sender<(Vec<Rule>, bool, Reply)>,
}
const MODIFIER_KEYS: [u16; 8] = [0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0x5b, 0x5c];

fn input(key: u16, up: bool) -> INPUT {
    let extended = matches!(key, 0x21..=0x28|0x2d..=0x2e|0xa3|0xa5|0x5b|0x5c);
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(key),
                wScan: 0,
                dwFlags: if up {
                    KEYEVENTF_KEYUP
                } else {
                    KEYBD_EVENT_FLAGS(0)
                } | if extended {
                    KEYEVENTF_EXTENDEDKEY
                } else {
                    KEYBD_EVENT_FLAGS(0)
                },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}
fn sequence(target: u16, held: &[u16]) -> Vec<INPUT> {
    // Remove held modifiers for the destination tap, then restore their state.
    // Otherwise Ctrl+J -> Home would accidentally produce Ctrl+Home.
    held.iter()
        .map(|&key| input(key, true))
        .chain([input(target, false), input(target, true)])
        .chain(held.iter().map(|&key| input(key, false)))
        .collect()
}
fn send(inputs: &[INPUT]) -> Result<(), String> {
    let count = unsafe { SendInput(inputs, std::mem::size_of::<INPUT>() as i32) };
    if count != inputs.len() as u32 {
        return Err("目标窗口未接受按键；管理员程序需要同等权限".into());
    }
    Ok(())
}
fn tap(target: u32) -> Result<(), String> {
    let held: Vec<u16> = MODIFIER_KEYS
        .into_iter()
        .filter(|&key| unsafe { GetAsyncKeyState(key as i32) } < 0)
        .collect();
    send(&sequence(target as u16, &held))
}
impl Hotkeys {
    pub fn start(app: tauri::AppHandle) -> Self {
        let (tx, rx) = mpsc::channel::<(Vec<Rule>, bool, Reply)>();
        std::thread::spawn(move || {
            let mut active = Vec::<(i32, Rule)>::new();
            loop {
                match rx.recv_timeout(Duration::from_millis(8)) {
                    Ok((rules, enabled, reply)) => {
                        for (id, _) in active.drain(..) {
                            let _ = unsafe { UnregisterHotKey(None, id) };
                        }
                        let mut errors = vec![None; rules.len()];
                        if enabled {
                            for (index, rule) in rules.into_iter().enumerate() {
                                let id = 0x6800 + index as i32;
                                match unsafe {
                                    RegisterHotKey(
                                        None,
                                        id,
                                        HOT_KEY_MODIFIERS(rule.modifiers) | MOD_NOREPEAT,
                                        rule.key,
                                    )
                                } {
                                    Ok(()) => active.push((id, rule)),
                                    Err(_) => {
                                        errors[index] =
                                            Some("组合键被系统或其他程序占用，请换一组".into())
                                    }
                                }
                            }
                        }
                        let _ = reply.send(errors);
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(_) => break,
                }
                let mut message = MSG::default();
                while unsafe { PeekMessageW(&mut message, None, 0, 0, PM_REMOVE) }.as_bool() {
                    if message.message == WM_HOTKEY {
                        if let Some((_, rule)) =
                            active.iter().find(|(id, _)| *id == message.wParam.0 as i32)
                        {
                            if let Err(error) = tap(rule.target) {
                                let _ = app.emit("mini68-hotkey-error", error);
                            }
                        }
                    }
                }
            }
            for (id, _) in active {
                let _ = unsafe { UnregisterHotKey(None, id) };
            }
        });
        Self { tx }
    }
    pub fn apply(&self, rules: Vec<Rule>, enabled: bool) -> Result<Vec<Option<String>>, String> {
        validate(&rules)?;
        let (tx, rx) = mpsc::channel();
        self.tx
            .send((rules, enabled, tx))
            .map_err(|e| e.to_string())?;
        rx.recv_timeout(Duration::from_secs(3))
            .map_err(|_| "组合键处理超时".into())
    }
}

// Used only by an isolated test instance, focused on its own editor.
pub fn test_press(rule: &Rule) -> Result<(), String> {
    validate(std::slice::from_ref(rule))?;
    let modifiers: Vec<u16> = [(2, 0xa2), (1, 0xa4), (4, 0xa0), (8, 0x5b)]
        .into_iter()
        .filter(|(bit, _)| rule.modifiers & bit != 0)
        .map(|(_, key)| key)
        .collect();
    let down: Vec<_> = modifiers
        .iter()
        .map(|&key| input(key, false))
        .chain([input(rule.key as u16, false)])
        .collect();
    let up: Vec<_> = [input(rule.key as u16, true)]
        .into_iter()
        .chain(modifiers.iter().rev().map(|&key| input(key, true)))
        .collect();
    let result = send(&down);
    std::thread::sleep(Duration::from_millis(120));
    let released = send(&up);
    result.and(released)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_duplicate_and_system_reserved_sources() {
        let rule = Rule {
            modifiers: 2,
            key: 74,
            target: 36,
        };
        assert!(validate(std::slice::from_ref(&rule)).is_ok());
        assert!(validate(&[rule.clone(), rule]).is_err());
        for (modifiers, key, target) in [
            (0, 74, 36),
            (16, 74, 36),
            (2, 123, 36),
            (3, 46, 36),
            (2, 74, 999),
        ] {
            assert!(validate(&[Rule {
                modifiers,
                key,
                target
            }])
            .is_err());
        }
    }
    #[test]
    fn target_tap_releases_then_restores_held_modifiers() {
        let inputs = sequence(36, &[0xa2, 0xa0]);
        let keys: Vec<_> = inputs
            .iter()
            .map(|i| unsafe { (i.Anonymous.ki.wVk.0, i.Anonymous.ki.dwFlags.0) })
            .collect();
        assert_eq!(
            keys,
            [(0xa2, 2), (0xa0, 2), (36, 1), (36, 3), (0xa2, 0), (0xa0, 0)]
        );
    }
}
