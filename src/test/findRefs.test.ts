/**
 * Test suite for the live preview's reference-command scanner.
 */

import { describe, it, expect } from "vitest";
import { findRefRanges } from "../views/editor/TextEditor/LivePreview/findRefs";

describe("findRefRanges", () => {
    it("finds each command kind", () => {
        expect(findRefRanges("\\ref{a}", 0, [])[0]?.kind).toBe("ref");
        expect(findRefRanges("\\eqref{a}", 0, [])[0]?.kind).toBe("eqref");
        expect(findRefRanges("\\cite{a}", 0, [])[0]?.kind).toBe("cite");
        expect(findRefRanges("\\label{a}", 0, [])[0]?.kind).toBe("label");
    });

    it("reports exact offsets", () => {
        //           0123456789
        const text = "see \\ref{fig:one}!";

        expect(findRefRanges(text, 0, [])).toEqual([
            { kind: "ref", from: 4, to: 17, keys: ["fig:one"], note: null, target: null },
        ]);
    });

    it("applies the document offset", () => {
        expect(findRefRanges("\\ref{a}", 50, [])).toEqual([
            { kind: "ref", from: 50, to: 57, keys: ["a"], note: null, target: null },
        ]);
    });

    it("splits and trims multi-key citations", () => {
        expect(findRefRanges("\\cite{knuth84, lamport94 }", 0, [])[0]?.keys).toEqual([
            "knuth84",
            "lamport94",
        ]);
    });

    it("captures a citation's optional locator", () => {
        const range = findRefRanges("\\cite[p.~3]{knuth84}", 0, [])[0];

        expect(range?.keys).toEqual(["knuth84"]);
        expect(range?.note).toBe("p.~3");
        expect(range?.to).toBe(20);
    });

    it("recognises natbib citation commands", () => {
        expect(findRefRanges("\\citep{a}", 0, [])[0]?.kind).toBe("cite");
        expect(findRefRanges("\\citet{a}", 0, [])[0]?.kind).toBe("cite");
    });

    it("captures a url target", () => {
        const range = findRefRanges("\\url{https://example.com}", 0, [])[0];

        expect(range?.kind).toBe("url");
        expect(range?.target).toBe("https://example.com");
    });

    it("captures href's target and link text separately", () => {
        const range = findRefRanges("\\href{https://example.com}{the site}", 0, [])[0];

        expect(range?.kind).toBe("href");
        expect(range?.target).toBe("https://example.com");
        expect(range?.note).toBe("the site");
    });

    it("does not split a url on its commas", () => {
        const range = findRefRanges("\\url{https://x.com/a,b}", 0, [])[0];

        expect(range?.keys).toEqual(["https://x.com/a,b"]);
    });

    it("captures a footnote body", () => {
        const range = findRefRanges("text\\footnote{see later}", 0, [])[0];

        expect(range?.kind).toBe("footnote");
        expect(range?.keys).toEqual(["see later"]);
    });

    it("skips empty and whitespace-only key lists", () => {
        expect(findRefRanges("\\ref{}", 0, [])).toEqual([]);
        expect(findRefRanges("\\cite{ , }", 0, [])).toEqual([]);
    });

    it("skips commands starting inside an excluded interval", () => {
        const text = "$\\eqref{eq:one}$";

        expect(findRefRanges(text, 0, [{ from: 0, to: 16 }])).toEqual([]);
    });

    it("skips escaped commands", () => {
        expect(findRefRanges("\\\\ref{a}", 0, [])).toEqual([]);
    });
});
