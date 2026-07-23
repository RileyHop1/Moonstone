# Toolbar

The row above the editor (`src/views/ProjectPage/Toolbar/Toolbar.tsx`). It
holds no editor reference itself — every button delegates to the
`EditorActions` object the project page registers (the same object the
global hot bar menus use), so the toolbar and menus stay in sync.

## Buttons

- **Save** — persists the open file (disabled unless there are unsaved
  changes). Also `Ctrl+S`.
- **Undo / Redo** — the CodeMirror history commands.
- **🔍 Find** — opens the find-and-replace panel (see below).
- **View-mode control** — the segmented `Src / Live / Read` switch.
- **Snippet buttons** — insert LaTeX at the cursor (`$x$`, `$$`, table,
  Greek letters, `∑`, `∫`, fraction, `√`, document template). Disabled
  in Read-only mode, since that mode is non-editable.
- **Exit** — leaves the project (prompts if there are unsaved changes).

## View modes

The editor renders in one of three modes, switchable from both this
control and the **View** menu (which shows a checkmark on the active
mode). Mode is per-editor state and resets to **Live** each session.

| Mode | Behavior |
|---|---|
| **Source** | Raw LaTeX, nothing rendered, editable. |
| **Live** | Obsidian-style preview: renders when the cursor is away, reveals source at the cursor. |
| **Read Only** | Everything rendered, no cursor-reveal, not editable. |

Under the hood a CodeMirror `Compartment` (`viewMode.ts`) swaps the
preview configuration in place — `previewExtensionForMode(mode)` — so
switching modes **preserves the document and undo history** (a remount
would lose both). Source provides no preview extension; Live provides
`livePreview()`; Read Only provides `livePreview({ reveal: false })`
plus `EditorState.readOnly` and `EditorView.editable.of(false)`. See
`live-preview.md` for how the reveal facet works.

The compartment is a module singleton, which is safe because exactly
one editor exists at a time (the project page mounts a single keyed
`TextEditor`, remounted per file).

## Find & Replace

The **🔍 Find** button and the Edit menu's **Find & Replace** item both
call `openSearchPanel` from `@codemirror/search`, surfacing CodeMirror's
built-in search/replace panel (themed to match the app in
`TextEditor.css`). The `Ctrl+F` keymap ships with `basicSetup`, so the
panel already opened on that shortcut before it had a menu entry.
