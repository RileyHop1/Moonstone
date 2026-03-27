# Moonstone — Codebase State (March 2026)

This document is a precise snapshot of the Moonstone codebase for use as context when working with AI assistants. It describes every source file, what code is actually in each file, the interfaces exposed, and where the project is in its development arc.

---

## Project Summary

Moonstone is a **Tauri 2** desktop application — a modern LaTeX editor with inline live preview. The tech stack is:

- **Frontend:** Vanilla TypeScript, built and served by Vite
- **Backend:** Rust, exposed to the frontend via Tauri's command/event API
- **Editor (planned):** CodeMirror 6
- **Math rendering (planned):** KaTeX with MathJax fallback

The project is in **early prototyping**. The backend has meaningful, tested logic. The frontend is currently a static HTML shell with almost no TypeScript — it has been recently reorganised from the default Tauri scaffold toward a planned feature-based architecture.

---

## Directory Structure (Source Files Only)

```
Moonstone/
├── index.html
├── package.json
├── package-lock.json
├── vite.config.ts
├── tsconfig.json
├── .gitignore
├── LICENSE
├── README.md               ← Design document (not code)
├── current_state.md        ← This file
│
├── src/                    ← TypeScript frontend
│   ├── main.ts             ← Entry point (currently empty — 1 blank line)
│   ├── styles/
│   │   └── styles.css      ← Global CSS: theme variables, reset, layout
│   └── assets/
│       ├── tauri.svg
│       ├── typescript.svg
│       └── vite.svg        ← Default Tauri scaffolding assets (unused)
│
└── src-tauri/              ← Rust backend
    ├── Cargo.toml
    ├── Cargo.lock
    ├── tauri.conf.json
    ├── build.rs
    ├── capabilities/
    │   └── default.json    ← Tauri permission config
    └── src/
        ├── main.rs         ← Binary entry point (calls lib::run())
        ├── lib.rs          ← App bootstrap, AppState, invoke_handler
        ├── file_manager.rs ← File & directory creation commands + tests
        ├── project_manager.rs ← Project struct, creation logic + tests
        └── settings.rs     ← Empty placeholder
```

---

## Frontend

### `index.html`
The single HTML file that acts as the app shell. It imports `styles.css` and `main.ts`. The DOM structure is fully hand-written (no framework), and it already establishes the three-panel layout:

```
.app
  header.titlebar          → "Moonstone" title text
  div.workspace
    aside.sidebar
      div.sidebar-header   → "Files" label
      div.file-tree        → empty, placeholder comment
    section.editor-panel   → empty, where CodeMirror will go
    section.preview-panel  → empty, where the rendered preview will go
```

**Status:** Static shell only. No TypeScript is wired to any of these DOM elements yet.

---

### `src/main.ts`
**Currently empty** (contains a single blank line). This is the Vite entry point referenced by `index.html`. All previous scaffold code (the `greet()` demo) has been removed.

---

### `src/styles/styles.css`
Global stylesheet. Contains:

**CSS custom properties (`:root`):**
| Variable | Value | Purpose |
|---|---|---|
| `--bg-app` | `#1e1e2e` | Main app background |
| `--bg-sidebar` | `#181825` | Sidebar background |
| `--bg-editor` | `#1e1e2e` | Editor panel background |
| `--bg-preview` | `#232336` | Preview panel background |
| `--bg-titlebar` | `#11111b` | Title bar background |
| `--text-primary` | `#cdd6f4` | Main text colour |
| `--text-secondary` | `#a6adc8` | Dimmed/label text |
| `--border-color` | `#313244` | All borders |
| `--accent` | `#89b4fa` | Accent/highlight colour |

(Colour palette is Catppuccin Mocha.)

**CSS rules defined:**
- `*, *::before, *::after` — box-sizing reset, zero margin/padding
- `html, body` — full height, font stack, background colour, `overflow: hidden`
- `.app` — `display: flex; flex-direction: column; height: 100vh`
- `.titlebar` — 36px tall, `--bg-titlebar`, flex row, bottom border
- `.titlebar-title` — 13px, semibold, `--text-secondary`
- `.workspace` — `display: flex; flex: 1; overflow: hidden`
- `.sidebar` — 220px wide, `--bg-sidebar`, right border, flex column
- `.sidebar-header` — 10px/12px padding, 12px uppercase label, bottom border
- `.file-tree` — `flex: 1`, `overflow-y: auto`, 4px vertical padding
- `.editor-panel` — `flex: 1`, `--bg-editor`, `overflow: hidden`
- `.preview-panel` — `flex: 1`, `--bg-preview`, left border, `overflow-y: auto`, 20px padding

**Status:** Complete enough to render the three-panel layout correctly. No component-specific styles yet (no CodeMirror overrides, no file tree item styles).

---

