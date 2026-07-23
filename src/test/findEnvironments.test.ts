/**
 * Test suite for the live preview's environment scanner.
 */

import { describe, it, expect } from "vitest";
import { findEnvironments } from "../views/editor/TextEditor/LivePreview/findEnvironments";

describe("findEnvironments", () => {
    it("finds a simple pair", () => {
        const source = "\\begin{center}\nhello\n\\end{center}";
        const environments = findEnvironments(source);

        expect(environments).toEqual([
            {
                name: "center",
                from: 0,
                to: source.length,
                beginTo: "\\begin{center}".length,
                endFrom: source.indexOf("\\end{center}"),
            },
        ]);
    });

    it("finds nested environments sorted by start", () => {
        const source =
            "\\begin{document}\n\\begin{equation}\nx\n\\end{equation}\n\\end{document}";
        const environments = findEnvironments(source);

        expect(environments).toHaveLength(2);
        expect(environments[0]).toMatchObject({ name: "document", from: 0 });
        expect(environments[1]).toMatchObject({ name: "equation" });
    });

    it("ignores an \\end with no matching \\begin", () => {
        expect(findEnvironments("\\end{center}")).toEqual([]);
    });

    it("drops unclosed environments", () => {
        expect(findEnvironments("\\begin{center}\nhello")).toEqual([]);
    });

    it("ignores mismatched pairs", () => {
        expect(findEnvironments("\\begin{a}\n\\end{b}")).toEqual([]);
    });

    it("supports starred environment names", () => {
        const source = "\\begin{align*}\nx\n\\end{align*}";
        const environments = findEnvironments(source);

        expect(environments).toHaveLength(1);
        expect(environments[0]).toMatchObject({ name: "align*" });
    });

    it("recovers after malformed input", () => {
        const source = "\\end{bogus}\n\\begin{center}\nok\n\\end{center}";
        const environments = findEnvironments(source);

        expect(environments).toHaveLength(1);
        expect(environments[0]).toMatchObject({ name: "center" });
    });
});
