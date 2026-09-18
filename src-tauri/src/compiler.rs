//! # Compiler
//!
//! Turns a project into a PDF with [Tectonic](https://tectonic-typesetting.github.io/),
//! shipped alongside Moonstone as a Tauri sidecar.
//!
//! Tectonic fetches the TeXLive support files a document actually needs
//! and caches them, so there is no separate TeX distribution for a user
//! to install. The engine is a **prebuilt binary rather than a linked
//! crate**: the `tectonic` crate needs five system C libraries through
//! `pkg-config`, which the release matrix cannot supply on every
//! target. `docs/pdf-compilation.md` records that decision and the
//! evidence for it.
//!
//! ## Artifacts hide themselves
//!
//! Compilation writes into [`BUILD_DIR_NAME`] inside the project, and
//! [`crate::file_manager`] already skips dot-prefixed entries when it
//! builds the file tree — so `.aux`, `.log`, `.synctex.gz` and the rest
//! never reach the file browser, with no filtering rules to maintain.
//!
//! The PDF is the exception: it is copied back out beside the source,
//! because it is the *product* rather than the noise. That is also what
//! every other TeX toolchain does, and it is what lets the finished PDF
//! be opened — and dragged into a pane — like any other project file.

use serde::Serialize;
use std::path::Path;
use std::time::Duration;
use tauri::{
    AppHandle,
    Runtime,
};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;

use crate::paths;

/// Directory inside a project that compilation writes to.
///
/// The leading dot is load-bearing: it is what keeps every intermediate
/// file out of the file browser.
pub const BUILD_DIR_NAME: &str = ".moonstone-build";

/// Name of the bundled Tectonic sidecar, as declared in
/// `tauri.conf.json`'s `externalBin`.
const SIDECAR: &str = "tectonic";

/// How long one compile may run before it is abandoned.
///
/// A runaway macro (`\def\x{\x}\x`) makes TeX spin forever, and
/// compile-on-save would then leave a process burning a core for the
/// rest of the session. Generous enough that a cold cache fetching a
/// large package set — measured at 79 seconds for a first-ever compile
/// — finishes comfortably.
const COMPILE_TIMEOUT: Duration = Duration::from_secs(180);

/// How serious a compile diagnostic is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DiagnosticSeverity {
    /// The document is broken here; output may be missing or wrong.
    Error,
    /// Worth the author's attention, but the document still built.
    Warning,
}

/// One problem the engine reported.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileDiagnostic {
    pub severity: DiagnosticSeverity,
    /// The file the engine named, relative to the project.
    ///
    /// Empty when the engine reported no location, which happens for
    /// failures in the engine itself rather than in the document.
    ///
    /// **It may lack an extension.** TeX reports the name as written,
    /// so `\input{chapters/one}` yields `chapters/one`, not
    /// `chapters/one.tex`. Resolving that back to a real file is the
    /// caller's job, because only the caller knows what is on disk.
    pub file: String,
    /// 1-based line number, or `None` when the engine reported none.
    pub line: Option<u32>,
    pub message: String,
}

/// What a compile produced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileOutcome {
    /// Absolute path of the PDF, or `None` when none was produced.
    ///
    /// A PDF and errors are **not** mutually exclusive: the engine
    /// keeps going past a recoverable error, so the usual outcome of a
    /// broken document is a best-effort PDF *and* a list of what is
    /// wrong. That is a far better failure than a blank pane.
    pub pdf_path: Option<String>,
    /// Everything the engine reported, in order, deduplicated.
    pub diagnostics: Vec<CompileDiagnostic>,
    /// Absolute path of the engine log, kept for diagnosing what this
    /// module could not parse.
    pub log_path: Option<String>,
}

/// Splits `"<file>:<line>: <message>"` into its parts.
///
/// Scans for the first `:` that is followed by digits and another `:`,
/// rather than splitting on the first colon outright. A Windows
/// absolute path would otherwise be cut at its drive letter — the
/// engine reports project-relative paths today, but a parser that
/// breaks the moment that changes is not worth the two extra lines.
///
/// # Parameters
///
/// * `rest` - The text after the `error: ` or `warning: ` prefix.
///
/// # Returns
///
/// The file, line and message, or `None` when the text carries no
/// location.
fn split_location(rest: &str) -> Option<(String, u32, String)> {
    let bytes = rest.as_bytes();

    for (index, byte) in bytes.iter().enumerate() {
        if *byte != b':' {
            continue;
        }

        let after = &rest[index + 1..];
        let digits: String = after.chars().take_while(char::is_ascii_digit).collect();

        if digits.is_empty() {
            continue;
        }

        let tail = &after[digits.len()..];
        let Some(message) = tail.strip_prefix(':') else {
            continue;
        };

        let line = digits.parse::<u32>().ok()?;

        return Some((
            rest[..index].to_string(),
            line,
            clean_message(message.trim_start()),
        ));
    }

    None
}

