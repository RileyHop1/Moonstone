# Backend Commands

All Tauri commands live in `src-tauri/src/` and are registered in
`lib.rs`. The frontend calls them through the typed wrappers in
`src/shared/tauri.ts`, which return a `Result<T>` instead of throwing.

## Path security

Every command resolves the Moonstone root (`~/Documents/Moonstone`,
created on demand) via `paths::moonstone_root` and validates each
user-supplied path with `paths::ensure_within_root`: raw `..`
components are rejected up front, then both root and candidate are
canonicalized and compared — a request can never read or write outside
the projects directory.

Commands are thin wrappers over pure `_impl` functions, which the unit
tests exercise against temp directories.

## Name and extension rules

Every command that creates or renames validates the name through
`paths::validate_name`; every command that creates, reads or saves a
file validates its extension through `file_manager::validate_extension`.
The frontend mirrors both so mistakes surface next to the input rather
than as a command failure — the backend stays the authority.

A name is rejected when it is empty or whitespace, longer than 200
characters, contains `/ \ : * ? " < > |` or a control character,
starts with a dot, ends with a dot or a space, or matches a Windows
device name (`CON`, `NUL`, `COM1`–`LPT9`, with or without an
extension). The Windows-specific rules apply on every platform: a
project should not become unopenable because it was created on Linux.

Extensions are limited to the **text** formats a LaTeX project is
authored from — `tex`, `ltx`, `bib`, `cls`, `sty`, `bst`, `dtx`,
`ins`, `def`, `cfg`, `tikz`, `txt`, `md`, `csv`. Compiled output and
binary assets are deliberately absent: the editor would corrupt them
on save. `read_file`, `save_file` and `create_file` share the check,
so whatever can be created can also be opened and saved — a type that
could be created but not saved would be a broken feature.

`nameValidation.test.ts` parses the Rust list and asserts the
frontend's copy matches, so the two cannot drift apart silently.

## Command table

| Command | Args | Returns | Notes |
|---|---|---|---|
| `list_projects` | — | `ProjectInfo[]` | Directories under the root, sorted by name |
| `create_project` | `name`, `templateId` | `ProjectInfo` | Creates dir + lays down the template's files; template resolved before anything is written |
| `list_templates` | — | `TemplateInfo[]` | The bundled project templates, in offer order (see [templates](templates.md)) |
| `list_references` | `projectPath` | `Reference[]` | Every `.bib` entry in the project, merged and key-sorted; unreadable files skipped (see [bibliography](bibliography.md)) |
| `delete_project` | `projectPath` | `()` | Recycle bin; only directories directly under the root |
| `rename_project` | `projectPath`, `newName` | `string` (path) | Renames `<old>.tex` → `<new>.tex` too, keeping the main-file convention; refuses an existing name; no-op if unchanged |
| `list_project_files` | `projectPath` | `FileNode` | Recursive tree; dirs before files, alphabetical; hidden entries skipped; depth-capped |
| `read_file` | `filePath` | `string` | Editable extensions only |
| `save_file` | `filePath`, `contents` | `()` | Editable extensions only; overwrites |
| `create_file` | `parentDirectory`, `fileName`, `fileExtension` | `string` (path) | Refuses overwrite; editable extensions only |
| `create_directory` | `parentDirectory`, `dirName` | `string` (path) | Emits `directory-created` event |
| `rename_entry` | `path`, `newName` | `string` (path) | Files keep `.tex`; refuses overwrite |
| `move_entry` | `sourcePath`, `destinationDir` | `string` (path) | Refuses overwrite, self/descendant, and whole projects; no-op if already there |
| `delete_entry` | `path` | `()` | Sends to the recycle bin; refuses the root and whole projects |
| `get_settings` | — | `AppSettings` | Fail-soft: defaults on missing/corrupt file |
| `save_settings` | `settings` | `()` | JSON in the app config dir |

## Shapes

```rust
struct ProjectInfo { name, path, last_modified /* RFC3339 */, file_count } // camelCase over the wire

struct TemplateInfo { id, name, description, file_count } // camelCase over the wire

struct Reference { key, entry_type, title, authors, year, source_path, source_name }

enum FileNode { // serde tag = "kind" → TS discriminated union
    Directory { name, path, children: Vec<FileNode> },
    File { name, path },
}
```

Errors are `Err(String)` and surface in the frontend as the `error`
branch of `Result<T>`.
