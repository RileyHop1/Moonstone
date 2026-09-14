# Moonstone — Adversarial Code Review

**Branch reviewed:** `live-preview-page` (working tree, including uncommitted split-pane work)
**Date:** 2026-09-14
**Baseline:** `main` (diff of 164 files, ~19.3k added lines)

**Verification performed:** `npx tsc --noEmit` — clean. `npm test` — 33 files / 470 tests, all pass.
Everything below is a design or correctness concern that the compiler and the current suite do **not** catch.

This review is deliberately adversarial. Section 9 lists what is genuinely good, so the rest can be read
as a punch list rather than a verdict on the codebase.

---

## 0. Headline

The branch contains **two features, not one**, and they are in very different states:

1. **Live preview** (committed) — mature, heavily tested, well documented, and with its performance
   characteristics actually measured. The problems here are a duplicated rendering path for table cells,
   a listener leak, and a barrel file that exports its own guts.
2. **Split editor panes** (uncommitted: `paneLayout.ts`, `PaneTree.tsx`, `EditorPane.tsx`,
   `paneLayout.test.ts`, +128 lines of CSS) — **written but never wired in**. Nothing imports
   `PaneTree` or `EditorPane`; `ProjectPage.tsx` still renders a single `TextEditor`
   ([ProjectPage.tsx:559-586](src/views/ProjectPage/ProjectPage.tsx#L559-L586)). The comments in
   `viewMode.ts` and `modalMode.ts` were already rewritten to claim multi-editor safety, so the
   _narrative_ says the feature shipped while the _wiring_ says it did not.

The reason it stalled is visible in the code and is finding **A-1**: `ProjectPage` assumes exactly one
`EditorView`, in seven separate places, and the pane feature cannot be connected without rewriting all
seven. That is the single most important thing in this document.

---

## 1. Split-pane feature (highest priority)

### A-1 — `ProjectPage` hard-codes "there is exactly one editor" seven times

**Severity: high (architectural blocker)**
[ProjectPage.tsx:143](src/views/ProjectPage/ProjectPage.tsx#L143), [:462-521](src/views/ProjectPage/ProjectPage.tsx#L462-L521)

There is a single `viewRef` and seven near-identical effects, each of the shape:

```ts
useEffect(() => {
  viewRef.current?.dispatch({ effects: SomeCompartment.reconfigure(extensionFor(x)) });
}, [x]);
```

for preview mode, modal mode, references, line numbers, diagnostics, theme, and spell check. They differ
only in _which_ compartment and _which_ dependency — textbook shotgun surgery, and the reason adding a
second pane means touching all of them. `EditorPane` currently sidesteps this by taking settings as
`initial*` props only ([EditorPane.tsx:180-196](src/views/ProjectPage/EditorPane.tsx#L180-L196)), which
means **with panes wired up, changing the theme or view mode would only reconfigure one pane and silently
leave the others stale.**

_Fix:_ invert the dependency. Instead of the page pushing into views, let each editor pull. Either
(a) drive a table — `const SYNCED = [{compartment: themeCompartment, build: (s) => moonstoneThemeForMode(s.theme)}, ...] as const` — and run one effect over `views x SYNCED`; or better
(b) give `TextEditor` a `settings` prop and let it own its own reconfiguration in one effect, so the
page never holds an `EditorView` for configuration purposes at all. The page then only needs views for
_commands_ (save/undo/redo/snippet), which is a much smaller surface.

### A-2 — File drags and in-editor text drags are indistinguishable

**Severity: high (functional bug, will fire on first use)**
[EditorPane.tsx:143-146](src/views/ProjectPage/EditorPane.tsx#L143-L146), [FileBrowser.tsx:406-409](src/views/ProjectPage/FileBrowser/FileBrowser.tsx#L406-L409)

The file browser puts the path on `text/plain`, and the pane reads `text/plain` back with no type marker:

```ts
const path = event.dataTransfer.getData("text/plain");
```

CodeMirror also supports dragging a text selection, and it puts the **selected text** on `text/plain`.
So dragging a selection inside a pane will: (1) let CodeMirror insert the text, then (2) bubble to
`EditorPane.handleDrop`, which happily treats the dragged prose as a file path and asks the backend to
open it — and, depending on where it lands, splits the pane. A drag from any _external_ application
carrying text does the same. This is "never trust input" (CLAUDE.md §10) at a DOM boundary.

_Fix:_ use a private MIME type (`application/x-moonstone-path`) on `setData`, and in `handleDragOver` /
`handleDrop` bail unless `event.dataTransfer.types.includes(...)`. Keep `text/plain` as a secondary
payload for drags out of the app if that is ever wanted.

### A-3 — `effectAllowed: "move"` vs `dropEffect: "copy"` cancels the drop

**Severity: high (likely makes the feature inert), unverified**
[FileBrowser.tsx:409](src/views/ProjectPage/FileBrowser/FileBrowser.tsx#L409) vs [EditorPane.tsx:138](src/views/ProjectPage/EditorPane.tsx#L138)

The drag source declares `effectAllowed = "move"`; the pane sets `dropEffect = "copy"` on dragover. Per
the HTML drag-and-drop spec, an incompatible `dropEffect` is reset to `"none"`, and a `dragover` ending
in `none` means **no `drop` event fires**. The file browser's own directory drop targets never touch
`dropEffect`, which is why moving files between folders works today.

I could not confirm this in the running app because the panes are not mounted. It is the first thing to
check when wiring them up — if drops "do nothing", this is why.

_Fix:_ set `dropEffect = "move"` in the pane (or widen the source to `"copyMove"` and pick per-target).

### A-4 — Directories are draggable, and the pane will try to open one as a file

**Severity: medium**
[FileBrowser.tsx:405-413](src/views/ProjectPage/FileBrowser/FileBrowser.tsx#L405-L413) (applied to both
the file branch and the directory branch), [EditorPane.tsx:155](src/views/ProjectPage/EditorPane.tsx#L155)

`dragProps` is spread onto directory rows too — correct for the existing move-into-folder gesture, wrong
for the new editor drop target, which does no kind check before calling `onDropFile`. Combine with A-2
and the payload is entirely unvalidated. The drag payload should carry the node kind, or the pane should
reject anything the file tree does not know as a file.

### A-5 — `paneLayout.ts` claims to be pure and is not

**Severity: medium (testability / CLAUDE.md "mutable globals")**
[paneLayout.ts:51](src/views/ProjectPage/paneLayout.ts#L51), [:164](src/views/ProjectPage/paneLayout.ts#L164)

The header says "Everything here is pure", but there is a module-level `let paneCounter = 0`, and
`splitPane` — which otherwise carefully takes `newId` as a parameter — mints the _split's_ id internally
by calling `nextPaneId()`. So the same inputs produce different outputs, the function has a hidden side
effect, and tests cannot assert on a whole tree by value without knowing the counter's history. The
inconsistency (one id injected, one id minted) is the tell.

_Fix:_ take both ids as parameters (`splitPane(node, targetId, side, path, {paneId, splitId})`), or pass
an id factory. The counter then lives in one place at the call site, and the module is genuinely pure.

Related: the counter resets on reload, so the moment a layout is persisted (an obvious next step), ids
from a restored layout will collide with freshly minted ones.

### A-6 — `focusAfterClose` returns the pane that was just closed, in the one-pane case

**Severity: low (latent)**
[paneLayout.ts:206-224](src/views/ProjectPage/paneLayout.ts#L206-L224)

`closePane` refuses to remove the last pane and returns the tree unchanged. A caller that does
`const next = closePane(layout, id); setFocus(focusAfterClose(next, id))` therefore keeps focus on a pane
it believes it closed. `closePane` should tell the caller whether it did anything — return
`{layout, closed: boolean}`, or a discriminated union — rather than making "unchanged" mean two things.

### A-7 — No teardown path for per-pane resources

**Severity: medium**
[PaneTree.tsx:35](src/views/ProjectPage/PaneTree.tsx#L35), [TextEditor.tsx:183-187](src/views/editor/TextEditor/TextEditor.tsx#L183-L187)

`onViewReady(paneId, view)` has no counterpart. `TextEditor` destroys its view in the effect cleanup but
never tells the parent, so the `Map<PaneId, EditorView>` the page will need has entries that are retained
after close and after every file switch. CodeMirror silently no-ops `dispatch` on a destroyed view
(verified in `@codemirror/view` — it just updates internal state and returns), so this will **not** throw;
it will fail invisibly, which is worse. Today's single-view code has the same latent hole: delete the open
file and `viewRef.current` still points at a destroyed editor.

_Fix:_ add `onViewDestroyed?: (view: EditorView) => void` and call it from the cleanup, or hand
`TextEditor` a ref-like object it can null out itself.

### A-8 — Drop-hint state churns and flickers

**Severity: low**
[EditorPane.tsx:132-141](src/views/ProjectPage/EditorPane.tsx#L132-L141), [:172](src/views/ProjectPage/EditorPane.tsx#L172)

`handleDragOver` calls `getBoundingClientRect()` and `setHoverSide` on **every** `dragover` (fired
continuously while a drag is over the pane), re-rendering the pane subtree each time. And `onDragLeave`
fires when the pointer crosses into a descendant element, because `dragleave` bubbles — so the hint
blinks off and back on constantly over the editor's DOM.

_Fix:_ cache the rect on `dragenter`; keep a dragenter/dragleave depth counter, or check
`event.relatedTarget` against `paneRef.current.contains(...)` before clearing.

### A-9 — Corner resolution compares normalised distances across axes

**Severity: low (UX)**
[EditorPane.tsx:87-105](src/views/ProjectPage/EditorPane.tsx#L87-L105)

`edgeAt` compares `x` (a fraction of width) against `y` (a fraction of height). On a pane 1600px wide and
300px tall, a point 200px from the left edge and 80px from the top resolves to "top", because 0.125 <
0.27 — even though the left edge is physically 2.5x further. Compare pixel distances, or accept the
distortion deliberately and say so in the comment.

### A-10 — The layout model cannot express pane sizes

**Severity: low (design note, not a defect)**
[paneLayout.ts:30-41](src/views/ProjectPage/paneLayout.ts#L30-L41)

`PaneSplit` has `direction` and `children` and nothing else; the CSS gives every pane `flex: 1`. So panes
are permanently equal and cannot be dragged — while the file browser beside them has a full
`ResizablePanel` with clamping and persistence. That asymmetry will read as a bug to a user. Adding
`readonly sizes: readonly number[]` later is a breaking change to every function in the file; adding it
now is cheap. Flagging, not demanding — YAGNI cuts the other way.

---

## 2. Live preview — correctness and performance

### B-1 — Table cells are rendered by a second, divergent implementation of the preview

**Severity: medium-high (duplication with real behavioural drift)**
[MathWidget.ts:219-264](src/views/editor/TextEditor/LivePreview/MathWidget.ts#L219-L264)

`renderCellContents` re-implements the whole decoration pipeline in DOM form: it calls the same five
scanners, then re-invents overlap resolution with an ad-hoc sort plus `if (piece.range.from < position)
continue` — a hand-rolled substitute for `ClaimedRanges`, with different semantics. The comment is honest
that it cannot reuse the decoration pipeline, but the consequences are not called out:

- **Macros are dropped.** [MathWidget.ts:288](src/views/editor/TextEditor/LivePreview/MathWidget.ts#L288)
  calls `katex.render` with no `macros` option, so a document-defined `\dmodel` renders correctly
  everywhere _except_ inside a table, where it turns red. `MathWidget` goes to real trouble to thread
  `macros` + `macroKey` through; this path throws that away.
- **Inert regions are not masked.** A `%` comment or `\verb` inside a cell is scanned like live source.
- Graphics and nested formatting are silently unsupported inside cells.

_Fix:_ extract the "scan a string, produce ordered non-overlapping pieces" step into one function used by
both paths (it is genuinely shared logic — one emits `Decoration.replace`, the other emits DOM nodes), and
pass `DocumentScan` (or at least `macros`/`macroKey`) into `TableWidget` so cells render like everything
else.

### B-2 — `TableWidget.eq` stringifies the entire grid on every comparison

**Severity: medium (performance)**
[MathWidget.ts:164](src/views/editor/TextEditor/LivePreview/MathWidget.ts#L164)

```ts
return JSON.stringify(other.rows) === JSON.stringify(this.rows);
```

`eq` is called on every decoration set comparison — i.e. on every keystroke and every cursor move. This is
two full serialisations of the table per call. `MathWidget` solved exactly this problem with `macroKey`;
`TableWidget` should carry the same kind of cheap identity (the raw source slice it was parsed from is the
obvious candidate, and is already at hand in `buildEnvironmentWidget`).

### B-3 — Inline math is scanned twice per update

**Severity: low-medium (redundant work; the broader perf question is already answered)**
[livePreview.ts:376-411](src/views/editor/TextEditor/LivePreview/livePreview.ts#L376-L411),
[:150-175](src/views/editor/TextEditor/LivePreview/livePreview.ts#L150-L175)

`scanDocument` computes `math: findMathRanges(scanText, 0)` for the **whole document**, but the block
layer consumes only the entries where `display` is true. Meanwhile `buildInlineDecorations` re-masks each
visible chunk and calls `findMathRanges` on it **again** to get the inline ones. So every inline `$…$` in
the document is found once and discarded, then the visible ones are found a second time — along with a
fresh `maskChunk` allocation over the viewport on every keystroke, cursor move, and scroll.

_Fix:_ filter `scan.math` by `view.visibleRanges` in the inline layer instead of rescanning. That removes
one scan and one allocation per update, and — usefully — fixes a real edge case: an inline `$…$` that
starts above the viewport is currently invisible to the chunk scan and renders as raw source, because the
chunk is cut at a line boundary. The cached whole-document scan already knows about it.

**On the wider "whole-document scan per keystroke" question — this is already measured and I was wrong to
raise it as an open risk.** [docs/live-preview.md:621-632](docs/live-preview.md) records 4.0ms median /
7.0ms worst keystroke on a 3,185-line document, and [:40-52](docs/live-preview.md) isolates the scan
itself at ~0.8ms of a 2.87ms cursor move, correctly identifying whole-document _decoration building_
(not scanning) as the residual cost and naming incremental reveal-state recomputation as the next lever.
That is exactly the right analysis and it is written down. The only gap left is that these are one-off
manual measurements, not a check anything would run again — see §8.

### B-4 — Window listeners outlive a destroyed view during a drag-selection

**Severity: medium (leak; more likely once panes can close)**
[pointerSelection.ts:106-114](src/views/editor/TextEditor/LivePreview/pointerSelection.ts#L106-L114)

`pointerdown` registers `pointerup`/`pointercancel` on `window` and only removes them when the gesture
ends. If the editor is unmounted mid-drag — pane closed, file deleted, project exited, view mode switched
(which reconfigures the compartment and tears the tracker down) — the listeners survive until the next
`pointerup` anywhere in the app and then dispatch into a destroyed view. CodeMirror swallows the dispatch,
so this leaks quietly. CLAUDE.md §7 is explicit about removing listeners.

_Fix:_ register through a `ViewPlugin` with a `destroy()` that removes any outstanding listeners, or use
an `AbortController` whose signal is aborted on destroy.

### B-5 — `revealBlockOnVerticalMotion` rebuilds the transaction and drops its annotations

**Severity: low**
[livePreview.ts:1029-1033](src/views/editor/TextEditor/LivePreview/livePreview.ts#L1029-L1033)

The filter returns a fresh spec carrying only `selection`, `effects`, and `scrollIntoView`. Any
`annotations` on the original — user-event tags, history markers, modal-mode bookkeeping — are discarded.
Effects survive (which is what keeps Vim working today), but this is a silent contract with the modal
extensions that nothing documents or tests. Prefer `[transaction, {selection: ...}]` or explicitly
forward `transaction.annotations`.

---

## 3. Cross-cutting architecture

### C-1 — The IPC boundary is asserted, not validated

**Severity: medium (CLAUDE.md §10)**
[tauri.ts:129-151](src/shared/tauri.ts#L129-L151)

```ts
const data = await invoke<T>(command, args);
return { ok: true, data };
```

`invoke<T>` is an unchecked cast. Every backend response — `FileNode` trees, `ProjectInfo[]`, `Reference[]`
— is trusted to match its TypeScript declaration at runtime. Only settings get a `normalizeSettings` pass,
and that one is where the type system is _weakest_ (`StoredSettings` uses `string` for the enums), which
suggests the author knew the boundary was untyped and only hardened one crossing. A malformed or
version-skewed response surfaces as `undefined.children` deep inside a React render.

_Fix:_ one small validator per response shape (hand-written predicates are fine; no dependency needed),
applied inside `invokeCommand` via a `parse` callback. `Result` already exists to carry the failure.

### C-2 — `EditorActions` is a god interface

**Severity: low-medium (CLAUDE.md §I — interface segregation)**
[appActions.tsx:27-46](src/shared/appActions.tsx#L27-L46)

One interface carries save/undo/redo, snippet insertion, new-file, exit-project, and view mode. `newFile`
and `exitProject` are not editor actions at all — they are page navigation and file management wearing an
editor's clothes. Every consumer takes the whole thing, so `Toolbar` depends on `exitProject` in order to
render an undo button.

It also causes a pointless double-plumb: `Toolbar` receives `viewMode` as its own prop _and_ inside
`actions` ([ProjectPage.tsx:535-541](src/views/ProjectPage/ProjectPage.tsx#L535-L541),
[appActions.tsx:41](src/shared/appActions.tsx#L41)) — two sources of truth for one value.

And because `actions` is memoised on `viewMode`, switching Src/Live/Read replaces the context value and
re-renders everything under `AppActionsProvider`.

### C-3 — `SpellCheck` depends on `LivePreview` for generic text utilities

**Severity: low (layering)**
[spellCheck.ts:22](src/views/editor/TextEditor/SpellCheck/spellCheck.ts#L22)

```ts
import { findInertRegions, maskChunk } from "../LivePreview";
```

"Where are the comments and verbatim blocks" is a LaTeX-lexing concern, not a preview concern. Spell check
and diagnostics both want it, and the preview happens to host it. Move `inertRegions.ts` (and the `find*`
scanners generally) into a sibling `TextEditor/latex/` module that all three features depend on, and the
dependency graph stops running through a rendering layer.

### C-4 — The `LivePreview` barrel exports the entire implementation

**Severity: low**
[LivePreview/index.ts](src/views/editor/TextEditor/LivePreview/index.ts)

33 exports. Production code imports exactly three of them (`livePreview`, `ImageSourceResolver`,
`LinkOpener`) plus the two spell-check borrows in C-3. Everything else — `ClaimedRanges`,
`documentScanField`, `findGroupEnd`, `enumerateLabel`, `maskInertRegions`, … — is public solely so tests
can reach it. That inverts CLAUDE.md §11 (small interfaces) and §13 (test behaviour, not implementation):
the module's public API is now defined by its test suite, and any refactor of an internal breaks the
"public" surface.

_Fix:_ tests can import from the concrete module path (`./LivePreview/findRefs`) without the barrel
advertising it. Keep the barrel to what consumers actually need.

---

## 4. Duplication inventory

| #   | What                                                                                                                                                                                                                 | Where                                                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | **"is path A inside path B"** — hand-rolled three times, each redoing the `\` / `/` dance                                                                                                                            | [FileBrowser.tsx:251](src/views/ProjectPage/FileBrowser/FileBrowser.tsx#L251), [ProjectPage.tsx:340-343](src/views/ProjectPage/ProjectPage.tsx#L340-L343), [ProjectPage.tsx:639-655](src/views/ProjectPage/ProjectPage.tsx#L639-L655) |
| D-2 | **Path basename / dirname** — a fourth and fifth variant                                                                                                                                                             | [EditorPane.tsx:163](src/views/ProjectPage/EditorPane.tsx#L163), [tauri.ts:68-72](src/shared/tauri.ts#L68-L72)                                                                                                                        |
| D-3 | **Seven identical compartment-reconfigure effects**                                                                                                                                                                  | [ProjectPage.tsx:462-521](src/views/ProjectPage/ProjectPage.tsx#L462-L521) — see A-1                                                                                                                                                  |
| D-4 | **`useDockDrag` / `usePanelResize`** — same pressed/startX refs, same pointer-capture dance, and byte-identical `*HandleProps` interfaces                                                                            | [useDockDrag.ts:17-22](src/shared/useDockDrag.ts#L17-L22) vs [usePanelResize.ts:18-23](src/shared/usePanelResize.ts#L18-L23)                                                                                                          |
| D-5 | **Twenty separate `{from, to}` interval types** across the editor, including `Interval` declared _twice_ — once in `inertRegions.ts` and again privately in `livePreview.ts`, which already imports from that module | [livePreview.ts:329-333](src/views/editor/TextEditor/LivePreview/livePreview.ts#L329-L333), [inertRegions.ts:26-29](src/views/editor/TextEditor/LivePreview/inertRegions.ts#L26-L29)                                                  |
| D-6 | **Preview rendering, implemented twice**                                                                                                                                                                             | see B-1                                                                                                                                                                                                                               |
| D-7 | **Enum narrowing, copy-pasted** — `MODAL_MODES.includes(x as T) ? (x as T) : default`, twice, with four `as` casts                                                                                                   | [settings.tsx:83-95](src/shared/settings.tsx#L83-L95)                                                                                                                                                                                 |
| D-8 | **`listPanes(layout)[0]?.id ?? ""`** repeated ~15 times in one test file; the `?? ""` fallback quietly turns a missing pane into a comparison against `""` rather than a failure                                     | [paneLayout.test.ts](src/test/paneLayout.test.ts)                                                                                                                                                                                     |

D-1 and D-2 together are the strongest case for a `src/shared/paths.ts`: `basename`, `dirname`,
`isInside`, `reparent`. Four of the five sites also disagree about edge cases — `tauri.ts:69-72` does
`slice(0, Math.max(lastIndexOf("/"), lastIndexOf("\\")))`, which on a path with **no** separator evaluates
to `slice(0, -1)` and silently truncates the last character instead of returning empty.

D-4 is the "frankenstein helper" you asked about, in its mildest form: two hooks that are 80% the same
pointer-capture drag primitive with different payloads. `usePanelResize`'s own header comment already says
"Built as a sibling of `useDockDrag` and for the same reason". One `usePointerDrag({onStart, onMove,
onEnd})` would carry both — and would fix the inconsistency that `usePanelResize` guards on
`event.isPrimary && event.button === 0` while `useDockDrag` does not, so a right-button drag on the file
browser header currently re-docks the panel.

---

## 5. Typing

Credit where due: **zero `any` in `src/`**, no `@ts-ignore`, and `unknown` used correctly at the four
places values genuinely arrive untyped. Discriminated unions (`Result`, `LoadState`, `FileNode`,
`PaneNode`, `FileOperation`) are used properly, and `assertNever` exists and is used. This is the strongest
part of the codebase. The remaining issues:

### E-1 — `tsconfig.json` is missing the flags CLAUDE.md §21 names

**Severity: medium**

`strict` is on, but `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `noImplicitOverride` are
all absent — three of the four explicitly listed in the project's own coding standard.

What makes this worth fixing rather than noting: **the code is already written as if the flag were on.**
`paneLayout.ts:216` does `const first = panes[0]; if (!first) throw ...`; `ClaimedRanges` does
`this.ranges[middle]?.to ?? 0` and `if (!range) break`; the tests do `listPanes(x)[0]?.id ?? ""`. Without
`noUncheckedIndexedAccess`, every one of those guards is dead code that a reader has to evaluate and
discard. Either turn the flag on and the guards become load-bearing, or delete them. The current state is
the worst of both.

(`noImplicitOverride` is effectively already satisfied — every widget method uses `override`.)

### E-2 — Four `as` casts doing validation's job

[settings.tsx:83-95](src/shared/settings.tsx#L83-L95). A two-line generic collapses them and removes the
casts from the call sites entirely:

```ts
function oneOf<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}
```

— one cast, contained, instead of four spread around. `normalizeTheme` in `themes.ts` already takes
`unknown` and does this properly; `settings.tsx` should match it.

### E-3 — `previewExtensionForMode` skips the project's own exhaustiveness convention

[viewMode.ts:53-75](src/views/editor/TextEditor/viewMode.ts#L53-L75) switches on `ViewMode` with no
`default: assertNever(mode)`, while `FileBrowser.renderTree` and `ProjectPage.dialogTitle` both use one.
It is safe today (TS catches the missing return), but the convention exists precisely so that adding a
fourth mode fails loudly in every switch.

---

## 6. Logic holes worth a second look

### F-1 — `updateSettings` performs I/O inside a React state updater

**Severity: medium**
[settings.tsx:154-166](src/shared/settings.tsx#L154-L166)

```ts
setSettings((previous) => {
    const next = normalizeSettings({ ...previous, ...partial });
    void saveSettings(next).then(...);   // <- side effect in an updater
    return next;
});
```

React may invoke an updater more than once (it does, under StrictMode in development), so every settings
change can fire two `save_settings` IPC calls. Updaters must be pure. Compute `next` outside, or move the
persist into an effect keyed on `settings`.

### F-2 — Rename silently destroys undo history

**Severity: low**
[ProjectPage.tsx:291-301](src/views/ProjectPage/ProjectPage.tsx#L291-L301) + [:563](src/views/ProjectPage/ProjectPage.tsx#L563)

`repointOpenFile` sets `{path: newPath, initialDoc: currentDoc}`, which changes the React `key`, which
remounts `TextEditor`, which throws away the undo stack. The content is preserved, so this looks correct —
but renaming a file mid-edit quietly costs the user their history, and nothing says so.

### F-3 — Concurrent opens resolve last-to-finish, not last-clicked

**Severity: low (CLAUDE.md §9 — "Support AbortSignal")**
[ProjectPage.tsx:185-203](src/views/ProjectPage/ProjectPage.tsx#L185-L203)

`openFileByPath` awaits `readFile` then unconditionally `setOpenFile`. Two quick clicks on different files
race; whichever read finishes last wins, regardless of which was asked for last. `refreshTree` and
`refreshReferences` have the same shape. The initial-load effect got this right with a `cancelled` flag —
the request-scoped paths did not.

### F-4 — Re-opening the current file is a no-op, including when that is what you want

**Severity: low**
[ProjectPage.tsx:187](src/views/ProjectPage/ProjectPage.tsx#L187)

`if (path === openFileRef.current?.path) return;` — so "click the file again to discard my unsaved changes
and reload from disk" does nothing at all, silently. In the pane world this guard has to become per-pane
anyway, which is the moment to reconsider it.

### F-5 — `findMainFilePath` only looks at the root level

**Severity: low**
[ProjectPage.tsx:106-115](src/views/ProjectPage/ProjectPage.tsx#L106-L115)

A project whose `.tex` files all live in `chapters/` opens with an empty editor. The bundled `book` and
`thesis` templates both have `chapters/` subdirectories — though both also ship a root `main.tex`, so it
only bites on user-restructured projects.

### F-6 — Native `window.confirm` in a desktop app

**Severity: low (consistency)**
[ProjectPage.tsx:182](src/views/ProjectPage/ProjectPage.tsx#L182), [:325](src/views/ProjectPage/ProjectPage.tsx#L325)

Three flows use the browser's blocking modal while the app has its own `NameDialog` component and theme.
Also untestable without stubbing a global, which the test suite has to do.

---

## 7. Tooling and process gaps (CLAUDE.md §21)

- **No ESLint. No Prettier.** Neither is in `package.json`. There is nonetheless an
  `// eslint-disable-next-line no-control-regex` in
  [nameValidation.ts:18](src/shared/nameValidation.ts#L18) — a suppression for a linter that does not
  exist, which is a good sign someone expected one to.
- **CI runs Rust only.** `.github/workflows/rust.yml` does `cargo build` + `cargo test` in `src-tauri`.
  The 470 frontend tests, `tsc --noEmit`, and the Playwright suite never run in CI. The frontend is where
  ~19k of this branch's lines live.
- **No `npm run typecheck` script** — `tsc` only runs as part of `build`.
- **`dist/` and `test-results/` are checked into the working tree** at the repo root.

The smallest high-value change in this document is a second workflow: `npm ci && npx tsc --noEmit && npm test`.

---

## 8. Test and documentation gaps

- **No component tests for the new panes.** `paneLayout.test.ts` covers the pure tree well; `EditorPane`
  and `PaneTree` have none — so drop-side detection, the drop payload handling (A-2), activation, and the
  close button are all untested. CLAUDE.md asks for a suite per page feature.
- **An untested branch in `splitPane`:** inserting _before_ an existing sibling (`side: "left"` or `"top"`
  onto a pane already inside a matching split, [paneLayout.ts:171-177](src/views/ProjectPage/paneLayout.ts#L171-L177)).
  "Keeps repeated splits flat" only exercises the append path.
- **No `docs/split-panes.md`.** Every other feature on this branch has one (`live-preview.md`,
  `theming.md`, `diagnostics.md`, `spell-check.md`, …). CLAUDE.md requires an md per page feature.
- **`docs/project-page.md` does not mention panes**, so the docs currently describe a single-editor page —
  which is accurate today and will silently stop being so the moment A-1 is addressed.
- **The performance numbers are manual, not repeatable.** `docs/live-preview.md` has a good measurement
  table, but nothing in the repo reproduces it, so a regression would only show up as "typing feels
  sluggish" months later. A single vitest case that dispatches N keystrokes into a generated 3,000-line
  document and asserts a generous ceiling would lock in what was already proven.

---

## 9. What is good (so the above is calibrated)

- **Type discipline is genuinely strong.** No `any`, no `@ts-ignore`, correct discriminated unions, and
  `assertNever` actually used. Most codebases this size do not manage this.
- **The comments explain _why_.** `pointerSelection.ts`'s header, the note at
  [livePreview.ts:636-646](src/views/editor/TextEditor/LivePreview/livePreview.ts#L636-L646) explaining
  why checking the full range was a bug, and the `enableAutocomplete: false` rationale in `TextEditor.tsx`
  are all exactly what CLAUDE.md §2 asks for — each one records a debugging session that would otherwise
  be repeated.
- **`ClaimedRanges`** is a real data structure with a real justification (binary search because the linear
  version made decoration building quadratic) and its own test file, including the deliberate
  touching-endpoints semantics. That is the right instinct.
- **`revealBlockOnVerticalMotion`** picking a transaction filter over a keymap, so it covers Vim and Helix
  motions for free, is a genuinely good architectural call.
- **The performance work is done properly.** `docs/live-preview.md` reports first-render and keystroke
  cost across three document sizes, isolates the cached-scan win with a before/after, and then resists
  the temptation to optimise further — correctly identifying decoration rebuilding as the residual cost
  and calling the incremental version "substantially riskier". That is CLAUDE.md §6 followed to the
  letter, and it is rarer than it should be.
- **The split-pane tree model is the right shape** — the VS Code flattening rule, keying by node id to
  preserve editor state, and keeping documents out of the tree are all correct decisions, made for stated
  reasons. A-5 and A-6 are blemishes on a sound design, not a rewrite.
- **470 passing tests and a clean `tsc`** on a 19k-line branch.

---

## 10. Suggested order of work

1. **A-1** — collapse the seven reconfigure effects and decide who owns editor configuration. Everything
   else about panes is blocked behind this.
2. **A-2 / A-3 / A-4** — make the drag payload typed and the drop validated, before the feature is wired
   up and the bugs become "known behaviour".
3. **A-5 / A-6 / A-7** — tidy the pane API while it still has exactly one call site (zero, in fact).
4. **CI running the frontend** (§7) — cheapest durable win in this document.
5. **D-1/D-2 `shared/paths.ts`** — five sites, one of which is already subtly wrong.
6. **B-1 / B-2** — table rendering: macros first (a visible bug), then `eq`.
7. **E-1** — turn on `noUncheckedIndexedAccess`; the code is already written for it.
8. **B-3** — small, self-contained: drop the duplicate inline-math scan and fix the above-viewport
   `$…$` edge case with it.