/// Tidies an engine message for display.
///
/// TeX prefixes raw errors with `! `, but only sometimes — the same
/// fault reads `! LaTeX Error: …` when the engine halts and
/// `LaTeX Error: …` when it carries on. Stripping it makes the two
/// spellings one message, which also makes deduplication work.
///
/// # Parameters
///
/// * `message` - The message as reported.
///
/// # Returns
///
/// The message without TeX's marker or trailing whitespace.
fn clean_message(message: &str) -> String {
    message.strip_prefix("! ").unwrap_or(message).trim_end().to_string()
}

/// Parses the engine's diagnostics out of its standard error.
///
/// Tectonic normalises every problem to one line —
/// `error: <file>:<line>: <message>` — ahead of the raw TeX log, which
/// is what makes running it as a subprocess cheap rather than grim.
///
/// Two rules are worth stating, because both are judgement calls:
///
/// * **Unanchored messages are dropped when anchored ones exist.** The
///   engine signs off with `error: the XeTeX engine had an
///   unrecoverable error` and similar, which tells an author nothing
///   they cannot see from the three real errors above it. When nothing
///   is anchored, they are kept instead — a failure with an empty
///   diagnostics list would be worse than a vague one.
/// * **Duplicates are collapsed.** A changed `.aux` makes the engine
///   run TeX again, and the second pass reports the same faults.
///
/// # Parameters
///
/// * `stderr` - Everything the engine wrote to standard error.
///
/// # Returns
///
/// The diagnostics, in the order they were first reported.
pub fn parse_diagnostics(stderr: &str) -> Vec<CompileDiagnostic> {
    let mut anchored: Vec<CompileDiagnostic> = Vec::new();
    let mut unanchored: Vec<CompileDiagnostic> = Vec::new();

    for line in stderr.lines() {
        let trimmed = line.trim_end();

        // Anything that is not one of the engine's own normalised
        // diagnostics is noise here: `note:` progress, the raw log
        // dump, and platform chatter such as Windows' harmless
        // `Fontconfig error: Cannot load default config file`, which
        // does not start with `error: ` and so never reaches this.
        let (severity, rest) = if let Some(rest) = trimmed.strip_prefix("error: ") {
            (DiagnosticSeverity::Error, rest)
        } else if let Some(rest) = trimmed.strip_prefix("warning: ") {
            (DiagnosticSeverity::Warning, rest)
        } else {
            continue;
        };

        match split_location(rest) {
            Some((file, line, message)) => anchored.push(CompileDiagnostic {
                severity,
                file,
                line: Some(line),
                message,
            }),
            None => unanchored.push(CompileDiagnostic {
                severity,
                file: String::new(),
                line: None,
                message: clean_message(rest),
            }),
        }
    }

    let mut diagnostics = if anchored.is_empty() { unanchored } else { anchored };

    // Order-preserving dedupe: the first report of a fault is the one
    // whose position the author will recognise.
    let mut seen = std::collections::HashSet::new();
    diagnostics.retain(|diagnostic| seen.insert(diagnostic.clone()));

    diagnostics
}

/// Arguments the engine is always run with.
///
/// # Parameters
///
/// * `build_dir` - Directory to write output into.
/// * `main_file` - Absolute path of the document to compile.
///
/// # Returns
///
/// The full argument list.
fn engine_arguments(build_dir: &Path, main_file: &Path) -> Vec<String> {
    vec![
        "-X".to_string(),
        "compile".to_string(),
        // Without this the engine stops at the first error, and the
        // diagnostics panel becomes a one-item list. It also keeps
        // writing a PDF, so a broken document still previews.
        "-Z".to_string(),
        "continue-on-errors".to_string(),
        // Disables `\write18` and friends. A project is a directory of
        // files that may have come from anywhere, so shell escape is
        // not something to leave on by default.
        "--untrusted".to_string(),
        // Error-to-source mapping depends on it.
        "--synctex".to_string(),
        // The log carries what the normalised diagnostics leave out —
        // undefined references and citations, in particular.
        "--keep-logs".to_string(),
        "-o".to_string(),
        build_dir.to_string_lossy().to_string(),
        main_file.to_string_lossy().to_string(),
    ]
}

