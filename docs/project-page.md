# Project Page

The editing workspace for one project: a dockable file browser, a
toolbar, and the live-preview editor. Opening a project auto-opens its
main file (`<project>.tex` at the root, else the first root-level
file), and the titlebar shows the project name.

## File browser

Queries `list_project_files` for the project's full tree (directories
recurse into subdirectories). Directories expand/collapse on click, and
the header's ⊞/⊟ buttons **expand-all / collapse-all**. Clicking a file
reads it (`read_file`) and opens it in the editor. If the current file
has unsaved changes, a confirm dialog protects them first.

**File management:** the header's ＋file/＋folder buttons create at
the project root; right-clicking a row opens a context menu —
directories offer New File / New Folder / Rename / Delete, files offer
Rename / Delete. Deletes are confirmed and go to the **recycle bin**
(never permanent).

- **New file:** the dialog asks only for a name; the extension comes
  from a **File type** dropdown (`src/shared/fileTypes.ts`), defaulting
  to `.tex`, and the resulting filename is previewed under the field so
  it is never a surprise. A folder's dialog omits the picker.
- **Inline rename:** "Rename" edits the name in place in the tree
  (`RenameInput`) — Enter commits, Escape/blur cancels. Invalid names
  are caught by the shared guard before any round trip and shown on the
  field; backend errors surface the same way. Keeps a file's `.tex`
  extension when the new name has no dot.
- **Drag-to-move:** drag a file or folder onto a directory row (or the
  empty body, which targets the project root) to move it — the new Rust
  `move_entry` command. The UI and backend both reject moving a folder
  into itself/a descendant and refuse to overwrite an existing name;
  dropping onto the current folder is a no-op.
- An open file follows its own (or an ancestor directory's) rename or
  move without losing unsaved edits (`renamedOpenFilePath`).

New projects seed their initial `.tex` with a basic document template.

**Docking:** the "Files" header is a drag handle using **pointer
events** with pointer capture — separate from the file rows' **HTML5
drag-and-drop** (move). While dragging the header, the window halves
highlight as drop zones; releasing docks the panel to that side.
Docking right simply reverses the flex row (`row-reverse`), so the
editor never remounts. The window sets `dragDropEnabled: false`
(`tauri.conf.json`) so the webview handles HTML5 DnD rather than the OS.

## Resizing and hiding the browser

The browser sits inside a reusable `ResizablePanel`, which owns its
width and collapsed state. The browser itself knows nothing about
either — it simply fills whatever width it is given, which is what
makes the panel reusable for the second file window in the plan.

**Dragging** the splitter on the panel's inner edge resizes it. The
editor is a flex child that grows, so it absorbs exactly what the panel
gives up without any coordination between them. Docked right, the
panel grows as the pointer moves *left*; the hook inverts the delta
from the `side` prop rather than the layout guessing.

**Two floors, both enforced** (`clampPanelWidth`): the panel never goes
below 150px and never leaves its neighbour less than 240px. A panel
that can be dragged to nothing is a panel the user cannot get back,
and the same is true of the editor. When the container is too narrow
to honour both, the panel keeps its minimum — shrinking it further
would not rescue the neighbour and would leave nothing to grab.

The width the user chose is stored separately from the width applied.
A window too narrow to honour their choice displays a clamped value but
remembers the real one, so widening the window restores it instead of
silently keeping the squeezed figure.

**Collapsing** leaves a narrow rail carrying the toggle, so the browser
is always one click from coming back. The stored width is untouched
while collapsed — that is what "restores the last width" means in
practice; no separate cache is needed.

The toggle lives in the splitter's own column rather than floating over
the panel. It was an overlay first, and it collided with whatever the
browser put in that corner: the header buttons on one dock side, the
"FILES" label on the other. Reserving the column removes the class of
problem rather than tuning offsets.

**Long names** truncate with a CSS ellipsis. The `min-width: 0` on
`.file-tree-name` is what makes it work — a flex item refuses to shrink
below its content by default, so without it a long name widens the row
instead of truncating. The truncation is purely visual: rename, open
and drag-to-move all use the real filename, which the browser suite
asserts explicitly.

Width and collapsed state are **per session**, matching the dock side,
which is also not persisted. Persisting all three to settings is a
reasonable follow-on; doing it for width alone would be inconsistent.

Because this is layout and pointer behaviour, its tests are in the
browser suite (`src/test/browser/fileBrowserPanel.browser.spec.ts`) —
jsdom has no widths to redistribute. Only the clamp arithmetic, which
is pure, is unit-tested.

## Editor wiring

`TextEditor` is file-agnostic: the page passes `initialDoc` and
remounts it with `key={file.path}`, giving each file a clean editor and
its own undo history. The page owns dirtiness (set on any doc change,
cleared on save) and holds the `EditorView` ref so toolbar/hotbar
actions can drive it.

The page also owns the project's **bibliography**: it calls
`list_references` when the project opens, hands the list to the editor
for `\cite{…}` completion, and reloads it after a `.bib` file is saved
so new entries are citable straight away — see
[bibliography](bibliography.md).

## Toolbar

- **Save** (also Ctrl+S) → `save_file`; disabled while clean; shows a
  transient "Saved ✓" on success and a red message on failure.
- **Undo / Redo** → CodeMirror history commands.
- **Snippet buttons** (math, table, α, β, ∑, ∫, fraction, √, template)
  insert LaTeX at the cursor and place the caret at the snippet's
  editing position (`src/views/editor/TextEditor/snippets.ts`).
- **Exit** returns to the project browser, confirming if dirty.

The same actions are registered into the app-actions context so the
GlobalHotBar menus (File > Save, Edit > Undo, Insert > Math, …) work
while this page is open and render disabled elsewhere.

## Files

- `src/views/ProjectPage/ProjectPage.tsx` — state + orchestration
- `src/views/ProjectPage/FileBrowser/` — tree panel (+ `RenameInput.tsx`)
- `src/views/ProjectPage/Toolbar/` — action row
- `src/shared/useDockDrag.ts` — drag-to-dock hook
- `src/shared/usePanelResize.ts` — splitter drag hook + width clamp
- `src/components/ResizablePanel.tsx` — resizable, collapsible panel
- `src/styles/ResizablePanel.css` — panel and splitter styling
- `src-tauri/src/file_manager.rs` — `move_entry` and other file commands
- Tests: `src/test/ProjectPage.test.tsx`,
  `src/test/usePanelResize.test.ts` (clamp arithmetic),
  `src/test/browser/fileBrowserPanel.browser.spec.ts` (drag, collapse,
  truncation)
