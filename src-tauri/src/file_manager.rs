//! # File Manager
//!
//! Manages files and directories within Moonstone projects.
//!
//! Every Tauri command in this module validates user-supplied paths
//! against the Moonstone root (see [`crate::paths`]) and delegates the
//! real work to a pure `_impl` function so the logic is unit-testable
//! against temporary directories.

use serde::Serialize;
use std::path::Path;
use tokio::fs;
use tauri::{
    AppHandle,
    Emitter,
    Runtime,
};

use crate::paths;

/// Maximum directory depth walked by [`list_project_files`], guarding
/// against symlink cycles and runaway nesting.
const MAX_TREE_DEPTH: u32 = 32;

/// One node of a project's file tree.
///
/// Serialized with a `kind` tag so the frontend receives a
/// discriminated union (`{ kind: "directory" | "file", ... }`).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileNode {
    /// A directory and its (recursively listed) children.
    #[serde(rename_all = "camelCase")]
    Directory {
        name: String,
        path: String,
        children: Vec<FileNode>,
    },
    /// A regular file.
    #[serde(rename_all = "camelCase")]
    File { name: String, path: String },
}

/// Creates an empty file in the specified parent directory.
///
/// # Parameters
///
/// * `parent_directory` - Directory (inside the Moonstone root) to create the file in.
/// * `file_name` - Bare file name without extension.
/// * `file_extension` - Extension without the dot (only `tex` is accepted).
///
/// # Returns
///
/// The full path of the created file.
///
/// # Errors
///
/// Returns an error if the name/extension is invalid, the path escapes
/// the Moonstone root, the file already exists, or the write fails.
#[tauri::command]
pub async fn create_file<R: Runtime>(
    app: AppHandle<R>,
    parent_directory: String,
    file_name: String,
    file_extension: String,
) -> Result<String, String> {
    let root = paths::moonstone_root(&app)?;
    let parent = paths::ensure_within_root(&root, Path::new(&parent_directory))?;

    create_file_impl(&parent, &file_name, &file_extension).await
}

/// Creates a directory (including intermediate parents) in the
/// specified parent directory.
///
/// Emits a `directory-created` event globally on success with the
/// full path as the payload.
///
/// # Parameters
///
/// * `parent_directory` - Directory (inside the Moonstone root) to create the directory in.
/// * `dir_name` - Name of the new directory.
///
/// # Returns
///
/// The full path of the created directory.
///
/// # Errors
///
/// Returns an error if the name is invalid, the path escapes the
/// Moonstone root, the directory already exists, or creation fails.
#[tauri::command]
pub async fn create_directory<R: Runtime>(
    app: AppHandle<R>,
    parent_directory: String,
    dir_name: String,
) -> Result<String, String> {
    let root = paths::moonstone_root(&app)?;
    let parent = paths::ensure_within_root(&root, Path::new(&parent_directory))?;

    let path_str = create_directory_impl(&parent, &dir_name).await?;

    app.emit("directory-created", path_str.clone())
        .map_err(|e| e.to_string())?;

    Ok(path_str)
}

/// Lists the full file tree of a project directory.
///
/// # Parameters
///
/// * `project_path` - Path of the project directory (inside the Moonstone root).
///
/// # Returns
///
/// The root [`FileNode::Directory`] of the project, with directories
/// sorted before files and both sorted alphabetically.
///
/// # Errors
///
/// Returns an error if the path escapes the Moonstone root, is not a
/// directory, or reading any directory fails.
#[tauri::command]
pub async fn list_project_files<R: Runtime>(
    app: AppHandle<R>,
    project_path: String,
) -> Result<FileNode, String> {
    let root = paths::moonstone_root(&app)?;
    let project = paths::ensure_within_root(&root, Path::new(&project_path))?;

    list_project_files_impl(&project)
}

/// Reads the contents of a `.tex` file.
///
/// # Parameters
///
/// * `file_path` - Path of the file (inside the Moonstone root).
///
/// # Returns
///
/// The file contents as a UTF-8 string.
///
/// # Errors
///
/// Returns an error if the path escapes the Moonstone root, is not a
/// `.tex` file, or reading fails.
#[tauri::command]
pub async fn read_file<R: Runtime>(
    app: AppHandle<R>,
    file_path: String,
) -> Result<String, String> {
    let root = paths::moonstone_root(&app)?;
    let file = paths::ensure_within_root(&root, Path::new(&file_path))?;

    read_file_impl(&file).await
}

