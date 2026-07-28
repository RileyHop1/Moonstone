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

## Caching and update cost

The block layer runs on selection changes as well as edits, because
the cursor decides what is revealed. What it does *not* do is rescan:
`documentScanField` holds the masked text and the results of every
whole-document scan, and recomputes **only on `docChanged`**. A cursor
move cannot change where the math is, only which of it is revealed.

`livePreview.test.ts` pins this by reference equality — a cursor move
must hand back the very same scan object.

Measured on a 2,400-line, 56 KB document:

| | rescanning per move | cached scan |
|---|---|---|
| Cursor move | 2.87 ms | **2.09 ms** |

So the scan is real but it is *not* the dominant cost. The remaining
~2 ms is rebuilding the whole-document decoration set, which has to
happen because reveal state changed somewhere. Making *that*
incremental — recomputing only the constructs whose reveal state
actually flipped — is the next lever if editing large documents ever
feels heavy, and it is a substantially riskier change than this one.

### Overlap bookkeeping

CodeMirror rejects overlapping replaces within one decoration set, so
each pass checks what earlier passes claimed. `ClaimedRanges` holds
those claims **merged and disjoint**, which keeps their ends ascending
and makes the check a single binary search. Merging is the point: with
claims sorted only by start, an earlier long claim could still span
the query, and the check would degrade to a walk back through every
prior claim — quadratic in the number of rendered constructs.

### Atomic ranges

Block-layer replaces are published to `EditorView.atomicRanges`
**selectively**, via the `atomic` flag on `addReplace`:

| Replace | Atomic | Why |
|---|---|---|
| Heading's hidden `\section{` and `}` | yes | One arrow press crosses them; the cursor still lands on the title text, which is what reveals the heading. |
| `\item` marker | yes | One press crosses the marker; clicking still reveals the token. |
| Hidden `\begin`/`\end` tag lines | **no** | Cursor contact with the tag line is the *only* way to reveal it. Atomic would make `\begin{...}` permanently uneditable by keyboard. |
| Collapsed preamble | **no** | Same: entering it is what expands it. |
| Tables, math environments | **no** | Same: the cursor must reach the region to reveal its source. |

That distinction is load-bearing and easy to get wrong, so both
directions are tested — the skips *and* the deliberate non-skips.

### Reveal is frozen while dragging a selection

Selecting across a block used to be impossible: the selection would
collapse to a line or two. The cause was reveal itself. Hiding a
block's `\begin`/`\end` lines is what makes it a block, so a drag
growing into one un-hid those lines *mid-gesture* — the content below
shifted down, the pointer ended up over a different line than the one
it was travelling toward, and the selection ended wherever it landed.
Dragging outside a block was unaffected, because revealing inline
commands swaps text without changing how many lines there are. That is
exactly the "works outside a block, breaks inside one" symptom.

`pointerSelection.ts` holds the reveal decision still for the length of
the gesture: the selection as of `pointerdown` is what `isRevealed`
reads until the button comes up, so the layout cannot move under the
pointer. On release, reveal returns to the live selection and the block
opens as usual.

Two details matter:

- It listens for **`pointerdown`, not `mousedown`**. Pointer events
  fire first, so the captured selection is the one from *before* the
  click. Capturing after CodeMirror has moved the cursor would freeze
  reveal at a cursor already inside the block — which reveals it, the
  very thing being avoided.
- Both layers rebuild on the transaction that **ends** the gesture,
  which carries no selection change of its own; without that the frozen
  reveal would outlive the drag.

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

## Inert regions (comments and verbatim)

Some regions must never be rendered no matter what they contain: a
comment like `% costs $5 and $10` is not math, and `\alpha` inside a
`verbatim` block must stay literal text.

Rather than teach all eight scanners to skip these regions —
duplicating overlap logic and still missing the scanners that pair
tokens across the whole document — `inertRegions.ts` **masks** the text
before anything scans it. Inert characters become spaces, preserving
total length and every newline position, so offsets found in the
masked text are valid document positions. The scanners are unchanged
and unaware: they find nothing where there is nothing to find.

