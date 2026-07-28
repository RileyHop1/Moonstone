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

## The harness

`src/test/browser/harness.html` + `harness.tsx` mount the **real**
`TextEditor` component on a bare page. They deliberately do not
re-declare its extension list: a copy would drift, and then the tests
would be verifying a fiction.

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
  Two of the three geometry tests written for the margin bug passed
  against the unfixed code on the first attempt — sampling only the
  centre of a line, and measuring a widget's own box, are both blind to
  it.

## Files

- `playwright.config.ts` — runner config, dev server, Chromium project
- `src/test/browser/harness.html` / `harness.tsx` — the fixture page
- `src/test/browser/livePreview.browser.spec.ts` — height map vs DOM
- `src/test/browser/spellCheck.browser.spec.ts` — correction popup
