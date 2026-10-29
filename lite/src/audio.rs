use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::Emitter;
use windows::Win32::{
    Media::Audio::{
        eMultimedia, eRender, Endpoints::IAudioMeterInformation, IMMDeviceEnumerator,
        MMDeviceEnumerator,
    },
    System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
    },
};

#[derive(Clone, Default, Serialize)]
pub struct Sample {
    pub amplitude: u16,
    pub available: bool,
}
pub struct Audio {
    pub sample: Arc<Mutex<Sample>>,
    pub active: Arc<AtomicBool>,
}
impl Audio {
    pub fn start(app: tauri::AppHandle) -> Self {
        let sample = Arc::new(Mutex::new(Sample::default()));
        let active = Arc::new(AtomicBool::new(false));
        let (shared, enabled) = (sample.clone(), active.clone());
        std::thread::spawn(move || unsafe {
            if CoInitializeEx(None, COINIT_MULTITHREADED).is_err() {
                return;
            }
            let enumerator: Result<IMMDeviceEnumerator, _> =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL);
            let mut meter: Option<IAudioMeterInformation> = None;
            let mut refreshed = Instant::now() - Duration::from_secs(2);
            loop {
                let started = Instant::now();
                if refreshed.elapsed() >= Duration::from_secs(1) {
                    meter = enumerator
                        .as_ref()
                        .ok()
                        .and_then(|e| e.GetDefaultAudioEndpoint(eRender, eMultimedia).ok())
                        .and_then(|d| d.Activate::<IAudioMeterInformation>(CLSCTX_ALL, None).ok());
                    refreshed = Instant::now();
                }
                let peak = meter.as_ref().and_then(|m| m.GetPeakValue().ok());
                *shared.lock().unwrap() = Sample {
                    amplitude: (peak.unwrap_or(0.0).clamp(0.0, 1.0) * 1000.0).round() as u16,
                    available: peak.is_some(),
                };
                if enabled.load(Ordering::Relaxed) {
                    let _ = app.emit("mini68-tick", ());
                }
                std::thread::sleep(Duration::from_millis(50).saturating_sub(started.elapsed()));
                // The process owns this thread and all COM objects; no helper process is left behind.
                if app.get_webview_window("main").is_none() {
                    break;
                }
            }
            drop(meter);
            drop(enumerator);
            CoUninitialize();
        });
        Self { sample, active }
    }
}
use tauri::Manager;
