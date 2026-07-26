# Project Browser

The landing page of Moonstone. It queries the backend (`list_projects`)
for every project under `~/Documents/Moonstone` and shows them in a
responsive grid — a page-style icon above each project's name.

## Behavior

- **Double-click a card** to open that project's page.
- **Right-click a card** for its context menu — Rename and Delete.
  Delete (after confirmation) sends the whole project to the recycle
  bin via `delete_project` and refreshes the grid. Rename opens the
  name dialog and calls `rename_project`, which renames the project's
  `<project>.tex` main file alongside the directory so the project
  page still auto-opens it.
- **File > New Project** (or the empty-state button) opens a modal
  dialog. Names are validated in the frontend and again by the
  backend, which is the authority.  On success the app navigates
  straight into the new project.

## Name guards

`src/shared/nameValidation.ts` mirrors the backend's `validate_name`
(`src-tauri/src/paths.rs`) so a bad name is reported next to the field
instead of arriving as a command failure. Every place a name is typed
— the new project/file/folder dialogs, project rename, and the file
browser's inline rename — runs the same check: non-empty, at most 200
characters, no path separators or `* ? " < > |`, no control
characters, no leading dot, no trailing dot or space, and no Windows
device name (`CON`, `NUL`, `COM1`… — reserved with any extension).
The frontend never accepts what the backend would refuse.
- Loading, error (with Retry), and empty states are rendered from a
  `LoadState` discriminated union, so every state is handled
  explicitly.

## Files

- `src/views/ProjectBrowser/ProjectBrowser.tsx` — page + data fetch
- `src/views/ProjectBrowser/ProjectCard.tsx` — one grid tile
- `src/views/ProjectBrowser/NewProjectDialog.tsx` — creation modal
- `src/shared/nameValidation.ts` — shared name guard
- `src/shared/fileTypes.ts` — selectable file types (new-file dialog)
- Tests: `src/test/ProjectBrowser.test.tsx`,
  `src/test/nameValidation.test.ts`
