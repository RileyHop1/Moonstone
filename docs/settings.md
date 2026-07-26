# Settings

The settings page (`src/views/Settings/`) controls user preferences,
applied live and persisted by the backend as JSON in the app config
directory (`settings.rs`, commands `get_settings` / `save_settings`).
Loading is fail-soft: a missing or corrupt settings file yields the
defaults.

## Layout

A sidebar of sections beside the selected section's controls. Every
control applies immediately and persists itself, so there is no save
button and no way to lose a change by navigating away.

| Section | Settings |
|---|---|
| General | Theme |
| Editor | Font size |

Sections are declared in `settingsTabs.ts` as plain data, so adding one
is a line there plus its panel component. `Settings.tsx` owns only the
selection and the sidebar; each panel (`GeneralTab`, `EditorTab`) reads
and writes settings itself. `SettingsRow` and `ChoiceButtons` are the
two shared building blocks — a labelled row and a set of mutually
exclusive options.

The sidebar is a `tablist` and the panel a `tabpanel`, so the sections
are navigable and testable by role rather than by class name.

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

## Adding a setting

Every field on the Rust `AppSettings` carries its **own** serde
default. That is deliberate: a settings file written by an older build
is missing the newer fields, and per-field defaults let those fill in
individually instead of the file failing to parse and resetting every
preference the user had set. Two tests cover it — a file with fields
missing, and a file with fields we do not recognise.

So a new setting is: a field with `#[serde(default = …)]` in
`settings.rs`, the matching field on the frontend `AppSettings` type,
normalization in `normalizeSettings`, and a control in the relevant
panel.

Tests: `src/test/Settings.test.tsx`, `settings_tests` in `settings.rs`.
