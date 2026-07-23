# Settings

The settings page (`src/views/Settings/`) controls user preferences,
applied live and persisted by the backend as JSON in the app config
directory (`settings.rs`, commands `get_settings` / `save_settings`).
Loading is fail-soft: a missing or corrupt settings file yields the
defaults.

## Current settings

- **Theme** — dark (default) or light. The palette is a set of CSS
  variables on `:root`, overridden under `:root[data-theme="light"]`;
  the editor chrome and syntax colors route through the same
  variables, so the whole app (CodeMirror included) follows the
  toggle. Also reachable from the hotbar: **Settings > Light/Dark**.
- **Editor font size** — 10–24 px (clamped), applied through the
  `--editor-font-size` CSS variable.

## How it flows

`SettingsProvider` (`src/shared/settings.tsx`) loads once at startup,
stamps `data-theme` and `--editor-font-size` onto the document root on
every change, and persists updates in the background. Values crossing
the IPC boundary are normalized/clamped — nothing from disk is
trusted as-is.

Planned later: configurable project root, more editor preferences.

Tests: `src/test/Settings.test.tsx`.
