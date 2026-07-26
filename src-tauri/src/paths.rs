//! # Paths
//!
//! Central path resolution and validation for Moonstone.
//!
//! All Tauri commands that touch the filesystem resolve the Moonstone
//! root through this module and validate every user-supplied path with
//! [`ensure_within_root`] so a malicious or malformed request can never
//! escape the projects directory.

use std::path::{
    Component,
    Path,
    PathBuf,
};
use tauri::{
    AppHandle,
    Manager,
    Runtime,
};

/// Name of the directory (inside the user's Documents folder) that
/// holds every Moonstone project.
const ROOT_DIR_NAME: &str = "Moonstone";

/// Characters that are not allowed in project or file names because
/// they are path separators or reserved on Windows.
const FORBIDDEN_NAME_CHARS: [char; 9] = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

/// Device names Windows reserves at every directory level. Creating
/// one fails in ways that look nothing like a naming problem, so they
/// are rejected up front on every platform — a project should not
/// become unopenable simply because it was made on Linux.
const RESERVED_DEVICE_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
    "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Longest name accepted. Most filesystems cap a single component at
/// 255 bytes; the margin leaves room for an extension.
const MAX_NAME_BYTES: usize = 200;

/// Resolves `~/Documents/Moonstone`, creating the directory if it does
/// not exist yet.
///
/// # Parameters
///
/// * `app` - Handle used to resolve the platform Documents directory.
///
/// # Returns
///
/// The absolute path to the Moonstone root directory.
///
/// # Errors
///
/// Returns an error if the Documents directory cannot be resolved or
/// the root directory cannot be created.
pub fn moonstone_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let documents = app
        .path()
        .document_dir()
        .map_err(|e| format!("Could not resolve the Documents directory: {}", e))?;

    let root = documents.join(ROOT_DIR_NAME);

    std::fs::create_dir_all(&root)
        .map_err(|e| format!("Could not create the Moonstone root directory: {}", e))?;

    Ok(root)
}

/// Canonicalizes `candidate` and verifies it lives inside `root`.
///
/// Existing paths are canonicalized directly. For not-yet-existing
/// targets (e.g. a file about to be created) the parent directory is
/// canonicalized and the final component re-joined, after rejecting
/// any `..` components in the raw input.
///
/// Both sides of the containment check are canonical, which matters on
/// Windows where `canonicalize` returns `\\?\C:\...` verbatim paths.
///
/// # Parameters
///
/// * `root` - The directory the candidate must stay inside.
/// * `candidate` - The user-supplied path to validate.
///
/// # Returns
///
/// The canonicalized candidate path.
///
/// # Errors
///
/// Returns an error if the candidate contains `..`, cannot be
/// canonicalized, or resolves outside of `root`.
pub fn ensure_within_root(root: &Path, candidate: &Path) -> Result<PathBuf, String> {
    // Reject traversal components before touching the filesystem so a
    // `..` can never influence which parent gets canonicalized.
    let has_parent_component = candidate
        .components()
        .any(|component| matches!(component, Component::ParentDir));
    if has_parent_component {
        return Err("Paths may not contain '..'".to_string());
    }

    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("Could not resolve the Moonstone root: {}", e))?;

    let canonical_candidate = canonicalize_allowing_missing_leaf(candidate)?;

    if !canonical_candidate.starts_with(&canonical_root) {
        return Err("Path is outside of the Moonstone projects directory".to_string());
    }

    Ok(canonical_candidate)
}

/// Validates a user-supplied project/file/directory name.
///
/// # Parameters
///
/// * `name` - The bare name (no path separators) to validate.
///
/// # Returns
///
/// `Ok(())` when the name is safe to join onto a directory path.
///
/// # Errors
///
/// Returns an error if the name is empty or whitespace, too long,
/// contains a path separator, Windows-reserved character or control
/// character, is a dot-name, ends with a dot or space, or collides
/// with a Windows device name.
pub fn validate_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Name can't be empty".to_string());
    }

    if name.len() > MAX_NAME_BYTES {
        return Err(format!(
            "Name can't be longer than {} characters",
            MAX_NAME_BYTES
        ));
    }

    if name.contains(FORBIDDEN_NAME_CHARS) {
        return Err(format!(
            "Name {} contains a forbidden character (/ \\ : * ? \" < > |)",
            name
        ));
    }

    // Invisible in the UI, rejected by most filesystems: a name with
    // one of these looks fine and fails inexplicably.
    if name.chars().any(char::is_control) {
        return Err("Name can't contain control characters".to_string());
    }

    // Dot-names are either traversal (".", "..") or hidden files,
    // neither of which Moonstone manages.
    if name.starts_with('.') {
        return Err("Name can't start with a dot".to_string());
    }

    // Windows silently strips these, so `report.` is stored as
    // `report` and every later lookup by the original name misses.
    if name.ends_with('.') || name.ends_with(' ') {
        return Err("Name can't end with a dot or a space".to_string());
    }

    if is_reserved_device_name(name) {
        return Err(format!("{} is a reserved name on Windows", name));
    }

    Ok(())
}

