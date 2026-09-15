# File types

What the editor does with a file, decided by its extension.

Source: `src/views/editor/TextEditor/editorProfile.ts`,
`src/views/editor/TextEditor/language.ts`
Tests: `src/test/editorProfile.test.ts`, `src/test/TextEditor.test.tsx`

## The problem this solves

The backend accepts fourteen text formats. The editor treated all
fourteen as LaTeX: `latex()` was applied unconditionally in
`TextEditor.tsx`, outside any compartment, and the live preview ran on
whatever was in the buffer. So in a `.bib` file a `$` in an article
title became inline maths, `\'{e}` became an accented character, and the
LaTeX linter reported errors against bibliographic data. In a `.csv`,
`\alpha` became α.

"Editable" had come to mean "the backend will store it", not "Moonstone
understands it". Bibliography is a shipped feature, so `.bib` files are
files people actually open.

## The three profiles

| Profile          | Extensions                                       | Language | Lint | Preview |
| ---------------- | ------------------------------------------------ | -------- | ---- | ------- |
| **Full LaTeX**   | `tex` `ltx`                                      | yes      | yes  | yes     |
| **LaTeX source** | `sty` `cls` `bst` `dtx` `ins` `def` `cfg` `tikz` | yes      | yes  | **no**  |
| **Plain text**   | `txt` `csv` `md` `bib`                           | no       | no   | no      |

The middle one is the interesting case, and the reason this is three
profiles rather than a boolean. A `.sty` or `.cls` **is** LaTeX and
deserves highlighting, bracket closing and tooltips — but it is LaTeX
_source_. A `\textbf{...}` inside a `\newcommand` body is not text to
embolden; an environment there is a definition, not a box to draw.
Highlighting helps and rendering actively misleads.

**Unknown extensions get plain text.** Applying a LaTeX parser to a file
nobody claimed is exactly how the original problem happened, so doing
nothing is the safe default. A dotfile like `.gitignore` counts as
having no extension: that is a name, not a type.

### Why `.bib` is plain text _for now_

A `.bib` file is structured data, not prose. Treating it as LaTeX is
what made `$H(X)$` in a title render as maths. Plain text is correct
today, but it is not the end state: entry-aware highlighting, key
completion and field validation are the natural follow-on, and that is
when `.bib` earns a profile of its own.

## How it is wired

`editorProfileForPath(path)` is pure and returns one of three **module
singletons**. Identity matters: the `SYNCED` table compares profiles by
reference to decide whether to reconfigure, so two `.tex` files share
one object and only a genuine change of file type costs a dispatch.

Two rows in [`SYNCED`](editor-configuration.md) read the profile:

- **`languageCompartment`** — builds `latex()` or nothing at all.
  A compartment rather than a mount-time decision, because a pane can
  open a different file type without remounting, and remounting would
  cost the undo history.
- **`previewCompartment`** — the profile has a **veto**. The user's view
  mode says what they want to see; the profile says what the file can
  support. A `.csv` renders no maths in any mode.

The two are deliberately separate questions. Read-only survives a
profile that does not render: the user asked for a document they cannot
edit, and a file that happens not to render is still not theirs to type
into.

Because the profile lives in `EditorConfiguration`, it is naturally
per-pane — see
[Per-pane configuration](editor-configuration.md#per-pane-configuration).
A `.bib` open beside a `.tex` stays raw without dragging the `.tex` out
of live mode.

## Adding a file type

1. Add it to `FILE_TYPES` in `src/shared/fileTypes.ts` so the New File
   dialog offers it.
2. Add it to `PROFILES` in `editorProfile.ts`.

Step 1 without step 2 is a **test failure**, not a silent fallback to
plain text: `editorProfile.test.ts` asserts that the set of creatable
extensions matches the set of decided ones exactly.
