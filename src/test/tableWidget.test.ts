/**
 * Tests for `TableWidget`'s identity.
 *
 * `eq` decides whether CodeMirror re-renders a widget, and it runs on
 * every decoration-set comparison — which is every keystroke and every
 * cursor move. It used to answer by serialising the whole parsed grid
 * twice per call (finding B-2); these pin down the cheaper identity
 * that replaced it, including the case that identity has to catch.
 */

import { describe, expect, it } from "vitest";
import { TableWidget } from "../views/editor/TextEditor/LivePreview/MathWidget";
import { parseTabular } from "../views/editor/TextEditor/latex/parseTabular";
import type { TabularRows } from "../views/editor/TextEditor/latex/parseTabular";

/** Parses table source, failing the test when it cannot. */
function gridOf(source: string): TabularRows {
    const parsed = parseTabular(source);
    if (!parsed) throw new Error(`Could not parse: ${source}`);

    return parsed;
}

const SOURCE = "{ll}\nA & B \\\n";
const OTHER = "{ll}\nA & C \\\n";

describe("TableWidget.eq", () => {
    it("treats two widgets built from the same source as equal", () => {
        const left = new TableWidget(gridOf(SOURCE), SOURCE);
        const right = new TableWidget(gridOf(SOURCE), SOURCE);

        expect(left.eq(right)).toBe(true);
    });

    it("treats a changed table as different", () => {
        const left = new TableWidget(gridOf(SOURCE), SOURCE);
        const right = new TableWidget(gridOf(OTHER), OTHER);

        expect(left.eq(right)).toBe(false);
    });

    it("treats a changed macro definition as different", () => {
        // A cell can use a document-defined macro, so editing the
        // definition changes what the table renders even though its own
        // source is untouched. Without the macro key in the identity,
        // the table would keep its stale rendering.
        const left = new TableWidget(gridOf(SOURCE), SOURCE, { d: "x" }, '{"d":"x"}');
        const right = new TableWidget(gridOf(SOURCE), SOURCE, { d: "y" }, '{"d":"y"}');

        expect(left.eq(right)).toBe(false);
    });

    it("does not walk the parsed grid to answer", () => {
        // Same source, deliberately mismatched grids: if `eq` compared
        // the grids it would say "different". It must not — reading the
        // grid is the cost this identity exists to avoid.
        const left = new TableWidget(gridOf(SOURCE), SOURCE);
        const right = new TableWidget(gridOf(OTHER), SOURCE);

        expect(left.eq(right)).toBe(true);
    });
});
