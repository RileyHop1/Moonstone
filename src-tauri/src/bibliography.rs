//! # Bibliography
//!
//! Reads a project's `.bib` files so the editor can offer references
//! while the author types `\cite{…}`.
//!
//! Results are **unified**: every `.bib` file in the project is parsed
//! and merged into one list. An author citing a paper should not have
//! to remember which file it was filed in, and a project that splits
//! its bibliography across several files behaves exactly like one that
//! does not.
//!
//! The parser is deliberately small. It understands the shape of
//! BibTeX — `@type{key, field = value, …}` — and nothing about LaTeX
//! semantics: it is feeding a search box, not a typesetter.

use serde::Serialize;
use std::path::Path;
use tauri::{
    AppHandle,
    Runtime,
};

use crate::paths;

/// How deep the search for `.bib` files descends, matching the file
/// tree's own cap so a symlink cycle cannot hang the command.
const MAX_SEARCH_DEPTH: u32 = 32;

/// Entry kinds that carry no reference: BibTeX directives rather than
/// works that can be cited.
const NON_ENTRY_TYPES: [&str; 3] = ["comment", "string", "preamble"];

/// One citable reference, shaped for the editor's completion list.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    /// Citation key, as written in `\cite{…}`.
    pub key: String,
    /// Entry type (`article`, `book`, …), lowercased.
    pub entry_type: String,
    /// Title, or empty when the entry has none.
    pub title: String,
    /// Authors as written, one per name.
    pub authors: Vec<String>,
    /// Publication year, or empty when absent.
    pub year: String,
    /// Absolute path of the `.bib` file the entry came from.
    pub source_path: String,
    /// File name of that `.bib` file, for display.
    pub source_name: String,
}

/// Collects every reference defined in a project's `.bib` files.
///
/// # Parameters
///
/// * `project_path` - Path of the project directory.
///
/// # Returns
///
/// Every reference found, sorted by key. Duplicate keys are reported
/// once, keeping the first occurrence.
///
/// # Errors
///
/// Returns an error if the path escapes the Moonstone root or the
/// project cannot be read. A single unreadable `.bib` file is skipped
/// rather than failing the whole command.
#[tauri::command]
pub async fn list_references<R: Runtime>(
    app: AppHandle<R>,
    project_path: String,
) -> Result<Vec<Reference>, String> {
    let root = paths::moonstone_root(&app)?;
    let project = paths::ensure_within_root(&root, Path::new(&project_path))?;

    list_references_impl(&project)
}

/// Finds and parses every `.bib` file under a project directory.
///
/// # Parameters
///
/// * `project` - The project directory to scan.
///
/// # Returns
///
/// The unified, de-duplicated, key-sorted reference list.
///
/// # Errors
///
/// Returns an error if the project directory cannot be read.
pub fn list_references_impl(project: &Path) -> Result<Vec<Reference>, String> {
    let mut bib_files: Vec<std::path::PathBuf> = Vec::new();
    collect_bib_files(project, 0, &mut bib_files)?;

    // Sorted so that which duplicate wins does not depend on the order
    // the filesystem happened to hand back.
    bib_files.sort();

    let mut references: Vec<Reference> = Vec::new();

    for file in &bib_files {
        // One malformed or unreadable file must not cost the author
        // every other reference in the project.
        let Ok(contents) = std::fs::read_to_string(file) else {
            continue;
        };

        let source_path = file.to_string_lossy().to_string();
        let source_name = file
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| source_path.clone());

        for entry in parse_bib(&contents) {
            references.push(Reference {
                key: entry.key,
                entry_type: entry.entry_type,
                title: entry.title,
                authors: entry.authors,
                year: entry.year,
                source_path: source_path.clone(),
                source_name: source_name.clone(),
            });
        }
    }

    references.sort_by(|a, b| a.key.to_lowercase().cmp(&b.key.to_lowercase()));
    references.dedup_by(|a, b| a.key == b.key);

    Ok(references)
}

