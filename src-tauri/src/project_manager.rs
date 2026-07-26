//! # Project Manager
//!
//! Defines the `Project` model and the Tauri commands for listing and
//! creating projects. A project is a directory directly under the
//! Moonstone root (`~/Documents/Moonstone`) containing LaTeX files.

use serde::{
    Deserialize,
    Serialize,
};
use std::path::Path;
use tauri::{
    AppHandle,
    Runtime,
};
use chrono::{
    DateTime,
    Local,
};
use tokio::fs;
use crate::paths;
use crate::templates::{
    self,
    ProjectTemplate,
};

/// Metadata for one project directory, shaped for the frontend's
/// project browser grid.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    /// Directory name of the project.
    pub name: String,
    /// Absolute path of the project directory.
    pub path: String,
    /// Last filesystem modification time, RFC3339 formatted.
    pub last_modified: String,
    /// Number of entries directly inside the project directory.
    pub file_count: u32,
}

/// Represents a Moonstone project — a directory of LaTeX files
/// with associated metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    name: String,
    path: String,
    creation_date: DateTime<Local>,
    last_modification_date: DateTime<Local>,
    amount_of_files: i32,
}

/// Lists every project directory under the Moonstone root.
///
/// # Returns
///
/// One [`ProjectInfo`] per directory, sorted alphabetically by name.
/// Non-directory entries in the root are ignored.
///
/// # Errors
///
/// Returns an error if the root cannot be resolved or read.
#[tauri::command]
pub async fn list_projects<R: Runtime>(app: AppHandle<R>) -> Result<Vec<ProjectInfo>, String> {
    let root = paths::moonstone_root(&app)?;

    list_projects_impl(&root)
}

/// Creates a new project directory under the Moonstone root, seeded
/// from a template.
///
/// # Parameters
///
/// * `name` - Name of the new project directory.
/// * `template_id` - Identifier of the template to seed from, as listed
///   by `list_templates`.
///
/// # Returns
///
/// The [`ProjectInfo`] of the freshly created project.
///
/// # Errors
///
/// Returns an error if the name is invalid, the template is unknown,
/// the project already exists, or directory/file creation fails.
#[tauri::command]
pub async fn create_project<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    template_id: String,
) -> Result<ProjectInfo, String> {
    let root = paths::moonstone_root(&app)?;

    create_project_impl(&root, &name, &template_id).await
}

/// Deletes a whole project directory, sending it to the system
/// recycle bin so mistakes are recoverable.
///
/// # Parameters
///
/// * `project_path` - Path of the project directory (directly under
///   the Moonstone root).
///
/// # Returns
///
/// `Ok(())` on success.
///
/// # Errors
///
/// Returns an error if the path escapes the Moonstone root, is not a
/// project directory, or the deletion fails.
#[tauri::command]
pub async fn delete_project<R: Runtime>(
    app: AppHandle<R>,
    project_path: String,
) -> Result<(), String> {
    let root = paths::moonstone_root(&app)?;
    let project = paths::ensure_within_root(&root, Path::new(&project_path))?;

    ensure_is_project(&root, &project)?;

    trash::delete(&project).map_err(|e| e.to_string())
}

/// Renames a project directory, keeping its main file in step.
///
/// A project's main file is `<project>.tex` by convention — that is
/// what the project page auto-opens — so renaming the directory alone
/// would quietly break it. The file is renamed alongside when it
/// exists; a project whose main file is named otherwise is left as is.
///
/// # Parameters
///
/// * `project_path` - Path of the project directory to rename.
/// * `new_name` - The new project name.
///
/// # Returns
///
/// The full path of the renamed project directory.
///
/// # Errors
///
/// Returns an error if the path escapes the Moonstone root, is not a
/// project directory, the name is invalid, a project of that name
/// already exists, or the rename fails.
#[tauri::command]
pub async fn rename_project<R: Runtime>(
    app: AppHandle<R>,
    project_path: String,
    new_name: String,
) -> Result<String, String> {
    let root = paths::moonstone_root(&app)?;
    let project = paths::ensure_within_root(&root, Path::new(&project_path))?;

    ensure_is_project(&root, &project)?;

    rename_project_impl(&project, &new_name).await
}

