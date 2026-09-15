//! # Project Templates
//!
//! The starting points offered when a project is created. Each template
//! is a set of files bundled into the binary with [`include_str!`], so
//! templates ship with the app and cannot go missing at runtime; the
//! sources live in `src-tauri/templates/<id>/`.
//!
//! A template's `main.tex` becomes `<project name>.tex`, which is the
//! file the project page auto-opens.

use serde::Serialize;
use std::path::Path;
use tokio::fs;

use crate::file_manager;
use crate::paths;

/// Replaced with the project's name wherever it appears in a template
/// file, so a new project opens already titled.
const NAME_PLACEHOLDER: &str = "{name}";

/// The file every template uses for its main document. It is written
/// out as `<project name>.tex` rather than under this name, matching
/// the convention the project page relies on to auto-open a project.
const TEMPLATE_MAIN_FILE: &str = "main.tex";

/// Builds one [`TemplateFile`] from a template directory and a path
/// inside it, keeping the registry below readable.
macro_rules! template_file {
    ($directory:literal, $path:literal) => {
        TemplateFile {
            path: $path,
            contents: include_str!(concat!("../templates/", $directory, "/", $path)),
        }
    };
}

/// One file a template lays down inside a new project.
pub struct TemplateFile {
    /// Path relative to the project directory, `/`-separated.
    pub path: &'static str,
    /// File contents, before [`NAME_PLACEHOLDER`] substitution.
    pub contents: &'static str,
}

/// A starting point for a new project.
pub struct ProjectTemplate {
    /// Stable identifier the frontend sends back when creating.
    pub id: &'static str,
    /// Name shown in the new-project dialog.
    pub name: &'static str,
    /// One line on what the template is for.
    pub description: &'static str,
    /// Every file laid down, including `main.tex`.
    pub files: &'static [TemplateFile],
}

/// A template as the frontend sees it — the metadata needed to offer a
/// choice, without the file contents.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateInfo {
    /// Identifier to pass back to `create_project`.
    pub id: String,
    /// Name shown in the dialog.
    pub name: String,
    /// One line on what the template is for.
    pub description: String,
    /// How many files the template creates.
    pub file_count: u32,
}

/// Every template Moonstone ships, in the order the dialog offers them:
/// the blank document first, then the document kinds people reach for
/// most often.
pub static TEMPLATES: &[ProjectTemplate] = &[
    ProjectTemplate {
        id: "blank",
        name: "Blank document",
        description: "An empty article — a title and nothing else.",
        files: &[template_file!("blank", "main.tex")],
    },
    ProjectTemplate {
        id: "article",
        name: "Academic article",
        description: "Abstract, numbered sections and a bibliography.",
        files: &[
            template_file!("article", "main.tex"),
            template_file!("article", "references.bib"),
        ],
    },
    ProjectTemplate {
        id: "report",
        name: "Report",
        description: "Chapters, a table of contents and an appendix.",
        files: &[template_file!("report", "main.tex")],
    },
    ProjectTemplate {
        id: "thesis",
        name: "Thesis / dissertation",
        description: "Title page, abstract, one file per chapter, bibliography.",
        files: &[
            template_file!("thesis", "main.tex"),
            template_file!("thesis", "chapters/introduction.tex"),
            template_file!("thesis", "chapters/literature-review.tex"),
            template_file!("thesis", "chapters/methodology.tex"),
            template_file!("thesis", "chapters/results.tex"),
            template_file!("thesis", "chapters/conclusion.tex"),
            template_file!("thesis", "references.bib"),
        ],
    },
    ProjectTemplate {
        id: "presentation",
        name: "Presentation",
        description: "Beamer slides, 16:9, with overlays and columns.",
        files: &[template_file!("presentation", "main.tex")],
    },
    ProjectTemplate {
        id: "homework",
        name: "Homework / problem set",
        description: "Numbered problems with solution environments.",
        files: &[template_file!("homework", "main.tex")],
    },
    ProjectTemplate {
        id: "lecture-notes",
        name: "Lecture notes",
        description: "Theorem, definition and proof environments.",
        files: &[template_file!("lecture-notes", "main.tex")],
    },
    ProjectTemplate {
        id: "cv",
        name: "CV / résumé",
        description: "One-page CV using only standard packages.",
        files: &[template_file!("cv", "main.tex")],
    },
    ProjectTemplate {
        id: "cover-letter",
        name: "Cover letter",
        description: "A formal letter with sender and recipient blocks.",
        files: &[template_file!("cover-letter", "main.tex")],
    },
    ProjectTemplate {
        id: "book",
        name: "Book",
        description: "Front matter, parts, per-chapter files, running heads.",
        files: &[
            template_file!("book", "main.tex"),
            template_file!("book", "chapters/chapter-one.tex"),
            template_file!("book", "chapters/chapter-two.tex"),
        ],
    },
];

/// Lists every available template for the new-project dialog.
///
/// # Returns
///
/// One [`TemplateInfo`] per template, in offer order.
#[tauri::command]
pub fn list_templates() -> Vec<TemplateInfo> {
    TEMPLATES
        .iter()
        .map(|template| TemplateInfo {
            id: template.id.to_string(),
            name: template.name.to_string(),
            description: template.description.to_string(),
            file_count: template.files.len() as u32,
        })
        .collect()
}

