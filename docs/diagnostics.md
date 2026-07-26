# Editor Diagnostics

An opt-in developer readout overlaying the editor, used when testing
the live preview. It is **hidden by default** and has no presence in
the UI until someone asks for it.

## Toggling

`Ctrl+Shift+D` (`Cmd+Shift+D` on macOS) shows and hides the panel.
That shortcut is currently the only entry point, which is deliberate:
diagnostics are a testing aid, not a user-facing feature.

**Wire-up pending.** When the settings page gets its pass, this should
become a persisted "Show editor diagnostics" preference driving
`setDiagnosticsVisible(view, visible)`. The extension already exposes
that function plus `isDiagnosticsVisible(view)` for exactly this
purpose — no changes to the diagnostics module should be needed, only
a settings field and a call site. See the TODO in `diagnostics.ts`.

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
  holding visibility, a `ViewPlugin` rendering the report, and the
  toggle keymap.
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
