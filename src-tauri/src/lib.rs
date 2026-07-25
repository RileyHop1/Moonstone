//! # Moonstone backend
//!
//! Registers every Tauri command the frontend calls. Commands are
//! stateless: each resolves the Moonstone projects root per call (see
//! [`paths`]), so there is no shared mutable state to guard.

mod file_manager;
mod paths;
mod project_manager;
mod settings;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Builds and runs the Tauri application with all commands registered.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            file_manager::create_file,
            file_manager::create_directory,
            file_manager::list_project_files,
            file_manager::read_file,
            file_manager::save_file,
            file_manager::rename_entry,
            file_manager::move_entry,
            file_manager::delete_entry,
            project_manager::list_projects,
            project_manager::create_project,
            project_manager::delete_project,
            settings::get_settings,
            settings::save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
