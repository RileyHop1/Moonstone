# Toolbar & View Menu Round: View Modes + Find & Replace

## Context

Second feature-focused round (see the live-preview round, now shipped). Now that live preview is rich, the most-felt gaps are: no way to see raw source or a clean rendered-only view, and no discoverable Find & Replace. The View menu is a dead stub (all `action: null`) and the Edit menu's "Find & Replace" is a stub too.

This round delivers **three view modes** and **Find & Replace**:

- **Source** — raw LaTeX, no rendering, editable.
- **Live** — today's Obsidian-style preview (renders when cursor is away). Default every session.
- **Read Only** — everything rendered, no cursor-reveal, not editable.

Decisions (confirmed): view mode is **per-editor state, resets to Live each session** (no settings persistence). The switch lives in **both** the View menu (checkmark on the active mode) and a compact segmented control in the toolbar. Find & Replace surfaces CodeMirror's built-in search panel (`basicSetup` already installs the Ctrl+F keymap).

## Architecture (from exploration)

- Menus are pure builders in `src/components/globalHotBarMenus.ts` (`MenuItem { label, action }`, `action: null` = disabled), assembled by `buildMenus(context)` and dispatched by `GlobalHotBar.tsx` via `DropDown.tsx` (reports by label). Unit-tested in `src/test/globalHotBarMenus.test.ts`.
- Editor actions flow through a registry context: `src/shared/appActions.tsx` (`EditorActions`), registered by `ProjectPage.tsx` (`useMemo` at ~303, `registerEditor` effect at ~338). Toolbar and menus both consume the same `EditorActions`.
- `undo`/`redo` are `@codemirror/commands`; `save`/`insertSnippet` dispatch via `viewRef.current`. This is the pattern the new actions follow.
- `TextEditor.tsx` builds the `EditorView` once per mount (remounted per file via React `key`); extensions array includes `livePreview()` unconditionally. **No `Compartment` exists anywhere yet** — this round introduces the first.
- `livePreview()` (`LivePreview/livePreview.ts:604`) returns `[inlineMathPlugin, blockPreviewField]` (module-level). Reveal is driven by `selectionTouches(state.selection, …)` in ~11 collector call sites (lines 99, 114, 127, 165, 266, 336-337, 407, 441, 481, 576).
- `@codemirror/search` resolves transitively; add it as an explicit dep for a clean import.

## Implementation

### 1. `ViewMode` type — `src/shared/types.ts`
`export type ViewMode = "source" | "live" | "readonly";` (neutral home so both `appActions.tsx` and the editor layer import it; matches the "literal union, no enums" house rule).

### 2. Parameterize reveal — `LivePreview/livePreview.ts`
- Add a facet: `const revealFacet = Facet.define<boolean, boolean>({ combine: (v) => v[0] ?? true });`
- Add a helper `function isRevealed(state, from, to): boolean { return state.facet(revealFacet) && selectionTouches(state.selection, from, to); }`.
- Replace the ~11 `selectionTouches(state.selection, a, b)` call sites with `isRevealed(state, a, b)`. (The inline plugin reads `view.state`; the block field already has `state`.)
- `export function livePreview(options?: { readonly reveal?: boolean }): Extension` → `[inlineMathPlugin, blockPreviewField, revealFacet.of(options?.reveal ?? true)]`. Plugins/field stay module-level; only the facet value differs per mode.

### 3. Mode → extension mapping — new `src/views/editor/TextEditor/viewMode.ts`
- `export const previewCompartment = new Compartment();` (module singleton — safe: exactly one editor exists at a time; note the assumption in a comment).
- `export const DEFAULT_VIEW_MODE: ViewMode = "live";`
- `export function previewExtensionForMode(mode: ViewMode): Extension`:
  - `source` → `[]`
  - `live` → `livePreview()`
  - `readonly` → `[livePreview({ reveal: false }), EditorState.readOnly.of(true), EditorView.editable.of(false)]`

### 4. `TextEditor.tsx`
- New prop `initialViewMode: ViewMode` (stored in a ref like the other props, since the effect builds once).
- Replace `livePreview()` in the extensions array with `previewCompartment.of(previewExtensionForMode(initialViewModeRef.current))`.

### 5. `ProjectPage.tsx`
- `const [viewMode, setViewMode] = useState<ViewMode>(DEFAULT_VIEW_MODE);`
- Pass `initialViewMode={viewMode}` to `<TextEditor>` (a new file remounts with the current mode).
- Effect on `viewMode`: `viewRef.current?.dispatch({ effects: previewCompartment.reconfigure(previewExtensionForMode(viewMode)) });`
- Extend the `actions` `useMemo` (add `viewMode` to its dep list so `actions.viewMode` stays current and re-registers):
  - `viewMode` (current mode, for the menu checkmark + toolbar highlight)
  - `setViewMode: (mode) => setViewMode(mode)`
  - `findReplace: () => { const v = viewRef.current; if (!v) return; openSearchPanel(v); v.focus(); }`

