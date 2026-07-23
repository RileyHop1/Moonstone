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
   math, text formatting, reference chips, and symbols. Recomputes on
   doc/selection/viewport changes, scanning only `view.visibleRanges`
   (expanded to line boundaries). This satisfies "only render what's
   visible" where per-keystroke cost lives.
2. **Block layer — `StateField`** (whole document): display `$$...$$`
   math, environment boxes, preamble hiding, section headings, and
   list-item markers. The regex scan is cheap; KaTeX rendering
   (`toDOM`) is only invoked for widgets in the rendered viewport
   anyway, so heavy work stays lazy.

The inline layer keeps **two** decoration sets: the replaces (also fed
to `EditorView.atomicRanges`, so arrow keys hop over widgets) and the
content marks from formatting commands, which must *not* be atomic or
the cursor could never enter `\textbf{...}` content.

## View modes

The preview participates in three editor view modes, swapped at runtime
through a CodeMirror `Compartment` (see `viewMode.ts` and `toolbar.md`):

- **Source** — the compartment holds no preview, so raw LaTeX shows.
- **Live** — `livePreview()`, the reveal-at-cursor behavior described
  below.
- **Read Only** — `livePreview({ reveal: false })` plus a non-editable,
  read-only editor, so everything stays rendered and the source never
  shows.

The `reveal` option feeds a `revealFacet`; the `isRevealed(state, …)`
helper gates every reveal check behind it, so read-only mode simply
treats all cursor contact as non-touching. When reveal is enabled
(Live), the granularity table below applies.

## Reveal rule

If any selection range touches a rendered region, its decorations are
skipped and the source shows. Widgets return `ignoreEvent() → false`,
so clicking any rendered widget puts the cursor inside it — revealing
it on the next update. Granularity varies by feature:

| Feature | Reveals when the selection touches |
|---|---|
| Inline/display math, symbols, chips, formatting | the whole command range |
| Environments | the hidden `\begin`/`\end` **lines** only — editing the body must not un-box it |
| Tables | anywhere in the environment (replaced wholesale) |
| Preamble | the preamble region |
| Headings | the heading **line** (the size class stays applied while editing) |
| `\item` markers | the `\item` **token** only — editing item text keeps the marker |

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

The environment pass returns its replaced regions (hidden tag lines,
table ranges, the collapsed preamble) so later passes — headings and
list items — never emit overlapping replaces, which CodeMirror rejects
within one decoration set.

## Headings

`findSections.ts` scans for `\section{...}`, `\subsection{...}`, and
`\subsubsection{...}` (plus starred variants), brace-matching titles
via the shared `braces.ts` helper so nested groups work. Each heading
gets a `cm-heading-1/2/3` line class (font size + weight — applied
even while revealed, so the text keeps its size during editing) and,
when the cursor is off the line, two replaces hiding the `\section{`
prefix and closing `}`. Skipped (raw source): escaped commands,
unclosed braces, multi-line titles, and empty titles.

## Inline formatting

`findFormatting.ts` scans for `\textbf`, `\textit`, `\emph`, and
`\underline`. The command token and closing brace are hidden by
replaces while the content stays editable raw text under a
`cm-fmt-bold/italic/underline` mark. Nesting needs no special
handling: `\textbf{\emph{x}}` yields two independent ranges whose
marks nest and whose hidden tokens never overlap. Content spanning a
line break bails to raw (visible-range chunks are line-bounded), as do
math-interior matches, unclosed braces, and empty content.

## Lists

`findListItems.ts` finds `\item` tokens (`(?![a-zA-Z])` so `\itemsep`
never matches) and resolves each against its **innermost** containing
`itemize`/`enumerate` environment via `findEnvironments`. Itemize
bullets vary by list depth (`•`, `◦`, `▪` cycling); enumerate labels
follow LaTeX's counters — depth counts *enumerate* nesting only
(`enumi`…`enumiv`), so `itemize > enumerate` gets `1.`, not `(a)`:
depth 1 `1.`, depth 2 `(a)`, depth 3 `i.`, deeper `A.`. Indices count
items per innermost environment, so nested lists restart and the outer
counter resumes. `\item[custom]` and items outside list environments
stay raw.

## Reference chips

`findRefs.ts` matches `\ref`, `\eqref`, `\cite`, and `\label` and
renders them as pill chips (`RefChipWidget`): 🔗 for ref/eqref, 📖 for
cite, 🏷 for label. `\cite{a,b}` shows both keys. Optional arguments
(`\cite[p.3]{k}`) intentionally fail the match and stay raw. Chips are
excluded from the symbol scan so a chip's interior is never
double-rendered.

## Comments

Theme-only: the `t.comment` highlight rule (`moonstoneTheme.ts`) is
italic at `opacity: 0.6`. A decoration-based pass with cursor reveal
was considered and rejected — dimmed text is still fully readable and
editable, so the reveal machinery would add complexity for no editing
benefit.

## Special characters

`symbols.ts` maps LaTeX commands to unicode glyphs (Greek letters,
operators, relations, arrows, set symbols) and scans visible text for
them — outside math segments and reference chips, and never after a
`\\` line break. Matches render as inline `SymbolWidget`s
(`\alpha` → α) with the same cursor-reveal rule.

## Tables

`parseTabular.ts` parses a `tabular`/`tabular*` environment's interior
(strips the column spec and `\hline`, splits rows on `\\` and cells on
unescaped `&`) into `TabularCell` objects. `\multicolumn{n}{spec}{...}`
cells carry a column span and alignment (first `l`/`c`/`r` in the
spec), rendered as `colspan`/`text-align` on the `td`. A successful
parse renders the whole environment as a theme-styled HTML table
(`TableWidget`); cells containing `$...$` render their math with
KaTeX. Anything the parser doesn't understand (`\multirow`, nested
environments, malformed multicolumns, …) returns `null` and the
environment falls back to the generic box — rendering never breaks
editing. Clicking the table reveals the source, as everywhere else.

## Files

- `src/views/editor/TextEditor/LivePreview/livePreview.ts` — assembly
- `src/views/editor/TextEditor/LivePreview/braces.ts` — shared brace matcher
- `src/views/editor/TextEditor/LivePreview/findMath.ts` — math scanner
- `src/views/editor/TextEditor/LivePreview/findEnvironments.ts` — env scanner
- `src/views/editor/TextEditor/LivePreview/findSections.ts` — heading scanner
- `src/views/editor/TextEditor/LivePreview/findFormatting.ts` — formatting scanner
- `src/views/editor/TextEditor/LivePreview/findListItems.ts` — list-item scanner
- `src/views/editor/TextEditor/LivePreview/findRefs.ts` — reference scanner
- `src/views/editor/TextEditor/LivePreview/symbols.ts` — symbol map + scanner
- `src/views/editor/TextEditor/LivePreview/parseTabular.ts` — table parser
- `src/views/editor/TextEditor/LivePreview/MathWidget.ts` — all widgets
- Tests: `src/test/findMath.test.ts`, `findEnvironments.test.ts`,
  `braces.test.ts`, `findSections.test.ts`, `findFormatting.test.ts`,
  `findListItems.test.ts`, `findRefs.test.ts`, `parseTabular.test.ts`,
  `symbols.test.ts`

## Deferred (next passes)

`\multirow` tables; chips/formatting/symbols inside table cells;
`\cite[...]`/`\item[...]` optional arguments; figures/graphics
placeholders; richer per-environment rendering.
