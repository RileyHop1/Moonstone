# Spell Check

Prose spell checking for LaTeX documents, surfaced through
CodeMirror's lint machinery so misspellings get the usual underline,
hover panel and quick fixes rather than a parallel UI of their own.

On by default; toggled from **View → Spell Check**.

## Why not the browser's spellchecker

CodeMirror's content is `contenteditable`, so `spellcheck="true"`
should in principle give this for free. It was tried first and
produced no underlines in the WebView2 runtime. Rather than chase
whether that is WebView2 policy or a screenshot-capture artifact, the
dictionary approach was taken — and it turns out to be the better one
regardless, because it can be made LaTeX-aware. The native checker
would have flagged every command it could see.

## Not flagging things is the feature

A LaTeX document is mostly not prose. A checker that flags every
command, citation key and formula symbol is worse than none at all —
a wall of false positives trains the author to ignore the underlines.

`findProseWords.ts` therefore skips:

| Skipped | Example |
|---|---|
| Commands | `\textbf`, `\maketitle` |
| Identifier-style arguments | `\ref{sec:intro}`, `\begin{itemize}`, `\includegraphics{figs/plot.png}`, `\usepackage{amsmath}` |
| Code arguments | `\texttt{getElementById}` |
| Math | `$x_{ij}$`, `$$\sum_k a_k$$` |
| Comments and verbatim bodies | reusing the preview's `maskChunk` |
| Words under three letters, containing digits, or all-caps | `an`, `h2o`, `HTML` |

Prose *inside* commands is still checked — `\textbf{important words}`
is real text, and so is a section title.

Two deliberate fallbacks, both matching the preview's philosophy that
malformed input degrades to "treat it as ordinary text":

- An **unclosed argument** (`\ref{`) does not swallow the rest of the
  file; scanning resumes after the brace.
- An **unclosed `$`** is not math, so checking continues past it.
  Treating the remainder as math would silently stop checking
  everything after a stray dollar sign.

## Loading and cost

The Hunspell data is about half a megabyte, so `dictionary.ts` pulls
it in behind a dynamic import: the build splits it into its own chunk,
and a user who never opens a document — or who turns checking off —
never downloads it. The load happens once and is shared by every
editor. A failure resolves to null and the checker simply reports
nothing, because a missing dictionary must not break editing.

Only the **viewport** is checked. A misspelling the author cannot see
is not worth the work, and this keeps the cost independent of document
length. Checks are debounced 400 ms after typing stops.

### The Vite alias

`dictionary-en`'s entry point reads its data with `node:fs`, which
cannot run in a webview, and its `exports` field blocks importing the
data files directly. `vite.config.ts` aliases the two files so they
can be inlined with `?raw`, keeping npm as the source of truth for
dictionary updates.

The aliases are **regex finds deliberately unanchored at the end**: a
string alias only prefix-matches on a `/` boundary, so it would never
match the `?raw` suffix, and anchoring with `$` would drop it.

## Known limitations

- **US English only.** `dictionary-en` is en-US, so British spellings
  (`emphasised`, `colour`) are flagged. Adding `dictionary-en-gb` and
  a language setting is the natural next step.
- **No personal dictionary.** There is no "add to dictionary" yet, so
  proper nouns and technical terms stay underlined. This wants
  backend persistence alongside the settings work.
- **Comments are not checked.** They are masked as inert along with
  verbatim bodies. Arguably a comment's prose is worth checking; it
  was excluded for consistency with the preview.

## Files

- `src/views/editor/TextEditor/SpellCheck/findProseWords.ts` — word extraction
- `src/views/editor/TextEditor/SpellCheck/dictionary.ts` — lazy Hunspell loading
- `src/views/editor/TextEditor/SpellCheck/spellCheck.ts` — linter, compartment
- `src/views/editor/TextEditor/SpellCheck/spellCheck.css` — underline and quick-fix styling
- Tests: `src/test/findProseWords.test.ts`