/// Overwrites a `.tex` file with new contents.
///
/// # Parameters
///
/// * `file_path` - Path of the file (inside the Moonstone root).
/// * `contents` - Full new contents of the file.
///
/// # Returns
///
/// `Ok(())` on a successful write.
///
/// # Errors
///
/// Returns an error if the path escapes the Moonstone root, is not a
/// `.tex` file, or writing fails.
#[tauri::command]
pub async fn save_file<R: Runtime>(
    app: AppHandle<R>,
    file_path: String,
    contents: String,
) -> Result<(), String> {
    let root = paths::moonstone_root(&app)?;
    let file = paths::ensure_within_root(&root, Path::new(&file_path))?;

    save_file_impl(&file, &contents).await
}

/// Creates an empty file named `file_name.file_extension` in `parent`.
///
/// # Parameters
///
/// * `parent` - Directory the file is created in.
/// * `file_name` - Bare file name without extension.
/// * `file_extension` - Extension without the dot.
///
/// # Returns
///
/// The full path of the created file.
///
/// # Errors
///
/// Returns an error if the name/extension is invalid, the file already
/// exists, or the write fails.
pub async fn create_file_impl(
    parent: &Path,
    file_name: &str,
    file_extension: &str,
) -> Result<String, String> {
    create_file_with_contents_impl(parent, file_name, file_extension, "").await
}

/// Creates a file named `file_name.file_extension` in `parent`, seeded
/// with `contents`.
///
/// # Parameters
///
/// * `parent` - Directory the file is created in.
/// * `file_name` - Bare file name without extension.
/// * `file_extension` - Extension without the dot.
/// * `contents` - Initial contents of the file.
///
/// # Returns
///
/// The full path of the created file.
///
/// # Errors
///
/// Returns an error if the name/extension is invalid, the file already
/// exists, or the write fails.
pub async fn create_file_with_contents_impl(
    parent: &Path,
    file_name: &str,
    file_extension: &str,
    contents: &str,
) -> Result<String, String> {
    paths::validate_name(file_name)?;

    if !validate_extension(file_extension) {
        return Err(format!("The extension {} isn't valid", file_extension));
    }

    let full_path = parent.join(format!("{}.{}", file_name, file_extension));

    // Refuse to clobber an existing file - creation is not overwriting.
    if full_path.exists() {
        return Err(format!("File {} already exists", file_name));
    }

    fs::write(&full_path, contents)
        .await
        .map_err(|e| e.to_string())?;

    Ok(full_path.to_string_lossy().to_string())
}

/// Renames a file or directory inside the Moonstone root.
///
/// A file being renamed without a dot in the new name keeps its
/// original extension; the final extension of a file must stay `.tex`
/// so the app can still open it.
///
/// # Parameters
///
/// * `path` - Current path of the entry (inside the Moonstone root).
/// * `new_name` - The new bare name.
///
/// # Returns
///
/// The full path of the renamed entry.
///
/// # Errors
///
/// Returns an error if the name is invalid, the path escapes the
/// Moonstone root, the target exists, or the rename fails.
#[tauri::command]
pub async fn rename_entry<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    new_name: String,
) -> Result<String, String> {
    let root = paths::moonstone_root(&app)?;
    let entry = paths::ensure_within_root(&root, Path::new(&path))?;

    rename_entry_impl(&entry, &new_name)
}

/// Deletes a file or directory inside a project, sending it to the
/// system recycle bin so mistakes are recoverable.
///
/// # Parameters
///
/// * `path` - Path of the entry to delete (inside the Moonstone root).
///
/// # Returns
///
/// `Ok(())` on success.
///
/// # Errors
///
/// Returns an error if the path escapes the Moonstone root, is a
/// project directory itself, or the deletion fails.
#[tauri::command]
pub async fn delete_entry<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    let root = paths::moonstone_root(&app)?;
    let entry = paths::ensure_within_root(&root, Path::new(&path))?;

    ensure_deletable(&root, &entry)?;

    trash::delete(&entry).map_err(|e| e.to_string())
}

