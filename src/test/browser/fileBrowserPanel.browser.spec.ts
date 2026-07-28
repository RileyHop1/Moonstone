/**
 * Browser tests for the resizable, collapsible file-browser panel.
 *
 * Resizing is a pointer drag that ends in a layout reflow, so almost
 * none of it can be tested without a real browser: jsdom has no widths
 * to redistribute and no pointer to drag with.
 */

import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

/** The panel wrapping the file browser. */
const PANEL = ".resizable-panel";

/** The drag target on the panel's inner edge. */
const GRIP = ".panel-splitter-grip";

/** The editor pane sharing the workspace with the panel. */
const EDITOR = ".project-editor-panel";

/**
 * Opens the workspace harness.
 *
 * @param page - The Playwright page.
 * @param query - Extra query string, without the leading `?`.
 */
async function openWorkspace(page: Page, query = ""): Promise<void> {
    await page.goto(`/src/test/browser/workspaceHarness.html${query ? `?${query}` : ""}`);
    await page.waitForFunction(() => (window as { moonstoneReady?: boolean }).moonstoneReady);
    await expect(page.locator(PANEL)).toBeVisible();
}

/**
 * Reads an element's rendered width.
 *
 * @param locator - The element.
 * @returns Its width in CSS pixels.
 */
async function widthOf(locator: Locator): Promise<number> {
    const box = await locator.boundingBox();
    if (!box) throw new Error("Element is not visible");

    return box.width;
}

/**
 * Drags the splitter horizontally.
 *
 * Moved in steps because a single jump can outrun pointer capture and
 * is nothing like the event stream a real drag produces.
 *
 * @param page - The Playwright page.
 * @param deltaX - Horizontal distance to drag, in pixels.
 */
async function dragSplitter(page: Page, deltaX: number): Promise<void> {
    const grip = page.locator(GRIP);
    const box = await grip.boundingBox();
    if (!box) throw new Error("Splitter is not visible");

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();

    const steps = 10;
    for (let step = 1; step <= steps; step++) {
        await page.mouse.move(startX + (deltaX * step) / steps, startY);
    }

    await page.mouse.up();
}

test.describe("file browser panel", () => {
    test("widens when the splitter is dragged outward", async ({ page }) => {
        await openWorkspace(page);

        const panel = page.locator(PANEL);
        const before = await widthOf(panel);

        await dragSplitter(page, 120);

        expect(await widthOf(panel)).toBeCloseTo(before + 120, -1);
    });

    test("narrows when the splitter is dragged inward", async ({ page }) => {
        await openWorkspace(page, "width=400");

        const panel = page.locator(PANEL);
        const before = await widthOf(panel);

        await dragSplitter(page, -120);

        expect(await widthOf(panel)).toBeCloseTo(before - 120, -1);
    });

    test("the editor reclaims exactly what the panel gives up", async ({ page }) => {
        await openWorkspace(page, "width=400");

        const editorBefore = await widthOf(page.locator(EDITOR));

        await dragSplitter(page, -150);

        // The workspace is fixed, so whatever the panel loses the
        // editor must gain — this is the "other panes react" half of
        // the feature, and it is invisible to jsdom.
        expect(await widthOf(page.locator(EDITOR))).toBeCloseTo(editorBefore + 150, -1);
    });

    test("cannot be shrunk to nothing", async ({ page }) => {
        await openWorkspace(page);

        // Far past the left edge of the screen: the gesture a
        // frustrated user makes, and the one that must not strand them.
        await dragSplitter(page, -2000);

        const width = await widthOf(page.locator(PANEL));

        expect(width).toBeGreaterThan(100);
        // Still draggable afterwards, which is the point of the floor.
        await expect(page.locator(GRIP)).toBeVisible();

        await dragSplitter(page, 200);
        expect(await widthOf(page.locator(PANEL))).toBeGreaterThan(width);
    });

    test("cannot squeeze the editor out of existence", async ({ page }) => {
        await openWorkspace(page);

        await dragSplitter(page, 5000);

        expect(await widthOf(page.locator(EDITOR))).toBeGreaterThan(200);
    });

    test("hides and restores the width it had", async ({ page }) => {
        await openWorkspace(page);

        const panel = page.locator(PANEL);
        await dragSplitter(page, 90);
        const chosenWidth = await widthOf(panel);

        const toggle = page.getByRole("button", { name: "Hide the file browser" });
        await toggle.click();

        // Collapsed: the browser is gone and the editor has the space.
        await expect(page.locator(".file-browser")).toHaveCount(0);
        expect(await widthOf(panel)).toBeLessThan(40);

        await page.getByRole("button", { name: "Show the file browser" }).click();

        await expect(page.locator(".file-browser")).toBeVisible();
        expect(await widthOf(panel)).toBeCloseTo(chosenWidth, -1);
    });

    test("drags the other way when docked right", async ({ page }) => {
        await openWorkspace(page, "side=right");

        const panel = page.locator(PANEL);
        const before = await widthOf(panel);

        // Docked right, the panel grows as the pointer moves *left*.
        await dragSplitter(page, -120);

        expect(await widthOf(panel)).toBeCloseTo(before + 120, -1);
    });
});

test.describe("file name truncation", () => {
    test("truncates a long name on display without changing it", async ({ page }) => {
        await openWorkspace(page, "width=180");

        const name = page.locator(".file-tree-name").first();

        const overflow = await name.evaluate((element) => ({
            // The rendered box is narrower than the text it holds,
            // which is what makes the browser draw an ellipsis.
            truncated: element.scrollWidth > element.clientWidth,
            text: element.textContent ?? "",
            ellipsis: getComputedStyle(element).textOverflow,
        }));

        expect(overflow.truncated).toBe(true);
        expect(overflow.ellipsis).toBe("ellipsis");
        // The name itself is untouched — only its rendering is clipped.
        expect(overflow.text).toContain("methodology.tex");
    });

    test("shows more of the name as the panel widens", async ({ page }) => {
        await openWorkspace(page, "width=180");

        const name = page.locator(".file-tree-name").first();
        const before = await widthOf(name);

        await dragSplitter(page, 200);

        // "Text should spread to fill space when more space is given."
        expect(await widthOf(name)).toBeGreaterThan(before);
    });

    test("renames using the full name, not the truncated one", async ({ page }) => {
        await openWorkspace(page, "width=180");

        const row = page.locator(".file-tree-row").first();
        await row.click({ button: "right" });

        await page.getByText("Rename", { exact: true }).click();

        const input = page.locator(".file-tree-rename-input");
        await expect(input).toBeVisible();

        // The editable value is the real filename: truncation must
        // never leak into what the user edits.
        await expect(input).toHaveValue(/an-extremely-long-chapter-filename/);
    });
});
