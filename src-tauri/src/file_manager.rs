//! # File Manager
//!
//! Manages the creation of files and directories within Moonstone.
//! Provides Tauri commands for file creation and directory creation.

use tokio::fs;
use tauri::{
    AppHandle, 
    Emitter
};

/// Creates an empty file in the specified parent directory.
///
/// The file is created with no content. 
///
/// # Errors
///
/// Returns an error if the file name is empty, the file already exists, 
/// invalid extension or the I/O operation fails.
#[tauri::command]
pub async fn create_file<R:tauri:: Runtime>(
    app: &AppHandle<R>, parent_directory: String, file_name: String, file_extension: String) 
    -> Result<String, String> {
    // Blocks empty file names.
    if file_name.is_empty() {
        return Err("File name can't be empty".to_string());
    }

    if !validate_extension(&file_extension) {

        return Err(format!("The extension {} isn't valid", file_extension));

    }

    let full_file = format!("{}.{}", file_name, file_extension);

    let full_path = std::path::Path::new(&parent_directory).join(&full_file);

    // Returns an error if the file already exists.
    if full_path.exists() {
        return Err(format!("File {} already exists", file_name));
    }

    fs::write(&full_path, "")
        .await.map_err(|e| e.to_string())?;

    let path_str = full_path.to_string_lossy().to_string();


    Ok(path_str)
}

/// Creates a directory (including any intermediate parents) in the
/// specified parent directory.
///
/// Emits a `directory-created` event globally on success with the
/// full path as the payload.
///
/// # Errors
///
/// Returns an error if the directory name is empty, the directory
/// already exists, or the I/O operation fails.
#[tauri::command]
pub async fn create_directory<R:tauri:: Runtime>(
    app: &AppHandle<R>, parent_directory: String, dir_name: String) 
    -> Result<String, String> {
    if dir_name.is_empty() {
        return Err("Directory cannot be empty".to_string());
    }

    let full_path = std::path::Path::new(&parent_directory).join(&dir_name);

    if full_path.exists() {
        return Err(format!("Directory {} already exists", dir_name));
    }

    fs::create_dir_all(&full_path)
        .await.map_err(|e| e.to_string())?;

    let path_str = full_path.to_string_lossy().to_string();

    app.emit("directory-created", path_str.clone()).map_err(|e| e.to_string())?;

    Ok(path_str)
}


/// Validates whether a file extension is recognized by Moonstone.
///
/// # Returns
///
/// `true` if the extension is valid, `false` otherwise.
fn validate_extension(extension: &str) -> bool {

    // For now it'll just be tex, but if other files are
    // are allowed later down the line extension will be easier.
    matches!(extension, "tex" )
}




#[cfg(test)]
mod file_manager_tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_validate_extension() {
        assert!(validate_extension("tex"));
        assert!(!validate_extension("pdf"));
    }

    #[tokio::test]
    async fn test_creat_file() {
        let app = tauri::test::mock_app();
        let handle = app.handle();

        let dir = tempdir().unwrap();
        let dir_path = dir.path().to_string_lossy().to_string();

        let result = create_file(handle, dir_path, "test_file".to_string(), "tex".to_string()).await;
        assert!(result.is_ok());
    }


    #[tokio::test]
    async fn test_create_directory_success() {
        let app = tauri::test::mock_app();
        let handle = app.handle();
        let dir = tempdir().unwrap();
        let dir_path = dir.path().to_string_lossy().to_string();

        let result = create_directory(handle, dir_path, "test_folder".to_string()).await;
        assert!(result.is_ok());
    }


}