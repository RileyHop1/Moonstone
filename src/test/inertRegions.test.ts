/**
 * Test suite for inert-region masking: the comment and verbatim
 * regions whose contents the preview must never render.
 */

import { describe, it, expect } from "vitest";
import {
    findCommentRanges,
    findInertRegions,
    findLiteralRanges,
    maskChunk,
    maskInertRegions,
} from "../views/editor/TextEditor/LivePreview/inertRegions";
import { findMathRanges } from "../views/editor/TextEditor/LivePreview/findMath";
import { findSymbolRanges } from "../views/editor/TextEditor/LivePreview/symbols";
import { findSections } from "../views/editor/TextEditor/LivePreview/findSections";
import { findEnvironments } from "../views/editor/TextEditor/LivePreview/findEnvironments";

describe("findCommentRanges", () => {
    it("finds a comment running to the end of its line", () => {
        const text = "before % comment\nafter";

        expect(findCommentRanges(text)).toEqual([{ from: 7, to: 16 }]);
    });

    it("treats an escaped percent as literal text", () => {
        expect(findCommentRanges("100\\% sure")).toEqual([]);
    });

    it("treats a percent after a line break as a comment", () => {
        // `\\` is a line break, so the `%` that follows is not escaped.
        const ranges = findCommentRanges("line\\\\% trailing");

        expect(ranges).toEqual([{ from: 6, to: 16 }]);
    });

    it("finds a comment on the final line without a newline", () => {
        expect(findCommentRanges("x % end")).toEqual([{ from: 2, to: 7 }]);
    });
});

describe("findLiteralRanges", () => {
    it("finds a verbatim body but not its tags", () => {
        const text = "\\begin{verbatim}\ncode\n\\end{verbatim}";

        expect(findLiteralRanges(text, [])).toEqual([{ from: 16, to: 22 }]);
    });

    it("finds lstlisting and minted bodies", () => {
        const listing = "\\begin{lstlisting}\nx\n\\end{lstlisting}";
        const minted = "\\begin{minted}{python}\nx\n\\end{minted}";

        expect(findLiteralRanges(listing, [])).toHaveLength(1);
        expect(findLiteralRanges(minted, [])).toHaveLength(1);
    });

    it("ignores non-literal environments", () => {
        expect(findLiteralRanges("\\begin{itemize}\nx\n\\end{itemize}", [])).toEqual([]);
    });

    it("ignores an unclosed literal environment", () => {
        expect(findLiteralRanges("\\begin{verbatim}\nforever", [])).toEqual([]);
    });

    it("finds a \\verb argument", () => {
        const text = "use \\verb|$x$| here";

        expect(findLiteralRanges(text, [])).toEqual([{ from: 10, to: 13 }]);
    });

    it("ignores a \\verb argument that never closes on its line", () => {
        expect(findLiteralRanges("\\verb|unclosed\nnext", [])).toEqual([]);
    });

    it("ignores a commented-out opening tag", () => {
        const text = "% \\begin{verbatim}\ncode";
        const comments = findCommentRanges(text);

        expect(findLiteralRanges(text, comments)).toEqual([]);
    });
});

describe("maskInertRegions", () => {
    it("preserves length and newline positions", () => {
        const text = "a % comment\nb\n\\begin{verbatim}\nx\n\\end{verbatim}";

        const masked = maskInertRegions(text);

        expect(masked).toHaveLength(text.length);
        for (let index = 0; index < text.length; index++) {
            if (text[index] === "\n") expect(masked[index]).toBe("\n");
        }
    });

    it("blanks comment bodies but keeps surrounding text", () => {
        const masked = maskInertRegions("keep % drop");

        expect(masked).toBe("keep       ");
    });

    it("stops a commented-out verbatim from opening a literal region", () => {
        const text = "% \\begin{verbatim}\n$x$";

        // The math after the comment is still live: the comment masked
        // the \begin, so no literal region was ever opened.
        expect(findMathRanges(maskInertRegions(text), 0)).toHaveLength(1);
    });
});