/// Compiles a project to PDF.
///
/// # Parameters
///
/// * `app` - Handle used to resolve the Moonstone root and the sidecar.
/// * `project_path` - Path of the project directory.
/// * `main_file` - The document to compile, relative to the project.
///
/// # Returns
///
/// The PDF path (when one was produced) and everything the engine
/// reported.
///
/// # Errors
///
/// Returns an error when either path escapes the Moonstone root, the
/// main file does not exist, the build directory cannot be created, the
/// engine cannot be started, or the compile exceeds
/// [`COMPILE_TIMEOUT`]. A document that merely fails to typeset is
/// **not** an error: that comes back as diagnostics.
#[tauri::command]
pub async fn compile_project<R: Runtime>(
    app: AppHandle<R>,
    project_path: String,
    main_file: String,
) -> Result<CompileOutcome, String> {
    let root = paths::moonstone_root(&app)?;
    let project = paths::ensure_within_root(&root, Path::new(&project_path))?;

    if !project.is_dir() {
        return Err("That project directory does not exist".to_string());
    }

    let main = paths::ensure_within_root(&root, &project.join(&main_file))?;

    if !main.is_file() {
        return Err(format!("There is no file to compile at {}", main_file));
    }

    let build_dir = project.join(BUILD_DIR_NAME);
    std::fs::create_dir_all(&build_dir)
        .map_err(|e| format!("Could not create the build directory: {}", e))?;

    let command = app
        .shell()
        .sidecar(SIDECAR)
        .map_err(|e| format!("Could not find the LaTeX engine: {}", e))?
        .args(engine_arguments(&build_dir, &main));

    let output = tokio::time::timeout(COMPILE_TIMEOUT, command.output())
        .await
        .map_err(|_| {
            format!(
                "Compilation took longer than {} seconds and was stopped",
                COMPILE_TIMEOUT.as_secs()
            )
        })?
        .map_err(|e| format!("Could not run the LaTeX engine: {}", e))?;

    let diagnostics = parse_diagnostics(&String::from_utf8_lossy(&output.stderr));

    let stem = main.file_stem().unwrap_or_default();
    let built_pdf = build_dir.join(stem).with_extension("pdf");
    let log = build_dir.join(stem).with_extension("log");

    Ok(CompileOutcome {
        pdf_path: publish_pdf(&built_pdf, &project, stem)?,
        diagnostics,
        log_path: log.is_file().then(|| log.to_string_lossy().to_string()),
    })
}

/// Copies the built PDF out of the build directory, beside the source.
///
/// # Parameters
///
/// * `built` - The PDF inside the build directory.
/// * `project` - The project directory to copy into.
/// * `stem` - The document's file stem, which names the PDF.
///
/// # Returns
///
/// The published path, or `None` when the compile produced no PDF.
///
/// # Errors
///
/// Returns an error if the copy fails.
fn publish_pdf(
    built: &Path,
    project: &Path,
    stem: &std::ffi::OsStr,
) -> Result<Option<String>, String> {
    if !built.is_file() {
        return Ok(None);
    }

    let published = project.join(stem).with_extension("pdf");

    std::fs::copy(built, &published)
        .map_err(|e| format!("Could not write the compiled PDF: {}", e))?;

    // The display form, not the canonical `\\?\C:\…` one: the frontend
    // matches this against file-tree paths to find a pane already
    // showing the PDF, and hands it to the asset protocol.
    Ok(Some(paths::to_display_string(&published)))
}

/// What exporting a PDF did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOutcome {
    /// Where the PDF was copied, or `None` when the user cancelled.
    pub exported_to: Option<String>,
}

