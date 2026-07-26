//! # Settings
//!
//! Persists user preferences as JSON in the app config directory.
//! Loading is fail-soft: a missing or corrupt settings file yields the
//! defaults instead of an error, so bad state can never lock the UI.

use serde::{
    Deserialize,
    Serialize,
};
use std::path::{
    Path,
    PathBuf,
};
use tauri::{
    AppHandle,
    Manager,
    Runtime,
};

/// File name of the settings JSON inside the app config directory.
const SETTINGS_FILE_NAME: &str = "settings.json";

/// User-facing preferences, shaped for the frontend settings page.
///
/// Every field carries its own serde default so a settings file written
/// by an older build still loads: a missing field falls back on its own
/// rather than discarding the whole file and resetting the user's other
/// preferences.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// Color theme: `"dark"` or `"light"`.
    #[serde(default = "default_theme")]
    pub theme: String,
    /// Editor font size in pixels.
    #[serde(default = "default_font_size")]
    pub editor_font_size: u32,
}

/// The theme a fresh install starts with.
fn default_theme() -> String {
    "dark".to_string()
}

/// The editor font size a fresh install starts with.
fn default_font_size() -> u32 {
    14
}

impl Default for AppSettings {
    /// The settings a fresh install starts with.
    fn default() -> Self {
        Self {
            theme: default_theme(),
            editor_font_size: default_font_size(),
        }
    }
}

/// Loads the persisted settings, falling back to defaults.
///
/// # Returns
///
/// The stored [`AppSettings`], or the defaults when no valid settings
/// file exists.
///
/// # Errors
///
/// Returns an error only if the config directory cannot be resolved.
#[tauri::command]
pub async fn get_settings<R: Runtime>(app: AppHandle<R>) -> Result<AppSettings, String> {
    let path = settings_path(&app)?;

    Ok(load_settings_impl(&path))
}

/// Persists the given settings to disk.
///
/// # Parameters
///
/// * `settings` - The settings to store.
///
/// # Returns
///
/// `Ok(())` on a successful write.
///
/// # Errors
///
/// Returns an error if the config directory cannot be resolved or the
/// write fails.
#[tauri::command]
pub async fn save_settings<R: Runtime>(
    app: AppHandle<R>,
    settings: AppSettings,
) -> Result<(), String> {
    let path = settings_path(&app)?;

    save_settings_impl(&path, &settings)
}

/// Resolves the settings file path inside the app config directory,
/// creating the directory if needed.
///
/// # Parameters
///
/// * `app` - Handle used to resolve the config directory.
///
/// # Returns
///
/// The absolute settings file path.
///
/// # Errors
///
/// Returns an error if the directory cannot be resolved or created.
fn settings_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Could not resolve the config directory: {}", e))?;

    std::fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Could not create the config directory: {}", e))?;

    Ok(config_dir.join(SETTINGS_FILE_NAME))
}

/// Reads settings from `path`, returning defaults when the file is
/// missing or unparsable.
///
/// # Parameters
///
/// * `path` - The settings file path.
///
/// # Returns
///
/// The parsed or default [`AppSettings`].
pub fn load_settings_impl(path: &Path) -> AppSettings {
    let Ok(contents) = std::fs::read_to_string(path) else {
        return AppSettings::default();
    };

    serde_json::from_str(&contents).unwrap_or_default()
}

/// Writes settings to `path` as pretty-printed JSON.
///
/// # Parameters
///
/// * `path` - The settings file path.
/// * `settings` - The settings to store.
///
/// # Returns
///
/// `Ok(())` on success.
///
/// # Errors
///
/// Returns an error if serialization or the write fails.
pub fn save_settings_impl(path: &Path, settings: &AppSettings) -> Result<(), String> {
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;

    std::fs::write(path, json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod settings_tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_load_returns_defaults_when_file_missing() {
        let dir = tempdir().unwrap();

        let settings = load_settings_impl(&dir.path().join("settings.json"));

        assert_eq!(settings, AppSettings::default());
    }

    #[test]
    fn test_load_returns_defaults_when_file_corrupt() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "not json at all").unwrap();

        let settings = load_settings_impl(&path);

        assert_eq!(settings, AppSettings::default());
    }

    #[test]
    fn test_save_and_load_round_trip() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let settings = AppSettings {
            theme: "light".to_string(),
            editor_font_size: 18,
        };

        save_settings_impl(&path, &settings).unwrap();
        let loaded = load_settings_impl(&path);

        assert_eq!(loaded, settings);
    }

    #[test]
    fn test_load_keeps_known_fields_when_others_are_missing() {
        // A settings file written by an older build has fewer fields.
        // Each one defaults on its own, so the preferences the user did
        // set survive instead of the whole file being discarded.
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, r#"{"theme":"light"}"#).unwrap();

        let settings = load_settings_impl(&path);

        assert_eq!(settings.theme, "light");
        assert_eq!(settings.editor_font_size, default_font_size());
    }

    #[test]
    fn test_load_ignores_fields_it_does_not_know() {
        // The reverse case: a file written by a newer build, or a
        // hand-edited one, must not blow away what we can read.
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, r#"{"theme":"light","somethingElse":42}"#).unwrap();

        assert_eq!(load_settings_impl(&path).theme, "light");
    }
}
