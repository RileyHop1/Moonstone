/**
 * Test suite for the live-preview assembly: the layering, reveal
 * granularity and view-mode behaviour that the individual scanner
 * suites cannot see.
 *
 * These assert on what the editor actually renders, mounting a real
 * `EditorView`, so they stay honest across refactors of how the
 * decorations are produced.
 */

import { describe, it, expect, afterEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import type { ViewMode } from "../shared/types";
import { documentScanField } from "../views/editor/TextEditor/LivePreview";
import { previewExtensionForMode } from "../views/editor/TextEditor/viewMode";

/** Editors mounted by the current test, torn down afterwards. */
let mounted: EditorView[] = [];

afterEach(() => {
    for (const view of mounted) view.destroy();
    mounted = [];
});

/** How a test wants its editor configured. */
interface MountOptions {
    /** Cursor position; defaults to the inert trailing line. */
    readonly cursor?: number;
    /** View mode; defaults to live. */
    readonly mode?: ViewMode;
}

/**
 * Plain text appended to every test document, giving the cursor
 * somewhere to rest that touches nothing.
 *
 * Parking the cursor at the end of the document itself would reveal
 * whatever happens to come last — correct behaviour, but it means a
 * one-construct document could never be observed rendered. Contains no
 * LaTeX-significant characters, so it adds no decorations of its own.
 */
const INERT_TAIL = "\n\nend of test document\n";

/**
 * Mounts an editor with the preview active.
 *
 * @param doc - The document contents; positions in `options.cursor`
 *   refer to this, unaffected by the appended tail.
 * @param options - Cursor position and view mode.
 * @returns The mounted view.
 */
function mountPreview(doc: string, options: MountOptions = {}): EditorView {
    const parent = document.createElement("div");
    document.body.appendChild(parent);

    const text = doc + INERT_TAIL;

    const view = new EditorView({
        doc: text,
        selection: { anchor: options.cursor ?? text.length },
        extensions: previewExtensionForMode(options.mode ?? "live"),
        parent,
    });

    mounted.push(view);
    return view;
}

/**
 * Reports whether the rendered editor contains a matching element.
 *
 * @param view - The mounted view.
 * @param selector - A CSS selector.
 * @returns True when at least one element matches.
 */
function hasElement(view: EditorView, selector: string): boolean {
    return view.dom.querySelector(selector) !== null;
}

/**
 * Returns the visible text of the editor.
 *
 * KaTeX emits a parallel MathML tree carrying the original TeX source
 * for screen readers, which would make every "is the source hidden?"
 * assertion trivially false. That layer is stripped so this reflects
 * what a sighted reader sees.
 *
 * @param view - The mounted view.
 * @returns The visible text, rendered widgets included.
 */
function renderedText(view: EditorView): string {
    const content = view.dom.querySelector(".cm-content");
    if (!content) return "";

    const visible = content.cloneNode(true) as HTMLElement;
    for (const mathml of visible.querySelectorAll(".katex-mathml")) mathml.remove();

    return visible.textContent ?? "";
}

describe("live preview — inline layer", () => {
    it("renders inline math as KaTeX", () => {
        const view = mountPreview("Euler: $e^{i\\pi}+1=0$ done.");

        expect(hasElement(view, ".cm-inline-math")).toBe(true);
        expect(hasElement(view, ".katex")).toBe(true);
    });

    it("reveals inline math when the cursor is inside it", () => {
        const view = mountPreview("Euler: $e^x$ done.", { cursor: 9 });

        expect(hasElement(view, ".cm-inline-math")).toBe(false);
        expect(renderedText(view)).toContain("$e^x$");
    });

    it("renders a symbol in place of its command", () => {
        const view = mountPreview("angle \\alpha here");

        expect(hasElement(view, ".cm-symbol")).toBe(true);
        expect(renderedText(view)).toContain("α");
    });

    it("renders a reference chip", () => {
        const view = mountPreview("see \\ref{sec:intro} above");

        expect(hasElement(view, ".cm-ref-chip")).toBe(true);
    });

    it("marks formatted text without hiding its content", () => {
        const view = mountPreview("a \\textbf{bold} b");

        expect(hasElement(view, ".cm-fmt-bold")).toBe(true);
        // Content stays editable raw text, only the tokens are hidden.
        expect(renderedText(view)).toContain("bold");
        expect(renderedText(view)).not.toContain("\\textbf");
    });

    it("renders an unresolvable image as a placeholder", () => {
        const view = mountPreview("\\includegraphics{plot.png}");

        expect(hasElement(view, ".cm-graphics-placeholder")).toBe(true);
        expect(hasElement(view, ".cm-graphics img")).toBe(false);
    });
});

describe("live preview — text-mode spellings", () => {
    it("renders escapes, dashes, quotes and accents in prose", () => {
        const view = mountPreview("100\\% profit---see ``na\\\"ive'' cases");

        expect(renderedText(view)).toContain("100% profit—see “naïve” cases");
    });

    it("renders the extended formatting commands", () => {
        const view = mountPreview("\\texttt{code} \\textsc{caps} \\sout{gone}");

        expect(hasElement(view, ".cm-fmt-mono")).toBe(true);
        expect(hasElement(view, ".cm-fmt-smallcaps")).toBe(true);
        expect(hasElement(view, ".cm-fmt-strike")).toBe(true);
    });

    it("renders a citation's optional locator inside the chip", () => {
        const view = mountPreview("see \\cite[p.~3]{knuth}");

        expect(hasElement(view, ".cm-ref-chip-cite")).toBe(true);
        // The locator's tie renders as a non-breaking space, as it
        // would anywhere else in the document.
        expect(renderedText(view)).toContain("knuth, p. 3");
    });

    it("renders a link chip without an open affordance by default", () => {
        // No opener is injected in tests, so offering to open would be
        // a control that cannot work.
        const view = mountPreview("\\url{https://example.com}");

        expect(hasElement(view, ".cm-ref-chip-url")).toBe(true);
        expect(hasElement(view, ".cm-ref-chip-open")).toBe(false);
    });

    it("renders a custom list label", () => {
        const view = mountPreview("\\begin{itemize}\n\\item[Note] body\n\\end{itemize}");

        expect(renderedText(view)).toContain("Note");
        expect(renderedText(view)).not.toContain("\\item");
    });
});

describe("live preview — block layer", () => {
    it("renders display math as a block", () => {
        const view = mountPreview("text\n$$x^2$$\nmore");

        expect(hasElement(view, ".cm-math-block")).toBe(true);
    });

    it("renders a math environment through KaTeX", () => {
        const view = mountPreview("\\begin{equation}\nE = mc^2\n\\end{equation}");

        expect(hasElement(view, ".cm-math-block")).toBe(true);
        expect(renderedText(view)).not.toContain("\\begin{equation}");
    });

    it("falls back to the environment box for math KaTeX cannot parse", () => {
        const view = mountPreview("\\begin{multline*}\na + b\n\\end{multline*}");

        expect(hasElement(view, ".cm-math-block")).toBe(false);
        expect(hasElement(view, ".cm-env-line")).toBe(true);
    });

    it("renders a tabular as a table", () => {
        const view = mountPreview(
            "\\begin{tabular}{ll}\nItem & Value \\\\\nMass & 1 \\\\\n\\end{tabular}",
        );

        expect(hasElement(view, ".cm-table-widget table")).toBe(true);
    });

    it("renders formatting and symbols inside table cells", () => {
        const view = mountPreview(
            "\\begin{tabular}{ll}\n\\textbf{Bold} & \\alpha \\\\\n\\end{tabular}",
        );

        expect(hasElement(view, ".cm-table-widget .cm-fmt-bold")).toBe(true);
        expect(renderedText(view)).toContain("α");
        expect(renderedText(view)).not.toContain("\\textbf");
    });

    it("drops booktabs rules from a table", () => {
        const view = mountPreview(
            "\\begin{tabular}{ll}\n\\toprule\nA & B \\\\\n\\midrule\nC & D \\\\\n\\bottomrule\n\\end{tabular}",
        );

        expect(hasElement(view, ".cm-table-widget table")).toBe(true);
        expect(renderedText(view)).not.toContain("toprule");
    });

    it("boxes a generic environment and hides its tags", () => {
        const view = mountPreview("\\begin{itemize}\n\\item one\n\\end{itemize}");

        expect(hasElement(view, ".cm-env-line")).toBe(true);
        expect(renderedText(view)).not.toContain("\\begin{itemize}");
    });

    it("renders list markers", () => {
        const view = mountPreview("\\begin{itemize}\n\\item one\n\\end{itemize}");

        expect(hasElement(view, ".cm-list-marker")).toBe(true);
        expect(renderedText(view)).not.toContain("\\item");
    });

    it("sizes a heading and hides its command", () => {
        const view = mountPreview("\\section{Intro}\n\ntext");

        expect(hasElement(view, ".cm-heading-1")).toBe(true);
        expect(renderedText(view)).toContain("Intro");
        expect(renderedText(view)).not.toContain("\\section{");
    });

    it("keeps the heading size while the heading is revealed", () => {
        const view = mountPreview("\\section{Intro}\n\ntext", { cursor: 3 });

        // The size class survives editing; only the braces come back.
        expect(hasElement(view, ".cm-heading-1")).toBe(true);
        expect(renderedText(view)).toContain("\\section{");
    });

    it("collapses the preamble behind a chip", () => {
        const view = mountPreview(
            "\\documentclass{article}\n\\begin{document}\nbody\n\\end{document}",
        );

        expect(hasElement(view, ".cm-preamble-chip")).toBe(true);
        expect(renderedText(view)).not.toContain("documentclass");
    });

    it("reveals the preamble when the cursor is inside it", () => {
        const view = mountPreview(
            "\\documentclass{article}\n\\begin{document}\nbody\n\\end{document}",
            { cursor: 5 },
        );

        expect(hasElement(view, ".cm-preamble-chip")).toBe(false);
        expect(renderedText(view)).toContain("documentclass");
    });

    it("keeps an environment boxed while its body is edited", () => {
        const doc = "\\begin{itemize}\n\\item one\n\\end{itemize}";

        // Cursor in the body, not on a tag line.
        const view = mountPreview(doc, { cursor: 22 });

        expect(hasElement(view, ".cm-env-line")).toBe(true);
        expect(renderedText(view)).not.toContain("\\begin{itemize}");
    });

    it("reveals the tags when the cursor reaches a tag line", () => {
        const doc = "\\begin{itemize}\n\\item one\n\\end{itemize}";

        const view = mountPreview(doc, { cursor: 3 });

        expect(renderedText(view)).toContain("\\begin{itemize}");
    });
});

describe("live preview — inert regions", () => {
    it("does not render math inside a comment", () => {
        const view = mountPreview("% costs $5 and $10\nreal text");

        expect(hasElement(view, ".cm-inline-math")).toBe(false);
        expect(renderedText(view)).toContain("$5 and $10");
    });

    it("does not render commands inside a verbatim body", () => {
        const view = mountPreview("\\begin{verbatim}\n$x$ \\alpha\n\\end{verbatim}");

        expect(hasElement(view, ".cm-inline-math")).toBe(false);
        expect(hasElement(view, ".cm-symbol")).toBe(false);
        expect(renderedText(view)).toContain("$x$ \\alpha");
    });

    it("still boxes the verbatim environment", () => {
        const view = mountPreview("\\begin{verbatim}\ncode\n\\end{verbatim}");

        expect(hasElement(view, ".cm-env-line")).toBe(true);
    });
});

describe("live preview — view modes", () => {
    it("renders nothing in source mode", () => {
        const view = mountPreview("$x^2$ and \\alpha", { mode: "source" });

        expect(hasElement(view, ".cm-inline-math")).toBe(false);
        expect(hasElement(view, ".cm-symbol")).toBe(false);
        expect(renderedText(view)).toContain("$x^2$");
    });

    it("keeps everything rendered in read-only mode, cursor or not", () => {
        // A cursor inside the math would reveal it in live mode.
        const view = mountPreview("Euler: $e^x$ done.", { cursor: 9, mode: "readonly" });

        expect(hasElement(view, ".cm-inline-math")).toBe(true);
        expect(renderedText(view)).not.toContain("$e^x$");
    });

    it("is not editable in read-only mode", () => {
        const view = mountPreview("text", { mode: "readonly" });

        expect(view.state.readOnly).toBe(true);
    });
});

describe("live preview — cursor motion over hidden text", () => {
    /**
     * Moves one character right from a position, as pressing the arrow
     * key would, honouring atomic ranges.
     *
     * @param view - The mounted view.
     * @param from - Starting position.
     * @returns The resulting cursor position.
     */
    function moveRight(view: EditorView, from: number): number {
        return view.moveByChar(EditorSelection.cursor(from), true).head;
    }

    it("skips a heading's hidden command in one press", () => {
        // "\section{Intro}" — the hidden prefix runs to index 9.
        const view = mountPreview("\\section{Intro}\n\ntext");

        expect(moveRight(view, 0)).toBe(9);
    });

    it("skips a list marker in one press", () => {
        const doc = "\\begin{itemize}\n\\item one\n\\end{itemize}";
        const view = mountPreview(doc);

        // "\item" occupies 16-21 on the second line.
        expect(moveRight(view, 16)).toBe(21);
    });

    it("still lets the cursor enter a hidden environment tag line", () => {
        // Making hidden tag lines atomic would leave `\begin{...}`
        // permanently uneditable, since cursor contact is what reveals
        // it. Stepping into the line must stay a normal move.
        const view = mountPreview("\\begin{itemize}\n\\item one\n\\end{itemize}");

        expect(moveRight(view, 0)).toBe(1);
    });

    it("still lets the cursor enter the collapsed preamble", () => {
        const view = mountPreview(
            "\\documentclass{article}\n\\begin{document}\nbody\n\\end{document}",
        );

        expect(moveRight(view, 0)).toBe(1);
    });
});

describe("live preview — scan caching", () => {
    it("reuses the scan across a cursor move", () => {
        const view = mountPreview("$x^2$ and \\section{Hi}");
        const before = view.state.field(documentScanField);

        view.dispatch({ selection: { anchor: 3 } });

        // Reference equality, not deep equality: a new object here
        // means the whole document was rescanned for an arrow key.
        expect(view.state.field(documentScanField)).toBe(before);
    });

    it("reuses the scan across a viewport change", () => {
        const view = mountPreview("line\n".repeat(200));
        const before = view.state.field(documentScanField);

        view.dispatch({ effects: EditorView.scrollIntoView(500) });

        expect(view.state.field(documentScanField)).toBe(before);
    });

    it("rescans after an edit", () => {
        const view = mountPreview("plain");
        const before = view.state.field(documentScanField);

        view.dispatch({ changes: { from: 0, insert: "$x$ " } });

        const after = view.state.field(documentScanField);
        expect(after).not.toBe(before);
        expect(after.math).toHaveLength(1);
    });
});

describe("live preview — updates", () => {
    it("re-renders after an edit introduces math", () => {
        const view = mountPreview("plain text");

        expect(hasElement(view, ".cm-inline-math")).toBe(false);

        view.dispatch({
            changes: { from: 0, insert: "$x^2$ " },
            selection: { anchor: view.state.doc.length + 6 },
        });

        expect(hasElement(view, ".cm-inline-math")).toBe(true);
    });

    it("re-renders after an edit comments math out", () => {
        const view = mountPreview("$x^2$");

        expect(hasElement(view, ".cm-inline-math")).toBe(true);

        view.dispatch({ changes: { from: 0, insert: "% " } });

        expect(hasElement(view, ".cm-inline-math")).toBe(false);
    });

    it("reveals and re-hides as the cursor moves through math", () => {
        const view = mountPreview("a $x^2$ b", { cursor: 0 });

        expect(hasElement(view, ".cm-inline-math")).toBe(true);

        view.dispatch({ selection: { anchor: 4 } });
        expect(hasElement(view, ".cm-inline-math")).toBe(false);

        view.dispatch({ selection: { anchor: 0 } });
        expect(hasElement(view, ".cm-inline-math")).toBe(true);
    });
});

describe("live preview — selecting across a block", () => {
    /** An environment whose tag lines the preview hides. */
    const DOC = [
        "before",
        String.raw`\begin{itemize}`,
        String.raw`\item one`,
        String.raw`\item two`,
        String.raw`\end{itemize}`,
        "after",
    ].join("\n");

    /** The tag lines that make the box a box. */
    const BEGIN_TAG = String.raw`\begin{itemize}`;
    const END_TAG = String.raw`\end{itemize}`;

    /**
     * Presses the primary mouse button inside the editor.
     *
     * @param view - The mounted view.
     */
    function pressMouse(view: EditorView): void {
        // `pointerdown`, matching what the preview listens for: it
        // fires before the browser's mousedown, which is what lets the
        // pre-click selection be captured.
        view.contentDOM.dispatchEvent(
            new PointerEvent("pointerdown", { button: 0, isPrimary: true, bubbles: true }),
        );
    }

    /** Releases the button, wherever the pointer ended up. */
    function releaseMouse(): void {
        window.dispatchEvent(
            new PointerEvent("pointerup", { button: 0, isPrimary: true, bubbles: true }),
        );
    }

    it("keeps the block's tag lines hidden while a drag grows into it", () => {
        // The bug this guards: revealing mid-drag un-hides the tag
        // lines, everything below shifts down, and the pointer ends up
        // over a different line — so the selection collapses to one.
        const view = mountPreview(DOC, { cursor: 0 });
        expect(renderedText(view)).not.toContain(BEGIN_TAG);

        pressMouse(view);
        view.dispatch({ selection: EditorSelection.single(0, DOC.length) });

        expect(renderedText(view)).not.toContain(BEGIN_TAG);
        expect(renderedText(view)).not.toContain(END_TAG);
    });

    it("reveals once the drag finishes", () => {
        const view = mountPreview(DOC, { cursor: 0 });

        pressMouse(view);
        view.dispatch({ selection: EditorSelection.single(0, DOC.length) });
        releaseMouse();

        expect(renderedText(view)).toContain(BEGIN_TAG);
    });

    it("still reveals for an ordinary selection change", () => {
        // Keyboard selection never had the problem, so it must keep
        // behaving exactly as before.
        const view = mountPreview(DOC, { cursor: 0 });

        view.dispatch({ selection: EditorSelection.single(0, DOC.length) });

        expect(renderedText(view)).toContain(BEGIN_TAG);
    });
});
