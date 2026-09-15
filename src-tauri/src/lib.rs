//! # Moonstone backend
//!
//! Registers every Tauri command the frontend calls. Commands are
//! stateless: each resolves the Moonstone projects root per call (see
//! [`paths`]), so there is no shared mutable state to guard.

mod bibliography;
mod compiler;
mod file_manager;
mod paths;
mod project_manager;
mod settings;
mod templates;

/// Builds and runs the Tauri application with all commands registered.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Registered so Rust can start the Tectonic sidecar. The
        // webview is granted no shell permission in
        // `capabilities/default.json`, so the ability to run a process
        // stays on this side of the IPC boundary.
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            compiler::compile_project,
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
            project_manager::rename_project,
            templates::list_templates,
            bibliography::list_references,
            settings::get_settings,
            settings::save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