/// Looks up a template by its identifier.
///
/// # Parameters
///
/// * `id` - Identifier sent by the frontend.
///
/// # Returns
///
/// The matching template.
///
/// # Errors
///
/// Returns an error when no template has that identifier.
pub fn find_template(id: &str) -> Result<&'static ProjectTemplate, String> {
    TEMPLATES
        .iter()
        .find(|template| template.id == id)
        .ok_or_else(|| format!("Unknown template {}", id))
}

/// Writes a template's files into a project directory.
///
/// The directory is expected to exist and be empty; files are created,
/// never overwritten, so a clash fails loudly rather than silently
/// replacing the user's work.
///
/// # Parameters
///
/// * `project_dir` - The project directory to fill.
/// * `project_name` - Substituted for [`NAME_PLACEHOLDER`], and used to
///   name the main document.
/// * `template` - The template to lay down.
///
/// # Returns
///
/// `Ok(())` once every file is written.
///
/// # Errors
///
/// Returns an error if a template path is malformed, a directory cannot
/// be created, or a file already exists.
pub async fn seed_project(
    project_dir: &Path,
    project_name: &str,
    template: &ProjectTemplate,
) -> Result<(), String> {
    for file in template.files {
        let destination = destination_for(file.path, project_name)?;
        let contents = file.contents.replace(NAME_PLACEHOLDER, project_name);

        let parent = match &destination.directory {
            Some(directory) => {
                let parent = project_dir.join(directory);
                fs::create_dir_all(&parent).await.map_err(|e| e.to_string())?;
                parent
            }
            None => project_dir.to_path_buf(),
        };

        file_manager::create_file_with_contents_impl(
            &parent,
            &destination.stem,
            &destination.extension,
            &contents,
        )
        .await?;
    }

    Ok(())
}

/// Where one template file lands inside a new project.
#[derive(Debug, PartialEq)]
struct Destination {
    /// Sub-directory inside the project, if the file is nested.
    directory: Option<String>,
    /// File name without its extension.
    stem: String,
    /// Extension without the dot.
    extension: String,
}

/// Resolves a template-relative path to the file it creates.
///
/// The main document is renamed to the project's name; everything else
/// keeps the name it has in the template. Paths are checked even though
/// they are compile-time constants, so a typo in the registry fails
/// loudly instead of writing outside the project.
///
/// # Parameters
///
/// * `relative_path` - `/`-separated path from the template registry.
/// * `project_name` - Name the main document takes.
///
/// # Returns
///
/// The resolved [`Destination`].
///
/// # Errors
///
/// Returns an error for absolute paths, backslashes, empty segments,
/// traversal (`..`), a missing extension, or a component that is not a
/// valid file name.
fn destination_for(relative_path: &str, project_name: &str) -> Result<Destination, String> {
    if relative_path.starts_with('/') || relative_path.contains('\\') {
        return Err(format!("Template path {} must be relative", relative_path));
    }

    let mut segments: Vec<&str> = relative_path.split('/').collect();

    let file_name = segments
        .pop()
        .filter(|name| !name.is_empty())
        .ok_or_else(|| format!("Template path {} has no file name", relative_path))?;

    for segment in &segments {
        if segment.is_empty() || *segment == "." || *segment == ".." {
            return Err(format!("Template path {} is not a plain path", relative_path));
        }
        paths::validate_name(segment)?;
    }

    let (stem, extension) = file_name
        .rsplit_once('.')
        .ok_or_else(|| format!("Template file {} has no extension", file_name))?;

    // The main document carries the project's name so the project page
    // finds it; it therefore never sits in a sub-directory.
    let is_main_file = relative_path == TEMPLATE_MAIN_FILE;
    let stem = if is_main_file { project_name } else { stem };

    paths::validate_name(stem)?;

    Ok(Destination {
        directory: if segments.is_empty() {
            None
        } else {
            Some(segments.join("/"))
        },
        stem: stem.to_string(),
        extension: extension.to_string(),
    })
}

