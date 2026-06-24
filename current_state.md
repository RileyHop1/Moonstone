# Moonstone — Codebase State (June 2026)

This document is a precise snapshot of the Moonstone codebase for use as context when working with AI assistants. It describes every source file, what code is actually in each file, the interfaces exposed, and where the project is in its development arc.

---

## Project Summary

Moonstone is a **Tauri 2** desktop application — a modern LaTeX editor with inline live preview. The tech stack is:

- **Frontend:** React 19 + TypeScript, built and served by Vite
- **Backend:** Rust, exposed to the frontend via Tauri's command/event API
- **Editor:** CodeMirror 6 (LaTeX language extension, One Dark theme)
- **Math rendering (planned):** KaTeX with MathJax fallback

The project is in **early prototyping**. The backend has meaningful, tested logic. The frontend was recently migrated from a vanilla TypeScript `View` class scaffold to React; it currently renders the application shell — a titlebar, a global menu bar (the "hot bar"), and the three-panel workspace — and mounts a working CodeMirror editor in the editor panel.

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
├── src/                    ← React + TypeScript frontend
│   ├── main.tsx            ← Entry point — mounts <App /> into #root
│   ├── App.tsx             ← Root component, three-panel layout
│   ├── views/              ← major regions of the application
│   │   └── editor/
│   │       └── TextEditor/
│   │           ├── TextEditor.tsx     ← CodeMirror-backed editor component
│   │           ├── moonstoneTheme.ts  ← Custom CodeMirror "Moonstone gem" theme
│   │           ├── TextEditor.css     ← Component styles
│   │           └── index.ts           ← barrel re-export
│   ├── components/         ← view-agnostic UI primitives
│   │   ├── GlobalHotBar.tsx ← Top menu bar (File/Edit/Insert/View/Settings/Help)
│   │   └── DropDown.tsx     ← Reusable labelled dropdown menu
│   ├── shared/             ← hooks, types, Tauri wrappers (empty, .gitkeep)
│   ├── styles/
│   │   ├── styles.css            ← Global CSS: theme variables, reset, layout
│   │   ├── GlobalHotBar.module.css ← GlobalHotBar styles (CSS module)
│   │   └── DropDown.module.css     ← DropDown styles (CSS module)
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
Minimal HTML shell. It imports `styles.css` and `src/main.tsx`, and exposes a single `<div id="root">` for React to mount into. All DOM construction now lives in React components — the shell is no longer hand-written here.

---

### `src/main.tsx`
React entry point. Looks up `#root`, throws if missing, and calls `createRoot(...).render(<StrictMode><App /></StrictMode>)`.

---

### `src/App.tsx`
The root component. Renders the application shell:

```
.app
  header.titlebar          → "Moonstone" title text
  <GlobalHotBar />         → top menu bar (File/Edit/Insert/View/Settings/Help)
  div.workspace
    aside.sidebar
      div.sidebar-header   → "Files" label
      div.file-tree        → empty, placeholder for the file tree component
    section.editor-panel   → contains <TextEditor />
```

The preview-panel section is not yet rendered.

---

### `src/components/GlobalHotBar.tsx`
The application-wide menu bar, rendered directly under the titlebar. Default-exported component.

- Composes six `DropDown` instances: **File** (New Project, Open Project, New File, Save, Recent Projects), **Edit** (Undo, Redo, Find & Replace), **Insert** (Math, Tables, Template), **View** (Source, Live Preview, Full Preview), **Settings** (Light/Dark, Settings Menu), and **Help** (Documentation).
- Each dropdown's `onSelect` currently just `console.log`s the chosen option — none of the menu actions are wired to behaviour yet.
- Styled via `GlobalHotBar.module.css` (CSS module).

---

### `src/components/DropDown.tsx`
A reusable, view-agnostic dropdown menu primitive. Default-exported component.

**Props (`DropDownProps`):**
- `name: string` — label shown on the trigger button
- `options: string[]` — items listed when the menu is open
- `onSelect: (option: string) => void` — called with the chosen option

**Behaviour:**
- Tracks open/closed state with `useState`.
- Renders a trigger `<button>` that toggles the menu, and (when open) a `<ul>` of `<li>` items keyed by option text. Selecting an item calls `onSelect` and closes the menu.
- Registers a `mousedown` listener (via `useEffect`, gated on `isOpen` and using a `useRef` on the container) to close the menu when the user clicks outside; the listener is cleaned up on close/unmount.
- Styled via `DropDown.module.css` (CSS module).

Currently mouse-driven only — no keyboard navigation, `Escape`-to-close, or ARIA attributes yet.

