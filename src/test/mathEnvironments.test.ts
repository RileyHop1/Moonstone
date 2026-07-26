/**
 * Test suite pinning the contract behind `MATH_ENVIRONMENTS`: every
 * environment the preview hands to KaTeX must actually render.
 *
 * Listing an unsupported environment is worse than omitting it — the
 * generic environment box degrades gracefully, whereas KaTeX turns a
 * "No such environment" parse failure into red error text in place of
 * the author's equation.
 */

import { describe, it, expect } from "vitest";
import katex from "katex";
import { MATH_ENVIRONMENTS } from "../views/editor/TextEditor/LivePreview";

/**
 * A representative body for each supported environment. Bodies differ
 * because alignment tabs are only legal in some of them.
 */
const SAMPLE_BODIES: Readonly<Record<string, string>> = {
    equation: "E = mc^2",
    "equation*": "E = mc^2",
    align: "a &= b \\\\ c &= d",
    "align*": "a &= b \\\\ c &= d",
    alignat: "{2} a &= b & c &= d",
    "alignat*": "{2} a &= b & c &= d",
    gather: "a = b \\\\ c = d",
    "gather*": "a = b \\\\ c = d",
    cases: "1 & x > 0 \\\\ 0 & x \\le 0",
    dcases: "1 & x > 0 \\\\ 0 & x \\le 0",
    rcases: "1 & x > 0 \\\\ 0 & x \\le 0",
    aligned: "a &= b \\\\ c &= d",
    alignedat: "{2} a &= b & c &= d",
    gathered: "a = b \\\\ c = d",
    split: "a &= b \\\\ &= c",
};

/** Environments KaTeX rejects outright, which must never be listed. */
const UNSUPPORTED = ["multline", "multline*", "flalign", "eqnarray", "displaymath"];

describe("MATH_ENVIRONMENTS", () => {
    it("has a sample body for every listed environment", () => {
        // Guards the test itself: a newly listed environment without a
        // sample would otherwise be silently unverified.
        for (const name of MATH_ENVIRONMENTS) {
            expect(SAMPLE_BODIES[name], `no sample body for ${name}`).toBeDefined();
        }
    });

    it.each([...MATH_ENVIRONMENTS])("renders %s with KaTeX", (name) => {
        const body = SAMPLE_BODIES[name] ?? "";
        const source = `\\begin{${name}}${body}\\end{${name}}`;

        expect(() =>
            katex.renderToString(source, { displayMode: true, throwOnError: true }),
        ).not.toThrow();
    });

    it.each(UNSUPPORTED)("does not list %s, which KaTeX cannot parse", (name) => {
        expect(MATH_ENVIRONMENTS.has(name)).toBe(false);
    });

    it("does not list tabular, which renders as a table instead", () => {
        expect(MATH_ENVIRONMENTS.has("tabular")).toBe(false);
    });
});
