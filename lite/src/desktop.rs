use crate::{
    hotkeys::{self, Hotkeys, Rule},
    startup::Startup,
};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex};

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct Config {
    pub enabled: bool,
    pub rules: Vec<Rule>,
}
#[derive(Serialize)]
pub struct Snapshot {
    pub config: Config,
    pub startup: bool,
    pub errors: Vec<Option<String>>,
    pub warning: Option<String>,
}
struct Inner {
    config: Config,
    errors: Vec<Option<String>>,
}
pub struct Desktop {
    path: PathBuf,
    engine: Hotkeys,
    inner: Mutex<Inner>,
    startup: Startup,
    warning: Option<String>,
}
impl Desktop {
    pub fn start(app: tauri::AppHandle, path: PathBuf, test: bool) -> Self {
        let loaded = (|| {
            if !path.exists() {
                return Ok(Config::default());
            }
            let config: Config =
                serde_json::from_slice(&std::fs::read(&path).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            hotkeys::validate(&config.rules)?;
            Ok::<_, String>(config)
        })();
        let (config, warning) = match loaded {
            Ok(config) => (config, None),
            Err(error) => (
                Config::default(),
                Some(format!("本地映射配置未加载：{error}")),
            ),
        };
        let engine = Hotkeys::start(app);
        let errors = engine
            .apply(config.rules.clone(), config.enabled)
            .unwrap_or_else(|error| vec![Some(error); config.rules.len()]);
        let startup = Startup::new(test);
        // Refresh an existing opt-in entry when a newer embedded core is opened.
        if !test && startup.command().ok().flatten().is_some() {
            let _ = startup.set(true);
        }
        Self {
            path,
            engine,
            inner: Mutex::new(Inner { config, errors }),
            startup,
            warning,
        }
    }
    pub fn snapshot(&self) -> Result<Snapshot, String> {
        let inner = self.inner.lock().unwrap();
        Ok(Snapshot {
            config: inner.config.clone(),
            errors: inner.errors.clone(),
            startup: self.startup.command()?.is_some(),
            warning: self.warning.clone(),
        })
    }
    pub fn save(&self, config: Config) -> Result<Snapshot, String> {
        hotkeys::validate(&config.rules)?;
        let mut inner = self.inner.lock().unwrap();
        let bytes = serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?;
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let pending = self.path.with_extension("new");
        std::fs::write(&pending, bytes).map_err(|e| e.to_string())?;
        std::fs::rename(pending, &self.path).map_err(|e| e.to_string())?;
        inner.errors = self.engine.apply(config.rules.clone(), config.enabled)?;
        inner.config = config;
        drop(inner);
        self.snapshot()
    }
    pub fn toggle(&self) -> Result<Snapshot, String> {
        let mut config = self.inner.lock().unwrap().config.clone();
        config.enabled = !config.enabled;
        self.save(config)
    }
    pub fn startup_set(&self, enabled: bool) -> Result<Snapshot, String> {
        self.startup.set(enabled)?;
        self.snapshot()
    }
    pub fn test_startup_command(&self) -> Result<Option<String>, String> {
        self.startup.command()
    }
}
