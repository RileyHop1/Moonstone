/**
 * Browser tests for the live preview's *geometry*.
 *
 * The preview replaces whole regions of the document with block
 * widgets, and CodeMirror keeps its own height map of where every line
 * sits. When the two disagree, nothing looks wrong — but every
 * coordinate-to-position lookup silently resolves to the wrong line,
 * which breaks hover tooltips and anything else built on `posAtCoords`.
 *
 * The classic cause is a **vertical margin on a block widget**:
 * CodeMirror measures widgets with `getBoundingClientRect().height`,
 * which excludes margins. These tests guard the invariant rather than
 * any single widget, so a margin added to a future widget fails here.
 */

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** A document exercising the preamble chip and an environment box. */
const DOCUMENT_WITH_PREAMBLE = [
    "\\documentclass{article}",
    "\\usepackage{amsmath}",
    "",
    "\\begin{document}",
    "",
    "The first paragraph of the body, long enough to aim a pointer at.",
    "",
    "A second paragraph, so drift below the preamble has somewhere to show.",
    "",
    "\\end{document}",
].join("\n");

/**
 * Opens the harness on a given document in live preview.
 *
 * @param page - The Playwright page.
 * @param doc - Document text to load.
 */
async function openPreview(page: Page, doc: string): Promise<void> {
    await page.goto(
        `/src/test/browser/harness.html?spell=off&view=live&doc=${encodeURIComponent(doc)}`,
    );
    await page.waitForFunction(() => (window as { moonstoneReady?: boolean }).moonstoneReady);
    await expect(page.locator(".cm-content")).toBeVisible();
}

/**
 * Checks that every visible line round-trips through CodeMirror's
 * coordinate system: aiming at the middle of a line and asking which
 * position is there must give back a position on that same line.
 *
 * @param page - The Playwright page.
 * @returns One description per line that failed to round-trip.
 */
async function roundTripFailures(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const view = (window as { moonstoneView?: import("@codemirror/view").EditorView })
            .moonstoneView;
        if (!view) throw new Error("Editor is not mounted");

        const failures: string[] = [];

        for (const block of view.viewportLineBlocks) {
            const line = view.state.doc.lineAt(block.from);

            // A block covering more than one line is a replaced region
            // rendered as a single widget (the preamble chip, a display
            // equation): no one line sits at a given point inside it.
            if (block.from !== line.from || block.to !== line.to) continue;

            // Blank lines have no text to aim at, and a hidden line has
            // been replaced away — neither can round-trip.
            if (line.length === 0 || block.height < 2) continue;

            const start = view.coordsAtPos(line.from);
            const end = view.coordsAtPos(line.to);
            if (!start || !end) continue;

            const x = (start.left + end.right) / 2;

            // Sampled across the line's full height, not just its
            // centre: drift of a few pixels leaves the centre correct
            // while the rest of the line already resolves elsewhere,
            // which is precisely how this bug hid.
            for (let y = start.top + 1; y < start.bottom - 1; y += 2) {
                // `false` is the mode CodeMirror's own hover logic uses.
                const pos = view.posAtCoords({ x, y }, false);

                if (pos === null || pos < line.from || pos > line.to) {
                    failures.push(
                        `line ${line.number} ("${line.text.slice(0, 24)}") ` +
                            `at y=${y.toFixed(1)} of ${start.top.toFixed(1)}..${start.bottom.toFixed(1)} ` +
                            `resolved to ${pos} instead of ${line.from}..${line.to}`,
                    );
                    break;
                }
            }
        }

        return failures;
    });
}

test.describe("live preview geometry", () => {
    test("positions round-trip while the preamble is revealed", async ({ page }) => {
        await openPreview(page, DOCUMENT_WITH_PREAMBLE);

        expect(await roundTripFailures(page)).toEqual([]);
    });

    test("positions round-trip after the preamble collapses", async ({ page }) => {
        await openPreview(page, DOCUMENT_WITH_PREAMBLE);

        // Clicking into the body moves the cursor out of the preamble,
        // which collapses it to a chip and re-lays out everything below
        // — the moment the height map and the DOM can drift apart.
        const target = await page.evaluate(() => {
            const view = (window as { moonstoneView?: import("@codemirror/view").EditorView })
                .moonstoneView;
            if (!view) throw new Error("Editor is not mounted");

            const from = view.state.doc.toString().indexOf("first paragraph");
            const coords = view.coordsAtPos(from);
            if (!coords) throw new Error("Body is not in view");

            return { x: coords.left + 4, y: (coords.top + coords.bottom) / 2 };
        });

        await page.mouse.click(target.x, target.y);
        await expect(page.locator(".cm-preamble-chip")).toBeVisible();

        expect(await roundTripFailures(page)).toEqual([]);
    });

    test("no block widget carries a vertical margin", async ({ page }) => {
        await openPreview(page, DOCUMENT_WITH_PREAMBLE);

        const target = await page.evaluate(() => {
            const view = (window as { moonstoneView?: import("@codemirror/view").EditorView })
                .moonstoneView;
            if (!view) throw new Error("Editor is not mounted");
            const from = view.state.doc.toString().indexOf("first paragraph");
            const coords = view.coordsAtPos(from);
            if (!coords) throw new Error("Body is not in view");
            return { x: coords.left + 4, y: (coords.top + coords.bottom) / 2 };
        });

        await page.mouse.click(target.x, target.y);
        await expect(page.locator(".cm-preamble-chip")).toBeVisible();

        // A direct statement of the rule, because the behavioural test
        // above only fails once the drift grows large enough to change
        // which line a point resolves to. A widget's own box excludes
        // its margins, so this is checked from the stylesheet, not from
        // a measured rectangle.
        const offenders = await page.evaluate(() => {
            const view = (window as { moonstoneView?: import("@codemirror/view").EditorView })
                .moonstoneView;
            if (!view) throw new Error("Editor is not mounted");

            return Array.from(view.dom.querySelectorAll(".cm-widgetBuffer + *, .cm-line ~ div"))
                .concat(Array.from(view.dom.querySelectorAll(".cm-preamble-row, .cm-math-block")))
                .filter((element) => {
                    const style = getComputedStyle(element);
                    return (
                        parseFloat(style.marginTop) !== 0 || parseFloat(style.marginBottom) !== 0
                    );
                })
                .map((element) => `${element.tagName}.${element.className}`);
        });

        expect(offenders).toEqual([]);
    });
});
