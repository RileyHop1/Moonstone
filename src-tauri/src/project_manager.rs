use serde::{
    Deserialize, 
    Serialize
};
use std::path::{
    Path,
    PathBuf
};
use tauri::{
    AppHandle,
    Manager
};
use chrono::{
    DateTime,
    Local
};
use tokio::fs;

mod file_manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Project {
    name: String,
    path: String,
    creation_date: DateTime<Local>,
    last_modification_date: DateTime<Local>,
    amount_of_files: i32,

    

}


impl Project {

    pub async fn new(app:AppHandle, name: String, path: String) 
        -> Result<Project,String> {

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


        file_manager::create_file(&app, &full_path, name).await?;
        
        Ok(Project {
            name,
            path,
            creation_date,
            last_modification_date,
            amount_of_files: 1, //We start projects with a inital file
        })


    }

    pub fn get_name(&self) -> String {
        &self.name
    }

    pub fn get_path(&self) -> String {
        &self.path
    }

    pub fn get_creation_date(&self) -> DateTime {
        self.creation_date
    }

    pub fn get_last_modification_date(&self) -> DateTime {
        self.last_modification_date
    }

    pub fn get_amount_of_files(&self) -> i32 {
        return self.amount_of_files
    }

    pub fn set_amount_of_files(&self, new_amount: i32) {
        self.amount_of_files = new_amount;
    }

    //This is generally whats probably going to be used
    pub fn amount_of_files_by_one(&self) {
        self.amount_of_files += 1;
    }
}

