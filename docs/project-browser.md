# Project Browser

The landing page of Moonstone. It queries the backend (`list_projects`)
for every project under `~/Documents/Moonstone` and shows them in a
responsive grid — a page-style icon above each project's name.

## Behavior

- **Double-click a card** to open that project's page.
- **Right-click a card** for its context menu — currently just
  Delete, which (after confirmation) sends the whole project to the
  recycle bin via `delete_project` and refreshes the grid.
- **File > New Project** (or the empty-state button) opens a modal
  dialog. Names are validated in the frontend (non-empty, no path
  separators or reserved characters, no leading dot) and again by the
  backend, which is the authority. On success the app navigates
  straight into the new project.
- Loading, error (with Retry), and empty states are rendered from a
  `LoadState` discriminated union, so every state is handled
  explicitly.

## Files

- `src/views/ProjectBrowser/ProjectBrowser.tsx` — page + data fetch
- `src/views/ProjectBrowser/ProjectCard.tsx` — one grid tile
- `src/views/ProjectBrowser/NewProjectDialog.tsx` — creation modal
- Tests: `src/test/ProjectBrowser.test.tsx`
