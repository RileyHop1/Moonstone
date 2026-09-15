# Split editor panes

Several files open side by side in the editor area.

Source: `src/views/ProjectPage/paneLayout.ts` (the model),
`PaneTree.tsx` (rendering), `EditorPane.tsx` (one pane)
Tests: `src/test/paneLayout.test.ts`, `src/test/PaneTree.test.tsx`,
`src/test/EditorPane.test.tsx`

> **Status:** the model, rendering, drop handling and the draggable
> splitter are complete and tested. Wiring into `ProjectPage` — per-pane
> documents, save, focus — is the next stage; until then nothing mounts a
> `PaneTree`.

## The model

A layout is a tree, and the tree is the whole model:

```ts
type PaneNode = PaneLeaf | PaneSplit;

interface PaneLeaf {
  kind: "leaf";
  id: PaneId;
  path: string | null; // the file shown, or null for an empty pane
}

interface PaneSplit {
  kind: "split";
  id: PaneId;
  direction: "row" | "column";
  children: readonly PaneNode[];
  sizes: readonly number[]; // parallel to children, summing to 1
}
```

Three decisions are worth stating, because each has a cost if reversed:

- **Documents are not in the tree.** A leaf holds a _path_; the page
  owns the loaded text separately, keyed by pane id. Two panes may show
  the same file, and each needs its own editor state and undo history.

- **Splits carry an id purely so React can key them.** Keying children
  by position would remount every editor below an insertion, throwing
  away undo history and scroll position.

- **Repeated splits in one direction stay flat.** Splitting right three
  times gives one row of four panes, not three levels of nesting. This
  is what VS Code does, and the alternative produces a tree the user did
  not ask for and cannot reason about.

## Everything here is pure

Ids come from the caller, not from a module counter:

```ts
const nextId = createPaneIdFactory();
let layout = createLayout("main.tex", nextId());
layout = splitPane(layout, "pane-1", "right", "notes.tex", {
  paneId: nextId(),
  splitId: nextId(),
});
```

This looks like ceremony and buys three things:

1. **The same inputs give the same tree**, so a test can assert on a
   whole layout by value rather than fishing ids out of the result.
2. **Tests do not depend on each other's history.** A module counter
   makes every id depend on how many tests ran before.
3. **A restored layout can seed its own factory** past the highest id it
   contains (`createPaneIdFactory(highest)`), instead of colliding with
   ids already in the tree. Persisting layouts is an obvious next step
   and this is what makes it cheap.

`closePane` returns `{layout, closed}` rather than a bare tree, because
it refuses to remove the last pane — an editor area with no panes has
nowhere to put the next file. Without the flag, "unchanged" means both
"refused" and "closed something that happened to leave the same shape",
and a caller moving focus afterwards would move it off a pane still on
screen.

## Sizes

Each split stores its children's shares, summing to 1 and rendered as
`flex-grow`. The rules:

- A fresh split is **even**: `[0.5, 0.5]`.
- Splitting a pane inside an existing split takes **half of that pane's
  share**, leaving its siblings untouched. Splitting one of three panes
  should not reshuffle the other two.
- Closing a pane **shares its space out in proportion**, so the
  survivors keep their relative sizes.
- `resizeSplit` normalises whatever it is given, and refuses a count
  that does not match the children, or any share that is zero, negative
  or not finite — applying those would leave `sizes` and `children` out
  of step, which every other function here assumes cannot happen.

### Dragging a boundary

`PaneSplitter` sits between each neighbouring pair, built on the shared
`usePointerDrag` gesture. The arithmetic lives in `boundaryShares`, in
the model, so it is testable without a DOM.

It works in **pixels and converts back to shares at the end**. Shares
are relative to a container whose size the splitter would otherwise have
to guess, and the pointer has to track the boundary exactly or the drag
feels like it is slipping. The split's extent is measured when the drag
starts rather than kept in state — it changes with every window resize,
and a stale value scales the whole gesture.

Only the two panes either side move: their **combined** share is
preserved, so dragging the first boundary of a three-column row leaves
the third column exactly where it was. Neither neighbour can be dragged
below `MIN_PANE_PX`, because a pane collapsed to nothing has no edge
left to drag back.

## Drop targets

Dragging a file from the browser onto a pane splits it. `edgeForPoint`
decides which edge, and lives in the model rather than the component so
it can be tested without a DOM.

**Distances are compared in pixels, not as fractions of each axis.**
Comparing fractions makes the answer depend on the pane's aspect ratio:
on a 1600x300 pane, a point 200px from the left and 70px from the top
gives 200/1600 = 0.125 against 70/300 = 0.233, so the _left_ edge wins
despite being nearly three times further away. The edge zone is a
quarter of the pane's **smaller** dimension, capped at 120px so a very
large pane does not turn most of itself into a drop zone.

The middle of a pane is deliberately not an edge: dropping there
replaces the pane's file instead of splitting, which is what stops every
drop from making another column.

Everything about validating the drag payload — why a private MIME type,
why the kind travels with the path, and the `effectAllowed`/`dropEffect`
trap — is in `docs/project-page.md`.

## Still to do

- **Wiring into `ProjectPage`:** per-pane documents, dirty tracking,
  save and focus, and a `Map<PaneId, EditorView>` maintained through
  `onViewReady` / `onViewDestroyed`.
- **Persisting layouts** across sessions. The id factory is ready for
  it; nothing else is.
- **Keyboard resizing.** The splitter is a `role="separator"` but does
  not yet respond to arrow keys.