### `vite.config.ts`
Standard Tauri + Vite configuration. Key settings:
- `clearScreen: false` — preserves Rust error output in the terminal
- Dev server on port **1420** (`strictPort: true`)
- Watches all files except `**/src-tauri/**`
- HMR over WebSocket on port 1421 when `TAURI_DEV_HOST` is set

---

### `tsconfig.json`
- Target: `ES2020`
- Module: `ESNext`, resolution: `bundler`
- `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`
- `noEmit: true` (Vite handles the actual compilation)
- `include: ["src"]` — only compiles files under `src/`

---

### `package.json`
**Scripts:**
- `npm run dev` — start Vite dev server
- `npm run build` — `tsc && vite build`
- `npm run tauri` — Tauri CLI

**Runtime dependencies (installed, available for use):**
| Package | Version | Purpose |
|---|---|---|
| `@tauri-apps/api` | ^2 | Tauri JS bindings (invoke, events, etc.) |
| `@tauri-apps/plugin-opener` | ^2 | Open files/URLs with native OS handler |
| `codemirror` | ^6.0.2 | CodeMirror 6 meta-package |
| `@codemirror/state` | ^6.5.4 | Editor state management |
| `@codemirror/view` | ^6.39.15 | Editor DOM rendering |
| `@codemirror/theme-one-dark` | ^6.1.3 | Dark theme for CodeMirror |
| `@codemirror/lang-javascript` | ^6.2.4 | JS language support (temp, until LaTeX extension is built) |
| `katex` | ^0.16.33 | Math rendering library |

**Note:** CodeMirror and KaTeX are installed but not yet imported or used anywhere in the TypeScript source.

---

## Backend (Rust)

### `src-tauri/src/main.rs`
Thin binary entry point. The only line of substance is `moonstone_lib::run()`. The `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` attribute prevents a console window on Windows release builds.

---

### `src-tauri/src/lib.rs`
The core Tauri app setup file. Declares the two backend modules and bootstraps the Tauri builder.

**Module declarations:**
```rust
mod file_manager;
mod project_manager;
```

**`AppState` struct** (managed singleton, accessible from any command via `State<AppState>`):
```rust
struct AppState {
    projects: Arc<Mutex<Vec<String>>>,
    current_directory: Arc<Mutex<String>>,
    within_project: Arc<Mutex<bool>>,
}
```

**`AppState` methods:**
- `AppState::new()` — initialises with empty projects vec, empty string directory, `false` for `within_project`
- `add_project(&self, new_project: String)` — pushes to the projects vec
- `remove_project(&self, project_name: String)` — retains all projects not matching the name
- `update_current_directory(&self, new_directory: String)` — overwrites the current directory

**`run()` function:**
- Registers `tauri_plugin_opener`
- Calls `.manage(AppState::new())` to inject state
- `invoke_handler` currently only registers `greet` — **`file_manager` and `project_manager` commands are NOT yet registered here**
- This means the frontend cannot call any backend file/project commands yet

**`greet` command** (placeholder, from scaffold):
```rust
fn greet(name: &str) -> String // returns "Hello, {name}! You've been greeted from Rust!"
```

---

### `src-tauri/src/file_manager.rs`
Handles low-level file system operations. All functions are `async` (uses `tokio::fs`). Both public functions are tagged `#[tauri::command]` but are not yet wired into `lib.rs`'s `invoke_handler`.

**Public interface:**

```rust
pub async fn create_file<R: tauri::Runtime>(
    app: &AppHandle<R>,
    parent_directory: String,
    file_name: String,
    file_extension: String,
) -> Result<String, String>
```
- Validates: name is non-empty, extension passes `validate_extension()`
- Constructs path as `parent_directory/file_name.file_extension`
- Errors if file already exists
- Writes empty file with `tokio::fs::write`
- Returns the full path string on success

```rust
pub async fn create_directory<R: tauri::Runtime>(
    app: &AppHandle<R>,
    parent_directory: String,
    dir_name: String,
) -> Result<String, String>
```
- Validates: name is non-empty, directory doesn't already exist
- Creates directory with `tokio::fs::create_dir_all`
- Emits Tauri event `"directory-created"` with the full path as payload
- Returns the full path string on success

**Private helper:**
```rust
fn validate_extension(extension: &str) -> bool
```
- Currently only accepts `"tex"`. Written with `matches!` macro to make adding more extensions easy later.

**Tests** (in `#[cfg(test)] mod file_manager_tests`):
- `test_validate_extension` — checks `"tex"` passes, `"pdf"` fails
- `test_creat_file` — creates a real temp file via `tempfile::tempdir`, asserts `Ok`
- `test_create_directory_success` — creates a real temp directory, asserts `Ok`

---

### `src-tauri/src/project_manager.rs`
Defines the `Project` model and handles project creation. A project is a named root directory containing LaTeX files.

