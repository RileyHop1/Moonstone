# Editor Diagnostics

An opt-in developer readout overlaying the editor, used when testing
the live preview. It is **hidden by default** and has no presence in
the UI until someone asks for it.

## Toggling

Two entry points, kept in step with each other:

- **Settings → Advanced → Show editor diagnostics**, persisted like any
  other preference. It sits under Advanced rather than Editor because
  it reports on the editor rather than changing how it behaves.
- **`Ctrl+Shift+D`** (`Cmd+Shift+D` on macOS), for reaching it without
  leaving the document.

The preference is the source of truth: `ProjectPage` calls
`setDiagnosticsVisible(view, showDiagnostics)` whenever it changes, and
the editor mounts with `editorDiagnostics({ initialVisible })` so the
panel never flashes off before a dispatch turns it on.

The shortcut does **both** — it flips the editor immediately and
reports the new value through `onVisibilityChange`, which the project
page writes back to settings. Toggling locally first avoids a round
trip through React for something meant to feel instant; reporting it
stops the switch in settings from disagreeing with what is on screen.

## What it reports

| Section | Fields | Why it matters |
|---|---|---|
| Modes | View mode, modal mode, editable | The first explanation for "why isn't this rendering?" — source mode renders nothing, read-only never reveals. |
| Document | Lines, characters | Sets the scale for the whole-document scans the block layer runs. |
| Selection | Cursor line/column, offset, range count, selected characters | The preview reveals source wherever the selection lands, so cursor position drives most preview behavior. |
| Viewport | Rendered line range, share of the document rendered | The inline layer only scans visible ranges; this shows how much that actually is. |

## Design

Three pieces, separated so the interesting part is testable without a
browser:

- **`collectDiagnostics.ts`** — a pure function from `EditorState` (plus
  an optional viewport range) to a `DiagnosticReport`: a list of titled
  sections, each holding label/value pairs. No DOM, no `EditorView`.
- **`diagnostics.ts`** — the CodeMirror extension: a `StateField`
  holding visibility (seeded per editor with `.init()`), a `ViewPlugin`
  rendering the report, and the toggle keymap.
- **`diagnostics.css`** — panel styling, using the app's theme
  variables so it follows light/dark.

Adding a reading means adding a field to a section in
`collectDiagnostics.ts`; the panel renders whatever the report
contains, so no rendering code changes.

### Why a StateField, not a Compartment

`viewMode.ts` and `modalMode.ts` use compartments because they *swap
extensions*. Diagnostics only toggles a flag, so a `StateField` plus a
`StateEffect` is simpler and — unlike a compartment — reachable
directly from a keymap without routing through React state.

### Mode facets

The panel needs to know which view and modal mode are active, but a
compartment holds the resulting extensions and keeps no record of the
choice. So `viewMode.ts` and `modalMode.ts` each publish their mode
through a facet (`viewModeFacet`, `modalModeFacet`) included in every
branch of their mode → extension mapping. Both fall back to their
default when nothing is configured.

### Panel lifetime

The panel is appended to the editor's own DOM (`view.dom`), not
`document.body`, so it is destroyed with the editor. It refreshes from
editor updates — document, selection, viewport, or visibility changes —
rather than on a timer, so an idle editor costs nothing, and it renders
no content at all while hidden.

Values are written with `textContent`, never `innerHTML`: they derive
from document contents and must never be interpreted as markup.

## Files

- `src/views/editor/TextEditor/Diagnostics/collectDiagnostics.ts` — report builder
- `src/views/editor/TextEditor/Diagnostics/diagnostics.ts` — extension, panel, keymap
- `src/views/editor/TextEditor/Diagnostics/diagnostics.css` — styling
- Tests: `src/test/diagnostics.test.ts`
