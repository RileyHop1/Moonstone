//! # Project settings
//!
//! Preferences that belong to one project rather than to the user —
//! today, which file is the root document that compiling builds.
//!
//! Stored inside the project as [`FILE_NAME`], so they travel with it
//! when it is copied or synced. The leading dot keeps the file out of
//! the file browser, which skips dot-prefixed entries.

use serde::{
    Deserialize,
    Serialize,
};
use std::path::{
    Component,
    Path,
    PathBuf,
};
use tauri::{
    AppHandle,
    Runtime,
};

use crate::paths;

/// File inside the project that holds its settings.
const FILE_NAME: &str = ".moonstone.json";

/// Settings stored with one project.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSettings {
    /// The root document, relative to the project with `/` separators,
    /// or `None` to let the editor work it out.
    #[serde(default)]
    pub main_file: Option<String>,
}

/// Resolves a project directory inside the Moonstone root.
///
/// # Parameters
///
/// * `app` - Handle used to resolve the root.
/// * `project_path` - The project the frontend named.
///
/// # Errors
///
/// Returns an error if it escapes the root or is not a directory.
fn project_dir<R: Runtime>(app: &AppHandle<R>, project_path: &str) -> Result<PathBuf, String> {
    let root = paths::moonstone_root(app)?;
    let project = paths::ensure_within_root(&root, Path::new(project_path))?;

    if !project.is_dir() {
        return Err("That project directory does not exist".to_string());
    }

    Ok(project)
}

/// Reads a project's settings; a missing or corrupt file gives the
/// defaults, so bad state can never stop a project opening.
///
/// # Parameters
///
/// * `project` - The project directory.
///
/// # Returns
///
/// The stored or default settings.
fn load(project: &Path) -> ProjectSettings {
    std::fs::read_to_string(project.join(FILE_NAME))
        .ok()
        .and_then(|contents| serde_json::from_str(&contents).ok())
        .unwrap_or_default()
}

/// Checks that a main file names something inside the project.
///
/// # Parameters
///
/// * `main_file` - The relative path to store.
///
/// # Errors
///
/// Returns an error for an absolute path or one using `..`.
fn validate_main_file(main_file: &str) -> Result<(), String> {
    let is_plain_relative = !main_file.is_empty()
        && Path::new(main_file)
            .components()
            .all(|component| matches!(component, Component::Normal(_)));

    if is_plain_relative {
        Ok(())
    } else {
        Err("The main document must be a file inside the project".to_string())
    }
}

/// Loads a project's settings.
///
/// # Parameters
///
/// * `project_path` - Path of the project directory.
///
/// # Returns
///
/// The project's settings, or the defaults.
///
/// # Errors
///
/// Returns an error if the project is outside the root or missing.
#[tauri::command]
pub async fn get_project_settings<R: Runtime>(
    app: AppHandle<R>,
    project_path: String,
) -> Result<ProjectSettings, String> {
    Ok(load(&project_dir(&app, &project_path)?))
}

/// Saves a project's settings.
///
/// # Parameters
///
/// * `project_path` - Path of the project directory.
/// * `settings` - The settings to store.
///
/// # Errors
///
/// Returns an error if the project is outside the root or missing, the
/// main file is not inside the project, or the write fails.
#[tauri::command]
pub async fn save_project_settings<R: Runtime>(
    app: AppHandle<R>,
    project_path: String,
    settings: ProjectSettings,
) -> Result<(), String> {
    if let Some(main_file) = &settings.main_file {
        validate_main_file(main_file)?;
    }

    let project = project_dir(&app, &project_path)?;
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;

    std::fs::write(project.join(FILE_NAME), json)
        .map_err(|e| format!("Could not save the project settings: {}", e))
}

#[cfg(test)]
mod project_settings_tests {
    use super::*;

    #[test]
    fn test_load_defaults_when_the_file_is_missing() {
        let project = tempfile::tempdir().unwrap();

        assert_eq!(load(project.path()), ProjectSettings::default());
    }

    #[test]
    fn test_load_defaults_when_the_file_is_corrupt() {
        let project = tempfile::tempdir().unwrap();
        std::fs::write(project.path().join(FILE_NAME), "{not json").unwrap();

        assert_eq!(load(project.path()), ProjectSettings::default());
    }

    #[test]
    fn test_load_reads_the_main_file() {
        let project = tempfile::tempdir().unwrap();
        std::fs::write(
            project.path().join(FILE_NAME),
            r#"{"mainFile":"thesis/main.tex"}"#,
        )
        .unwrap();

        assert_eq!(load(project.path()).main_file.as_deref(), Some("thesis/main.tex"));
    }

    #[test]
    fn test_validate_main_file_accepts_a_nested_file() {
        assert!(validate_main_file("chapters/main.tex").is_ok());
    }

    #[test]
    fn test_validate_main_file_rejects_escapes() {
        // The frontend reads this back and compiles it, so it must not
        // be able to name a file outside the project.
        for bad in ["../other/main.tex", "/etc/main.tex", "a/../../b.tex", ""] {
            assert!(validate_main_file(bad).is_err(), "{} should be rejected", bad);
        }
    }
}