**`Project` struct** (not `pub`, internal to this module):
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Project {
    name: String,
    path: String,                          // parent directory (not the project dir itself)
    creation_date: DateTime<Local>,
    last_modification_date: DateTime<Local>,
    amount_of_files: i32,
}
```

**`Project` methods:**
```rust
pub async fn new<R: tauri::Runtime>(
    app: AppHandle<R>,
    name: String,
    path: String,
) -> Result<Project, String>
```
- Validates name is non-empty
- Constructs `full_path = path/name`
- Errors if directory already exists
- Creates the directory with `tokio::fs::create_dir_all`
- Calls `file_manager::create_file` to create `name.tex` as the seed file
- Returns a `Project` with both timestamps set to `Local::now()` and `amount_of_files: 1`

**Getters/setters (all `pub`):**
- `get_name() -> &str`
- `get_path() -> &str`
- `get_creation_date() -> DateTime<Local>`
- `get_last_modification_date() -> DateTime<Local>`
- `get_amount_of_files() -> i32`
- `set_amount_of_files(new_amount: i32)`
- `increment_amount_of_files()`

**Tests** (in `#[cfg(test)] mod project_manager_tests`):
- `test_new_rejects_empty_name` — empty name returns specific error message
- `test_new_creates_project_directory` — directory is created on disk
- `test_new_creates_initial_tex_file` — `name.tex` exists and file count is 1
- `test_new_rejects_duplicate_project` — second call with same name returns error
- `test_get_name`, `test_get_path`, `test_get_amount_of_files` — getter unit tests
- `test_set_amount_of_files`, `test_increment_amount_of_files` — setter unit tests

All async tests use `tauri::test::mock_app()` (requires the `tauri/test` feature in `Cargo.toml`) and `tempfile::tempdir()` for real filesystem isolation.

---

### `src-tauri/src/settings.rs`
**Empty placeholder.** The file exists but contains no code.

---

### `src-tauri/Cargo.toml`

**Dependencies:**
| Crate | Version | Features |
|---|---|---|
| `tauri` | 2 | — |
| `tauri-plugin-opener` | 2 | — |
| `serde` | 1 | `derive` |
| `serde_json` | 1 | — |
| `tokio` | 1 | `full` |
| `chrono` | 0.4 | `serde` |

**Dev dependencies:**
| Crate | Purpose |
|---|---|
| `tempfile` | Temporary directories/files for tests |
| `tauri` (with `test` feature) | `tauri::test::mock_app()` for unit tests |

The crate is built as `staticlib + cdylib + rlib` (required for Tauri's mobile targets).

---

### `src-tauri/tauri.conf.json`
- App identifier: `com.riley.moonstone`
- Window: 800×600, title `"moonstone"`
- Dev URL: `http://localhost:1420` (Vite)
- `withGlobalTauri: true` — exposes `window.__TAURI__` globally
- CSP: `null` (disabled during development)
- Bundled targets: all platforms

---

### `src-tauri/capabilities/default.json`
Grants the `main` window `core:default` and `opener:default` permissions. No filesystem or shell permissions are currently requested here — this will need updating when file/project commands are wired up and the frontend starts calling them.

---

## Known Gaps / What Is Not Yet Done

1. **`src/main.ts` is empty** — no TypeScript wires up the DOM, CodeMirror, or Tauri commands.

2. **CodeMirror is not mounted** — the packages are installed in `node_modules` but are never imported or initialised anywhere. The `.editor-panel` `<section>` in `index.html` is empty.

3. **Backend commands not registered** — `file_manager::create_file` and `file_manager::create_directory` are tagged `#[tauri::command]` but `lib.rs`'s `invoke_handler` only includes `greet`. The frontend cannot call them until they are added to `tauri::generate_handler![]`.

4. **`settings.rs` is empty** — no settings struct, no persistence, no commands.

5. **`AppState` is defined but nothing uses it** — `projects`, `current_directory`, and `within_project` are managed but no command reads or writes them.

6. **No `views/` or `shared/` directories yet** — the README design doc describes a feature-based `src/` structure (`views/`, `shared/`, `styles/`) but only `styles/` exists so far.

7. **KaTeX is installed but unused** — no rendering logic exists on the frontend.

8. **`@codemirror/lang-javascript` is a placeholder** — a LaTeX CodeMirror language extension doesn't yet exist; JS language support is installed temporarily.

---

## Planned Frontend Architecture (from README)

The README documents the intended `src/` structure (not yet implemented):

```
src/
├── main.ts              ← bootstrap, view routing
├── views/               ← one module per screen/major UI area
│   └── editor/          ← (planned) file tree + CodeMirror + preview panel
├── shared/              ← event bus, type definitions, Tauri API wrappers
└── styles/
    └── styles.css       ← (exists) global CSS variables, reset, layout
```