---

### `src/views/editor/TextEditor/TextEditor.tsx`
React component that mounts a CodeMirror 6 editor. Re-exported via `src/views/editor/TextEditor/index.ts` so consumers can import from the folder path.

- Uses `useRef<HTMLDivElement>` to capture the host element.
- In `useEffect` (run once on mount), constructs an `EditorView` with `basicSetup`, `latex({ autoCloseTags, enableLinting, enableTooltips })`, and the custom `moonstone` theme (from `moonstoneTheme.ts`), parented to the ref.
- Returns a `editor.destroy()` cleanup so StrictMode double-invocation and unmounts are safe.
- Renders a single `<div ref={hostRef} className="view-container-text-editor" />`.

The math-rendering scaffolding that previously lived in `text-editor.ts` (`MathRender` ViewPlugin, `MathWidget`) was incomplete and has been dropped during the migration. It will be reintroduced when the live-preview parser is built.

---

### `src/views/editor/TextEditor/moonstoneTheme.ts`
Custom CodeMirror 6 theme ("Moonstone gem"), replacing the previous `@codemirror/theme-one-dark`. Exports a single `moonstone` extension (an array combining an `EditorView.theme(...)` for the editor chrome and a `syntaxHighlighting(HighlightStyle.define(...))` for token colours).

- **Chrome** (background, cursor, selection, active line, gutters, brackets, tooltips, autocomplete) is wired to the global theme variables from `styles.css` (`var(--text-primary)`, `var(--accent)`, `var(--border-color)`, etc.) so the editor stays in sync with the rest of the app. The editor background is `transparent`, letting the `.editor-panel` colour (and any future sheen) show through. Marked `{ dark: true }`.
- **Syntax** uses a restrained moonlit palette defined locally in the file: pale lavender keywords, silver-blue names/links, moonlit-teal strings, pale-violet numbers, muted blue-grey italic comments, and a soft red for invalid tokens.

---

### `src/views/editor/TextEditor/TextEditor.css`
Component stylesheet. Defines `.view-container-text-editor { height: 100%; width: 100%; }`.

---

### `src/components/`
View-agnostic UI primitives. Now contains `GlobalHotBar.tsx` and `DropDown.tsx` (documented above); the `.gitkeep` remains. Their styles live in `src/styles/` as CSS modules (see below).

---

### `src/shared/`
Reserved for non-UI cross-cutting code: reusable hooks, TypeScript types, and Tauri command/event wrappers. Empty placeholder (`.gitkeep`) — nothing lives here yet.

---

### `src/styles/styles.css`
Global stylesheet. Contains:

**CSS custom properties (`:root`):**
| Variable | Value | Purpose |
|---|---|---|
| `--bg-app` | `#0d1117` | Main app background (blue-black gem body) |
| `--bg-sidebar` | `#0a0e14` | Sidebar background |
| `--bg-editor` | `#0d1117` | Editor panel background |
| `--bg-preview` | `#131a26` | Preview panel background |
| `--bg-titlebar` | `#070a0f` | Title bar background |
| `--text-primary` | `#e6ecff` | Main text colour (moonlight white) |
| `--text-secondary` | `#8b93b0` | Dimmed/label text |
| `--border-color` | `#1e2738` | All borders |
| `--accent` | `#a9c6ff` | Accent/highlight colour (silver-blue sheen) |
| `--glow` | `0 0 10px rgba(169,198,255,0.35)` | Reusable adularescent glow (shadows/text-shadow) |
| `--sheen` | radial gradient | Off-center moonlight gradient applied to the body background |