/// Checks that a path names an existing PDF inside the Moonstone root.
///
/// # Parameters
///
/// * `root` - The Moonstone projects root.
/// * `pdf_path` - The path the frontend asked to export.
///
/// # Returns
///
/// The canonical path of the PDF.
///
/// # Errors
///
/// Returns an error if the path escapes the root, is not a `.pdf`, or
/// does not exist yet.
fn validate_export_source(root: &Path, pdf_path: &Path) -> Result<std::path::PathBuf, String> {
    let pdf = paths::ensure_within_root(root, pdf_path)?;

    let is_pdf = pdf
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"));
    if !is_pdf {
        return Err("Only a PDF can be exported".to_string());
    }

    if !pdf.is_file() {
        return Err("There is no PDF yet. Compile this document first".to_string());
    }

    Ok(pdf)
}

/// Copies a compiled PDF to a location the user picks.
///
/// The save dialog is opened **here**, not in the webview, so the
/// destination can only be one the user chose in a native dialog. A
/// command taking the destination as an argument would let the webview
/// overwrite any file the user can write to.
///
/// # Parameters
///
/// * `app` - Handle used to resolve the root and open the dialog.
/// * `pdf_path` - Absolute path of the PDF to export.
///
/// # Returns
///
/// Where the PDF was copied, or no destination when cancelled.
///
/// # Errors
///
/// Returns an error if the source fails [`validate_export_source`], the
/// chosen path cannot be read, or the copy fails.
#[tauri::command]
pub async fn export_pdf<R: Runtime>(
    app: AppHandle<R>,
    pdf_path: String,
) -> Result<ExportOutcome, String> {
    let root = paths::moonstone_root(&app)?;
    let source = validate_export_source(&root, Path::new(&pdf_path))?;

    let file_name = source
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "document.pdf".to_string());

    // The callback form, bridged through a channel, rather than the
    // blocking one: blocking would park an async worker thread for as
    // long as the dialog stays open.
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("PDF", &["pdf"])
        .set_file_name(file_name)
        .save_file(move |chosen| {
            // The receiver only disappears if the command was dropped,
            // and then there is nobody left to tell.
            let _ = sender.send(chosen);
        });

    let Some(chosen) = receiver
        .await
        .map_err(|_| "The save dialog closed unexpectedly".to_string())?
    else {
        return Ok(ExportOutcome { exported_to: None });
    };

    let destination = chosen
        .into_path()
        .map_err(|e| format!("Could not use that location: {}", e))?;

    tokio::fs::copy(&source, &destination)
        .await
        .map_err(|e| format!("Could not write the PDF: {}", e))?;

    Ok(ExportOutcome {
        exported_to: Some(paths::to_display_string(&destination)),
    })
}

#[cfg(test)]
mod compiler_tests {
    use super::*;

    /// Real stderr from compiling a document with three planted faults
    /// under `-Z continue-on-errors`, captured from Tectonic 0.17.0.
    ///
    /// Copied verbatim rather than hand-written, including the repeated
    /// block from the engine's second pass and the Windows Fontconfig
    /// line, because a parser tested against tidied-up input is a
    /// parser tested against the wrong thing.
    const BROKEN_STDERR: &str = concat!(
        "note: \"version 2\" Tectonic command-line interface activated\n",
        "Fontconfig error: Cannot load default config file: No such file: (null)\n",
        "note: Running TeX ...\n",
        "error: broken.tex:11: LaTeX Error: \\begin{itemize} on input line 8 ended by \\end{enumerate}.\n",
        "error: broken.tex:13: Undefined control sequence\n",
        "error: broken.tex:16: Missing $ inserted\n",
        "note: Rerunning TeX because \"broken.aux\" changed ...\n",
        "error: broken.tex:11: LaTeX Error: \\begin{itemize} on input line 8 ended by \\end{enumerate}.\n",
        "error: broken.tex:13: Undefined control sequence\n",
        "error: broken.tex:16: Missing $ inserted\n",
        "note: Running xdvipdfmx ...\n",
        "warning: errors were issued by the TeX engine, but were ignored; use --print and/or --keep-logs for details.\n",
    );

    /// Real stderr from a document that only produced warnings.
    const WARNING_STDERR: &str = concat!(
        "note: Running TeX ...\n",
        "Fontconfig error: Cannot load default config file: No such file: (null)\n",
        "warning: warn.tex:11: Overfull \\hbox (199.0pt too wide) detected at line 11\n",
        "warning: warn.tex:11: Overfull \\hbox (199.0pt too wide) detected at line 11\n",
        "warning: warnings were issued by the TeX engine; use --print and/or --keep-logs for details.\n",
    );