describe("maskChunk", () => {
    it("masks only the requested span, with document-relative regions", () => {
        const doc = "line one\n% hidden\nline three";
        const regions = findInertRegions(doc);

        // Mask just the middle line, as the inline layer would.
        const chunk = maskChunk(doc.slice(9, 17), 9, regions);

        expect(chunk).toBe("        ");
        expect(chunk).toHaveLength(8);
    });

    it("masks the part of a region that reaches into the span", () => {
        const doc = "\\begin{verbatim}\nabc\ndef\n\\end{verbatim}";
        const regions = findInertRegions(doc);

        // A chunk starting mid-body, as when scrolled into a code block.
        const chunk = maskChunk(doc.slice(21, 24), 21, regions);

        expect(chunk).toBe("   ");
    });

    it("leaves a span with no inert regions untouched", () => {
        const doc = "% comment\nplain text here";
        const regions = findInertRegions(doc);

        expect(maskChunk(doc.slice(10, 25), 10, regions)).toBe("plain text here");
    });

    it("agrees with masking the whole document at once", () => {
        const doc = "a % one\n$x$\n\\begin{verbatim}\n$y$\n\\end{verbatim}\ntail";
        const regions = findInertRegions(doc);
        const whole = maskInertRegions(doc);

        // Every chunk boundary must produce the same bytes as the
        // single-pass mask, or offsets would disagree between layers.
        for (let split = 0; split <= doc.length; split += 7) {
            const head = maskChunk(doc.slice(0, split), 0, regions);
            const tail = maskChunk(doc.slice(split), split, regions);

            expect(head + tail).toBe(whole);
        }
    });

    it("handles a \\verb nested inside a verbatim body without double blanking", () => {
        const doc = "\\begin{verbatim}\n\\verb|x|\n\\end{verbatim}";

        const masked = maskInertRegions(doc);

        expect(masked).toHaveLength(doc.length);
        expect(masked.slice(17, 25)).toBe("        ");
    });
});

describe("scanners over masked text", () => {
    it("does not find math inside a comment", () => {
        const masked = maskInertRegions("% costs $5 and $10\n$x$");

        const ranges = findMathRanges(masked, 0);

        expect(ranges).toHaveLength(1);
        expect(ranges[0]?.from).toBe(19);
    });

    it("does not find symbols inside a comment", () => {
        const masked = maskInertRegions("% use \\alpha here");

        expect(findSymbolRanges(masked, 0, [])).toEqual([]);
    });

    it("does not find a commented-out section heading", () => {
        const masked = maskInertRegions("% \\section{Draft}\n\\section{Real}");

        const sections = findSections(masked);

        expect(sections).toHaveLength(1);
        expect(sections[0]?.from).toBe(18);
    });

    it("does not pair environment tags inside comments", () => {
        const masked = maskInertRegions("% \\begin{itemize}\ntext");

        expect(findEnvironments(masked)).toEqual([]);
    });

    it("does not render math inside a verbatim body", () => {
        const masked = maskInertRegions("\\begin{verbatim}\n$x^2$\n\\end{verbatim}");

        expect(findMathRanges(masked, 0)).toEqual([]);
    });

    it("does not render commands inside a verbatim body", () => {
        const masked = maskInertRegions(
            "\\begin{lstlisting}\n\\alpha \\textbf{x}\n\\end{lstlisting}",
        );

        expect(findSymbolRanges(masked, 0, [])).toEqual([]);
    });

    it("still exposes the verbatim tags so the box renders", () => {
        const masked = maskInertRegions("\\begin{verbatim}\n$x$\n\\end{verbatim}");

        const environments = findEnvironments(masked);

        expect(environments).toHaveLength(1);
        expect(environments[0]?.name).toBe("verbatim");
    });

    it("does not render math inside a \\verb argument", () => {
        const masked = maskInertRegions("text \\verb|$x$| more");

        expect(findMathRanges(masked, 0)).toEqual([]);
    });

    it("leaves ordinary content untouched", () => {
        const text = "\\section{Real}\n$x^2$ and \\alpha\n";

        expect(maskInertRegions(text)).toBe(text);
    });
});
