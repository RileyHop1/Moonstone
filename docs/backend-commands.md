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
the projects directory. Names pass `paths::validate_name` (non-empty,
no separators/reserved characters, no leading dot). Only `.tex` files
may be read or written.

Commands are thin wrappers over pure `_impl` functions, which the unit
tests exercise against temp directories.

## Command table

| Command | Args | Returns | Notes |
|---|---|---|---|
| `list_projects` | — | `ProjectInfo[]` | Directories under the root, sorted by name |
| `create_project` | `name` | `ProjectInfo` | Creates dir + seeds `<name>.tex` with a document template |
| `delete_project` | `projectPath` | `()` | Recycle bin; only directories directly under the root |
| `list_project_files` | `projectPath` | `FileNode` | Recursive tree; dirs before files, alphabetical; hidden entries skipped; depth-capped |
| `read_file` | `filePath` | `string` | `.tex` only |
| `save_file` | `filePath`, `contents` | `()` | `.tex` only; overwrites |
| `create_file` | `parentDirectory`, `fileName`, `fileExtension` | `string` (path) | Refuses overwrite; `.tex` only |
| `create_directory` | `parentDirectory`, `dirName` | `string` (path) | Emits `directory-created` event |
| `rename_entry` | `path`, `newName` | `string` (path) | Files keep `.tex`; refuses overwrite |
| `delete_entry` | `path` | `()` | Sends to the recycle bin; refuses the root and whole projects |
| `get_settings` | — | `AppSettings` | Fail-soft: defaults on missing/corrupt file |
| `save_settings` | `settings` | `()` | JSON in the app config dir |

## Shapes

```rust
struct ProjectInfo { name, path, last_modified /* RFC3339 */, file_count } // camelCase over the wire

enum FileNode { // serde tag = "kind" → TS discriminated union
    Directory { name, path, children: Vec<FileNode> },
    File { name, path },
}
```

Errors are `Err(String)` and surface in the frontend as the `error`
branch of `Result<T>`.