(Colour palette is a custom **Moonstone gem** theme — cool blue-black with a silver-blue sheen, evoking the gemstone's adularescence.)

**CSS rules defined:**
- `*, *::before, *::after` — box-sizing reset, zero margin/padding
- `html, body` — full height, font stack, background colour + `--sheen` radial gradient (fixed attachment), `overflow: hidden`
- `.app` — `display: flex; flex-direction: column; height: 100vh`
- `.titlebar` — 36px tall, `--bg-titlebar`, flex row, bottom border
- `.titlebar-title` — 13px, semibold, `--text-primary` with a `--glow` text-shadow and slight letter-spacing
- `.workspace` — `display: flex; flex: 1; overflow: hidden`
- `.sidebar` — 220px wide, `--bg-sidebar`, right border, flex column
- `.sidebar-header` — 10px/12px padding, 12px uppercase label, bottom border
- `.file-tree` — `flex: 1`, `overflow-y: auto`, 4px vertical padding
- `.editor-panel` — `flex: 1`, `--bg-editor`, `overflow: hidden`
- `.preview-panel` — `flex: 1`, `--bg-preview`, left border, `overflow-y: auto`, 20px padding

**Status:** Complete enough to render the layout correctly. No file-tree item styles yet. The editor is themed by the custom `moonstone` CodeMirror theme (see `moonstoneTheme.ts`), which consumes these same variables.

---

### `src/styles/GlobalHotBar.module.css`
CSS module for `GlobalHotBar`. Styles `.HotBar` as a horizontal flex strip under the titlebar, using the global theme variables (`--bg-titlebar` background, `--border-color` bottom border, `--text-secondary` text) so it matches the Catppuccin Mocha dark theme. Includes `user-select: none`.

---

### `src/styles/DropDown.module.css`
CSS module for `DropDown`. Styles the trigger button, the absolutely-positioned menu, and its items. Also theme-variable driven: transparent trigger with a `--bg-sidebar` hover, a `--bg-sidebar` menu panel bordered with `--border-color`, and items that highlight to the `--accent` colour on hover. The dropdown menu uses `z-index: 100` to sit above the workspace.

---

### `vite.config.ts`
Standard Tauri + Vite configuration, plus the `@vitejs/plugin-react` plugin. Key settings:
- `plugins: [react()]` — enables JSX/TSX and Fast Refresh
- `clearScreen: false` — preserves Rust error output in the terminal
- Dev server on port **1420** (`strictPort: true`)
- Watches all files except `**/src-tauri/**`
- HMR over WebSocket on port 1421 when `TAURI_DEV_HOST` is set

---

### `tsconfig.json`
- Target: `ES2020`
- Module: `ESNext`, resolution: `bundler`
- `jsx: "react-jsx"` (new transform; no `import React` needed in components)
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
| Package | Purpose |
|---|---|
| `react`, `react-dom` | UI framework |
| `@tauri-apps/api` | Tauri JS bindings (invoke, events, etc.) |
| `@tauri-apps/plugin-opener` | Open files/URLs with native OS handler |
| `codemirror` | CodeMirror 6 meta-package |
| `@codemirror/state` | Editor state management |
| `@codemirror/view` | Editor DOM rendering |
| `@codemirror/theme-one-dark` | Dark theme for CodeMirror (no longer used — replaced by the custom `moonstone` theme; still installed) |
| `@codemirror/lang-javascript` | JS language support (temp, not used by `TextEditor`) |
| `codemirror-lang-latex` | LaTeX language extension used by `TextEditor` |
| `katex` | Math rendering library (not yet imported anywhere) |

**Dev dependencies of note:**
| Package | Purpose |
|---|---|
| `@vitejs/plugin-react` | React Fast Refresh + JSX support in Vite |
| `@types/react`, `@types/react-dom` | React type definitions |

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

1. **Backend commands not registered** — `file_manager::create_file` and `file_manager::create_directory` are tagged `#[tauri::command]` but `lib.rs`'s `invoke_handler` only includes `greet`. The frontend cannot call them until they are added to `tauri::generate_handler![]`.

2. **No Tauri integration on the frontend** — `@tauri-apps/api` is installed but no React component invokes a command or subscribes to an event yet.

3. **No file tree component** — the `.file-tree` div in `App.tsx` is an empty placeholder.

4. **No preview panel** — `App.tsx` does not render a `.preview-panel` section, and there is no live-preview component.

5. **Math rendering is unimplemented** — KaTeX is installed but unused. The `MathRender`/`MathWidget` stubs from the previous vanilla-TS scaffold were dropped during the React migration and will be reintroduced when the parser is built.

6. **`settings.rs` is empty** — no settings struct, no persistence, no commands.

7. **`AppState` is defined but nothing uses it** — `projects`, `current_directory`, and `within_project` are managed but no command reads or writes them.

8. **No `shared/` directory yet** — the README design doc describes `shared/` (hooks, types, Tauri wrappers); it has not been created yet.

9. **`@codemirror/lang-javascript` is unused** — the editor uses `codemirror-lang-latex`. The JS language package can be removed once we are sure nothing else depends on it.

---

## Planned Frontend Architecture (from README)

The README documents the intended `src/` structure:

```
src/
├── main.tsx            ← React bootstrap
├── App.tsx             ← root component
├── views/              ← major UI regions (one folder per region)
│   └── editor/         ← FileTree + TextEditor + Preview components
├── components/         ← view-agnostic UI primitives
├── shared/             ← hooks, type definitions, Tauri API wrappers
└── styles/
    └── styles.css      ← global CSS variables, reset, layout
```
