# Browser Tests

Playwright tests that run the editor in a real browser, covering what
the jsdom suites structurally cannot.

```
npm test          # jsdom, fast, the default loop
npm run test:browser   # Chromium, slower, real layout
```

## Why a second test layer

jsdom has **no layout engine**. Every rectangle is zero, nothing has a
position, and no element is ever really "under" the pointer. That is
fine for the parsers and pure functions that make up most of the
preview, and those suites stay in `src/test/*.test.ts`.

It is not fine for anything that depends on geometry, and CodeMirror is
full of such things:

| Needs a real browser | Why jsdom cannot answer it |
|---|---|
| Hover tooltips (spell check, LaTeX help) | Show and hide by comparing pointer position to text rectangles |
| CodeMirror's height map | Built from measured line and widget heights |
| Drag selection | Depends on what sits under the pointer mid-gesture |
| Keymaps (Vim, Helix) | jsdom needs `runScopeHandlers` and a hand-faked `keyCode`, which tests the workaround as much as the editor |
| Theme and contrast | Computed styles resolve against a real cascade |

The bug that prompted this layer is written up in
[live-preview.md](live-preview.md#block-widgets-must-never-carry-a-vertical-margin):
a CSS margin on a block widget desynchronised CodeMirror's height map
from the DOM. Every jsdom test passed throughout, and would have kept
passing, because the disagreement is a purely geometric one.

## The harnesses

Two fixture pages, both mounting **real** components on a bare page.

### `harness.html` — the editor

Mounts `TextEditor` itself. It deliberately does not re-declare the
extension list: a copy would drift, and then the tests would be
verifying a fiction.

Configuration comes from the query string, so one fixture serves every
scenario and no test needs its own page:

| Param | Values | Default |
|---|---|---|
| `doc` | URL-encoded document text | short prose with misspellings |
| `view` | `source` \| `live` \| `readonly` | `live` |
| `modal` | `none` \| `vim` \| `helix` | `none` |
| `spell` | `on` \| `off` | `on` |
| `lines` | `absolute` \| `relative` \| `mixed` | `absolute` |
| `theme` | `dark` \| `light` | `dark` |

The page publishes two handles on `window`: `moonstoneReady` (await it
before touching anything) and `moonstoneView`, the live `EditorView`.
Driving assertions through the view rather than through DOM selectors
is usually more robust — a word is a slice of a text node, not an
element, so `view.coordsAtPos` is the only honest way to point at one.

### `workspaceHarness.html` — the project page's layout

Mounts a real `ResizablePanel` around a real `FileBrowser`, beside a
placeholder editor pane, using the project page's own CSS.

**No backend is mocked, and that is deliberate.** `FileBrowser` takes
its tree as a prop, so a fixture tree is enough to render the real
component. A mocked IPC layer that drifted from the real backend would
produce tests that pass while the app is broken; not needing one yet is
worth preserving. The editor pane is a placeholder because what is
under test is how the panes share width — mounting CodeMirror there
would add noise, not fidelity.

| Param | Values | Default |
|---|---|---|
| `side` | `left` \| `right` | `left` |
| `width` | initial panel width in px | 220 |
| `names` | `long` \| `short` | `long` |

## What is not covered

**There is no Tauri backend.** The harness mounts the editor alone, so
nothing crossing into Rust — the file browser's contents, settings
persistence, project loading — is exercised here. Extending the harness
with a mocked `shared/tauri.ts` would open up full-page tests (the
project page, the file browser's resize behaviour); it has not been
done yet.

**Chromium is not WebView2.** The engines are close relatives and
engine-level bugs reproduce faithfully, but Moonstone ships in
WebView2. A visual fix is still worth eyeballing in the real app before
it is called done.

## Conventions

- Specs are named `*.browser.spec.ts` and live in `src/test/browser/`.
  Vitest excludes that directory (`vite.config.ts`) and Playwright
  matches only that suffix, so the two runners never collect each
  other's files.
- `playwright.config.ts` starts the Vite dev server itself and reuses
  one that is already running locally.
- **Retries are off.** A failure here is a real geometry bug far more
  often than it is flake, and retrying would hide exactly the class of
  intermittent, layout-dependent problem this layer exists to catch.
- When fixing a bug, put the bug back once and watch the new test fail.
  This is not optional diligence — it has caught a bad test **every
  time** it has been done:

  | Test written for | What was wrong with it |
  |---|---|
  | Preamble widget margin | Sampled only a line's centre; drift under half a line is invisible there |
  | Preamble widget margin | Measured the widget's own box, which excludes margins by definition |
  | Colour literals in the light theme | Scanned the DOM, so hover/selected/drop-target rules were never evaluated |
  | Selection inside an env box | Read `rgb(19, 26, 38)`'s blue channel as the alpha, so an opaque colour looked translucent |
  | Undefined macros | Looked for the error colour under `.katex`, which is not where KaTeX puts it |

  Every one of those passed against broken code. A test that cannot
  fail is worse than no test, because it reads as coverage.

- **Assert the styling, not just the element.** A `toBeVisible` check
  on Helix's status panel passed happily while the panel was completely
  unthemed — our stylesheet targeted `.hx-status-panel` and the package
  emits `.cm-hx-status-panel`. Comparing the computed background
  against the palette is what catches a selector that matches nothing.

## Files

- `playwright.config.ts` — runner config, dev server, Chromium project
- `src/test/browser/harness.html` / `harness.tsx` — editor fixture
- `src/test/browser/workspaceHarness.html` / `.tsx` — layout fixture
- `src/test/browser/livePreview.browser.spec.ts` — height map vs DOM
- `src/test/browser/spellCheck.browser.spec.ts` — correction popup
- `src/test/browser/fileBrowserPanel.browser.spec.ts` — panel resize,
  collapse, and name truncation
- `src/test/browser/theme.browser.spec.ts` — contrast audit for both
  palettes (see [theming.md](theming.md))

## Checking that the guards still guard

Every bug fixed so far has been re-verified by reverting the fix and
confirming a test notices. Current state, all confirmed:

| Fix | Test that catches it |
|---|---|
| Macros handed to KaTeX | `livePreview.test.ts` |
| `\multirow` supported | `parseTabular.test.ts` |
| Table struts stripped | `parseTabular.test.ts` |
| `\paragraph` heading levels | `findSections.test.ts` |
| Cursor stops inside blocks | `livePreview.browser.spec.ts` |
| Selection visible in an env box | `livePreview.browser.spec.ts` |
| Preamble widget uses padding, not margin | `livePreview.browser.spec.ts` |
| Env box survives inner display maths | `livePreview.test.ts` |
| Reveal frozen during a drag | `livePreview.test.ts` |
| Vim mode label | `modalMode.browser.spec.ts` |
| Modal panels are themed | `modalMode.browser.spec.ts` |
| Light-theme tints are perceptible | `theme.browser.spec.ts` |
| No colour literals outside the palette | `themePalette.test.ts` |

Worth repeating after a refactor that touches the preview, the theme
tokens or the modal extensions. Reverting one fix at a time and running
the named suite is enough; a fix whose revert leaves the suite green
has no coverage, whatever the test names suggest.

## The jsdom side

`src/test/setup.ts` installs an **inert `ResizeObserver`**, which jsdom
does not implement. It is deliberately a no-op rather than a
simulation: jsdom has no layout, so there are no size changes to
report, and a fake that invented some would mislead. Components that
watch their container mount cleanly under jsdom and are tested for real
here.