The work is split so cost scales with what is being rendered:

- **`findInertRegions`** locates the regions. This must see the whole
  document: a `\begin{verbatim}` far above the viewport decides whether
  the visible lines are literal, and nothing in the visible text itself
  reveals that. It is a linear scan yielding a handful of intervals,
  with no large allocation.
- **`maskChunk`** applies them to one span. Callers mask only what they
  are about to scan.

`inertRegionsField` caches the intervals — not a masked copy of the
document — and is keyed to document changes only, since a cursor move
cannot change which regions are inert. The inline layer then masks
just its visible chunk, so its cost tracks the viewport rather than
the document. The block layer masks everything, because it renders
boxes, headings and markers across the whole file; making *that* scan
incremental is separate work.

Masking rebuilds text segment-wise: untouched spans between inert
regions pass through as slices, so a document with a dozen comments
allocates a couple of dozen segments rather than one array element per
character.

Two views of the document are therefore in play. **Masked text drives
every scan; the real document supplies whatever a widget renders** —
KaTeX sources, table cell contents, and the "are these tag lines
clean?" check that decides whether a table may be replaced wholesale
(a trailing comment there means it may not, or the comment would be
swallowed by the widget).

What gets masked:

- **Comments** — an unescaped `%` through the end of its line. `\%` is
  a literal percent; `\\%` is a line break followed by a real comment.
  The newline itself survives.
- **Literal environments** — the *bodies* of `verbatim`, `verbatim*`,
  `Verbatim`, `Verbatim*`, `lstlisting`, `minted`, and `alltt`. Only
  the body: the `\begin`/`\end` tags stay visible so the environment
  still renders its box.
- **`\verb` arguments** — the text between the delimiters, which may
  not span a line.

Comments are resolved first and excluded from the literal scan, so a
commented-out `\begin{verbatim}` cannot open a literal region and a
commented `\end{verbatim}` does not close one — the search continues to
the next real closing tag. (Real LaTeX treats `%` as ordinary text
inside verbatim and would end the environment there; the divergence is
confined to that pathological case.) Unclosed literal environments and
unclosed `\verb` arguments stay raw rather than swallowing the rest of
the document.

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

## Math environments

`equation`, `align`, `gather` and friends are handed to KaTeX as
display math instead of getting the generic box — displayed equations
are the main reason to want live rendering, so a box full of raw
source was the biggest hole in the preview.

The **whole** environment including its `\begin`/`\end` tags goes to
KaTeX, because that is what drives its alignment and equation
numbering: `\begin{equation}` renders with a right-aligned `(1)`, and
`align` numbers each row.

The list is exactly what KaTeX implements, verified by rendering each
one (`mathEnvironments.test.ts` pins this):

> `equation`, `equation*`, `align`, `align*`, `alignat`, `alignat*`,
> `gather`, `gather*`, `cases`, `dcases`, `rcases`, `aligned`,
> `alignedat`, `gathered`, `split`

`multline`, `flalign`, `eqnarray` and `displaymath` are deliberately
**absent** — KaTeX rejects them with "No such environment", and an
error-styled widget in place of the author's equation is worse than
the box, which stays perfectly editable. Inner environments (`split`,
`matrix`, `array`, …) render as part of whichever outer environment
contains them.

Table and math environments share one code path:
`tryReplaceEnvironment` handles the reveal check, the "do the tag
lines hold other content?" check and the block replace, while
`buildEnvironmentWidget` decides *what* to render. Adding another
whole-environment renderer means adding a branch there and nothing
else.

## Images

`\includegraphics[options]{path}` renders the actual image, inline,
bounded to 20rem tall so a large figure cannot push the editor around.