/// Recursively collects `.bib` file paths under a directory.
///
/// # Parameters
///
/// * `directory` - Directory to search.
/// * `depth` - Current recursion depth.
/// * `found` - Accumulator for matching paths.
///
/// # Returns
///
/// `Ok(())` once the directory has been walked.
///
/// # Errors
///
/// Returns an error if the depth cap is exceeded or a read fails.
fn collect_bib_files(
    directory: &Path,
    depth: u32,
    found: &mut Vec<std::path::PathBuf>,
) -> Result<(), String> {
    if depth > MAX_SEARCH_DEPTH {
        return Err(format!(
            "Project tree exceeds the maximum depth of {}",
            MAX_SEARCH_DEPTH
        ));
    }

    let entries = std::fs::read_dir(directory).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();

        // Hidden entries are not part of a project, as elsewhere.
        if name.starts_with('.') {
            continue;
        }

        let path = entry.path();

        if path.is_dir() {
            collect_bib_files(&path, depth + 1, found)?;
            continue;
        }

        let is_bib = path
            .extension()
            .map(|extension| extension.eq_ignore_ascii_case("bib"))
            .unwrap_or(false);

        if is_bib {
            found.push(path);
        }
    }

    Ok(())
}

/// One entry as it appears in a `.bib` file, before a source is
/// attached to it.
#[derive(Debug, Clone, PartialEq)]
pub struct BibEntry {
    /// Citation key.
    pub key: String,
    /// Entry type, lowercased.
    pub entry_type: String,
    /// Title, or empty when absent.
    pub title: String,
    /// Authors as written.
    pub authors: Vec<String>,
    /// Publication year, or empty when absent.
    pub year: String,
}

/// Parses the entries out of a `.bib` file's contents.
///
/// Anything outside an `@type{…}` block is ignored, which is how
/// BibTeX itself treats free text, so comments need no special case.
/// Malformed entries are skipped rather than aborting the parse: a
/// half-typed entry at the end of a file should not hide the good ones
/// above it.
///
/// # Parameters
///
/// * `contents` - The file's text.
///
/// # Returns
///
/// Every entry that had a key, in file order.
pub fn parse_bib(contents: &str) -> Vec<BibEntry> {
    let characters: Vec<char> = contents.chars().collect();
    let mut entries: Vec<BibEntry> = Vec::new();
    let mut index = 0;

    while index < characters.len() {
        if characters[index] != '@' {
            index += 1;
            continue;
        }

        match parse_entry(&characters, index) {
            Some((entry, next)) => {
                if let Some(entry) = entry {
                    entries.push(entry);
                }
                index = next;
            }
            // Nothing parseable from here on.
            None => break,
        }
    }

    entries
}

/// Parses one `@type{…}` block starting at an `@`.
///
/// # Parameters
///
/// * `characters` - The whole file as characters.
/// * `start` - Index of the `@`.
///
/// # Returns
///
/// The entry (or `None` for a directive such as `@string`) and the
/// index to continue from, or `None` when the block cannot be parsed.
fn parse_entry(characters: &[char], start: usize) -> Option<(Option<BibEntry>, usize)> {
    let mut index = skip_whitespace(characters, start + 1);

    let type_start = index;
    while index < characters.len() && (characters[index].is_alphanumeric() || characters[index] == '_') {
        index += 1;
    }

    let entry_type: String = characters[type_start..index].iter().collect::<String>().to_lowercase();
    if entry_type.is_empty() {
        return Some((None, start + 1));
    }

    index = skip_whitespace(characters, index);

    // Entries open with a brace or a parenthesis; both close the same
    // way as far as this parser is concerned.
    let closing = match characters.get(index) {
        Some('{') => '}',
        Some('(') => ')',
        _ => return Some((None, index.max(start + 1))),
    };
    index += 1;

    let body_end = find_matching(characters, index, closing);

    if NON_ENTRY_TYPES.contains(&entry_type.as_str()) {
        return Some((None, body_end));
    }

    let entry = parse_entry_body(characters, index, body_end, &entry_type);

    Some((entry, body_end))
}

