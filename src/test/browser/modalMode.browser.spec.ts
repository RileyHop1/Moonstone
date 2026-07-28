/**
 * Browser tests for modal editing's mode indicators.
 *
 * Real key handling is the point: under jsdom a modal keymap only
 * fires through `runScopeHandlers` with a hand-faked `keyCode`, which
 * tests the workaround more than the editor.
 */

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** A short document with room to move around in. */
const DOC = ["First line of prose.", "Second line of prose.", "Third line."].join("\n");

/**
 * Opens the harness in a modal mode, focused and ready for keys.
 *
 * @param page - The Playwright page.
 * @param modal - Which modal editor to enable.
 */
async function openModal(page: Page, modal: "vim" | "helix"): Promise<void> {
    await page.goto(
        `/src/test/browser/harness.html?spell=off&view=source&modal=${modal}&doc=${encodeURIComponent(DOC)}`,
    );
    await page.waitForFunction(() => (window as { moonstoneReady?: boolean }).moonstoneReady);

    await page.locator(".cm-content").click();
    await page.waitForTimeout(200);
}

test.describe("Vim mode indicator", () => {
    test("shows a status panel", async ({ page }) => {
        await openModal(page, "vim");

        // Helix has had a status panel since line numbering shipped;
        // Vim showed only a cursor shape, which cannot distinguish
        // normal from visual mode.
        await expect(page.locator(".cm-vim-panel")).toBeVisible();
    });

    test("reports insert mode, and stops when insert ends", async ({ page }) => {
        await openModal(page, "vim");

        await page.keyboard.press("i");
        await expect(page.locator(".cm-vim-panel")).toContainText(/insert/i);

        await page.keyboard.press("Escape");
        await expect(page.locator(".cm-vim-panel")).not.toContainText(/insert/i);
    });

    test("reports visual mode", async ({ page }) => {
        await openModal(page, "vim");

        await page.keyboard.press("Escape");
        await page.keyboard.press("v");

        // The case the cursor shape could never convey: visual and
        // normal mode look identical without a label.
        await expect(page.locator(".cm-vim-panel")).toContainText(/visual/i);
    });

    test("doubles as the command line", async ({ page }) => {
        await openModal(page, "vim");

        await page.keyboard.press("Escape");
        await page.keyboard.press(":");

        await expect(page.locator(".cm-vim-panel input")).toBeVisible();
    });
});

/**
 * Reports whether an element is painted with the app's own chrome.
 *
 * A panel that exists but is unstyled looks fine in a `toBeVisible`
 * assertion and wrong on screen, so the selector our stylesheet uses
 * has to be checked against the class the package actually emits.
 *
 * @param page - The Playwright page.
 * @param selector - The panel to inspect.
 * @returns Its computed background colour.
 */
async function panelBackground(page: Page, selector: string): Promise<string> {
    return page.evaluate((target) => {
        const element = document.querySelector(target);
        if (!element) throw new Error(`no element for ${target}`);
        return getComputedStyle(element).backgroundColor;
    }, selector);
}

/** `--bg-titlebar` in the default dark palette, which both panels use. */
const THEMED_PANEL_BACKGROUND = "rgb(7, 10, 15)";

test.describe("Helix mode indicator", () => {
    test("shows its status panel", async ({ page }) => {
        await openModal(page, "helix");

        await expect(page.locator(".cm-hx-status-panel")).toBeVisible();
    });

    test("themes its status panel", async ({ page }) => {
        await openModal(page, "helix");

        // Helix prefixes its panel classes with `cm-`. The stylesheet
        // originally omitted that, so these panels kept CodeMirror's
        // default chrome from the day they shipped — invisible to a
        // test that only asks whether the panel exists.
        expect(await panelBackground(page, ".cm-hx-status-panel")).toBe(
            THEMED_PANEL_BACKGROUND,
        );
    });
});

test("Vim's panel is themed too", async ({ page }) => {
    await openModal(page, "vim");

    expect(await panelBackground(page, ".cm-vim-panel")).toBe(THEMED_PANEL_BACKGROUND);
});

test("plain editing shows no modal panel", async ({ page }) => {
    await page.goto(
        `/src/test/browser/harness.html?spell=off&view=source&modal=none&doc=${encodeURIComponent(DOC)}`,
    );
    await page.waitForFunction(() => (window as { moonstoneReady?: boolean }).moonstoneReady);

    await expect(page.locator(".cm-vim-panel")).toHaveCount(0);
    await expect(page.locator(".cm-hx-status-panel")).toHaveCount(0);
});
