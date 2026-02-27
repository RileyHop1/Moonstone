use std::sync::{Arc, Mutex};


mod file_manager;
mod project_manager;

struct AppState {
    // Add any state you want to share across commands here
    projects: Arc<Mutex<Vec<String>>>,
    current_directory: Arc<Mutex<String>>,
    within_project: Arc<Mutex<bool>>,

}


impl AppState {
    fn new() -> Self {

        Self {
            projects: Arc::new(Mutex::new(Vec::new())),
            current_directory: Arc::new(Mutex::new(String::new())),
            within_project: Arc::new(Mutex::new(false)),
        }
    }

    fn add_project(&self, new_project: String) {
        let mut projects = self.projects.lock().unwrap();
        projects.push(new_project);
    }

    fn remove_project(&self, project_name: String) {
        let mut projects = self.projects.lock().unwrap();
        projects.retain(|project| project != &project_name);
    }


    fn update_current_directory(&self, new_directory: String) {
        *self.current_directory.lock().unwrap() = new_directory;
    }
}





// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {

                
                Ok(())

        })
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
