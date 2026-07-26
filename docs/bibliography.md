# Bibliography

Inline reference search: type `\cite{` and the project's bibliography
is offered as completions, searchable by more than the citation key.

This is the Overleaf-parity item from the plan — their equivalent is a
premium feature.

## What it does

Typing inside any citation argument opens the completion popup:

```latex
\cite{comp
      └── The LaTeX Companion — Goossens et al., 1993
```

- **Search across fields.** The query is matched against the citation
  key, the title, every author, and the year. Authors remember a paper
  by its title, not by the key they invented for it a year ago, so key-
  only matching would miss the way people actually recall a citation.
- **Unified results.** Every `.bib` file in the project is parsed and
  merged into one list, so a project that splits its bibliography
  across several files behaves exactly like one that does not. Each
  entry knows which file it came from (`sourceName`). Duplicate keys
  collapse to one entry, keeping the first by file order.
- **The whole cite family.** `\cite`, `\citep`, `\citet`, `\nocite`,
  `\textcite`, `\autocite`, `\citeauthor` — anything whose command name
  contains "cite", so packages we have never heard of work too.
  Optional arguments are stepped over: `\citep[see][p.~3]{…}`.
- **Multi-key citations.** In `\cite{first,second,…}` only the key
  being typed — after the last comma — is completed and replaced.
- **Quiet where it should be.** Nothing is offered in `\ref{`,
  `\section{`, ordinary prose, inside a `%` comment, or once the
  argument is closed. With an empty key it waits for an explicit
  Ctrl-Space rather than popping up the whole bibliography uninvited.

Ranking is key-prefix, then key-substring, then title, then author,
then year — the strongest signal first, because a key match means the
author typed part of the very thing being inserted.

## How it works

**Backend** (`src-tauri/src/bibliography.rs`). `list_references`
walks the project for `.bib` files (hidden directories skipped,
depth-capped), parses each, merges, sorts by key and de-duplicates.
One unreadable or malformed file is skipped rather than failing the
command — losing every reference because of one bad file would be a
poor trade.

The parser understands the shape of BibTeX and nothing about LaTeX
semantics: it is feeding a search box, not a typesetter. It handles
`{braced}`, `"quoted"` and bare values, nested braces, values wrapped
over lines, `@type(parens)`, case-insensitive types and field names,
and skips `@string`/`@preamble`/`@comment`. Text outside an entry is
ignored, which is how BibTeX treats it, so comments need no special
case. A half-typed entry at the end of a file is skipped without
hiding the good entries above it.

**Frontend** (`src/views/editor/TextEditor/References/`).

- `findCitationContext.ts` — pure: given the text before the cursor,
  decides whether completion applies and what the partial key is.
- `matchReferences.ts` — pure: filters and ranks; also formats the
  author/year summary shown beside each completion.
- `references.ts` — the CodeMirror extension. Registered through
  `EditorState.languageData` rather than `autocompletion`'s `override`,
  so it *adds* to the editor's existing completion sources instead of
  replacing them. `filter: false` is set on the result because ranking
  already ran across every field, and CodeMirror's own filter only sees
  labels — it would drop everything matched by title or author.

### Two traps worth knowing about

Both of these were live bugs during this work. Each left the source
returning perfectly good results while no popup ever appeared, so
neither showed up in tests that call the source directly.

1. **`latex()` must be configured with `enableAutocomplete: false`**
   (in `TextEditor.tsx`). The package otherwise installs its own
   `autocompletion({override: […]})`, and `override` *replaces every
   other completion source* — silently disabling reference search. Its
   LaTeX completions are registered through language data separately,
   so turning this off loses nothing; `basicSetup`'s autocompletion
   still offers them alongside ours.
2. **The completion source must be built once, not per lookup.**
   CodeMirror tracks a running completion by the identity of the source
   that started it. A `languageData` provider that returns
   `[{autocomplete: createSource(refs)}]` — building a new function on
   every call — leaves the session stuck `pending` forever.

`references.test.ts` drives a real `EditorView` and asserts a session
reaches `active` for both of these; the tests fail if either regresses.

The scan looks back a bounded 1000 characters from the cursor, so the
per-keystroke cost does not grow with the document.

Like the view mode, modal mode and spell checker, the reference list
lives in a **compartment**. `ProjectPage` loads the bibliography when
the project opens and reconfigures the compartment when it changes, so
saving a `.bib` makes its new entries citable immediately without
rebuilding the editor or losing undo history.

## Not included

- **Reference manager sync** (Zotero/Mendeley) — explicitly deferred in
  the plan pending a discussion.
- **Editing `.bib` entries through a UI.** They are edited as text like
  any other file. First-class `.bib` support — entry highlighting,
  field validation, duplicate-key warnings — is parked in `ideas.md`
  behind the per-file-type editor profiles.

## Files

- `src-tauri/src/bibliography.rs` — parser, `list_references`
- `src/views/editor/TextEditor/References/` — context, ranking, extension
- Tests: `bibliography_tests` in `bibliography.rs`,
  `src/test/references.test.ts`
