//! # Project Manager
//!
//! Defines the `Project` model and handles project creation.
//! A project is a named directory containing LaTeX files managed by Moonstone.

use serde::{
    Deserialize, 
    Serialize
};
use std::path::{
    Path,
};
use tauri::{
    AppHandle,
};
use chrono::{
    DateTime,
    Local
};
use tokio::fs;
use crate::file_manager;



/// Represents a Moonstone project — a directory of LaTeX files
/// with associated metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Project {
    name: String,
    path: String,
    creation_date: DateTime<Local>,
    last_modification_date: DateTime<Local>,
    amount_of_files: i32,
}

impl Project {
    /// Creates a new project directory and an initial `.tex` file inside it.
    ///
    /// The directory is created at `path/name`. Both timestamps are set
    /// to the current local time and `amount_of_files` starts at 1.
    ///
    /// # Errors
    ///
    /// Returns an error if the name is empty, the directory already exists,
    /// or file/directory creation fails.
    pub async fn new<R:tauri::Runtime>
        (app: AppHandle<R>, name: String, path: String) 
        -> Result<Project, String> {
        if name.is_empty() {
            return Err("Projects must have a name that isn't empty".to_string());
        }

        let creation_date = Local::now();
        let last_modification_date = Local::now();
        let full_path = Path::new(&path).join(&name);

        if full_path.exists() {
            return Err(format!("Project {} already exists", name));
        }

        fs::create_dir_all(&full_path)
            .await.map_err(|e| e.to_string())?;

        //The start file should be a latex file.
        file_manager::create_file(&app, full_path.to_string_lossy().to_string(), name.clone(), "tex".to_string()).await?;

        Ok(Project {
            name,
            path,
            creation_date,
            last_modification_date,
            amount_of_files: 1, // Projects start with an initial file
        })
    }

    /// Returns the project name.
    pub fn get_name(&self) -> &str {
        &self.name
    }

    /// Returns the parent path where the project directory lives.
    pub fn get_path(&self) -> &str {
        &self.path
    }

    /// Returns when the project was created.
    pub fn get_creation_date(&self) -> DateTime<Local> {
        self.creation_date
    }

    /// Returns when the project was last modified.
    pub fn get_last_modification_date(&self) -> DateTime<Local> {
        self.last_modification_date
    }

    /// Returns the current file count.
    pub fn get_amount_of_files(&self) -> i32 {
        self.amount_of_files
    }

    /// Overwrites the file count with `new_amount`.
    pub fn set_amount_of_files(&mut self, new_amount: i32) {
        self.amount_of_files = new_amount;
    }

    /// Increments the file count by one.
    pub fn increment_amount_of_files(&mut self) {
        self.amount_of_files += 1;
    }
}


#[cfg(test)]
mod project_manager_tests {
    use super::*;
    use tempfile::tempdir;

    // Helper to build a Project without going through ::new,
    // useful for testing getters/setters in isolation.
    fn make_test_project() -> Project {
        Project {
            name: "test_project".to_string(),
            path: "/tmp".to_string(),
            creation_date: Local::now(),
            last_modification_date: Local::now(),
            amount_of_files: 1,
        }
    }

    // --- Project::new tests ---

    #[tokio::test]
    async fn test_new_rejects_empty_name() {
        let app = tauri::test::mock_app();
        let handle = app.handle().clone();
        let dir = tempdir().unwrap();
        let dir_path = dir.path().to_string_lossy().to_string();

        let result = Project::new(handle, "".to_string(), dir_path).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Projects must have a name that isn't empty");
    }

    #[tokio::test]
    async fn test_new_creates_project_directory() {
        let app = tauri::test::mock_app();
        let handle = app.handle().clone();
        let dir = tempdir().unwrap();
        let dir_path = dir.path().to_string_lossy().to_string();

        let result = Project::new(handle, "my_project".to_string(), dir_path.clone()).await;
        assert!(result.is_ok());

        let project = result.unwrap();
        let expected_dir = Path::new(&dir_path).join("my_project");
        assert!(expected_dir.exists());
    }

    #[tokio::test]
    async fn test_new_creates_initial_tex_file() {
        let app = tauri::test::mock_app();
        let handle = app.handle().clone();
        let dir = tempdir().unwrap();
        let dir_path = dir.path().to_string_lossy().to_string();

        let project = Project::new(handle, "my_project".to_string(), dir_path.clone()).await.unwrap();

        let tex_file = Path::new(&dir_path).join("my_project").join("my_project.tex");
        assert!(tex_file.exists());
        assert_eq!(project.get_amount_of_files(), 1);
    }

    #[tokio::test]
    async fn test_new_rejects_duplicate_project() {
        let app = tauri::test::mock_app();
        let dir = tempdir().unwrap();
        let dir_path = dir.path().to_string_lossy().to_string();

        // Create first project
        let handle1 = app.handle().clone();
        Project::new(handle1, "duplicate".to_string(), dir_path.clone()).await.unwrap();

        // Attempt duplicate
        let handle2 = app.handle().clone();
        let result = Project::new(handle2, "duplicate".to_string(), dir_path).await;
        assert!(result.is_err());
    }

    // --- Getter tests ---

    #[test]
    fn test_get_name() {
        let project = make_test_project();
        assert_eq!(project.get_name(), "test_project");
    }

    #[test]
    fn test_get_path() {
        let project = make_test_project();
        assert_eq!(project.get_path(), "/tmp");
    }

    #[test]
    fn test_get_amount_of_files() {
        let project = make_test_project();
        assert_eq!(project.get_amount_of_files(), 1);
    }

    // --- Setter tests ---

    #[test]
    fn test_set_amount_of_files() {
        let mut project = make_test_project();
        project.set_amount_of_files(5);
        assert_eq!(project.get_amount_of_files(), 5);
    }

    #[test]
    fn test_increment_amount_of_files() {
        let mut project = make_test_project();
        assert_eq!(project.get_amount_of_files(), 1);
        project.increment_amount_of_files();
        assert_eq!(project.get_amount_of_files(), 2);
    }
}