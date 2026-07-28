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

/** Prose either side of a display-maths block. */
const DOCUMENT_WITH_DISPLAY_MATHS = [
    "Text before the equation.",
    "",
    "$$\\int_0^1 x \\, dx$$",
    "",
    "Text after the equation.",
].join("\n");

/**
 * Reports the cursor's line and whether the maths is rendered.
 *
 * @param page - The Playwright page.
 * @returns The cursor's 1-based line and the block-widget count.
 */
async function cursorState(page: Page): Promise<{ line: number; blocks: number }> {
    return page.evaluate(() => {
        const view = (window as { moonstoneView?: import("@codemirror/view").EditorView })
            .moonstoneView;
        if (!view) throw new Error("Editor is not mounted");

        return {
            line: view.state.doc.lineAt(view.state.selection.main.head).number,
            blocks: document.querySelectorAll(".cm-math-block").length,
        };
    });
}

/**
 * Places the cursor without using the mouse, and focuses the editor.
 *
 * @param page - The Playwright page.
 * @param offset - Document offset to move to.
 */
async function placeCursor(page: Page, offset: number): Promise<void> {
    await page.evaluate((at) => {
        const view = (window as { moonstoneView?: import("@codemirror/view").EditorView })
            .moonstoneView;
        if (!view) throw new Error("Editor is not mounted");
        view.dispatch({ selection: { anchor: at } });
        view.focus();
    }, offset);
}

test.describe("cursor motion over rendered blocks", () => {
    // A `block: true` replace leaves no text line for vertical motion
    // to land on, so arrow keys used to step clean over display maths —
    // which made it editable only by clicking. Real keys are the whole
    // point here, so these cannot live in jsdom.

    test("arrow up stops inside display maths rather than skipping it", async ({ page }) => {
        await openPreview(page, DOCUMENT_WITH_DISPLAY_MATHS);

        await placeCursor(page, DOCUMENT_WITH_DISPLAY_MATHS.indexOf("Text after") + 3);
        await expect(page.locator(".cm-math-block")).toHaveCount(1);

        // Up onto the blank line, then up again onto the maths.
        await page.keyboard.press("ArrowUp");
        await page.keyboard.press("ArrowUp");

        const state = await cursorState(page);
        expect(state.line, "cursor should land on the maths line").toBe(3);
        expect(state.blocks, "maths should reveal as editable source").toBe(0);
    });

    test("arrow down stops inside display maths rather than skipping it", async ({ page }) => {
        await openPreview(page, DOCUMENT_WITH_DISPLAY_MATHS);

        await placeCursor(page, 3);
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("ArrowDown");

        const state = await cursorState(page);
        expect(state.line).toBe(3);
        expect(state.blocks).toBe(0);
    });

    test("continues past the maths on the next press", async ({ page }) => {
        await openPreview(page, DOCUMENT_WITH_DISPLAY_MATHS);

        await placeCursor(page, DOCUMENT_WITH_DISPLAY_MATHS.indexOf("Text after") + 3);
        await page.keyboard.press("ArrowUp");
        await page.keyboard.press("ArrowUp");
        await page.keyboard.press("ArrowUp");

        // Stopping inside the block must cost one keypress, not trap
        // the cursor there.
        expect((await cursorState(page)).line).toBeLessThan(3);
    });

    test("inline maths is reached by horizontal motion", async ({ page }) => {
        const doc = "First line.\nSecond line with $x^2 + y^2$ maths.\nThird line.";
        await openPreview(page, doc);

        // From just past the maths, walk left into it.
        await placeCursor(page, doc.indexOf("maths."));
        for (let press = 0; press < 3; press++) await page.keyboard.press("ArrowLeft");

        await expect(page.locator(".cm-inline-math")).toHaveCount(0);
    });
});

/** Prose wrapped around a multi-line environment box. */
const DOCUMENT_WITH_BOX = [
    "Before the environment.",
    "",
    "\\begin{itemize}",
    "First line inside the box.",
    "Second line inside the box.",
    "Third line inside the box.",
    "Fourth line inside the box.",
    "\\end{itemize}",
    "",
    "After the environment.",
].join("\n");

