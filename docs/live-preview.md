# Live Preview

Obsidian-style inline rendering for LaTeX inside CodeMirror 6. Source
text is replaced by rendered widgets whenever the cursor is elsewhere;
touching a rendered region with the cursor (click or arrow keys)
reveals the raw source for editing.

## Two-layer architecture

CodeMirror requires block-level replacing decorations to come from a
`StateField` (they affect vertical layout), while viewport-limited
work belongs in a `ViewPlugin`. The preview is therefore split:

1. **Inline layer — `ViewPlugin`** (viewport-limited): inline `$...$`
   math. Recomputes on doc/selection/viewport changes, scanning only
   `view.visibleRanges` (expanded to line boundaries). This satisfies
   "only render what's visible" where per-keystroke cost lives.
2. **Block layer — `StateField`** (whole document): display `$$...$$`
   math, environment boxes, and preamble hiding. The regex scan is
   cheap; KaTeX rendering (`toDOM`) is only invoked for widgets in the
   rendered viewport anyway, so heavy work stays lazy.

## Reveal rule

Math and symbols: if any selection range touches the segment, its
decoration is skipped and the source shows. Environments reveal their
tags only when the selection touches the hidden `\begin`/`\end`
**lines themselves** — the cursor is usually *inside* the environment
(especially `document`), and editing the body must not un-box it.
Tables reveal on any cursor contact (they are replaced wholesale); the
preamble reveals when the selection touches the preamble region.
Widgets return `ignoreEvent() → false`, so clicking any rendered
widget puts the cursor inside it — revealing it on the next update.
Atomic ranges make arrow keys hop over inline widgets.

## Math

`findMath.ts` is a pure scanner (grammar-independent): `\$` never
delimits, `$$` always opens display math, inline math cannot span
lines, and unclosed delimiters yield nothing — so half-typed math stays
visible. `MathWidget` renders with KaTeX (`throwOnError: false`);
invalid input falls back to the raw source in an error style.

## Environments

`findEnvironments.ts` pairs `\begin{...}`/`\end{...}` with a stack
(malformed input degrades to visible source). When the cursor is
outside an environment spanning multiple lines:

- The `\begin`/`\end` lines are hidden (block replace decorations).
- Interior lines get `cm-env-line` (+`-first`/`-last`) classes;
  contiguous line decorations form one rounded box in CSS — the same
  technique Obsidian uses, which keeps editing, search, and cursor
  placement inside the box fully functional.
- For `\begin{document}`, everything above it (the preamble /
  document attributes) is collapsed behind a "⚙ Preamble" chip;
  clicking the chip or moving the cursor into the preamble reveals it.

## Special characters

`symbols.ts` maps LaTeX commands to unicode glyphs (Greek letters,
operators, relations, arrows, set symbols) and scans visible text for
them — outside math segments, since KaTeX renders those itself, and
never after a `\\` line break. Matches render as inline
`SymbolWidget`s (`\alpha` → α) with the same cursor-reveal rule.

## Tables

`parseTabular.ts` parses a `tabular`/`tabular*` environment's interior
(strips the column spec and `\hline`, splits rows on `\\` and cells on
unescaped `&`). A successful parse renders the whole environment as a
theme-styled HTML table (`TableWidget`); cells containing `$...$`
render their math with KaTeX. Anything the parser doesn't understand
(`\multicolumn`, nested environments, …) returns `null` and the
environment falls back to the generic box — rendering never breaks
editing. Clicking the table reveals the source, as everywhere else.

## Files

- `src/views/editor/TextEditor/LivePreview/livePreview.ts` — assembly
- `src/views/editor/TextEditor/LivePreview/findMath.ts` — math scanner
- `src/views/editor/TextEditor/LivePreview/findEnvironments.ts` — env scanner
- `src/views/editor/TextEditor/LivePreview/symbols.ts` — symbol map + scanner
- `src/views/editor/TextEditor/LivePreview/parseTabular.ts` — table parser
- `src/views/editor/TextEditor/LivePreview/MathWidget.ts` — KaTeX/table/symbol/preamble widgets
- Tests: `src/test/findMath.test.ts`, `src/test/findEnvironments.test.ts`,
  `src/test/parseTabular.test.ts`, `src/test/symbols.test.ts`

## Deferred (next passes)

Richer per-environment rendering (figures, lists), `\multicolumn`
tables, and section heading styling.