/// Parses the inside of an entry: its key, then its fields.
///
/// # Parameters
///
/// * `characters` - The whole file as characters.
/// * `from` - Index just after the opening brace.
/// * `to` - Index of the closing brace.
/// * `entry_type` - The already-parsed entry type.
///
/// # Returns
///
/// The entry, or `None` when it has no citation key.
fn parse_entry_body(
    characters: &[char],
    from: usize,
    to: usize,
    entry_type: &str,
) -> Option<BibEntry> {
    let mut index = skip_whitespace(characters, from);

    let key_start = index;
    while index < to && characters[index] != ',' {
        index += 1;
    }

    let key = characters[key_start..index].iter().collect::<String>().trim().to_string();
    if key.is_empty() {
        return None;
    }

    let mut entry = BibEntry {
        key,
        entry_type: entry_type.to_string(),
        title: String::new(),
        authors: Vec::new(),
        year: String::new(),
    };

    while index < to {
        // Step over the comma that ended the key or the previous field.
        index = skip_whitespace(characters, index + 1);

        let name_start = index;
        while index < to && characters[index] != '=' && characters[index] != ',' {
            index += 1;
        }

        let name = characters[name_start..index.min(to)]
            .iter()
            .collect::<String>()
            .trim()
            .to_lowercase();

        if index >= to || characters[index] != '=' {
            // A trailing comma, or a field without a value.
            continue;
        }

        let (value, next) = read_field_value(characters, index + 1, to);
        index = next;

        match name.as_str() {
            "title" => entry.title = value,
            "author" => entry.authors = split_authors(&value),
            "year" => entry.year = value,
            _ => {}
        }
    }

    Some(entry)
}

/// Reads one field's value, stopping at the comma that ends it.
///
/// Handles the three forms BibTeX allows — `{braced}`, `"quoted"` and
/// bare (a number or a `@string` name) — and treats `#` concatenation
/// as plain text, which is enough for search.
///
/// # Parameters
///
/// * `characters` - The whole file as characters.
/// * `from` - Index just after the `=`.
/// * `to` - Index of the entry's closing brace.
///
/// # Returns
///
/// The cleaned value and the index of the terminating comma (or `to`).
fn read_field_value(characters: &[char], from: usize, to: usize) -> (String, usize) {
    let mut index = skip_whitespace(characters, from);
    let mut value = String::new();

    while index < to {
        match characters[index] {
            '{' => {
                let end = find_matching(characters, index + 1, '}');
                value.extend(&characters[index + 1..end.min(to)]);
                index = end + 1;
            }
            '"' => {
                let end = find_closing_quote(characters, index + 1, to);
                value.extend(&characters[index + 1..end.min(to)]);
                index = end + 1;
            }
            ',' => break,
            // Concatenation and stray whitespace between pieces.
            '#' => index += 1,
            character if character.is_whitespace() => {
                value.push(' ');
                index += 1;
            }
            character => {
                value.push(character);
                index += 1;
            }
        }
    }

    (clean_value(&value), index)
}

/// Normalises a field value for display and search.
///
/// Braces are structural in BibTeX (they protect capitalisation), so
/// they are dropped rather than shown; whitespace is collapsed so a
/// value wrapped across lines reads as one line.
///
/// # Parameters
///
/// * `value` - The raw value text.
///
/// # Returns
///
/// The cleaned value.
fn clean_value(value: &str) -> String {
    let without_braces: String = value.chars().filter(|c| *c != '{' && *c != '}').collect();

    without_braces.split_whitespace().collect::<Vec<&str>>().join(" ")
}

/// Splits a BibTeX author field into individual names.
///
/// # Parameters
///
/// * `value` - The cleaned `author` field.
///
/// # Returns
///
/// One entry per author, empty when the field is empty.
fn split_authors(value: &str) -> Vec<String> {
    if value.trim().is_empty() {
        return Vec::new();
    }

    value
        .split(" and ")
        .map(|author| author.trim().to_string())
        .filter(|author| !author.is_empty())
        .collect()
}

