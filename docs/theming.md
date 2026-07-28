# Theming

Seven palettes, all named for the moon, selected in **Settings →
General → Theme** and persisted with the other settings.

| Theme | Character |
|---|---|
| **Dark** | The default moonstone: blue-black body, silver-blue sheen |
| **Light** | The same stone in daylight — milky blue-white |
| **Blood Moon** | Lunar eclipse; copper-red on a red-black body |
| **Blue Moon** | Rarer and colder: saturated royal navy, vivid azure |
| **Harvest Moon** | Low autumn moon; amber and gold, the only theme with no blue |
| **New Moon** | The moon unlit: near-black and monochrome, for OLED |
| **Eclipse** | Totality: pure black behind pure white, vivid syntax. High contrast (AAA) |

`dark` and `light` keep their plain ids because they are already
persisted in users' settings files; renaming them would silently reset
everyone to the default. Their *labels* are what the settings list
shows, so the naming can be revisited without a migration.

## How a theme is applied

`settings.tsx` sets `data-theme` on the document element (`dark` is
also the unattributed default, so the base `:root` block is its
palette). Everything else follows from CSS custom properties declared
in `src/styles/styles.css`, so switching themes repaints the app
without remounting anything.

## Adding a theme

Two steps, and the tests hold you to both:

1. An entry in `THEMES` (`src/shared/themes.ts`) — id, label, whether
   the palette is dark, and optionally a `minContrast` if the theme
   promises more than the WCAG AA default.
2. A `:root[data-theme="<id>"]` block in `styles.css` defining **every**
   variable the base block defines, `color-scheme` included.

Nothing else. The settings list is derived from the registry, the
editor picks its light/dark variant from `isDark`, and the contrast
audit runs over every entry automatically. `themePalette.test.ts` fails
if a registered theme has no palette block, or if a palette omits a
variable the default defines — an omission would silently inherit the
dark value, which is the bug this whole area was born from.

## The one rule

**Colours are declared in `styles.css` and nowhere else.**

This is not tidiness. Interactive tints were originally written as
literals — `rgba(169, 198, 255, 0.08)` — in eight different files.
That is the *dark* accent, so in the light theme every hover,
selection, active line and drop target was a pale blue wash on a
near-white background: present in the DOM, invisible on screen. "The
light theme looks washed out" was that, measured.

`src/test/themePalette.test.ts` enforces the rule by scanning the
source for colour literals outside `styles.css`, and checks that every
colour defined for dark is also defined for light — a variable missing
from the light block silently inherits its dark value.

That scan reads files from disk deliberately. A DOM-based version was
tried first and passed against the unfixed code, because the offending
rules were for hover, selected and drop-target states, none of which
are on screen while a test looks.

## Tokens

| Group | Variables |
|---|---|
| Surfaces | `--bg-app`, `--bg-sidebar`, `--bg-editor`, `--bg-preview`, `--bg-titlebar` |
| Text | `--text-primary`, `--text-secondary`, `--error-color` |
| Identity | `--accent`, `--accent-rgb`, `--border-color`, `--glow`, `--sheen` |
| Interactive | `--surface-hover`, `--surface-selected`, `--surface-active-line`, `--surface-selection`, `--surface-drop-target`, `--surface-error-tint`, `--shadow-menu` |
| Syntax | `--syn-keyword`, `--syn-name`, `--syn-variable`, `--syn-string`, `--syn-number`, `--syn-comment`, `--syn-operator`, `--syn-heading`, `--syn-invalid` |

`--accent-rgb` holds bare channels (`47 86 173`) so a token can mix its
own alpha with `rgb(var(--accent-rgb) / 0.18)`. Use a **semantic**
token at the call site — `var(--surface-hover)` — rather than mixing an
alpha inline, so the strength of a hover is decided once per theme.

### Alphas are per theme, not shared

A tint's alpha does not transfer between palettes. A light colour at
5% over near-black registers; a dark colour at 5% over near-white does
not. The light theme therefore sets its own, slightly stronger, values.
Its menu shadow is also tinted with the palette rather than pure black,
which reads as grime on a pale surface.

## The editor is a special case

CodeMirror themes carry a `dark` boolean that is **not cosmetic**: it
decides which half of every `&dark` / `&light` rule applies, in
CodeMirror's base theme and in third-party extensions. It cannot be
expressed as a CSS variable.

It was hardcoded `true`, so the light theme was light everywhere except
the parts the app does not style itself — CodeMirror's own tooltips and
panel chrome stayed dark. `moonstoneThemeForMode(theme)` now returns
the matching variant, held in `themeCompartment` and reconfigured by
`ProjectPage` when the setting changes, alongside the other
compartments (view mode, modal mode, spell check, line numbers).

There are still only **two** editor theme extensions no matter how many
palettes exist, because the light/dark split is the only thing CSS
cannot express. `isDarkTheme(theme)` picks between them.

## Contrast is asserted, not eyeballed

`src/test/browser/theme.browser.spec.ts` computes real contrast ratios
in the browser for **every** registered palette — five checks each, so
a new theme cannot ship below the bar the first two set:

| Check | Floor |
|---|---|
| Body text on every surface it appears on | 4.5:1 (WCAG AA) |
| Syntax colours against the editor background | 4.5:1 |
| Comments (deliberately dimmed) | 3:1 |
| Borders against their surface | 1.05:1 |
| Hover / selection / active-line tints | 1.05:1 |

The last figure is not a WCAG number — no standard sets a floor for
decorative tints. It is a regression guard, and it is calibrated:
the old dark-tuned tints scored **1.02:1 and 1.04:1** on the light
sidebar, just under it.

### A theme may hold itself to a higher bar

`minContrast` on a theme's registry entry raises the text and syntax
floor for that palette, and lifts its comment floor from 3:1 to 4.5:1.

**Eclipse declares 7:1 (WCAG AAA).** Calling a theme "high contrast" is
a claim, and without this it would mean whatever the palette happened
to land on. The floor bites: the default theme's secondary grey scores
**6.90:1** on black — comfortably AA, and rejected by Eclipse.

A high-contrast palette also differs structurally, not just in its
numbers. Eclipse drops the sheen (a gradient wash is the enemy of
contrast), draws structure with bright borders rather than shifts in
surface tone, and runs its hover and selection tints at two to three
times the alpha of the other themes so a state is unmistakable rather
than merely detectable.

**Deliberately not screenshot baselines.** Pixel baselines are
platform-sensitive — font rendering differs between a dev machine and
CI — and every intentional design change becomes a baseline update.
Contrast ratios are stable across machines and describe what actually
went wrong.

## Files

- `src/shared/themes.ts` — the theme registry (ids, labels, light/dark)
- `src/styles/styles.css` — every palette, and the only place colours live
- `src/views/editor/TextEditor/moonstoneTheme.ts` — editor chrome + syntax, per palette
- `src/shared/settings.tsx` — applies `data-theme` to the document
- Tests: `src/test/themePalette.test.ts` (source rule),
  `src/test/browser/theme.browser.spec.ts` (contrast)