/// Renames a project directory and its matching main file.
///
/// # Parameters
///
/// * `project` - The project directory (already validated).
/// * `new_name` - The new project name.
///
/// # Returns
///
/// The full path of the renamed directory.
///
/// # Errors
///
/// Returns an error if the name is invalid, the target already
/// exists, or a rename fails.
pub async fn rename_project_impl(project: &Path, new_name: &str) -> Result<String, String> {
    paths::validate_name(new_name)?;

    let old_name = project
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .ok_or_else(|| "The project has no name".to_string())?;

    if old_name == new_name {
        return Ok(project.to_string_lossy().to_string());
    }

    let parent = project
        .parent()
        .ok_or_else(|| "The project has no parent directory".to_string())?;
    let target = parent.join(new_name);

    if target.exists() {
        return Err(format!("Project {} already exists", new_name));
    }

    // The main file is renamed first: if the directory moved first and
    // this failed, the project would be left renamed but broken, which
    // is harder to recover from than not having renamed at all.
    let main_file = project.join(format!("{}.tex", old_name));
    if main_file.is_file() {
        fs::rename(&main_file, project.join(format!("{}.tex", new_name)))
            .await
            .map_err(|e| format!("Could not rename the main file: {}", e))?;
    }

    fs::rename(project, &target)
        .await
        .map_err(|e| e.to_string())?;

    Ok(target.to_string_lossy().to_string())
}

/// Errors unless `candidate` is a project directory: a directory
/// sitting directly under the Moonstone root.
///
/// # Parameters
///
/// * `root` - The Moonstone root directory.
/// * `candidate` - The path to check (canonical).
///
/// # Returns
///
/// `Ok(())` when the candidate is a deletable project directory.
///
/// # Errors
///
/// Returns an error for the root itself, nested entries, or files.
pub fn ensure_is_project(root: &Path, candidate: &Path) -> Result<(), String> {
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;

    if candidate.parent() != Some(canonical_root.as_path()) {
        return Err("Only project directories can be deleted here".to_string());
    }

    if !candidate.is_dir() {
        return Err("Projects are directories".to_string());
    }

    Ok(())
}

/// Builds the project list for a given root directory.
///
/// # Parameters
///
/// * `root` - The Moonstone root directory to scan.
///
/// # Returns
///
/// One [`ProjectInfo`] per subdirectory, sorted by name.
///
/// # Errors
///
/// Returns an error if reading the root directory fails.
pub fn list_projects_impl(root: &Path) -> Result<Vec<ProjectInfo>, String> {
    let entries = std::fs::read_dir(root).map_err(|e| e.to_string())?;

    let mut projects: Vec<ProjectInfo> = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if !path.is_dir() {
            continue;
        }

        projects.push(build_project_info(&path)?);
    }

    projects.sort_by_key(|project| project.name.to_lowercase());

    Ok(projects)
}

/// Creates a project directory from a template and returns its
/// metadata.
///
/// # Parameters
///
/// * `root` - The Moonstone root directory.
/// * `name` - Name of the new project.
/// * `template_id` - Identifier of the template to seed from.
///
/// # Returns
///
/// The [`ProjectInfo`] of the created project.
///
/// # Errors
///
/// Returns an error if the name is invalid, the template is unknown, or
/// creation fails.
pub async fn create_project_impl(
    root: &Path,
    name: &str,
    template_id: &str,
) -> Result<ProjectInfo, String> {
    paths::validate_name(name)?;

    // Resolved before anything is written, so an unknown template can
    // not leave a half-created project behind.
    let template = templates::find_template(template_id)?;

    Project::new(name.to_string(), root.to_string_lossy().to_string(), template).await?;

    build_project_info(&root.join(name))
}

/// Reads project metadata (mtime, entry count) from a directory.
///
/// # Parameters
///
/// * `project_dir` - The project directory to describe.
///
/// # Returns
///
/// The populated [`ProjectInfo`].
///
/// # Errors
///
/// Returns an error if filesystem metadata cannot be read.
fn build_project_info(project_dir: &Path) -> Result<ProjectInfo, String> {
    let name = project_dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| project_dir.display().to_string());

    let metadata = std::fs::metadata(project_dir).map_err(|e| e.to_string())?;

    let last_modified = metadata
        .modified()
        .map(|time| DateTime::<Local>::from(time).to_rfc3339())
        .unwrap_or_default();

    let file_count = std::fs::read_dir(project_dir)
        .map_err(|e| e.to_string())?
        .count() as u32;

    Ok(ProjectInfo {
        name,
        path: project_dir.to_string_lossy().to_string(),
        last_modified,
        file_count,
    })
}

