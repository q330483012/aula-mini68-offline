use crate::protocol;
use hidapi::{HidApi, HidDevice};
use serde::Serialize;
use std::{sync::mpsc, time::Duration};
use tauri::Emitter;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub id: String,
    pub product_name: String,
    pub vendor_id: u16,
    pub product_id: u16,
    pub usage_page: u16,
    pub usage: u16,
}
#[derive(Clone, Serialize)]
struct Input {
    id: String,
    data: Vec<u8>,
}
type Reply<T> = mpsc::Sender<Result<T, String>>;
pub enum Job {
    List(Reply<Vec<Info>>),
    Open(String, Reply<()>),
    Close(String, Reply<()>),
    Write(String, u8, Vec<u8>, Reply<()>),
}
pub struct Hid {
    pub jobs: mpsc::Sender<Job>,
}
fn infos(api: &mut HidApi) -> Result<Vec<Info>, String> {
    api.refresh_devices().map_err(|e| e.to_string())?;
    Ok(api
        .device_list()
        .filter(|d| protocol::supported(d.vendor_id(), d.product_id(), d.usage_page(), d.usage()))
        .map(|d| Info {
            id: d.path().to_string_lossy().into_owned(),
            product_name: d.product_string().unwrap_or("MINI68").into(),
            vendor_id: d.vendor_id(),
            product_id: d.product_id(),
            usage_page: d.usage_page(),
            usage: d.usage(),
        })
        .collect())
}
impl Hid {
    pub fn start(app: tauri::AppHandle, read_only: bool) -> Self {
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut api = HidApi::new();
            let mut opened: Option<(String, HidDevice)> = None;
            loop {
                let job = if opened.is_some() {
                    rx.try_recv().ok()
                } else {
                    match rx.recv_timeout(Duration::from_millis(200)) {
                        Ok(j) => Some(j),
                        Err(mpsc::RecvTimeoutError::Timeout) => continue,
                        Err(_) => break,
                    }
                };
                if let Some(job) = job {
                    match job {
                        Job::List(reply) => {
                            let _ =
                                reply.send(api.as_mut().map_err(|e| e.to_string()).and_then(infos));
                        }
                        Job::Open(id, reply) => {
                            let result = (|| {
                                if opened.as_ref().is_some_and(|(key, _)| key == &id) {
                                    return Ok(());
                                }
                                if opened.is_some() {
                                    return Err("请先断开当前键盘".into());
                                }
                                let api = api.as_mut().map_err(|e| e.to_string())?;
                                infos(api)?;
                                let info = api
                                    .device_list()
                                    .find(|d| {
                                        d.path().to_string_lossy() == id
                                            && protocol::supported(
                                                d.vendor_id(),
                                                d.product_id(),
                                                d.usage_page(),
                                                d.usage(),
                                            )
                                    })
                                    .ok_or("未找到 MINI68 USB 配置接口，请检查数据线")?;
                                let device = info.open_device(api).map_err(|e| e.to_string())?;
                                opened = Some((id, device));
                                Ok(())
                            })();
                            let _ = reply.send(result);
                        }
                        Job::Close(id, reply) => {
                            if opened.as_ref().is_some_and(|(key, _)| key == &id) {
                                opened = None;
                            }
                            let _ = reply.send(Ok(()));
                        }
                        Job::Write(id, report_id, data, reply) => {
                            let result = (|| {
                                let wire = protocol::wire_report(report_id, &data, read_only)?;
                                let (_, device) = opened
                                    .as_ref()
                                    .filter(|(key, _)| key == &id)
                                    .ok_or("键盘尚未连接")?;
                                let count = device.write(&wire).map_err(|e| e.to_string())?;
                                if count != wire.len() {
                                    return Err(format!("HID 写入不完整 {count}/{}", wire.len()));
                                }
                                Ok(())
                            })();
                            let _ = reply.send(result);
                        }
                    }
                }
                if let Some((id, device)) = &opened {
                    let mut buffer = [0u8; 65];
                    match device.read_timeout(&mut buffer, 4) {
                        Ok(0) => {}
                        Ok(n) => {
                            let start = usize::from(n == 65 && buffer[0] == 0);
                            let _ = app.emit(
                                "mini68-input",
                                Input {
                                    id: id.clone(),
                                    data: buffer[start..n].to_vec(),
                                },
                            );
                        }
                        Err(_) => {
                            let id = id.clone();
                            opened = None;
                            let _ = app.emit("mini68-disconnect", id);
                        }
                    }
                }
            }
        });
        Self { jobs: tx }
    }
}

pub async fn answer<T: Send + 'static>(rx: mpsc::Receiver<Result<T, String>>) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(Duration::from_secs(10))
            .map_err(|_| "USB 请求超时".to_string())?
    })
    .await
    .map_err(|e| e.to_string())?
}
