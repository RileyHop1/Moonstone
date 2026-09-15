# Editor configuration

How the user's settings reach a running editor.

Source: `src/views/editor/TextEditor/editorConfiguration.ts`
Tests: `src/test/editorConfiguration.test.ts`, `src/test/TextEditor.test.tsx`

## The problem this solves

Settings like theme, view mode and spell check have to change **in
place**. Rebuilding the editor would apply them, but it would also
throw away the document, the undo history and the scroll position, so
CodeMirror's answer is a `Compartment`: a placeholder in the extension
tree whose contents can be swapped by dispatching a `reconfigure`
effect.

The question is who does the dispatching. Originally it was
`ProjectPage`, which held one `EditorView` in a ref and ran **seven**
near-identical effects against it:

```ts
useEffect(() => {
  viewRef.current?.dispatch({
    effects: themeCompartment.reconfigure(moonstoneThemeForMode(theme)),
  });
}, [theme]);
```

…and six more like it, differing only in which compartment and which
dependency. That works for exactly one editor. It does not survive a
second one: the page would have to fan all seven out over a collection
of views, and any one of them left un-fanned leaves that editor
silently stale — still on the old theme, still in the old mode, with
nothing to show anything is wrong.

That was the blocker behind the split-pane work (finding A-1).

## The shape now

The dependency is inverted. Settings are **data**, and each editor
applies its own.

1. **`EditorConfiguration`** — a plain readonly object holding every
   live setting: view mode, modal mode, spell check, theme, line
   numbering, diagnostics, references, `openLink`, and the two
   **per-file** fields — `profile` and `resolveImageSource` — which
   follow the document a pane has open rather than the user's
   preferences. See [Per-pane configuration](#per-pane-configuration).

2. **`SYNCED`** — one row per compartment:

   ```ts
   {
       compartment: themeCompartment,
       build: (configuration) => moonstoneThemeForMode(configuration.theme),
       hasChanged: (previous, next) => previous.theme !== next.theme,
   }
   ```

3. **`editorExtensions(configuration, base)`** builds what the editor
   mounts with — `base` being `basicSetup`, threaded through because
   which compartments outrank it is part of the mapping — and
   **`reconfigurationEffects(previous, next)`** builds what a change
   costs. Both read the same rows, so mount and reconfigure cannot
   drift apart.

`TextEditor` takes `configuration` as a live prop and runs one effect:

```ts
const effects = reconfigurationEffects(appliedRef.current, configuration);
appliedRef.current = configuration;
if (effects.length > 0) view.dispatch({ effects });
```

`ProjectPage` now holds an `EditorView` only for **commands** — save,
undo, redo, snippet insertion, find/replace — which is a far smaller
surface than configuration was.

## Things worth knowing

- **`hasChanged` is explicit per row, not a deep compare.** The point
  of the table is that a theme switch costs one dispatch, not six. A
  test asserts exactly that; if it starts failing with a larger number,
  something has begun over-reporting changes.

- **`references` compares by identity.** A parent that rebuilds the
  array every render will reconfigure every render. Memoise it. The
  same applies to the configuration object itself — build it in a
  `useMemo`, or hoist it if it is static, as the browser-test harness
  does.

- **Changing the modal mode reconfigures two compartments.** Line
  numbering's `"mixed"` setting is defined in terms of the modal
  editor's insert state, so the two move together.

- **Diagnostics is not a compartment.** Visibility is a `StateField`,
  so it cannot be reconfigured; `diagnosticsVisibilityEffect(visible)`
  produces its effect instead and rides along in the same dispatch.

- **Precedence is part of the table, not of the caller.** The modal
  keymap comes first, because Vim and Helix register high-precedence
  keymaps that need to see keys before the default bindings. The
  language comes _last_, after `basicSetup`, because its
  `autoCloseTags` input handler has to see input after
  `closeBrackets` — which is where it sat before it moved into a
  compartment. That is what `afterBase` on a row means, and why
  `editorExtensions` takes `basicSetup` as an argument instead of
  letting `TextEditor` concatenate it.

- **Compartments are module singletons, and that is fine** with any
  number of editors. A `Compartment` is only an identity key; its
  contents live in each editor's own state, so reconfiguring one editor
  leaves every other alone.

## Per-pane configuration

Source: `src/views/ProjectPage/usePaneConfigurations.ts`
Tests: `src/test/usePaneConfigurations.test.ts`

Most of a configuration is a preference and is the same in every pane.
Two fields are not:

| Field                | Follows              | Why                                                                    |
| -------------------- | -------------------- | ---------------------------------------------------------------------- |
| `profile`            | the file's extension | A `.bib` must not be parsed as LaTeX — see [file types](file-types.md) |
| `resolveImageSource` | the file's directory | `\includegraphics` paths are relative to the document                  |

When the page gained a second pane it kept building **one**
configuration from the _active_ document and handing it to every pane.
So an unfocused pane resolved its images against whichever directory
the focused pane happened to be in — invisible until two files in
different directories were open at once.

`usePaneConfigurations(sharedSettings)` returns a lookup from document
path to configuration. `PaneTree` calls it per leaf:

```tsx
configuration={shared.configurationFor(document?.path ?? null)}
```

**Identity is the subtle requirement.** `TextEditor` diffs the object
it is handed, so a fresh configuration per render would reconfigure
every compartment in every pane on every render — rebuilding preview
decorations and resetting modal state. The cache lives inside the
`useMemo` and is keyed by **path**, not by pane, so:

- a pane keeps its object when an unrelated pane opens a file;
- two panes showing the same file share one configuration;
- changing a setting rebuilds everything, which is what should happen.

## Adding a setting

1. Add the field to `EditorConfiguration`.
2. Add a row to `SYNCED` (or, if it is not compartment-backed, an
   explicit branch in `reconfigurationEffects`, as diagnostics has).
3. Populate it where `ProjectPage` builds `sharedSettings`, or in
   `usePaneConfigurations` if it follows the file rather than the user.

The `CHANGES` table in `editorConfiguration.test.ts` is keyed on
`keyof EditorConfiguration`, so step 1 without the rest is a **type
error** rather than a silently untested field.
