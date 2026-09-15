# Shared utilities

Two small modules in `src/shared/` that several features depend on, each
consolidating logic that had been written more than once.

## `paths.ts`

String arithmetic on the paths the backend hands us: `basename`,
`dirname`, `join`, `isInside`, `isAtOrInside`, `reparent`, `segmentsOf`,
`separatorOf`, `withSeparator`, `isAbsolute`.

Tests: `src/test/paths.test.ts`

These replaced five hand-rolled copies — in the file browser, the
project page (twice), the editor pane, and the Tauri wrapper — which
had drifted apart. One of them was **wrong**:

```ts
// The old dirname, in tauri.ts:
documentPath.slice(0, Math.max(documentPath.lastIndexOf("/"), documentPath.lastIndexOf("\\")));
```

On a path with no separator at all, both `lastIndexOf` calls return -1,
so this is `slice(0, -1)` — it silently drops the last character and
calls the result a directory.

Things worth knowing:

- **Either separator is accepted anywhere.** The backend returns
  backslashes on Windows, but the user and LaTeX write forward slashes,
  and a `\includegraphics{figures/plot.png}` in a document whose path
  uses backslashes has to resolve. Comparisons normalise both sides.

- **`isInside` requires a separator, not just a prefix.** Without it
  `C:\project-notes` counts as inside `C:\project`, which would make a
  delete close the wrong editor.

- **Case is _not_ normalised.** Windows would treat `C:\Project` and
  `C:\project` as the same directory. Every path here comes from the
  backend's own tree and is cased consistently, and lowercasing would
  introduce false matches where case does count.

- **These are string operations, not filesystem ones.** Nothing touches
  disk, resolves symlinks, or collapses `.` and `..`.
  `src-tauri/src/paths.rs` is the authority for anything that must be
  true of the real filesystem; this is for deciding what to display and
  which pane to update.

## `usePointerDrag.ts`

The pointer gesture behind every draggable handle: the file browser's
dock handle (`useDockDrag`), the panel splitter (`usePanelResize`), and
the boundary between editor panes (`PaneSplitter`).

Tests: `src/test/usePointerDrag.test.tsx`

All three were the same twenty lines — press, capture the pointer, track
movement, release — differing only in what they did with the numbers.
They had also **drifted into a real bug**: `usePanelResize` guarded on
`isPrimary && button === 0` and `useDockDrag` did not, so a right-button
drag on the file browser's header re-docked the panel.

- **Pointer capture is the point.** Without it, moving faster than the
  browser dispatches events takes the pointer off the handle and the
  drag stops. With it, every further move and the release are routed
  back to the handle wherever the pointer actually is.

- **`thresholdPx` separates a click from a drag.** The dock handle is
  also just a header, so a press that never travels must not re-dock
  anything; `onEnd` reports whether the gesture ever passed the
  threshold. A splitter wants every pixel, so it leaves the threshold at
  zero.

- **`onStart` can decline.** Returning `false` abandons the gesture
  before capture — used by the pane splitter when its split has no
  measurable extent, which would otherwise produce `NaN` shares.

- **Handlers are read from a ref**, so the returned props are stable and
  a caller need not memoise anything.

### Testing pointer drags

jsdom implements no pointer capture, so any handle built on this throws
on the first press. `src/test/setup.ts` installs an inert stub that
records captures rather than ignoring them, so a test can assert one was
taken.

What that buys is testing the gesture's **decisions** — whether it
starts at all, whether a press counts as a drag, what it computes. It
does not buy geometry: jsdom has no layout, so anything depending on
real rectangles belongs in the browser suite. This is why the pane
splitter's arithmetic lives in `boundaryShares`, a pure function in the
layout model, rather than inside the component.