#[cfg(test)]
mod templates_tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_ships_at_least_ten_templates() {
        assert!(TEMPLATES.len() >= 10, "found {}", TEMPLATES.len());
    }

    #[test]
    fn test_template_identifiers_are_unique() {
        let mut ids: Vec<&str> = TEMPLATES.iter().map(|template| template.id).collect();
        let count = ids.len();

        ids.sort_unstable();
        ids.dedup();

        assert_eq!(ids.len(), count);
    }

    #[test]
    fn test_every_template_is_described() {
        for template in TEMPLATES {
            assert!(!template.name.is_empty(), "{} has no name", template.id);
            assert!(
                !template.description.is_empty(),
                "{} has no description",
                template.id
            );
        }
    }

    #[test]
    fn test_every_template_has_a_main_document() {
        // Without one, a created project would have no file to open.
        for template in TEMPLATES {
            assert!(
                template
                    .files
                    .iter()
                    .any(|file| file.path == TEMPLATE_MAIN_FILE),
                "{} has no {}",
                template.id,
                TEMPLATE_MAIN_FILE
            );
        }
    }

    #[test]
    fn test_every_template_file_is_non_empty_and_placeable() {
        for template in TEMPLATES {
            for file in template.files {
                assert!(
                    !file.contents.trim().is_empty(),
                    "{}/{} is empty",
                    template.id,
                    file.path
                );
                assert!(
                    destination_for(file.path, "Project").is_ok(),
                    "{}/{} is not placeable",
                    template.id,
                    file.path
                );
            }
        }
    }

    #[test]
    fn test_template_paths_are_unique_within_a_template() {
        for template in TEMPLATES {
            let mut paths: Vec<&str> = template.files.iter().map(|file| file.path).collect();
            let count = paths.len();

            paths.sort_unstable();
            paths.dedup();

            assert_eq!(paths.len(), count, "{} repeats a path", template.id);
        }
    }

    #[test]
    fn test_list_templates_exposes_every_template() {
        let listed = list_templates();

        assert_eq!(listed.len(), TEMPLATES.len());
        assert_eq!(listed[0].id, "blank");
        assert_eq!(listed[0].file_count, 1);
    }

    #[test]
    fn test_find_template_by_id() {
        assert_eq!(find_template("thesis").unwrap().id, "thesis");
        assert!(find_template("nonexistent").is_err());
    }

    #[test]
    fn test_destination_for_main_file_takes_the_project_name() {
        let destination = destination_for("main.tex", "My Paper").unwrap();

        assert_eq!(
            destination,
            Destination {
                directory: None,
                stem: "My Paper".to_string(),
                extension: "tex".to_string(),
            }
        );
    }

    #[test]
    fn test_destination_for_keeps_other_file_names() {
        let destination = destination_for("references.bib", "My Paper").unwrap();

        assert_eq!(destination.stem, "references");
        assert_eq!(destination.extension, "bib");
        assert_eq!(destination.directory, None);
    }

    #[test]
    fn test_destination_for_nested_file() {
        let destination = destination_for("chapters/introduction.tex", "My Paper").unwrap();

        assert_eq!(destination.directory, Some("chapters".to_string()));
        assert_eq!(destination.stem, "introduction");
    }

    #[test]
    fn test_destination_for_rejects_unsafe_paths() {
        for path in [
            "/etc/passwd",
            "chapters\\intro.tex",
            "../escape.tex",
            "chapters//intro.tex",
            "chapters/",
            "noextension",
        ] {
            assert!(
                destination_for(path, "Project").is_err(),
                "{} should be refused",
                path
            );
        }
    }

    #[tokio::test]
    async fn test_seed_project_writes_the_main_file_under_the_project_name() {
        let dir = tempdir().unwrap();
        let template = find_template("blank").unwrap();

        seed_project(dir.path(), "My Paper", template).await.unwrap();

        assert!(dir.path().join("My Paper.tex").exists());
        assert!(!dir.path().join("main.tex").exists());
    }

    #[tokio::test]
    async fn test_seed_project_substitutes_the_project_name() {
        let dir = tempdir().unwrap();
        let template = find_template("blank").unwrap();

        seed_project(dir.path(), "My Paper", template).await.unwrap();

        let contents = std::fs::read_to_string(dir.path().join("My Paper.tex")).unwrap();
        assert!(contents.contains("\\title{My Paper}"));
        assert!(!contents.contains(NAME_PLACEHOLDER));
    }

    #[tokio::test]
    async fn test_seed_project_creates_nested_files() {
        let dir = tempdir().unwrap();
        let template = find_template("thesis").unwrap();

        seed_project(dir.path(), "Thesis", template).await.unwrap();

        assert!(dir.path().join("Thesis.tex").exists());
        assert!(dir.path().join("chapters/introduction.tex").exists());
        assert!(dir.path().join("references.bib").exists());
    }

    #[tokio::test]
    async fn test_seed_project_writes_every_file_of_every_template() {
        // A template whose files cannot all be written would produce a
        // half-built project, so every one is exercised here.
        for template in TEMPLATES {
            let dir = tempdir().unwrap();

            seed_project(dir.path(), "Project", template)
                .await
                .unwrap_or_else(|error| panic!("{} failed: {}", template.id, error));

            for file in template.files {
                let expected = if file.path == TEMPLATE_MAIN_FILE {
                    dir.path().join("Project.tex")
                } else {
                    dir.path().join(file.path)
                };

                assert!(expected.exists(), "{}/{} missing", template.id, file.path);
            }
        }
    }

    #[tokio::test]
    async fn test_seed_project_refuses_to_overwrite() {
        let dir = tempdir().unwrap();
        let template = find_template("blank").unwrap();
        std::fs::write(dir.path().join("Project.tex"), "mine").unwrap();

        assert!(seed_project(dir.path(), "Project", template).await.is_err());
        // The existing file must survive untouched.
        assert_eq!(
            std::fs::read_to_string(dir.path().join("Project.tex")).unwrap(),
            "mine"
        );
    }
}
