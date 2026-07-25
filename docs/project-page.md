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

- **Inline rename:** "Rename" edits the name in place in the tree
  (`RenameInput`) — Enter commits, Escape/blur cancels, invalid names
  show the backend error on the field. Keeps a file's `.tex` extension
  when the new name has no dot.
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

## Editor wiring

`TextEditor` is file-agnostic: the page passes `initialDoc` and
remounts it with `key={file.path}`, giving each file a clean editor and
its own undo history. The page owns dirtiness (set on any doc change,
cleared on save) and holds the `EditorView` ref so toolbar/hotbar
actions can drive it.

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
- `src-tauri/src/file_manager.rs` — `move_entry` and other file commands
- Tests: `src/test/ProjectPage.test.tsx`