test.describe("selection inside an environment box", () => {
    // CodeMirror draws selection into `.cm-selectionLayer` *behind* the
    // content, so an opaque background on a `.cm-line` hides it. The
    // environment box had exactly that, and selecting inside one showed
    // no highlight — which read as "only the last line renders".

    /**
     * Selects a range and reports what the selection layer drew.
     *
     * @param page - The Playwright page.
     * @param from - Selection anchor.
     * @param to - Selection head.
     * @returns Each drawn rectangle's top and width.
     */
    async function selectionRects(
        page: Page,
        from: number,
        to: number,
    ): Promise<{ top: number; width: number }[]> {
        await page.evaluate(
            ([anchor, head]) => {
                const view = (window as { moonstoneView?: import("@codemirror/view").EditorView })
                    .moonstoneView;
                if (!view) throw new Error("Editor is not mounted");
                view.focus();
                view.dispatch({ selection: { anchor: anchor as number, head: head as number } });
            },
            [from, to],
        );

        // Drawn in CodeMirror's measure phase, so a synchronous read
        // straight after the dispatch sees nothing.
        await page.waitForTimeout(300);

        return page.evaluate(() =>
            Array.from(document.querySelectorAll(".cm-selectionBackground")).map((element) => {
                const box = element.getBoundingClientRect();
                return { top: Math.round(box.top), width: Math.round(box.width) };
            }),
        );
    }

    test("draws the highlight on every selected line", async ({ page }) => {
        await openPreview(page, DOCUMENT_WITH_BOX);

        const rects = await selectionRects(
            page,
            DOCUMENT_WITH_BOX.indexOf("First line") + 3,
            DOCUMENT_WITH_BOX.indexOf("Fourth line") + 8,
        );

        // Three pieces: the tail of the first line, a block covering
        // the whole lines between, and the head of the last.
        expect(rects.length).toBeGreaterThanOrEqual(3);
        expect(rects.every((rect) => rect.width > 0)).toBe(true);
    });

    test("nothing paints over the selection layer", async ({ page }) => {
        await openPreview(page, DOCUMENT_WITH_BOX);

        await selectionRects(
            page,
            DOCUMENT_WITH_BOX.indexOf("First line") + 3,
            DOCUMENT_WITH_BOX.indexOf("Fourth line") + 8,
        );

        // The rule this enforces: a line inside a box must not carry an
        // *opaque* background of its own. Its surface is painted by a
        // pseudo-element below the selection layer instead.
        //
        // Translucent ones are fine and expected — the active line
        // carries a faint tint, and the selection shows through it.
        const opaqueLines = await page.evaluate(() =>
            Array.from(document.querySelectorAll(".cm-env-line"))
                .map((element) => getComputedStyle(element).backgroundColor)
                .filter((colour) => {
                    // Count the components rather than pattern-matching
                    // the last number: `rgb(19, 26, 38)` has no alpha,
                    // and reading its blue channel as one is how an
                    // earlier version of this passed against the bug.
                    const parts = colour.match(/[\d.]+/g) ?? [];
                    if (parts.length < 3) return false;

                    const alpha = parts.length >= 4 ? Number(parts[3]) : 1;
                    return alpha === 1;
                }),
        );

        expect(opaqueLines, "an opaque line background hides the selection").toEqual([]);
    });

    test("still draws the highlight when the selection leaves the box", async ({ page }) => {
        await openPreview(page, DOCUMENT_WITH_BOX);

        const rects = await selectionRects(
            page,
            DOCUMENT_WITH_BOX.indexOf("Before the") + 3,
            DOCUMENT_WITH_BOX.indexOf("Fourth line") + 8,
        );

        // This case always worked — leaving the box reveals it, which
        // removes the box styling — so it guards against a fix that
        // trades one for the other.
        expect(rects.length).toBeGreaterThanOrEqual(3);
        expect(rects.every((rect) => rect.width > 0)).toBe(true);
    });
});

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
