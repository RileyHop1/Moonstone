/**
 * Test suite for the live preview's text-formatting scanner.
 */

import { describe, it, expect } from "vitest";
import { findFormatRanges } from "../views/editor/TextEditor/LivePreview/findFormatting";

describe("findFormatRanges", () => {
    it("maps each command to its style", () => {
        expect(findFormatRanges("\\textbf{a}", 0, [])[0]?.style).toBe("bold");
        expect(findFormatRanges("\\textit{a}", 0, [])[0]?.style).toBe("italic");
        expect(findFormatRanges("\\emph{a}", 0, [])[0]?.style).toBe("italic");
        expect(findFormatRanges("\\underline{a}", 0, [])[0]?.style).toBe("underline");
    });

    it("reports exact offsets", () => {
        //           0123456789
        const text = "x \\textbf{hi} y";

        expect(findFormatRanges(text, 0, [])).toEqual([
            { style: "bold", from: 2, to: 13, contentFrom: 10, contentTo: 12 },
        ]);
    });

    it("applies the document offset to all positions", () => {
        const text = "\\emph{a}";

        expect(findFormatRanges(text, 100, [])).toEqual([
            { style: "italic", from: 100, to: 108, contentFrom: 106, contentTo: 107 },
        ]);
    });

    it("finds both ranges of a nested command", () => {
        //           0         1
        //           0123456789012345678
        const text = "\\textbf{\\emph{x}}";

        expect(findFormatRanges(text, 0, [])).toEqual([
            { style: "bold", from: 0, to: 17, contentFrom: 8, contentTo: 16 },
            { style: "italic", from: 8, to: 16, contentFrom: 14, contentTo: 15 },
        ]);
    });

    it("handles triple nesting", () => {
        const text = "\\textbf{\\emph{\\underline{x}}}";
        const ranges = findFormatRanges(text, 0, []);

        expect(ranges.map((range) => range.style)).toEqual(["bold", "italic", "underline"]);
    });

    it("skips commands starting inside an excluded interval", () => {
        const text = "$\\textbf{x}$";

        expect(findFormatRanges(text, 0, [{ from: 0, to: 12 }])).toEqual([]);
    });

    it("keeps commands outside the excluded intervals", () => {
        const text = "$y$ \\textbf{x}";

        expect(findFormatRanges(text, 0, [{ from: 0, to: 3 }])).toHaveLength(1);
    });

    it("skips unclosed commands", () => {
        expect(findFormatRanges("\\textbf{oops", 0, [])).toEqual([]);
    });

    it("skips content spanning a line break", () => {
        expect(findFormatRanges("\\textbf{a\nb}", 0, [])).toEqual([]);
    });

    it("skips empty and whitespace-only content", () => {
        expect(findFormatRanges("\\textbf{}", 0, [])).toEqual([]);
        expect(findFormatRanges("\\emph{  }", 0, [])).toEqual([]);
    });

    it("skips escaped commands", () => {
        expect(findFormatRanges("\\\\textbf{x}", 0, [])).toEqual([]);
    });
});