/// Finds the index of the brace closing the one already consumed.
///
/// # Parameters
///
/// * `characters` - The whole file as characters.
/// * `from` - Index just after the opening brace.
/// * `closing` - The closing character to match.
///
/// # Returns
///
/// Index of the closing character, or the end of input when the block
/// is unterminated.
fn find_matching(characters: &[char], from: usize, closing: char) -> usize {
    let opening = if closing == ')' { '(' } else { '{' };
    let mut depth = 1;
    let mut index = from;

    while index < characters.len() {
        let character = characters[index];

        if character == '\\' {
            // An escaped brace is content, not structure.
            index += 2;
            continue;
        }

        if character == opening {
            depth += 1;
        } else if character == closing {
            depth -= 1;
            if depth == 0 {
                return index;
            }
        }

        index += 1;
    }

    characters.len()
}

/// Finds the quote closing a quoted value, ignoring braced regions.
///
/// # Parameters
///
/// * `characters` - The whole file as characters.
/// * `from` - Index just after the opening quote.
/// * `to` - Index of the entry's closing brace.
///
/// # Returns
///
/// Index of the closing quote, or `to` when unterminated.
fn find_closing_quote(characters: &[char], from: usize, to: usize) -> usize {
    let mut depth = 0;
    let mut index = from;

    while index < to {
        match characters[index] {
            '\\' => index += 1,
            '{' => depth += 1,
            '}' => depth -= 1,
            '"' if depth == 0 => return index,
            _ => {}
        }
        index += 1;
    }

    to
}

/// Advances past whitespace.
///
/// # Parameters
///
/// * `characters` - The whole file as characters.
/// * `from` - Index to start at.
///
/// # Returns
///
/// Index of the first non-whitespace character at or after `from`.
fn skip_whitespace(characters: &[char], from: usize) -> usize {
    let mut index = from;

    while index < characters.len() && characters[index].is_whitespace() {
        index += 1;
    }

    index
}

