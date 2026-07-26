# Modal Editing (Vim / Helix)

Optional modal editing in the editor, chosen in **Settings → Editor →
Edit mode**: None, Vim or Helix. They are mutually exclusive — you can
be in one modal system or none. Off by default, and **persisted**, so
the choice survives restarts.

## How it works

A single `ModalMode` (`none` / `vim` / `helix`, in `shared/types.ts`)
drives one CodeMirror `Compartment` (`modalMode.ts`), swapped in and out
at runtime the same way the view modes are (`viewMode.ts`). Toggling
preserves the document and undo history — no remount.

- `modalCompartment` holds the active modal keymap (or nothing).
- `modalExtensionForMode(mode)` maps the mode to `vim()` /
  `helix()` / `[]`.
- The compartment sits **first** in the editor's extensions array, so
  the modal keymap sees keys before the default bindings. Only one of
  vim/helix is ever active, so there is no keymap conflict.
- The mode is a **user preference**, stored in `AppSettings`, not
  per-session editor state. `ProjectPage` reads it from `useSettings()`
  and dispatches `modalCompartment.reconfigure(...)` when it changes,
  so switching applies to the open document immediately without a
  remount. It is deliberately not in `EditorActions`: there is one
  place to change it, the settings page.

### Vim

`@replit/codemirror-vim`. Standard built-in motions/operators:
`h/j/k/l`, `w/b/e`, `0/$`, `gg/G`, `i/a/o`, `x`, `dd`, `yy/p`, `v`
visual mode, `/` search, counts, etc. Block cursor and `:` command
panel themed to match (`TextEditor.css`).

### Helix (experimental)

`codemirror-helix` (the same extension the obsidian-helix plugin uses).
Helix is **selection-first**: a motion creates/extends a selection and
the operator acts on it (`w` selects a word, `d` deletes the selection,
`x` selects the line, `i`/`Esc` toggle insert). The extension is
early-stage — functional but incomplete — hence "experimental". Its
block cursor and status/command panels are themed (`.cm-hx-cursor`,
`.hx-status-panel`, `.hx-command-panel`).

Helix is configured with `"editor.cursor-shape.insert": "bar"`, so the
cursor becomes a bar while inserting rather than staying a block. That
is the usual signal that typing will insert rather than command — and
it is load-bearing for mixed line numbering, because the package only
maintains its `cm-hx-block-cursor` class when the insert shape is a
bar, and that class is the only thing it publishes about its mode. See
`settings.md`.

## Scope and interactions

- **Persisted.** The mode is a user preference in `settings.rs`, set
  in **Settings → Editor → Edit mode**, and survives restarts.
- **Saving.** `Ctrl+S` still saves in every mode. Vim's `:w`/`:q` and
  Helix's project-context commands are **not** wired to the Tauri
  save/exit actions.
- **View modes.** Modal editing composes with Source/Live/Read-only.
  In Read-only the editor is non-editable, so motions/selection work but
  edits do not. Motions respect live-preview atomic ranges.
- **File switch** remounts the editor, so the modal mode re-applies from
  the current session state.

## Deferred

Custom key mappings, persistence of the mode, wiring Vim `:w`/`:q` and
Helix `externalCommands` (multi-file file/search/save) to Moonstone's
Tauri actions.

Tests: `src/test/modalMode.test.ts`, and the View-menu wiring in
`src/test/globalHotBarMenus.test.ts`.
