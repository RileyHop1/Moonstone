/**
 * Test suite for the live preview's math delimiter scanner.
 */

import { describe, it, expect } from "vitest";
import { findMathRanges } from "../views/editor/TextEditor/LivePreview/findMath";

describe("findMathRanges", () => {
    it("finds simple inline math", () => {
        const ranges = findMathRanges("$x^2$", 0);

        expect(ranges).toEqual([
            { from: 0, to: 5, innerFrom: 1, innerTo: 4, display: false },
        ]);
    });

    it("finds display math", () => {
        const ranges = findMathRanges("$$x$$", 0);

        expect(ranges).toEqual([
            { from: 0, to: 5, innerFrom: 2, innerTo: 3, display: true },
        ]);
    });

    it("offsets all positions into document space", () => {
        const ranges = findMathRanges("$x$", 100);

        expect(ranges).toEqual([
            { from: 100, to: 103, innerFrom: 101, innerTo: 102, display: false },
        ]);
    });

    it("ignores escaped dollar signs", () => {
        expect(findMathRanges("costs \\$5 and \\$6", 0)).toEqual([]);
    });

    it("yields nothing for unclosed delimiters", () => {
        expect(findMathRanges("$x", 0)).toEqual([]);
        expect(findMathRanges("$$x$", 0)).toEqual([]);
    });

    it("does not let inline math span lines", () => {
        expect(findMathRanges("$a\nb$", 0)).toEqual([]);
    });

    it("lets display math span lines", () => {
        const ranges = findMathRanges("$$\nx\n$$", 0);

        expect(ranges).toEqual([
            { from: 0, to: 7, innerFrom: 2, innerTo: 5, display: true },
        ]);
    });

    it("finds adjacent segments", () => {
        const ranges = findMathRanges("$a$$b$", 0);

        expect(ranges).toHaveLength(2);
        expect(ranges[0]).toMatchObject({ from: 0, to: 3, display: false });
        expect(ranges[1]).toMatchObject({ from: 3, to: 6, display: false });
    });

    it("finds multiple segments in mixed text", () => {
        const ranges = findMathRanges("a $x$ b $$y$$ c", 0);

        expect(ranges).toHaveLength(2);
        expect(ranges[0]).toMatchObject({ from: 2, to: 5, display: false });
        expect(ranges[1]).toMatchObject({ from: 8, to: 13, display: true });
    });

    it("skips escaped dollars inside math without ending the segment", () => {
        const ranges = findMathRanges("$a\\$b$", 0);

        expect(ranges).toEqual([
            { from: 0, to: 6, innerFrom: 1, innerTo: 5, display: false },
        ]);
    });
});