/// Reports whether a name collides with a Windows device name.
///
/// The comparison ignores case and any extension, matching how Windows
/// resolves them: `con.tex` is as reserved as `CON`.
///
/// # Parameters
///
/// * `name` - The candidate name.
///
/// # Returns
///
/// `true` when the name is reserved.
fn is_reserved_device_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name);

    RESERVED_DEVICE_NAMES
        .iter()
        .any(|reserved| stem.eq_ignore_ascii_case(reserved))
}

/// Canonicalizes a path, tolerating a final component that does not
/// exist yet by canonicalizing its parent instead.
///
/// # Parameters
///
/// * `candidate` - The path to canonicalize.
///
/// # Returns
///
/// The canonical path (with the possibly-missing leaf re-joined).
///
/// # Errors
///
/// Returns an error if neither the path nor its parent can be
/// canonicalized, or the path has no parent/file name.
fn canonicalize_allowing_missing_leaf(candidate: &Path) -> Result<PathBuf, String> {
    if candidate.exists() {
        return candidate
            .canonicalize()
            .map_err(|e| format!("Could not resolve path: {}", e));
    }

    let parent = candidate
        .parent()
        .ok_or_else(|| "Path has no parent directory".to_string())?;

    let leaf = candidate
        .file_name()
        .ok_or_else(|| "Path has no file name".to_string())?;

    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| format!("Could not resolve parent directory: {}", e))?;

    Ok(canonical_parent.join(leaf))
}

#[cfg(test)]
mod paths_tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_ensure_within_root_accepts_nested_path() {
        let dir = tempdir().unwrap();
        let nested = dir.path().join("project").join("chapter");
        std::fs::create_dir_all(&nested).unwrap();

        let result = ensure_within_root(dir.path(), &nested);
        assert!(result.is_ok());
    }

    #[test]
    fn test_ensure_within_root_accepts_missing_leaf() {
        let dir = tempdir().unwrap();
        let missing_file = dir.path().join("new_file.tex");

        let result = ensure_within_root(dir.path(), &missing_file);
        assert!(result.is_ok());
    }

    #[test]
    fn test_ensure_within_root_rejects_parent_traversal() {
        let dir = tempdir().unwrap();
        let escaping = dir.path().join("..").join("outside.tex");

        let result = ensure_within_root(dir.path(), &escaping);
        assert!(result.is_err());
    }

    #[test]
    fn test_ensure_within_root_rejects_absolute_outside_path() {
        let root = tempdir().unwrap();
        let other = tempdir().unwrap();

        let result = ensure_within_root(root.path(), other.path());
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_name_accepts_simple_name() {
        assert!(validate_name("my_project").is_ok());
    }

    #[test]
    fn test_validate_name_rejects_empty_and_whitespace() {
        assert!(validate_name("").is_err());
        assert!(validate_name("   ").is_err());
    }

    #[test]
    fn test_validate_name_rejects_separators_and_reserved_chars() {
        assert!(validate_name("a/b").is_err());
        assert!(validate_name("a\\b").is_err());
        assert!(validate_name("a:b").is_err());
        assert!(validate_name("a?b").is_err());
    }

    #[test]
    fn test_validate_name_rejects_dot_names() {
        assert!(validate_name(".").is_err());
        assert!(validate_name("..").is_err());
        assert!(validate_name(".hidden").is_err());
    }

    #[test]
    fn test_validate_name_accepts_names_with_spaces_and_dots_inside() {
        assert!(validate_name("Welcome to Moonstone").is_ok());
        assert!(validate_name("chapter 1.2 draft").is_ok());
    }

    #[test]
    fn test_validate_name_rejects_trailing_dot_or_space() {
        // Windows silently strips these, so the stored name would not
        // match what the user typed.
        assert!(validate_name("report.").is_err());
        assert!(validate_name("report ").is_err());
    }

    #[test]
    fn test_validate_name_rejects_control_characters() {
        assert!(validate_name("re\tport").is_err());
        assert!(validate_name("re\nport").is_err());
        assert!(validate_name("re\u{0}port").is_err());
    }

    #[test]
    fn test_validate_name_rejects_windows_device_names() {
        assert!(validate_name("CON").is_err());
        assert!(validate_name("nul").is_err());
        assert!(validate_name("Com1").is_err());
        assert!(validate_name("LPT9").is_err());
        // Reserved regardless of extension, as Windows resolves it.
        assert!(validate_name("con.tex").is_err());
    }

    #[test]
    fn test_validate_name_allows_device_name_as_a_prefix() {
        // Only an exact stem match is reserved.
        assert!(validate_name("console").is_ok());
        assert!(validate_name("nullable").is_ok());
    }

    #[test]
    fn test_validate_name_rejects_overlong_names() {
        assert!(validate_name(&"a".repeat(MAX_NAME_BYTES)).is_ok());
        assert!(validate_name(&"a".repeat(MAX_NAME_BYTES + 1)).is_err());
    }
}
