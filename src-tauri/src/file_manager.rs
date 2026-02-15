use tokio::fs;
use tauri::{
    AppHandle, 
    Manager
};





#[tauri::command]
pub async fn create_file(app: AppHandle, parent_directory: String, file_name: String) 
    -> Result<String, String> {

        //Blocks empty file names.
        if file_name.is_empty() {
            return Err("File name can't be empty");
        }

        let full_path = std::path::Path::new(&parent_directory).join(&file_name);

        //Returns an error if the file alread exists.
        if full_path.exists() {
            return Err(format!("File {} already exists", file_name));
        }

        tokio::fs::write(&full_path, "")
            .await.map_err(|e| e.to_string())?;

        let path_str = full_path.to_string_lossy().to_string();

        app.emit_all("file-created", path_str.clone()).unwrap();

        Ok(path_str)
}



#[tauri::command]
pub async fn create_directory(app: AppHandle, parent_directory: String, dir_name: String) 
    -> Result<String, String> {

    if dir_name.is_empty() {
        return Err("Directory cannot be empty");
    }

    let full_path = std::path::Path::new(&parent_directory).join(&dir_name);

    if full_path.exists() {
        return Err(format!("Directory {} already exists", dir_name));
    }

    tokio::fs::create_dir_all(&full_path)
        .await.map_err(|e| e.to_string())?;

    let path_str = full_path.to_string_lossy().to_string();

    app.emit_all("directory-created", path_str.clone()).unwrap();

    Ok(path_str)

}


