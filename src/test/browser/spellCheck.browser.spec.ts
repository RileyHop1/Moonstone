/**
 * Browser tests for the spell-check correction popup.
 *
 * The popup is CodeMirror's lint hover tooltip, which lives or dies by
 * pointer geometry — so these cannot run in jsdom, which has none.
 *
 * The behaviour under test is the one a user expects from any editor:
 * hovering a misspelling opens a box of corrections, and moving the
 * pointer onto that box to click a correction does not dismiss it.
 */

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** A misspelling present in the harness's default document. */
const MISSPELLED_WORD = "sentance";

/** The correction popup. */
const TOOLTIP = ".cm-tooltip-hover";

/** Loading the dictionary and debouncing the first lint pass is slow. */
const FIRST_CHECK_TIMEOUT_MS = 30_000;

/** A screen point, in CSS pixels. */
interface Point {
    readonly x: number;
    readonly y: number;
}

/**
 * Opens the harness with spell checking on and waits for the first
 * check to underline something.
 *
 * @param page - The Playwright page.
 */
async function openEditorWithMisspellings(page: Page): Promise<void> {
    await page.goto("/src/test/browser/harness.html?spell=on&view=live");
    await page.waitForFunction(() => (window as { moonstoneReady?: boolean }).moonstoneReady);

    await expect(page.locator(".cm-lintRange-warning").first()).toBeVisible({
        timeout: FIRST_CHECK_TIMEOUT_MS,
    });
}

/**
 * Finds the centre of a word in the rendered document.
 *
 * Coordinates come from CodeMirror rather than a DOM selector because
 * the word is a slice of a text node, not an element of its own.
 *
 * @param page - The Playwright page.
 * @param word - The word to locate.
 * @returns The centre point of the word on screen.
 */
async function centreOfWord(page: Page, word: string): Promise<Point> {
    return page.evaluate((target) => {
        const view = (window as { moonstoneView?: import("@codemirror/view").EditorView })
            .moonstoneView;
        if (!view) throw new Error("Editor is not mounted");

        const from = view.state.doc.toString().indexOf(target);
        if (from < 0) throw new Error(`Document does not contain "${target}"`);

        const start = view.coordsAtPos(from);
        const end = view.coordsAtPos(from + target.length);
        if (!start || !end) throw new Error(`"${target}" is not in view`);

        return { x: (start.left + end.right) / 2, y: (start.top + start.bottom) / 2 };
    }, word);
}

/**
 * Reads the popup's bounding box.
 *
 * @param page - The Playwright page.
 * @returns The box, or null when the popup is closed.
 */
async function tooltipBox(page: Page): Promise<{ x: number; y: number; width: number; height: number } | null> {
    return page.locator(TOOLTIP).first().boundingBox();
}

test.describe("spell-check correction popup", () => {
    test("opens when the pointer rests on a misspelling", async ({ page }) => {
        await openEditorWithMisspellings(page);

        await page.mouse.move(0, 0);
        const word = await centreOfWord(page, MISSPELLED_WORD);
        await page.mouse.move(word.x, word.y);

        await expect(page.locator(TOOLTIP)).toBeVisible();
        await expect(page.locator(TOOLTIP)).toContainText(MISSPELLED_WORD);
    });

    test("stays open while the pointer travels onto it", async ({ page }) => {
        await openEditorWithMisspellings(page);

        await page.mouse.move(0, 0);
        const word = await centreOfWord(page, MISSPELLED_WORD);
        await page.mouse.move(word.x, word.y);
        await expect(page.locator(TOOLTIP)).toBeVisible();

        const box = await tooltipBox(page);
        expect(box).not.toBeNull();
        if (!box) return;

        // Walk from the word to the middle of the popup the way a hand
        // does, checking at each step: a dead zone anywhere along the
        // path is what closes the box in real use.
        const target: Point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const steps = 12;
        const closedAt: Point[] = [];

        for (let step = 1; step <= steps; step++) {
            const point: Point = {
                x: word.x + ((target.x - word.x) * step) / steps,
                y: word.y + ((target.y - word.y) * step) / steps,
            };
            await page.mouse.move(point.x, point.y);

            if ((await page.locator(TOOLTIP).count()) === 0) closedAt.push(point);
        }

        expect(
            closedAt,
            `popup closed while the pointer moved from the word (${word.x}, ${word.y}) ` +
                `to the popup (${target.x}, ${target.y})`,
        ).toEqual([]);
    });

    test("stays reachable after the word has been clicked", async ({ page }) => {
        await openEditorWithMisspellings(page);

        // The flow users actually take: click the misspelling, then go
        // for the correction. The click moves the cursor out of the
        // preamble, collapsing it and re-laying out the body — which
        // used to leave CodeMirror's geometry adrift, so the popup
        // dismissed itself the moment the pointer moved.
        const before = await centreOfWord(page, MISSPELLED_WORD);
        await page.mouse.click(before.x, before.y);
        await expect(page.locator(".cm-preamble-chip")).toBeVisible();

        const word = await centreOfWord(page, MISSPELLED_WORD);
        await page.mouse.move(word.x + 4, word.y);
        await page.mouse.move(word.x, word.y);
        await expect(page.locator(TOOLTIP)).toBeVisible();

        const box = await tooltipBox(page);
        expect(box).not.toBeNull();
        if (!box) return;

        const target: Point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const steps = 12;
        const closedAt: Point[] = [];

        for (let step = 1; step <= steps; step++) {
            const point: Point = {
                x: word.x + ((target.x - word.x) * step) / steps,
                y: word.y + ((target.y - word.y) * step) / steps,
            };
            await page.mouse.move(point.x, point.y);

            if ((await page.locator(TOOLTIP).count()) === 0) closedAt.push(point);
        }

        expect(closedAt, "popup closed on the way from a clicked word to the corrections").toEqual(
            [],
        );
    });

    test("applies a correction when its button is clicked", async ({ page }) => {
        await openEditorWithMisspellings(page);

        await page.mouse.move(0, 0);
        const word = await centreOfWord(page, MISSPELLED_WORD);
        await page.mouse.move(word.x, word.y);
        await expect(page.locator(TOOLTIP)).toBeVisible();

        const correction = page.locator(`${TOOLTIP} .cm-diagnosticAction`).first();
        const replacement = (await correction.textContent()) ?? "";
        expect(replacement).not.toBe("");

        await correction.click();

        const text = await page.evaluate(() => {
            const view = (window as { moonstoneView?: import("@codemirror/view").EditorView })
                .moonstoneView;
            return view?.state.doc.toString() ?? "";
        });

        expect(text).not.toContain(MISSPELLED_WORD);
        expect(text).toContain(replacement);
    });
});