#[cfg(test)]
mod bibliography_tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_parses_a_simple_entry() {
        let entries = parse_bib("@book{knuth1984, title = {The TeXbook}, author = {Knuth, Donald E.}, year = {1984}}");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].key, "knuth1984");
        assert_eq!(entries[0].entry_type, "book");
        assert_eq!(entries[0].title, "The TeXbook");
        assert_eq!(entries[0].authors, vec!["Knuth, Donald E."]);
        assert_eq!(entries[0].year, "1984");
    }

    #[test]
    fn test_parses_multiple_entries_with_free_text_between() {
        // Text outside an entry is a comment as far as BibTeX cares.
        let source = "
            This line is not an entry.
            @article{first, title = {One}}
            Neither is this one.
            @article{second, title = {Two}}
        ";

        let entries = parse_bib(source);

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].key, "first");
        assert_eq!(entries[1].key, "second");
    }

    #[test]
    fn test_handles_nested_braces_in_a_value() {
        let entries = parse_bib("@book{k, title = {The {\\TeX}book}}");

        assert_eq!(entries[0].title, "The \\TeXbook");
    }

    #[test]
    fn test_handles_quoted_values() {
        let entries = parse_bib("@article{a, title = \"A Quoted Title\", year = \"2026\"}");

        assert_eq!(entries[0].title, "A Quoted Title");
        assert_eq!(entries[0].year, "2026");
    }

    #[test]
    fn test_handles_bare_values() {
        let entries = parse_bib("@article{a, year = 2026, title = {Bare}}");

        assert_eq!(entries[0].year, "2026");
        assert_eq!(entries[0].title, "Bare");
    }

    #[test]
    fn test_collapses_whitespace_across_lines() {
        let entries = parse_bib("@article{a, title = {A title\n    split over\n    lines}}");

        assert_eq!(entries[0].title, "A title split over lines");
    }

    #[test]
    fn test_field_names_and_types_are_case_insensitive() {
        let entries = parse_bib("@ARTICLE{a, TITLE = {Shouty}, Year = {2026}}");

        assert_eq!(entries[0].entry_type, "article");
        assert_eq!(entries[0].title, "Shouty");
        assert_eq!(entries[0].year, "2026");
    }

    #[test]
    fn test_splits_multiple_authors() {
        let entries = parse_bib("@article{a, author = {Doe, Jane and Roe, Richard and Poe, Edgar}}");

        assert_eq!(
            entries[0].authors,
            vec!["Doe, Jane", "Roe, Richard", "Poe, Edgar"]
        );
    }

    #[test]
    fn test_skips_directives() {
        // @string/@preamble/@comment define no citable work.
        let entries = parse_bib(
            "@string{acm = {ACM}}\n@preamble{\"\\newcommand{\\x}{y}\"}\n@comment{ignored}\n@book{real, title = {Real}}",
        );

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].key, "real");
    }

    #[test]
    fn test_entry_without_optional_fields() {
        let entries = parse_bib("@misc{bare}");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].key, "bare");
        assert_eq!(entries[0].title, "");
        assert!(entries[0].authors.is_empty());
    }

    #[test]
    fn test_ignores_an_entry_without_a_key() {
        assert!(parse_bib("@article{, title = {No key}}").is_empty());
    }

    #[test]
    fn test_tolerates_a_half_typed_entry() {
        // The good entry above must survive the broken one below.
        let entries = parse_bib("@book{good, title = {Good}}\n@article{halfway, title = {");

        assert_eq!(entries[0].key, "good");
        assert!(entries.iter().all(|entry| entry.key != "missing"));
    }

    #[test]
    fn test_accepts_parenthesised_entries() {
        let entries = parse_bib("@article(paren, title = {Parenthesised})");

        assert_eq!(entries[0].key, "paren");
        assert_eq!(entries[0].title, "Parenthesised");
    }

    #[test]
    fn test_trailing_comma_after_last_field() {
        let entries = parse_bib("@article{a, title = {Trailing}, }");

        assert_eq!(entries[0].title, "Trailing");
    }

    #[test]
    fn test_list_references_merges_every_bib_file() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("refs.bib"), "@book{alpha, title = {Alpha}}").unwrap();
        std::fs::create_dir(dir.path().join("chapters")).unwrap();
        std::fs::write(
            dir.path().join("chapters").join("more.bib"),
            "@article{beta, title = {Beta}}",
        )
        .unwrap();

        let references = list_references_impl(dir.path()).unwrap();

        assert_eq!(references.len(), 2);
        assert_eq!(references[0].key, "alpha");
        assert_eq!(references[0].source_name, "refs.bib");
        assert_eq!(references[1].key, "beta");
        assert_eq!(references[1].source_name, "more.bib");
    }

    #[test]
    fn test_list_references_is_sorted_by_key() {
        let dir = tempdir().unwrap();
        std::fs::write(
            dir.path().join("refs.bib"),
            "@book{zebra, title = {Z}}\n@book{apple, title = {A}}",
        )
        .unwrap();

        let references = list_references_impl(dir.path()).unwrap();

        assert_eq!(references[0].key, "apple");
        assert_eq!(references[1].key, "zebra");
    }

    #[test]
    fn test_list_references_keeps_one_entry_per_duplicate_key() {
        // Two files defining the same key would otherwise offer the
        // author the same citation twice.
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("a.bib"), "@book{same, title = {First}}").unwrap();
        std::fs::write(dir.path().join("b.bib"), "@book{same, title = {Second}}").unwrap();

        let references = list_references_impl(dir.path()).unwrap();

        assert_eq!(references.len(), 1);
        assert_eq!(references[0].title, "First");
    }

    #[test]
    fn test_list_references_ignores_other_file_types() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("paper.tex"), "@book{notabib, title = {No}}").unwrap();

        assert!(list_references_impl(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn test_list_references_skips_hidden_directories() {
        let dir = tempdir().unwrap();
        std::fs::create_dir(dir.path().join(".git")).unwrap();
        std::fs::write(
            dir.path().join(".git").join("stale.bib"),
            "@book{hidden, title = {Hidden}}",
        )
        .unwrap();

        assert!(list_references_impl(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn test_list_references_on_a_project_without_bib_files() {
        let dir = tempdir().unwrap();

        assert!(list_references_impl(dir.path()).unwrap().is_empty());
    }
}
