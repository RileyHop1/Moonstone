# Project Templates

Every project starts from a template. The new-project dialog asks for a
name and a starting point; the backend lays down that template's files
and the project opens ready to write.

## What ships

Ten templates, offered in this order — blank first, then the document
kinds people reach for most:

| Template | Files | What it gives you |
|---|---|---|
| Blank document | 1 | An empty `article` with a title and nothing else |
| Academic article | 2 | Abstract, numbered sections, `references.bib` |
| Report | 1 | `report` class, chapters, table of contents, appendix |
| Thesis / dissertation | 7 | Title page, abstract, one file per chapter, bibliography |
| Presentation | 1 | Beamer, 16:9, overlays and a two-column frame |
| Homework / problem set | 1 | Numbered problems with `solution` environments |
| Lecture notes | 1 | `amsthm` theorem/definition/proof environments |
| CV / résumé | 1 | One-page CV, standard packages only |
| Cover letter | 1 | `letter` class with sender and recipient blocks |
| Book | 3 | Front matter, parts, per-chapter files, running heads |

Templates deliberately stay close to the standard classes and widely
installed packages, so a fresh project compiles on an ordinary TeX
distribution without chasing dependencies.

## How a template is defined

Sources live in `src-tauri/templates/<id>/` and are compiled into the
binary with `include_str!`, so templates ship with the app and cannot
go missing at runtime. The registry in `src-tauri/src/templates.rs`
names them:

```rust
ProjectTemplate {
    id: "article",
    name: "Academic article",
    description: "Abstract, numbered sections and a bibliography.",
    files: &[
        template_file!("article", "main.tex"),
        template_file!("article", "references.bib"),
    ],
}
```

The `template_file!` macro pairs a path inside the project with the
source file to embed.

Two rules apply to every template:

- **`main.tex` is the main document.** It is written out as
  `<project name>.tex`, which is the file the project page auto-opens.
  A template without one is a bug, and a test fails on it.
- **`{name}` is replaced with the project name** wherever it appears,
  so a new project is already titled.

Nested paths (`chapters/introduction.tex`) create the directories they
need. Paths are validated before use — no absolute paths, backslashes,
empty segments or `..` — so a typo in the registry fails loudly instead
of writing outside the project.

Files go through the same `create_file_with_contents_impl` used for
ordinary file creation, which means a template can only lay down file
types Moonstone can also open and save, and it never overwrites an
existing file.

## Adding a template

1. Create `src-tauri/templates/<id>/main.tex`, plus any other files.
2. Add a `ProjectTemplate` entry to `TEMPLATES` in `templates.rs`.
3. Run `cargo test` — the registry tests check identifiers are unique,
   every template has a description and a `main.tex`, no file is empty,
   every path is placeable, and every template seeds cleanly into a
   temporary directory.

Nothing on the frontend needs changing: the dialog renders whatever
`list_templates` returns.

## The dialog

`NewProjectDialog` (`src/views/ProjectBrowser/NewProjectDialog.tsx`)
owns its own modal rather than reusing `NameDialog` — the template
choice is the larger half of it, and the shared modal stays a
single-input prompt.

- Templates load once when the dialog opens, through a `LoadState` so
  loading and failure are rendered explicitly.
- The first template is selected up front, so Create is a valid action
  as soon as a name is typed.
- Create stays disabled until a template is selectable, rather than
  letting a submit fail.
- The picker is a `radiogroup`; each option shows the template's name,
  its file count, and one line on what it is for.
- Names are checked by the shared guard (see
  [project browser](project-browser.md)) before the backend is called.

## Files

- `src-tauri/templates/` — the template sources
- `src-tauri/src/templates.rs` — registry, `list_templates`, seeding
- `src/views/ProjectBrowser/NewProjectDialog.tsx` — the dialog
- Tests: `templates_tests` in `templates.rs`,
  `src/test/ProjectBrowser.test.tsx`
