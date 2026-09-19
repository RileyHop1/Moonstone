# Known bugs

Bugs that have been reproduced and diagnosed but not yet fixed. Each one
gets its own branch; move an entry out of this file when its fix merges.

---

## 1. Line-level edits freeze the editor for ~0.6–1 s (spell check)

**Status:** open. Diagnosed 2026-09-19; fix on its own branch.

### Symptom

In `Job.tex` with Vim mode, moving over lines 18–21 with `j`/`k` is smooth,
but `dd` on those lines lags about 1 s on the first press and 2–3 s on the
next. Single `u`, `yy` and `p` feel fine, but spamming them lags as a
batch.

### Repro

1. Open a document with a few `\begin{itemize}[leftmargin=*, itemsep=…]`
   lines (the CV template's `Job.tex` has five), spell check on.
2. Delete a line (`dd` in Vim, or Ctrl+Shift+K without Vim), then pause.
3. About 400 ms later the editor stops responding for ~0.6–1 s. Keys pressed
   meanwhile queue up and run afterwards, which is the "compounding".

It is **not** Vim-specific and **not** about the `\newcommand` block. Any
document change followed by a pause triggers it; `dd` just makes the pauses
natural. Typing hides it because each keystroke pushes the check back again.

### Measurements

Browser harness (real `TextEditor`), `Job.tex`, one long task after each
line deletion:

| Configuration                          | Long task per delete |
| -------------------------------------- | -------------------- |
| Riley's settings (Vim, mixed, live)    | ~600 ms              |
| Source view                            | ~300 ms              |
| Line numbers absolute                  | ~600 ms              |
| No Vim (Ctrl+Shift+K)                  | ~600 ms              |
| `\newcommand` block replaced with text | ~600 ms              |
| **Spell check off**                    | **none**             |

A CPU profile of those tasks is almost entirely nspell: `generate`
(1.2 s over four deletes), `form` (1.0 s), `suggest`, `check`. The edit
itself (`view.dispatch`) costs ~1 ms.

### Root cause

The spell checker is a linter that re-runs 400 ms after every document
change ([spellCheck.ts:34](src/views/editor/TextEditor/SpellCheck/spellCheck.ts#L34)).
Three defects compound:

1. **Suggestions are computed eagerly.** `buildDiagnostic` calls
   `dictionary.suggest(word)` for every flagged word on every run
   ([spellCheck.ts:88](src/views/editor/TextEditor/SpellCheck/spellCheck.ts#L88)),
   only to fill in a popup that is rarely opened. nspell's `suggest` costs
   **40–90 ms per unknown word** (checking a word costs ~0 ms), it is slowest
   when there is no good suggestion, and nothing caches it.
2. **Environment options are spell-checked.** `skipCommand` skips `[…]`
   _then_ `{…}` after an opaque command
   ([findProseWords.ts:131-132](src/views/editor/TextEditor/SpellCheck/findProseWords.ts#L131-L132)),
   but `\begin{itemize}[leftmargin=*, itemsep=0.1em]` puts the options
   _after_ the braces. So `leftmargin` and `itemsep` are flagged. They are
   invisible, because the environment box hides the `\begin` line, but
   they are still checked and still pay for suggestions.
3. **Lines are checked twice.** Each visible range is widened to whole lines
   ([spellCheck.ts:53-55](src/views/editor/TextEditor/SpellCheck/spellCheck.ts#L53-L55)),
   and neighbouring ranges (split by block widgets) then overlap. The live
   preview avoids this with a `lastProcessedEnd` clamp; the spell checker
   does not.

Net result for `Job.tex`: **21 diagnostics** where one real misspelling
(`honours`) is on screen: 5 lines × 2 option keys × 2 duplicate passes,
each paying ~55 ms for `suggest`.

### Fix direction

Compute suggestions lazily, when a diagnostic's popup opens, and cache them
per word. Skip `[…]` after `{…}` too for `\begin` and similar commands. Clamp
the widened ranges the way `buildInlineDecorations` does. The first fix
alone removes almost all of the cost. Add a browser test asserting no long
task after a line delete in `Job.tex`, and check it fails without the fix.