/// Renames `entry` to `new_name` within its parent directory.
///
/// # Parameters
///
/// * `entry` - The existing file or directory.
/// * `new_name` - The new bare name.
///
/// # Returns
///
/// The full path of the renamed entry.
///
/// # Errors
///
/// Returns an error if the name is invalid, the target already
/// exists, or the filesystem rename fails.
pub fn rename_entry_impl(entry: &Path, new_name: &str) -> Result<String, String> {
    paths::validate_name(new_name)?;

    let parent = entry
        .parent()
        .ok_or_else(|| "Entry has no parent directory".to_string())?;

    let final_name = resolve_renamed_file_name(entry, new_name)?;
    let target = parent.join(&final_name);

    if target.exists() {
        return Err(format!("{} already exists", final_name));
    }

    std::fs::rename(entry, &target).map_err(|e| e.to_string())?;

    Ok(target.to_string_lossy().to_string())
}

/// Computes the final name for a rename: directories keep the name as
/// given; files without a dot keep their original extension, and a
/// file's final extension must remain valid.
///
/// # Parameters
///
/// * `entry` - The entry being renamed.
/// * `new_name` - The user-supplied new name.
///
/// # Returns
///
/// The name the entry should end up with.
///
/// # Errors
///
/// Returns an error if a file would end up with an invalid extension.
fn resolve_renamed_file_name(entry: &Path, new_name: &str) -> Result<String, String> {
    if entry.is_dir() {
        return Ok(new_name.to_string());
    }

    // Keep the original extension when the user typed a bare name.
    let final_name = if new_name.contains('.') {
        new_name.to_string()
    } else {
        match entry.extension() {
            Some(extension) => format!("{}.{}", new_name, extension.to_string_lossy()),
            None => new_name.to_string(),
        }
    };

    let has_valid_extension = Path::new(&final_name)
        .extension()
        .map(|ext| validate_extension(&ext.to_string_lossy()))
        .unwrap_or(false);

    if !has_valid_extension {
        return Err("Files must keep a .tex extension".to_string());
    }

    Ok(final_name)
}

/// Errors when `entry` must not be deleted: entries directly under the
/// Moonstone root are whole projects, which this command does not
/// manage.
///
/// # Parameters
///
/// * `root` - The Moonstone root directory (canonical).
/// * `entry` - The entry to check (canonical).
///
/// # Returns
///
/// `Ok(())` when the entry is safely inside a project.
///
/// # Errors
///
/// Returns an error for the root itself or its direct children.
pub fn ensure_deletable(root: &Path, entry: &Path) -> Result<(), String> {
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;

    if entry == canonical_root {
        return Err("The projects directory itself can't be deleted".to_string());
    }

    if entry.parent() == Some(canonical_root.as_path()) {
        return Err("Whole projects can't be deleted from the file browser".to_string());
    }

    Ok(())
}

/// Creates the directory `parent/dir_name`, including intermediate parents.
///
/// # Parameters
///
/// * `parent` - Directory the new directory is created in.
/// * `dir_name` - Name of the new directory.
///
/// # Returns
///
/// The full path of the created directory.
///
/// # Errors
///
/// Returns an error if the name is invalid, the directory already
/// exists, or creation fails.
pub async fn create_directory_impl(parent: &Path, dir_name: &str) -> Result<String, String> {
    paths::validate_name(dir_name)?;

    let full_path = parent.join(dir_name);

    if full_path.exists() {
        return Err(format!("Directory {} already exists", dir_name));
    }

    fs::create_dir_all(&full_path)
        .await
        .map_err(|e| e.to_string())?;

    Ok(full_path.to_string_lossy().to_string())
}

/// Recursively builds the [`FileNode`] tree rooted at `directory`.
///
/// # Parameters
///
/// * `directory` - Directory to walk.
///
/// # Returns
///
/// The [`FileNode::Directory`] for `directory` with all descendants.
///
/// # Errors
///
/// Returns an error if `directory` is not a directory or a read fails.
pub fn list_project_files_impl(directory: &Path) -> Result<FileNode, String> {
    if !directory.is_dir() {
        return Err(format!("{} is not a directory", directory.display()));
    }

    build_directory_node(directory, 0)
}

/// Reads a `.tex` file to a string.
///
/// # Parameters
///
/// * `file` - Path of the file to read.
///
/// # Returns
///
/// The file contents.
///
/// # Errors
///
/// Returns an error if the file is not a `.tex` file or reading fails.
pub async fn read_file_impl(file: &Path) -> Result<String, String> {
    ensure_tex_extension(file)?;

    fs::read_to_string(file).await.map_err(|e| e.to_string())
}