    /// Real stderr from a halting failure: a package that is not cached
    /// and cannot be fetched.
    const MISSING_PACKAGE_STDERR: &str = concat!(
        "note: using only cached resource files\n",
        "note: Running TeX ...\n",
        "error: uncached.tex:3: ! LaTeX Error: File `pgfplots.sty' not found.\n",
        "error: something bad happened inside XeTeX; its output follows:\n",
        "error: the XeTeX engine had an unrecoverable error\n",
        "caused by: halted on potentially-recoverable error as specified\n",
    );

    /// Real stderr from an include in a subdirectory.
    const SUBDIRECTORY_STDERR: &str = concat!(
        "error: chapters/one:3: Undefined control sequence\n",
        "error: chapters/one:3: Undefined control sequence\n",
        "warning: errors were issued by the TeX engine, but were ignored; use --print and/or --keep-logs for details.\n",
    );

    #[test]
    fn test_parse_diagnostics_reads_every_planted_error() {
        let diagnostics = parse_diagnostics(BROKEN_STDERR);

        assert_eq!(diagnostics.len(), 3);
        assert_eq!(
            diagnostics
                .iter()
                .map(|diagnostic| diagnostic.line)
                .collect::<Vec<_>>(),
            vec![Some(11), Some(13), Some(16)]
        );
        assert!(diagnostics
            .iter()
            .all(|diagnostic| diagnostic.severity == DiagnosticSeverity::Error));
        assert!(diagnostics
            .iter()
            .all(|diagnostic| diagnostic.file == "broken.tex"));
    }

    #[test]
    fn test_parse_diagnostics_collapses_a_rerun() {
        // The engine ran TeX twice because the `.aux` changed, so every
        // fault was reported twice. Showing an author each of their
        // errors twice would look like a bug in Moonstone.
        assert_eq!(parse_diagnostics(BROKEN_STDERR).len(), 3);
    }

    #[test]
    fn test_parse_diagnostics_ignores_engine_progress() {
        // `note:` lines are progress, not problems.
        assert!(parse_diagnostics("note: Running TeX ...\nnote: Writing `main.pdf`\n").is_empty());
    }

    #[test]
    fn test_parse_diagnostics_ignores_fontconfig_noise() {
        // Windows emits this on every run, including runs that succeed.
        // It reads like an error and is not one.
        let noise = "Fontconfig error: Cannot load default config file: No such file: (null)\n";

        assert!(parse_diagnostics(noise).is_empty());
    }

    #[test]
    fn test_parse_diagnostics_drops_the_engines_summary() {
        // "errors were issued ... use --print" tells an author nothing
        // the three real errors above it have not already said.
        let diagnostics = parse_diagnostics(BROKEN_STDERR);

        assert!(!diagnostics
            .iter()
            .any(|diagnostic| diagnostic.message.contains("--print")));
    }

