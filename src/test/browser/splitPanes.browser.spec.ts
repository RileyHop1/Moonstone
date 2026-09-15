/**
 * Drop-to-split, under real layout.
 *
 * What jsdom structurally cannot answer, and this can:
 *
 * - **The drop effects.** A `dropEffect` the drag source does not allow
 *   resolves to `"none"`, and then no `drop` event fires at all. jsdom
 *   does not enforce that rule, so the jsdom specs can only assert the
 *   two values are compatible, never that a browser agrees. If drag-to-
 *   split ever silently stops working, this is the spec that goes red.
 * - **Which edge wins is geometry**, and jsdom reports every rectangle
 *   as 0x0, so every drop there resolves to the centre.
 *
 * **What this does NOT cover, despite appearances.** In the real app
 * (WebView2) CodeMirror's own drop handler consumed the drop, inserted
 * the dragged path as text and stopped propagation, so the pane's
 * handler never ran — which is why the pane now claims these events in
 * the capture phase. Chromium does not reproduce that here: these specs
 * pass either way, checked by reverting the fix. The guard for it is
 * the jsdom test "claims the drop before an inner element can consume
 * it" in `EditorPane.test.tsx`, which simulates the stopped propagation
 * directly. Do not delete that test on the assumption this one covers
 * it.
 */

import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/** The harness, with the real pane tree mounted. */
const HARNESS = "/src/test/browser/workspaceHarness.html?panes=on&names=short";

/** Panes currently on screen. */
const PANES = ".editor-pane";

/**
 * Opens the harness and waits for the first pane's editor to mount.
 *
 * @param page - The Playwright page.
 */
async function openHarness(page: Page): Promise<void> {
    await page.goto(HARNESS);
    await page.waitForFunction(() => (window as { moonstoneReady?: boolean }).moonstoneReady);
    await expect(page.locator(`${PANES} .cm-content`).first()).toBeVisible();
}

/**
 * Drags a file row onto a point within a pane.
 *
 * Playwright's `dragTo` dispatches a single move, which browsers do not
 * always treat as a drag; the intermediate steps are what make the
 * gesture real, exactly as they are for a person.
 *
 * @param page - The Playwright page.
 * @param source - The file row to drag.
 * @param target - The pane to drop on.
 * @param position - Where within the pane to release, as a fraction.
 */
async function dragFileOnto(
    page: Page,
    source: Locator,
    target: Locator,
    position: { readonly xFraction: number; readonly yFraction: number },
): Promise<void> {
    const from = await source.boundingBox();
    const to = await target.boundingBox();
    if (!from || !to) throw new Error("Source or target is not laid out");

    const endX = to.x + to.width * position.xFraction;
    const endY = to.y + to.height * position.yFraction;

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();

    for (let step = 1; step <= 12; step++) {
        await page.mouse.move(
            from.x + (endX - from.x) * (step / 12),
            from.y + (endY - from.y) * (step / 12),
        );
    }

    await page.mouse.up();
}

test.describe("drop-to-split", () => {
    test("splits a pane when a file is dropped on its edge", async ({ page }) => {
        await openHarness(page);
        await expect(page.locator(PANES)).toHaveCount(1);

        await dragFileOnto(
            page,
            page.getByText("notes.tex", { exact: true }),
            page.locator(PANES).first(),
            { xFraction: 0.95, yFraction: 0.5 },
        );

        await expect(page.locator(PANES)).toHaveCount(2);
    });

    test("does not paste the dropped path into the document", async ({ page }) => {
        // The regression that drove this spec: CodeMirror consumed the
        // drop, inserted the path as text and stopped propagation, so
        // the pane's own handler never ran.
        await openHarness(page);

        await dragFileOnto(
            page,
            page.getByText("notes.tex", { exact: true }),
            page.locator(PANES).first(),
            { xFraction: 0.95, yFraction: 0.5 },
        );

        await expect(page.locator(PANES)).toHaveCount(2);

        // The harness names documents by base name only, so a full path
        // appearing in the text can only have come from the drag
        // payload being inserted as text.
        await expect(page.locator(`${PANES} .cm-content`).first()).not.toContainText(
            "C:/projects/project",
        );
    });

    test("opens the file in place when dropped in the middle", async ({ page }) => {
        // The centre is deliberately not an edge: dropping there
        // replaces the pane's file rather than making another column.
        await openHarness(page);

        await dragFileOnto(
            page,
            page.getByText("notes.tex", { exact: true }),
            page.locator(PANES).first(),
            { xFraction: 0.5, yFraction: 0.5 },
        );

        await expect(page.locator(PANES)).toHaveCount(1);
        await expect(page.locator(`${PANES} .cm-content`).first()).toContainText(
            "contents of notes.tex",
        );
    });

    test("clears the drop hint once the drop lands", async ({ page }) => {
        await openHarness(page);

        await dragFileOnto(
            page,
            page.getByText("notes.tex", { exact: true }),
            page.locator(PANES).first(),
            { xFraction: 0.95, yFraction: 0.5 },
        );

        await expect(page.locator(".pane-drop-hint")).toHaveCount(0);
    });

    test("splits downwards when dropped on the bottom edge", async ({ page }) => {
        await openHarness(page);

        await dragFileOnto(
            page,
            page.getByText("notes.tex", { exact: true }),
            page.locator(PANES).first(),
            { xFraction: 0.5, yFraction: 0.95 },
        );

        await expect(page.locator(".pane-split-column")).toHaveCount(1);
        await expect(page.locator(PANES)).toHaveCount(2);
    });
});

test.describe("the pane splitter", () => {
    test("moves space from one pane to its neighbour", async ({ page }) => {
        await openHarness(page);

        await dragFileOnto(
            page,
            page.getByText("notes.tex", { exact: true }),
            page.locator(PANES).first(),
            { xFraction: 0.95, yFraction: 0.5 },
        );
        await expect(page.locator(PANES)).toHaveCount(2);

        const before = await page.locator(PANES).first().boundingBox();
        const splitter = page.locator(".pane-splitter");
        const grip = await splitter.boundingBox();
        if (!before || !grip) throw new Error("Panes are not laid out");

        await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
        await page.mouse.down();
        await page.mouse.move(grip.x - 150, grip.y + grip.height / 2, { steps: 10 });
        await page.mouse.up();

        const after = await page.locator(PANES).first().boundingBox();
        if (!after) throw new Error("The pane vanished");

        expect(after.width).toBeLessThan(before.width - 50);
    });
});