/// Writes `contents` to a `.tex` file, overwriting existing contents.
///
/// # Parameters
///
/// * `file` - Path of the file to write.
/// * `contents` - Full new contents.
///
/// # Returns
///
/// `Ok(())` on success.
///
/// # Errors
///
/// Returns an error if the file is not a `.tex` file or writing fails.
pub async fn save_file_impl(file: &Path, contents: &str) -> Result<(), String> {
    ensure_tex_extension(file)?;

    fs::write(file, contents).await.map_err(|e| e.to_string())
}

/// Validates whether a file extension is recognized by Moonstone.
///
/// # Parameters
///
/// * `extension` - Extension without the dot.
///
/// # Returns
///
/// `true` if the extension is valid, `false` otherwise.
fn validate_extension(extension: &str) -> bool {
    // For now it'll just be tex, but if other files are
    // allowed later down the line extension will be easier.
    matches!(extension, "tex")
}

/// Errors unless `file` has a `.tex` extension.
///
/// # Parameters
///
/// * `file` - Path to check.
///
/// # Returns
///
/// `Ok(())` when the extension is `.tex`.
///
/// # Errors
///
/// Returns an error for any other (or missing) extension.
fn ensure_tex_extension(file: &Path) -> Result<(), String> {
    let is_tex = file
        .extension()
        .map(|ext| validate_extension(&ext.to_string_lossy()))
        .unwrap_or(false);

    if !is_tex {
        return Err(format!("{} is not a .tex file", file.display()));
    }

    Ok(())
}

/// Builds a [`FileNode::Directory`] for `directory`, recursing into
/// subdirectories up to [`MAX_TREE_DEPTH`].
///
/// Hidden entries (leading dot) are skipped. Children are sorted with
/// directories first, then files, each group alphabetically.
///
/// # Parameters
///
/// * `directory` - Directory to describe.
/// * `depth` - Current recursion depth.
///
/// # Returns
///
/// The populated directory node.
///
/// # Errors
///
/// Returns an error if the depth cap is exceeded or a read fails.
fn build_directory_node(directory: &Path, depth: u32) -> Result<FileNode, String> {
    if depth > MAX_TREE_DEPTH {
        return Err(format!(
            "Project tree exceeds the maximum depth of {}",
            MAX_TREE_DEPTH
        ));
    }

    let mut directories: Vec<FileNode> = Vec::new();
    let mut files: Vec<FileNode> = Vec::new();

    let entries = std::fs::read_dir(directory).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();

        // Hidden files/directories are not part of a project.
        if name.starts_with('.') {
            continue;
        }

        let path = entry.path();

        if path.is_dir() {
            directories.push(build_directory_node(&path, depth + 1)?);
        } else {
            files.push(FileNode::File {
                name,
                path: path.to_string_lossy().to_string(),
            });
        }
    }

    sort_nodes_by_name(&mut directories);
    sort_nodes_by_name(&mut files);
    directories.extend(files);

    let dir_name = directory
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| directory.display().to_string());

    Ok(FileNode::Directory {
        name: dir_name,
        path: directory.to_string_lossy().to_string(),
        children: directories,
    })
}

