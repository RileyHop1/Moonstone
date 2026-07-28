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
| Editor | Font size, edit mode, line numbers, spell check |
| Advanced | Show editor diagnostics |

Sections are declared in `settingsTabs.ts` as plain data, so adding one
is a line there plus its panel component. `Settings.tsx` owns only the
selection and the sidebar; each panel (`GeneralTab`, `EditorTab`) reads
and writes settings itself.

`SettingsRow` — a labelled row — holds one of two controls, chosen by
how long the option list is:

- **`ChoiceButtons`**, a row of buttons, for two or three mutually
  exclusive options. The default, and what most rows use.
- **`SettingsSelect`**, a dropdown, for lists that are open-ended.

The theme picker started as buttons and outgrew them: six themes
overflowed the settings card and squeezed the label to one word per
line. Anything expected to keep growing belongs in the dropdown.

`SettingsSelect` wraps a **native `<select>`** deliberately. Keyboard
navigation, type-to-find, screen-reader semantics and scrolling for a
long list all come free and correct, where a hand-rolled listbox has to
reproduce each one. The cost: the open popup is drawn by the OS and
follows the palette only as far as `color-scheme` allows — a neutral
dark or light menu rather than a tinted one, and only while open. Every
palette sets `color-scheme`, or a dark theme would open a white menu.

The row gives its label a `min-width` and lets the control shrink.
Before that the control refused to give ground, so a long one pushed
past the card instead of the row adapting.

The sidebar is a `tablist` and the panel a `tabpanel`, so the sections
are navigable and testable by role rather than by class name.

## Current settings

- **Theme** — seven palettes: Dark (default), Light, Blood Moon, Blue
  Moon, Harvest Moon, New Moon and Eclipse (high contrast). Each is a
  block of CSS variables
  selected by `data-theme` on the document element; the editor chrome
  and syntax colours route through the same variables, so the whole app
  (CodeMirror included) follows the choice. Full write-up, including
  how to add one, in `theming.md`.
- **Editor font size** — 10–24 px (clamped), applied through the
  `--editor-font-size` CSS variable.
- **Edit mode** — None, Vim or Helix. See `modal-editing.md`.
- **Line numbers** — absolute, relative, or mixed. See below.
- **Spell check** — on by default. See `spell-check.md`.
- **Show editor diagnostics** — the developer overlay, off by default.
  It sits under Advanced rather than Editor because it reports on the
  editor rather than changing how it behaves, and most users never
  need it. See `diagnostics.md`.

### Line numbering

- **Absolute** — each line's own number, as most editors show.
- **Relative** — distance from the cursor, for jumping (`5j`, `d3k`).
  The cursor's own line keeps its absolute number: a zero there says
  nothing, whereas the real number is what you need to jump to or cite
  a line.
- **Mixed** — absolute while inserting text, where numbers are for
  reading, and relative otherwise, where they are for moving.

**The whole setting is gated on modal editing.** Counting from the
cursor exists to serve motions like `5j` and `d3k`, so with edit mode
set to None the control is disabled — and the editor ignores the stored
value rather than clearing it, so turning Vim or Helix back on restores
the numbering that was chosen. Gating the UI without gating the
behaviour would leave a disabled control that was still doing
something.

The implementation is worth knowing about, because the obvious approach
does not work. `basicSetup` already installs a line-number gutter, and
`lineNumbers({formatNumber})` overrides its formatting — but the
built-in gutter only re-renders when its **config** changes, not on
selection, so relative numbers would be correct on the first paint and
then frozen as the cursor moved.

Instead, `LineNumbers/lineNumbers.ts` supplies **markers** through the
public `lineNumberMarkers` facet, which that same gutter renders in
place of the plain numbers. Because the facet is computed from the
state (`["doc", "selection", insertModeField]`), the gutter re-renders
whenever the cursor moves — declaratively, with no dispatching and no
frame of lag. Absolute mode contributes no markers at all, so it costs
nothing per keystroke.

Insert-mode tracking (`LineNumbers/insertMode.ts`) exists because
neither modal package puts its mode in the editor state. Vim exposes
its state through `getCM(view)`. Helix publishes nothing, so its block
cursor stands in — it shows a block in every mode except insert, which
is exactly the distinction mixed mode draws. A small view plugin
mirrors whichever signal applies into a state field for the facet to
read.

Two details that are easy to get wrong, both found by testing this in
the app rather than in isolation:

- **Helix only maintains that cursor class when its insert cursor is a
  bar**, which is not its default. `modalMode.ts` therefore starts
  Helix with `"editor.cursor-shape.insert": "bar"` — worth doing twice
  over, since a bar cursor while inserting is also the usual signal
  that typing will insert rather than command.
- **The field is seeded with `.init()`, not left to its default.** A
  modal editor always starts in normal mode, and every compartment
  reconfigure re-runs `create`. Letting the watcher correct the start
  value made numbering depend on whether the modal package had
  attached itself yet, which is a race.

Edit mode and spell check were previously session-only toggles in the
**View** menu. They are preferences, so they live here and persist;
duplicating them in a menu would mean two places to change one thing.
View modes (Source/Live/Read-Only) deliberately stayed in the View menu
and toolbar — those are per-document state you switch constantly, not a
preference.

`ProjectPage` reads both from `useSettings()` and reconfigures the
editor's compartments when they change, so a change applies to the open
document immediately without losing the document or undo history.

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