The preview cannot resolve paths itself — it does not know where the
document lives, and must not depend on Tauri — so the host injects an
`ImageSourceResolver` through `livePreview({ resolveImageSource })`.
`createImageSourceResolver` (in `shared/tauri.ts`) builds one from the
open file's path, resolving relative paths against the document's own
directory as LaTeX does, and `convertFileSrc` turns the result into an
`asset://` URL. `tauri.conf.json` enables the asset protocol scoped to
`$DOCUMENT/Moonstone/**`, so the webview can read project files and
nothing else.

Three cases render a labelled placeholder rather than an image, so the
author always sees *what* was referenced:

| Case | Shown |
|---|---|
| Path escapes the project with `..`, or no document is open | `🖼 path` |
| Path has no file extension (LaTeX would probe for one; that needs filesystem access) | `🖼 path` |
| Image fails to load — missing file, outside the asset scope | `⚠ path` |

Without a resolver at all (plain browser, tests) every image is a
placeholder, which keeps the preview usable outside Tauri.

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

### Claim checks must match what a pass actually replaces

The overlap checks that keep replaces from colliding have to be as
narrow as the replace they guard, or they suppress rendering that would
have been perfectly legal.

The environment pass has two treatments and they need different checks:

| Treatment | Replaces | Correct check |
|---|---|---|
| Wholesale widget (`tryReplaceEnvironment`) | the entire environment | the whole range |
| Box (hidden tags + `cm-env-line`) | the two tag lines only | the tag lines only |

The box treatment was guarded by the whole-range check, and it cost a
real bug. Display math is claimed in an **earlier pass** than
environments, so a single `$$…$$` anywhere in the body made the
`document` environment look claimed. The result: no box, no hidden
`\begin{document}`/`\end{document}`, and no preamble chip — the whole
document rendered as raw LaTeX.

What made it look bizarre rather than obviously broken is that it
inverted the reveal rule. Putting the cursor *inside* the maths
revealed them as source, so they claimed nothing, the check passed, and
the document snapped into its rendered form. Clicking away broke it
again.

Line decorations are not replaces, so `boxInteriorLines` may safely
style lines that a block widget covers — a boxed environment containing
a rendered table demonstrates this every time it renders.

## Block widgets must never carry a vertical margin

A hard rule, learned from a bug that looked like nothing to do with
layout.

CodeMirror maintains a **height map**: its own model of where every
line sits vertically, used by `posAtCoords` to answer "which position
is under this pointer". Widget heights enter that map via
`getBoundingClientRect().height`, and **a bounding rect excludes
margins**. So a block widget with `margin: 0.3rem 0` occupies 9.6px
more on screen than the height map believes, and every line below it
sits lower in the DOM than CodeMirror thinks.

Nothing looks wrong — the rendering is pixel-perfect. What breaks is
every coordinate query below the widget. The symptom that exposed it:
the spell-check correction popup dismissed itself the moment the
pointer moved, because CodeMirror concluded the pointer had left the
misspelled word when it had not. Clicks were unaffected, which made it
look like a tooltip bug, because CodeMirror positions the caret from a
click using the browser's native caret lookup rather than its own
height map.

**Use padding, on a wrapper element if the widget's own box needs to
stay tight.** `PreambleWidget` renders a `cm-preamble-row` whose only
job is to hold the chip's vertical spacing as padding. The same rule is
why headings use `padding-top` rather than `margin-top`.

This is guarded three ways, all in `src/test/browser/`:

- positions round-trip through `coordsAtPos` → `posAtCoords`, sampled
  across each line's full height (the centre alone stays correct until
  the drift exceeds half a line, which is how this hid);
- no widget element carries a non-zero vertical margin;
- the spell-check popup survives the journey from a clicked word to its
  corrections.

## Headings

`findSections.ts` scans for `\section{...}`, `\subsection{...}`, and
`\subsubsection{...}` (plus starred variants), brace-matching titles
via the shared `braces.ts` helper so nested groups work. Each heading
gets a `cm-heading-1/2/3` line class (font size + weight — applied
even while revealed, so the text keeps its size during editing) and,
when the cursor is off the line, two replaces hiding the `\section{`
prefix and closing `}`. Skipped (raw source): escaped commands,
unclosed braces, multi-line titles, and empty titles.

