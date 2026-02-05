use std::path::Path;


#[tauri::command]
pub async fn open_file_by_name(name: String, current_dir: String) -> Result<String, String> {
    let path: String = format!("{}{}", current_dir, name);
    let p = Path::new(&path);

    if p.exists() {
        Ok(format!("file {} exists!", path))
    } else {
        Err("File not found".to_string())
    }
}

#[tauri::command]
pub async fn open_file_by_path(path: String) -> Result<String, String> {
    let p = Path::new(&path);

    if p.exists() {
        Ok(format!("file {} exists!", path))
    } else {
        Err("File not found".to_string())
    }
}