### 6. `src/shared/appActions.tsx`
Extend `EditorActions` with `readonly viewMode: ViewMode`, `readonly setViewMode: (mode: ViewMode) => void`, `readonly findReplace: () => void` (import `ViewMode` from `./types`).

### 7. Menu wiring — `globalHotBarMenus.ts`
- Extend `MenuItem` with `readonly checked?: boolean`.
- `buildEditMenu`: wire `Find & Replace` → `editor ? editor.findReplace : null`.
- Rewrite `buildViewMenu(context: MenuContext)` to use `editor`:
  - `Source` → `{ action: editor ? () => editor.setViewMode("source") : null, checked: editor?.viewMode === "source" }`
  - `Live Preview` → `"live"`
  - `Read Only` (renamed from "Full Preview") → `"readonly"`
- `buildMenus`: call `buildViewMenu(context)`.

### 8. `GlobalHotBar.tsx` + `DropDown.tsx`
- `DropDownOption` gains `readonly checked?: boolean`; `DropDown` renders a leading `✓` (or spacer) for checked items.
- `GlobalHotBar` maps `checked: item.checked ?? false` into each option.

### 9. Toolbar — `src/views/ProjectPage/Toolbar/Toolbar.tsx` (+ `Toolbar.css`)
- New props `viewMode: ViewMode` and use `actions.setViewMode` / `actions.findReplace`.
- Add a **🔍 Find** button (disabled unless `hasOpenFile`) near Undo/Redo → `actions.findReplace`.
- Add a segmented **Src / Live / Read** control (three buttons; active one highlighted via a `toolbar-segment-active` class) → `actions.setViewMode(...)`, disabled unless `hasOpenFile`.
- **Disable the snippet buttons when `viewMode === "readonly"`** (editing is off) — `disabled={!hasOpenFile || viewMode === "readonly"}`.
- `ProjectPage` passes `viewMode` to `<Toolbar>`.

### 10. Search panel theming — `TextEditor.css` (or `moonstoneTheme.ts`)
Style `.cm-panels`, `.cm-search` inputs/buttons with the app CSS vars (`--bg-preview`, `--border-color`, `--text-primary`, `--accent`) so the built-in panel matches the dark theme.

### 11. `package.json`
Add `@codemirror/search` to dependencies (already resolvable transitively; explicit import needs it declared).

## Tests

- **`globalHotBarMenus.test.ts`** (extend): View items disabled when `editor` is null; when present, Source/Live/Read Only dispatch `setViewMode` with the right arg; `checked` reflects `editor.viewMode`; `Find & Replace` wired to `editor.findReplace`. Update any existing assertion that View items are all-null / Find & Replace is null.
- **New `viewMode.test.ts`**: `previewExtensionForMode("source")` is empty; `"live"` and `"readonly"` are non-empty and differ; `DEFAULT_VIEW_MODE === "live"`.
- Menu builders + `previewExtensionForMode` are the pure, automated surface; the Compartment reconfigure and search panel are verified manually (CM internals aren't jsdom-friendly), consistent with the existing "decoration wiring is untested glue" convention.

## Docs

- **New `docs/toolbar.md`**: toolbar buttons, the view-mode segmented control, Find & Replace.
- **`docs/live-preview.md`**: add a "View modes" section (source/live/read-only, the `revealFacet`, read-only = reveal off + non-editable).

## Risks

1. **Compartment singleton** assumes one editor instance at a time — true today (ProjectPage mounts one keyed `TextEditor`); documented in `viewMode.ts`.
2. **Read-only editability** — `EditorState.readOnly` blocks user input but not programmatic dispatch; snippet buttons are therefore disabled in the toolbar for read-only mode to avoid confusing edits.
3. **Ctrl+F already bound** by `basicSetup`; we only call `openSearchPanel` (no second keymap), so no conflict.
4. **Reveal-facet swap correctness** — the env-tag reveal rule and all granularities are preserved; `isRevealed` only adds the facet gate in front of the existing `selectionTouches`.

## Verification

1. `npx vitest run` — all suites green (108 existing + new).
2. `npx tsc --noEmit` and `npm run build` — clean (catches the `EditorActions`/prop ripple).
3. `npm run tauri dev` (open `dsaf/preview-test.tex`) manual checklist:
   - View menu shows ✓ on Live; switching to Source shows raw `\section{...}`, all rendering gone, still editable; Read Only renders everything with no cursor-reveal and typing does nothing.
   - Toolbar segmented control mirrors + drives the mode; snippet buttons disabled in Read Only.
   - Find & Replace: Edit menu item and 🔍 button both open the search panel (themed to match); Ctrl+F still works; replace works.
   - Mode resets to Live when the app restarts.
   - Regression: switching modes preserves document + undo history (Compartment reconfigure, not remount); live-preview reveal behavior unchanged in Live mode.