## Text-mode spellings

`findTextReplacements.ts` renders the unglamorous, pervasive half of
LaTeX prose: escaped punctuation (`\&`, `\%`, `\$`, `\_`, `\#`,
`\{`, `\}`), em and en dashes (`---`, `--`), paired quotes
(`` `` ``/`''`), ties (`~` → a real non-breaking space) and accents,
both bare (`\"o`) and braced (`\"{o}`), including the letter-named
ones (`\c{c}`, `\v{s}`). Accented output is NFC-normalized so it is a
single precomposed character rather than a combining pair.

It scans left to right rather than by regex alternation, because
precedence here is positional: `---` must beat `--`, and a backslash
must consume whatever follows before `~` can be read as a tie. An
unrecognised command's letters are consumed too, so `\alpha` is never
mistaken for an accent.

Single quotes are deliberately **not** curled — it would mangle every
apostrophe in ordinary prose for almost no visible gain.

`applyTextReplacements` exposes the same transform as a plain string
function, for text a widget renders itself and the decoration pipeline
therefore never sees: a citation chip's `p.~3` locator, a table cell.

## Inline formatting

`findFormatting.ts` scans for `\textbf`, `\textit`, `\emph`,
`\underline`, `\texttt`, `\textsc`, `\textsf`, `\textrm`, `\sout`,
`\textsuperscript` and `\textsubscript`. The command token and closing
brace are hidden by replaces while the content stays editable raw text
under a `cm-fmt-*` mark. The pattern's alternatives are generated
longest-first so `\textsuperscript` is not matched as `\textsc`. Nesting needs no special
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
counter resumes.

`\item[custom]` renders its label in place of the marker, with the
replaced range covering the whole `\item[...]` so no stray bracket is
left behind. The label must follow the token on the same line — a
bracket on the next line belongs to the item's text. An empty label
falls back to the default marker. Items outside list environments stay
raw.

## Reference chips

`findRefs.ts` matches `\ref`, `\eqref`, `\cite` (plus natbib's
`\citep`/`\citet`), `\label`, `\url`, `\href` and `\footnote`, and
renders them as pill chips (`RefChipWidget`): 🔗 ref/eqref, 📖 cite,
🏷 label, 🌐 url/href, † footnote. `\cite{a,b}` shows both keys.

Optional arguments are read rather than rejected: `\cite[p.~3]{k}`
renders as `📖 k, p. 3`, with the locator passed through
`applyTextReplacements` so it reads as prose. `\href{url}{text}`
shows its link text, keeping the URL as the target.

Link chips carry an `↗` affordance. Clicking the **chip body** reveals
the source like every other chip; only the affordance follows the
link, so opening and editing can never be confused. The chip's
`ignoreEvent` returns true just for that element. Opening is injected
as a `LinkOpener` — the preview must not know about Tauri — and
`openExternalLink` in `shared/tauri.ts` supplies it, refusing anything
that is not `http`/`https`, since a document is untrusted input.
Without an opener the affordance is not rendered at all, rather than
offering a control that cannot work.

Chips are excluded from the symbol and text-replacement scans so a
chip's interior is never double-rendered.

## Comments