/// Sorts nodes alphabetically by name (case-insensitive).
///
/// # Parameters
///
/// * `nodes` - The nodes to sort in place.
fn sort_nodes_by_name(nodes: &mut [FileNode]) {
    nodes.sort_by_key(|node| match node {
        FileNode::Directory { name, .. } | FileNode::File { name, .. } => name.to_lowercase(),
    });
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
    async fn test_create_file() {
        let dir = tempdir().unwrap();

        let result = create_file_impl(dir.path(), "test_file", "tex").await;
        assert!(result.is_ok());
        assert!(dir.path().join("test_file.tex").exists());
    }

    #[tokio::test]
    async fn test_create_file_rejects_duplicate() {
        let dir = tempdir().unwrap();

        create_file_impl(dir.path(), "test_file", "tex").await.unwrap();
        let result = create_file_impl(dir.path(), "test_file", "tex").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_create_file_rejects_bad_extension() {
        let dir = tempdir().unwrap();

        let result = create_file_impl(dir.path(), "test_file", "pdf").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_create_directory_success() {
        let dir = tempdir().unwrap();

        let result = create_directory_impl(dir.path(), "test_folder").await;
        assert!(result.is_ok());
        assert!(dir.path().join("test_folder").is_dir());
    }

    #[tokio::test]
    async fn test_list_project_files_builds_sorted_tree() {
        let dir = tempdir().unwrap();

        // Layout: chapters/intro.tex, main.tex, appendix.tex
        std::fs::create_dir(dir.path().join("chapters")).unwrap();
        std::fs::write(dir.path().join("chapters").join("intro.tex"), "").unwrap();
        std::fs::write(dir.path().join("main.tex"), "").unwrap();
        std::fs::write(dir.path().join("appendix.tex"), "").unwrap();

        let tree = list_project_files_impl(dir.path()).unwrap();

        let FileNode::Directory { children, .. } = tree else {
            panic!("root should be a directory");
        };

        // Directory first, then files alphabetically.
        assert_eq!(children.len(), 3);
        assert!(matches!(&children[0], FileNode::Directory { name, .. } if name == "chapters"));
        assert!(matches!(&children[1], FileNode::File { name, .. } if name == "appendix.tex"));
        assert!(matches!(&children[2], FileNode::File { name, .. } if name == "main.tex"));
    }

    #[tokio::test]
    async fn test_list_project_files_skips_hidden_entries() {
        let dir = tempdir().unwrap();

        std::fs::write(dir.path().join(".hidden"), "").unwrap();
        std::fs::write(dir.path().join("visible.tex"), "").unwrap();

        let tree = list_project_files_impl(dir.path()).unwrap();

        let FileNode::Directory { children, .. } = tree else {
            panic!("root should be a directory");
        };
        assert_eq!(children.len(), 1);
    }

    #[tokio::test]
    async fn test_read_and_save_round_trip() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("doc.tex");
        std::fs::write(&file, "").unwrap();

        save_file_impl(&file, "\\documentclass{article}").await.unwrap();
        let contents = read_file_impl(&file).await.unwrap();

        assert_eq!(contents, "\\documentclass{article}");
    }

    #[tokio::test]
    async fn test_read_file_rejects_non_tex() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("doc.pdf");
        std::fs::write(&file, "").unwrap();

        let result = read_file_impl(&file).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_create_file_with_contents_seeds_contents() {
        let dir = tempdir().unwrap();

        create_file_with_contents_impl(dir.path(), "seeded", "tex", "\\documentclass{article}")
            .await
            .unwrap();

        let contents = std::fs::read_to_string(dir.path().join("seeded.tex")).unwrap();
        assert_eq!(contents, "\\documentclass{article}");
    }

    #[test]
    fn test_rename_entry_renames_file_keeping_extension() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("old.tex");
        std::fs::write(&file, "content").unwrap();

        let renamed = rename_entry_impl(&file, "new").unwrap();

        assert!(renamed.ends_with("new.tex"));
        assert!(dir.path().join("new.tex").exists());
        assert!(!file.exists());
    }

    #[test]
    fn test_rename_entry_rejects_non_tex_target() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("old.tex");
        std::fs::write(&file, "").unwrap();

        assert!(rename_entry_impl(&file, "new.pdf").is_err());
    }

    #[test]
    fn test_rename_entry_refuses_overwrite() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("a.tex"), "").unwrap();
        std::fs::write(dir.path().join("b.tex"), "").unwrap();

        assert!(rename_entry_impl(&dir.path().join("a.tex"), "b").is_err());
    }

    #[test]
    fn test_rename_entry_renames_directory() {
        let dir = tempdir().unwrap();
        let sub = dir.path().join("chapters");
        std::fs::create_dir(&sub).unwrap();

        rename_entry_impl(&sub, "sections").unwrap();

        assert!(dir.path().join("sections").is_dir());
    }

    #[test]
    fn test_ensure_deletable_guards_root_and_projects() {
        let root = tempdir().unwrap();
        let project = root.path().join("project");
        let nested = project.join("file.tex");
        std::fs::create_dir(&project).unwrap();
        std::fs::write(&nested, "").unwrap();

        let canonical_root = root.path().canonicalize().unwrap();
        let canonical_project = project.canonicalize().unwrap();
        let canonical_nested = nested.canonicalize().unwrap();

        assert!(ensure_deletable(root.path(), &canonical_root).is_err());
        assert!(ensure_deletable(root.path(), &canonical_project).is_err());
        assert!(ensure_deletable(root.path(), &canonical_nested).is_ok());
    }
}