    #[test]
    fn test_parse_diagnostics_reads_warnings() {
        let diagnostics = parse_diagnostics(WARNING_STDERR);

        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].severity, DiagnosticSeverity::Warning);
        assert_eq!(diagnostics[0].line, Some(11));
        assert!(diagnostics[0].message.starts_with("Overfull"));
    }

    #[test]
    fn test_parse_diagnostics_keeps_a_missing_package_error() {
        let diagnostics = parse_diagnostics(MISSING_PACKAGE_STDERR);

        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].file, "uncached.tex");
        assert_eq!(diagnostics[0].line, Some(3));
        // TeX's `! ` marker is stripped: the same fault is spelled with
        // it when the engine halts and without it when it carries on.
        assert_eq!(
            diagnostics[0].message,
            "LaTeX Error: File `pgfplots.sty' not found."
        );
    }

    #[test]
    fn test_parse_diagnostics_reports_the_file_an_include_named() {
        let diagnostics = parse_diagnostics(SUBDIRECTORY_STDERR);

        assert_eq!(diagnostics.len(), 1);
        // Exactly as TeX reported it: `\input{chapters/one}` gives a
        // name with no extension, and inventing one here would be
        // guessing at what is on disk.
        assert_eq!(diagnostics[0].file, "chapters/one");
        assert_eq!(diagnostics[0].line, Some(3));
    }

    #[test]
    fn test_parse_diagnostics_keeps_engine_errors_when_nothing_is_anchored() {
        // A failure with an empty diagnostics list would leave the user
        // told that compiling failed and nothing else.
        let stderr = "error: the XeTeX engine had an unrecoverable error\n";
        let diagnostics = parse_diagnostics(stderr);

        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].file, "");
        assert_eq!(diagnostics[0].line, None);
    }

    #[test]
    fn test_parse_diagnostics_survives_an_absolute_windows_path() {
        // The engine reports project-relative paths today. If that ever
        // changes, a parser that split on the first colon would cut
        // every path at its drive letter.
        let stderr = "error: C:\\projects\\thesis\\main.tex:42: Undefined control sequence\n";
        let diagnostics = parse_diagnostics(stderr);

        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].file, "C:\\projects\\thesis\\main.tex");
        assert_eq!(diagnostics[0].line, Some(42));
    }

    #[test]
    fn test_parse_diagnostics_keeps_colons_inside_a_message() {
        let stderr = "error: main.tex:7: Package hyperref Warning: Token not allowed: foo\n";
        let diagnostics = parse_diagnostics(stderr);

        assert_eq!(diagnostics[0].line, Some(7));
        assert_eq!(
            diagnostics[0].message,
            "Package hyperref Warning: Token not allowed: foo"
        );
    }

    #[test]
    fn test_parse_diagnostics_handles_empty_output() {
        assert!(parse_diagnostics("").is_empty());
    }

    #[test]
    fn test_engine_arguments_ask_for_every_feature_the_editor_needs() {
        let arguments = engine_arguments(Path::new("/p/.moonstone-build"), Path::new("/p/main.tex"));

        // Each of these is load-bearing, and each is easy to drop by
        // accident: without `continue-on-errors` the panel shows one
        // error, without `--synctex` there is no jump-to-source, and
        // without `--untrusted` a downloaded project can run shell
        // commands.
        assert!(arguments.contains(&"continue-on-errors".to_string()));
        assert!(arguments.contains(&"--synctex".to_string()));
        assert!(arguments.contains(&"--untrusted".to_string()));
        assert!(arguments.contains(&"--keep-logs".to_string()));
    }

    #[test]
    fn test_validate_export_source_accepts_a_pdf_inside_the_root() {
        let root = tempfile::tempdir().unwrap();
        let pdf = root.path().join("main.pdf");
        std::fs::write(&pdf, b"%PDF").unwrap();

        assert!(validate_export_source(root.path(), &pdf).is_ok());
    }

    #[test]
    fn test_validate_export_source_rejects_a_file_that_is_not_a_pdf() {
        // Export copies to wherever the user points it; letting it copy
        // a `.tex` or anything else would make it a general file copier.
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("main.tex");
        std::fs::write(&source, "\\documentclass{article}").unwrap();

        let error = validate_export_source(root.path(), &source).unwrap_err();

        assert!(error.contains("Only a PDF"));
    }

    #[test]
    fn test_validate_export_source_asks_for_a_compile_when_the_pdf_is_missing() {
        let root = tempfile::tempdir().unwrap();

        let error = validate_export_source(root.path(), &root.path().join("main.pdf")).unwrap_err();

        assert!(error.contains("Compile this document first"));
    }

    #[test]
    fn test_validate_export_source_rejects_a_pdf_outside_the_root() {
        let root = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let pdf = elsewhere.path().join("secret.pdf");
        std::fs::write(&pdf, b"%PDF").unwrap();

        assert!(validate_export_source(root.path(), &pdf).is_err());
    }

    #[test]
    fn test_publish_pdf_returns_the_display_form_of_the_path() {
        // The project path arrives canonicalized — `\\?\C:\…` on
        // Windows — and the frontend compares the result against file
        // tree paths, which never carry that prefix.
        let project = tempfile::tempdir().unwrap();
        let canonical = project.path().canonicalize().unwrap();
        let built = canonical.join("built.pdf");
        std::fs::write(&built, b"%PDF").unwrap();

        let published = publish_pdf(&built, &canonical, std::ffi::OsStr::new("main"))
            .unwrap()
            .unwrap();

        assert!(!published.starts_with(r"\\?\"));
        assert!(published.ends_with("main.pdf"));
    }

    #[test]
    fn test_engine_arguments_put_the_document_last() {
        let arguments = engine_arguments(Path::new("/p/.moonstone-build"), Path::new("/p/main.tex"));

        assert_eq!(arguments.last().map(String::as_str), Some("/p/main.tex"));
    }
}