Comment *contents* are excluded from every scanner by the masking pass
described under [Inert regions](#inert-regions-comments-and-verbatim).

Comment *styling* is theme-only: the `t.comment` highlight rule
(`moonstoneTheme.ts`) is italic at `opacity: 0.6`. A decoration-based
pass with cursor reveal was considered and rejected — dimmed text is
still fully readable and editable, so the reveal machinery would add
complexity for no editing benefit.

## Special characters

`symbols.ts` maps LaTeX commands to unicode glyphs (Greek letters,
operators, relations, arrows, set symbols) and scans visible text for
them — outside math segments and reference chips, and never after a
`\\` line break. Matches render as inline `SymbolWidget`s
(`\alpha` → α) with the same cursor-reveal rule.

## Tables

`parseTabular.ts` parses a `tabular`/`tabular*` environment's interior
(strips the column spec, `\hline`, and the booktabs rules —
`\toprule`, `\midrule`, `\bottomrule`, `\cmidrule` with its optional
trimming argument, `\addlinespace` — then splits rows on `\\` and
cells on unescaped `&`) into `TabularCell` objects. `\multicolumn{n}{spec}{...}`
cells carry a column span and alignment (first `l`/`c`/`r` in the
spec), rendered as `colspan`/`text-align` on the `td`. A successful
parse renders the whole environment as a theme-styled HTML table
(`TableWidget`).

Cells render the same constructs as anywhere else — math, formatting
commands, symbols and text-mode spellings. A table is replaced
wholesale rather than decorated, so `renderCellContents` cannot reuse
the decoration pipeline; it reuses the same *scanners* instead, sorts
their results by position and lets the first match win where they
overlap. That way a cell means the same thing inside a table as
outside one. Anything the parser doesn't understand (`\multirow`, nested
environments, malformed multicolumns, …) returns `null` and the
environment falls back to the generic box — rendering never breaks
editing. Clicking the table reveals the source, as everywhere else.

## Files

- `src/views/editor/TextEditor/LivePreview/livePreview.ts` — assembly
- `src/views/editor/TextEditor/LivePreview/inertRegions.ts` — comment/verbatim masking
- `src/views/editor/TextEditor/LivePreview/braces.ts` — shared brace matcher
- `src/views/editor/TextEditor/LivePreview/findMath.ts` — math scanner
- `src/views/editor/TextEditor/LivePreview/findEnvironments.ts` — env scanner
- `src/views/editor/TextEditor/LivePreview/findSections.ts` — heading scanner
- `src/views/editor/TextEditor/LivePreview/findFormatting.ts` — formatting scanner
- `src/views/editor/TextEditor/LivePreview/findListItems.ts` — list-item scanner
- `src/views/editor/TextEditor/LivePreview/findRefs.ts` — reference scanner
- `src/views/editor/TextEditor/LivePreview/findGraphics.ts` — `\includegraphics` scanner
- `src/views/editor/TextEditor/LivePreview/findTextReplacements.ts` — escapes, dashes, quotes, ties, accents
- `src/views/editor/TextEditor/LivePreview/symbols.ts` — symbol map + scanner
- `src/views/editor/TextEditor/LivePreview/parseTabular.ts` — table parser
- `src/views/editor/TextEditor/LivePreview/MathWidget.ts` — all widgets
- Tests: `src/test/findMath.test.ts`, `findEnvironments.test.ts`,
  `braces.test.ts`, `findSections.test.ts`, `findFormatting.test.ts`,
  `findListItems.test.ts`, `findRefs.test.ts`, `parseTabular.test.ts`,
  `symbols.test.ts`, `inertRegions.test.ts`, `findGraphics.test.ts`,
  `mathEnvironments.test.ts`, `imageSourceResolver.test.ts`,
  `claimedRanges.test.ts`, `findTextReplacements.test.ts`, and
  `livePreview.test.ts` — the assembly suite, which mounts a real
  editor and asserts on what it renders

## Deferred (next passes)

- **`\multirow`** — still bails the whole parse. Unlike `\multicolumn`
  it needs state across rows: a spanning cell must suppress a cell in
  each following row, which the current row-at-a-time parse has no
  place to record.
- **Old-style font groups** (`{\bf ...}`, `{\it ...}`) — a different
  shape from the `\text*` commands, since the scope is the enclosing
  group rather than a brace argument.
- **Curled single quotes** — deliberately skipped; see above.
- **`\caption` and figure-environment layout**, and honouring
  `\includegraphics` options (`width`, `scale`, `angle`), which are
  parsed into `GraphicsRange.options` and then ignored.
- **Extension-less image paths**, which need a filesystem probe
  through the backend.