// The accessors are exercised by tests and kept as the Project model's
// public surface for upcoming features (rename, file counting).
#[allow(dead_code)]
impl Project {
    /// Creates a new project directory and seeds it from a template.
    ///
    /// The directory is created at `path/name`. Both timestamps are set
    /// to the current local time and `amount_of_files` reflects the
    /// template's file count.
    ///
    /// # Parameters
    ///
    /// * `name` - Name of the project directory.
    /// * `path` - Parent directory the project is created in.
    /// * `template` - Template whose files seed the project.
    ///
    /// # Returns
    ///
    /// The freshly constructed [`Project`].
    ///
    /// # Errors
    ///
    /// Returns an error if the name is empty, the directory already exists,
    /// or file/directory creation fails.
    pub async fn new(
        name: String,
        path: String,
        template: &ProjectTemplate,
    ) -> Result<Project, String> {
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
            .await
            .map_err(|e| e.to_string())?;

        templates::seed_project(&full_path, &name, template).await?;

        Ok(Project {
            name,
            path,
            creation_date,
            last_modification_date,
            amount_of_files: template.files.len() as i32,
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
mod rename_project_tests {
    use super::*;
    use tempfile::tempdir;

    /// Creates a project directory with its conventional main file.
    ///
    /// # Parameters
    ///
    /// * `root` - Directory to create the project in.
    /// * `name` - Project name.
    ///
    /// # Returns
    ///
    /// The project directory's path.
    async fn seed_project(root: &Path, name: &str) -> std::path::PathBuf {
        let project = root.join(name);
        fs::create_dir_all(&project).await.unwrap();
        fs::write(project.join(format!("{}.tex", name)), "body")
            .await
            .unwrap();
        project
    }

    #[tokio::test]
    async fn test_rename_project_renames_directory_and_main_file() {
        let dir = tempdir().unwrap();
        let project = seed_project(dir.path(), "old").await;

        let renamed = rename_project_impl(&project, "new").await.unwrap();

        assert!(!project.exists());
        assert!(Path::new(&renamed).join("new.tex").exists());
        // The old main file must not survive under its old name.
        assert!(!Path::new(&renamed).join("old.tex").exists());
    }

    #[tokio::test]
    async fn test_rename_project_keeps_other_files() {
        let dir = tempdir().unwrap();
        let project = seed_project(dir.path(), "old").await;
        fs::write(project.join("refs.bib"), "@book{a}").await.unwrap();

        let renamed = rename_project_impl(&project, "new").await.unwrap();

        assert!(Path::new(&renamed).join("refs.bib").exists());
    }

    #[tokio::test]
    async fn test_rename_project_without_a_matching_main_file() {
        let dir = tempdir().unwrap();
        let project = dir.path().join("old");
        fs::create_dir_all(&project).await.unwrap();
        fs::write(project.join("paper.tex"), "body").await.unwrap();

        let renamed = rename_project_impl(&project, "new").await.unwrap();

        assert!(Path::new(&renamed).join("paper.tex").exists());
    }

    #[tokio::test]
    async fn test_rename_project_refuses_an_existing_name() {
        let dir = tempdir().unwrap();
        let project = seed_project(dir.path(), "old").await;
        seed_project(dir.path(), "taken").await;

        assert!(rename_project_impl(&project, "taken").await.is_err());
        // The failed rename must leave the project untouched.
        assert!(project.join("old.tex").exists());
    }

    #[tokio::test]
    async fn test_rename_project_rejects_an_invalid_name() {
        let dir = tempdir().unwrap();
        let project = seed_project(dir.path(), "old").await;

        assert!(rename_project_impl(&project, "a/b").await.is_err());
        assert!(rename_project_impl(&project, "CON").await.is_err());
        assert!(rename_project_impl(&project, "  ").await.is_err());
    }

    #[tokio::test]
    async fn test_rename_project_to_the_same_name_is_a_no_op() {
        let dir = tempdir().unwrap();
        let project = seed_project(dir.path(), "same").await;

        let renamed = rename_project_impl(&project, "same").await.unwrap();

        assert_eq!(renamed, project.to_string_lossy());
        assert!(project.join("same.tex").exists());
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

    /// The simplest template, for tests about project creation itself
    /// rather than about template contents.
    ///
    /// # Returns
    ///
    /// The blank template.
    fn blank_template() -> &'static ProjectTemplate {
        templates::find_template("blank").unwrap()
    }

    #[tokio::test]
    async fn test_new_rejects_empty_name() {
        let dir = tempdir().unwrap();
        let dir_path = dir.path().to_string_lossy().to_string();

        let result = Project::new("".to_string(), dir_path, blank_template()).await;
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Projects must have a name that isn't empty");
    }

    #[tokio::test]
    async fn test_new_creates_project_directory() {
        let dir = tempdir().unwrap();
        let dir_path = dir.path().to_string_lossy().to_string();

        let result = Project::new("my_project".to_string(), dir_path.clone(), blank_template()).await;
        assert!(result.is_ok());

        let expected_dir = Path::new(&dir_path).join("my_project");
        assert!(expected_dir.exists());
    }

    #[tokio::test]
    async fn test_new_creates_initial_tex_file() {
        let dir = tempdir().unwrap();
        let dir_path = dir.path().to_string_lossy().to_string();

        let project = Project::new("my_project".to_string(), dir_path.clone(), blank_template())
            .await
            .unwrap();

        let tex_file = Path::new(&dir_path).join("my_project").join("my_project.tex");
        assert!(tex_file.exists());
        assert_eq!(project.get_amount_of_files(), 1);
    }

    #[tokio::test]
    async fn test_new_counts_the_files_a_template_lays_down() {
        let dir = tempdir().unwrap();
        let dir_path = dir.path().to_string_lossy().to_string();
        let template = templates::find_template("thesis").unwrap();

        let project = Project::new("my_thesis".to_string(), dir_path, template)
            .await
            .unwrap();

        assert_eq!(project.get_amount_of_files(), template.files.len() as i32);
    }

    #[tokio::test]
    async fn test_new_rejects_duplicate_project() {
        let dir = tempdir().unwrap();
        let dir_path = dir.path().to_string_lossy().to_string();

        Project::new("duplicate".to_string(), dir_path.clone(), blank_template())
            .await
            .unwrap();

        let result = Project::new("duplicate".to_string(), dir_path, blank_template()).await;
        assert!(result.is_err());
    }

    // --- Command impl tests ---

    #[tokio::test]
    async fn test_list_projects_empty_root() {
        let dir = tempdir().unwrap();

        let projects = list_projects_impl(dir.path()).unwrap();
        assert!(projects.is_empty());
    }

    #[tokio::test]
    async fn test_list_projects_returns_sorted_directories_only() {
        let dir = tempdir().unwrap();

        std::fs::create_dir(dir.path().join("zeta")).unwrap();
        std::fs::create_dir(dir.path().join("alpha")).unwrap();
        std::fs::write(dir.path().join("stray.txt"), "").unwrap();

        let projects = list_projects_impl(dir.path()).unwrap();

        assert_eq!(projects.len(), 2);
        assert_eq!(projects[0].name, "alpha");
        assert_eq!(projects[1].name, "zeta");
    }

    #[tokio::test]
    async fn test_create_project_impl_seeds_tex_file() {
        let dir = tempdir().unwrap();

        let info = create_project_impl(dir.path(), "thesis", "blank").await.unwrap();

        assert_eq!(info.name, "thesis");
        assert_eq!(info.file_count, 1);
        assert!(dir.path().join("thesis").join("thesis.tex").exists());
    }

    #[tokio::test]
    async fn test_create_project_seeds_template_with_project_name() {
        let dir = tempdir().unwrap();

        create_project_impl(dir.path(), "thesis", "blank").await.unwrap();

        let contents =
            std::fs::read_to_string(dir.path().join("thesis").join("thesis.tex")).unwrap();
        assert!(contents.contains("\\documentclass{article}"));
        assert!(contents.contains("\\title{thesis}"));
        assert!(contents.contains("\\begin{document}"));
        assert!(contents.contains("\\end{document}"));
    }

    #[tokio::test]
    async fn test_create_project_impl_lays_down_a_multi_file_template() {
        let dir = tempdir().unwrap();

        let info = create_project_impl(dir.path(), "my_thesis", "thesis").await.unwrap();

        let project = dir.path().join("my_thesis");
        assert!(project.join("my_thesis.tex").exists());
        assert!(project.join("chapters").join("introduction.tex").exists());
        assert!(project.join("references.bib").exists());
        // Entries directly inside the project: main file, bibliography
        // and the chapters directory.
        assert_eq!(info.file_count, 3);
    }

    #[tokio::test]
    async fn test_create_project_impl_rejects_an_unknown_template() {
        let dir = tempdir().unwrap();

        assert!(create_project_impl(dir.path(), "doomed", "nonexistent").await.is_err());
        // The template is resolved first, so nothing is left behind.
        assert!(!dir.path().join("doomed").exists());
    }

    #[tokio::test]
    async fn test_create_project_impl_rejects_bad_name() {
        let dir = tempdir().unwrap();

        assert!(create_project_impl(dir.path(), "bad/name", "blank").await.is_err());
        assert!(create_project_impl(dir.path(), "", "blank").await.is_err());
    }

    #[test]
    fn test_ensure_is_project_accepts_direct_child_directory() {
        let root = tempdir().unwrap();
        let project = root.path().join("thesis");
        std::fs::create_dir(&project).unwrap();

        let canonical_project = project.canonicalize().unwrap();
        assert!(ensure_is_project(root.path(), &canonical_project).is_ok());
    }

    #[test]
    fn test_ensure_is_project_rejects_root_nested_and_files() {
        let root = tempdir().unwrap();
        let project = root.path().join("thesis");
        let nested = project.join("chapters");
        let stray_file = root.path().join("stray.txt");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(&stray_file, "").unwrap();

        let canonical_root = root.path().canonicalize().unwrap();
        let canonical_nested = nested.canonicalize().unwrap();
        let canonical_file = stray_file.canonicalize().unwrap();

        assert!(ensure_is_project(root.path(), &canonical_root).is_err());
        assert!(ensure_is_project(root.path(), &canonical_nested).is_err());
        assert!(ensure_is_project(root.path(), &canonical_file).is_err());
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
