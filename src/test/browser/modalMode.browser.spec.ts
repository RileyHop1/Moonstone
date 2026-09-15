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
async function openModal(
    page: Page,
    modal: "vim" | "helix",
    lines: "absolute" | "relative" | "mixed" = "absolute",
): Promise<void> {
    await page.goto(
        `/src/test/browser/harness.html?spell=off&view=source&modal=${modal}&lines=${lines}&doc=${encodeURIComponent(DOC)}`,
    );
    await page.waitForFunction(() => (window as { moonstoneReady?: boolean }).moonstoneReady);

    await page.locator(".cm-content").click();
    await page.waitForTimeout(200);
}

/** The Helix status panel, which reads `NOR`, `INS` or `SEL` plus a position. */
const HELIX_PANEL = ".cm-hx-status-panel";

/**
 * The line numbers actually on screen.
 *
 * CodeMirror keeps a hidden spacer element in the gutter, sized to the
 * widest number it expects. It is a `.cm-gutterElement` like the rest,
 * so reading text content naively picks up a number that is not on
 * screen — filtering on computed visibility is what leaves the real
 * ones.
 *
 * @param page - The Playwright page.
 * @returns The visible line numbers, top to bottom.
 */
async function visibleLineNumbers(page: Page): Promise<string[]> {
    return page.evaluate(() =>
        Array.from(document.querySelectorAll(".cm-lineNumbers .cm-gutterElement"))
            .filter((element) => getComputedStyle(element).visibility !== "hidden")
            .map((element) => element.textContent ?? ""),
    );
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

        await expect(page.locator(HELIX_PANEL)).toBeVisible();
    });

    test("themes its status panel", async ({ page }) => {
        await openModal(page, "helix");

        // Helix prefixes its panel classes with `cm-`. The stylesheet
        // originally omitted that, so these panels kept CodeMirror's
        // default chrome from the day they shipped — invisible to a
        // test that only asks whether the panel exists.
        expect(await panelBackground(page, HELIX_PANEL)).toBe(THEMED_PANEL_BACKGROUND);
    });
});

/**
 * Helix's keymap, not just its chrome.
 *
 * Vim had four tests that actually press keys; Helix had two that only
 * asked whether its panel existed and was painted. So the panel was
 * covered and the *editor* was not — a Helix keymap that had stopped
 * being installed at all would have passed both.
 */
test.describe("Helix editing", () => {
    test("enters and leaves insert mode", async ({ page }) => {
        await openModal(page, "helix");

        await expect(page.locator(HELIX_PANEL)).toContainText("NOR");

        await page.keyboard.press("i");
        await expect(page.locator(HELIX_PANEL)).toContainText("INS");

        await page.keyboard.press("Escape");
        await expect(page.locator(HELIX_PANEL)).toContainText("NOR");
    });

    test("enters select mode", async ({ page }) => {
        await openModal(page, "helix");

        await page.keyboard.press("v");

        // The case a cursor shape cannot convey, exactly as for Vim.
        await expect(page.locator(HELIX_PANEL)).toContainText("SEL");
    });

    test("types text in insert mode", async ({ page }) => {
        await openModal(page, "helix");

        await page.keyboard.press("i");
        await page.keyboard.type("XY", { delay: 50 });

        await expect(page.locator(".cm-content")).toContainText("Third line.XY");
    });

    test("treats keys as commands in normal mode, not as text", async ({ page }) => {
        // The assertion that proves the keymap is installed rather than
        // merely that a panel is on screen: `w` is a word motion, so it
        // must not reach the document as a character.
        await openModal(page, "helix");

        await page.keyboard.press("w");
        await page.keyboard.press("d");

        await expect(page.locator(HELIX_PANEL)).not.toContainText("INS");
        await expect(page.locator(".cm-content")).not.toContainText("wd");
    });

    test("drives mixed line numbering from its insert state", async ({ page }) => {
        // "Mixed" numbering is *defined* in terms of the modal editor's
        // insert state, which is the one place line numbering and modal
        // editing meet — and it had no browser coverage in either
        // direction. The `lines` harness parameter existed and was used
        // by nothing.
        await openModal(page, "helix", "mixed");

        // Normal mode: distances from the cursor, with the cursor's own
        // line showing its absolute number.
        await page.keyboard.press("Escape");
        expect(await visibleLineNumbers(page)).toEqual(["2", "1", "3"]);

        // Insert mode: plain absolute numbering, because counting lines
        // to jump to is not what you are doing while typing.
        await page.keyboard.press("i");
        await expect(page.locator(HELIX_PANEL)).toContainText("INS");
        expect(await visibleLineNumbers(page)).toEqual(["1", "2", "3"]);

        await page.keyboard.press("Escape");
        await expect(page.locator(HELIX_PANEL)).toContainText("NOR");
        expect(await visibleLineNumbers(page)).toEqual(["2", "1", "3"]);
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
