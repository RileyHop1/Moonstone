/**
 * The PDF viewer, with real pdf.js.
 *
 * jsdom has no canvas and no workers, so the jsdom suites stub the viewer
 * out entirely; this is the only place pdf.js actually runs. It also runs
 * under **WebKit** (see `playwright.config.ts`) — the engine family of
 * Linux's WebKitGTK, whose missing built-in PDF viewer is the reason
 * pdf.js is used at all. If Linux previews break, this is the spec that
 * should go red first.
 */

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** The harness page. */
const HARNESS = "/src/test/browser/pdfHarness.html";

/** The three-page fixture the harness loads by default. */
const FIXTURE = "/src/test/browser/fixtures/sample.pdf";

/** Rendered pages. */
const PAGES = ".pdfViewer .page";

/**
 * Opens the harness and waits for every fixture page to exist.
 *
 * @param page - The Playwright page.
 */
async function openFixture(page: Page): Promise<void> {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto(HARNESS);
    await expect(page.locator(PAGES)).toHaveCount(3);
}

/**
 * Width of the first rendered page, in CSS pixels.
 *
 * @param page - The Playwright page.
 * @returns The width.
 */
async function firstPageWidth(page: Page): Promise<number> {
    const box = await page.locator(PAGES).first().boundingBox();
    return box?.width ?? 0;
}

test.describe("PDF viewer", () => {
    test("draws the document's text onto a canvas", async ({ page }) => {
        await openFixture(page);

        const canvas = page.locator(`${PAGES} canvas`).first();
        await expect(canvas).toBeVisible();

        // A canvas that exists but is blank is exactly what a broken
        // worker or font load looks like, so count dark pixels: the
        // fixture's first line of text has to be drawn somewhere.
        await expect
            .poll(() =>
                canvas.evaluate((element: HTMLCanvasElement) => {
                    const context = element.getContext("2d");
                    if (!context) return 0;

                    const { data } = context.getImageData(0, 0, element.width, element.height);
                    let dark = 0;
                    for (let index = 0; index < data.length; index += 4) {
                        if ((data[index] ?? 255) < 128) dark += 1;
                    }
                    return dark;
                }),
            )
            .toBeGreaterThan(100);
    });

    test("opens at the pane's width", async ({ page }) => {
        await openFixture(page);

        const scroller = await page.locator(".pdf-viewer-scroll").boundingBox();
        const width = await firstPageWidth(page);

        // Fit-width leaves a small margin, but a page at 100% zoom would
        // be ~816px wide and overflow an 800px pane.
        expect(width).toBeGreaterThan((scroller?.width ?? 0) * 0.8);
        expect(width).toBeLessThanOrEqual(scroller?.width ?? 0);
    });

    test("zooms in, and back to the pane's width", async ({ page }) => {
        await openFixture(page);
        const fitted = await firstPageWidth(page);

        await page.getByRole("button", { name: "+" }).click();
        await expect.poll(() => firstPageWidth(page)).toBeGreaterThan(fitted * 1.05);

        await page.getByRole("button", { name: "Fit width" }).click();
        await expect.poll(() => firstPageWidth(page)).toBeCloseTo(fitted, 0);
    });

    test("reloads in place without losing the reader's place", async ({ page }) => {
        await openFixture(page);
        const scroller = page.locator(".pdf-viewer-scroll");
        await scroller.evaluate((element) => (element.scrollTop = 900));

        // Mark the current pages, so the reload is detectable by their
        // replacement rather than by waiting an arbitrary time.
        await page.locator(PAGES).evaluateAll((pages) => {
            for (const element of pages) element.setAttribute("data-stale", "");
        });
        await page.evaluate((source) => window.setPdfSource?.(source), `${FIXTURE}?v=2`);

        await expect(page.locator(`${PAGES}[data-stale]`)).toHaveCount(0);
        await expect(page.locator(PAGES)).toHaveCount(3);
        await expect
            .poll(() => scroller.evaluate((element) => element.scrollTop))
            .toBeGreaterThan(850);
    });

    test("settles when a page only just overflows the pane at fit width @scrollbars", async ({
        page,
    }) => {
        // The trap: fitting to width makes the page just too tall, so a
        // vertical scrollbar appears and narrows the pane; re-fitting to
        // the narrower pane makes it short enough that the scrollbar goes
        // away — and round again, forever. Found in the real app, where
        // it made the zoom snap back to fit-width under the reader.
        await page.setViewportSize({ width: 800, height: 2000 });
        await page.goto(`${HARNESS}?src=/src/test/browser/fixtures/single.pdf`);
        await expect(page.locator(`${PAGES} canvas`)).toBeVisible();

        // pdf.js stretches its content to fill the pane, so `scrollHeight`
        // says nothing; the page's own bottom edge is what overflows.
        const scroller = page.locator(".pdf-viewer-scroll");
        const { pageBottom, chrome } = await scroller.evaluate((element) => {
            const pageBox = element.querySelector(".page")?.getBoundingClientRect();
            const scrollerBox = element.getBoundingClientRect();
            return {
                pageBottom: (pageBox?.bottom ?? 0) - scrollerBox.top,
                chrome: window.innerHeight - element.clientHeight,
            };
        });
        await page.setViewportSize({ width: 800, height: Math.round(pageBottom + chrome - 4) });

        // "Must not keep changing" cannot be awaited, only sampled.
        const widths: number[] = [];
        for (let sample = 0; sample < 8; sample += 1) {
            await page.waitForTimeout(150);
            widths.push(await firstPageWidth(page));
        }
        expect(new Set(widths.slice(3)).size).toBe(1);
    });

    test("explains a PDF that cannot be opened instead of showing nothing", async ({
        page,
    }) => {
        await page.goto(`${HARNESS}?src=/does-not-exist.pdf`);

        await expect(page.getByRole("alert")).toContainText("Could not open this PDF");
    });
    test("reports a double-click in PDF points, whatever the zoom", async ({ page }) => {
        await openFixture(page);

        /**
         * Double-clicks a fraction of the way across and down page one's
         * printed area (inside pdf.js's page border).
         *
         * @param fx - Fraction across.
         * @param fy - Fraction down.
         * @returns The spot the viewer reported.
         */
        const doubleClickAt = async (fx: number, fy: number) => {
            const area = await page
                .locator(PAGES)
                .first()
                .evaluate((element) => {
                    const box = element.getBoundingClientRect();
                    return {
                        x: box.left + element.clientLeft,
                        y: box.top + element.clientTop,
                        width: element.clientWidth,
                        height: element.clientHeight,
                    };
                });
            await page.mouse.dblclick(area.x + area.width * fx, area.y + area.height * fy);
            return page.evaluate(() => {
                const clicks = window.moonstoneSyncClicks ?? [];
                return clicks[clicks.length - 1];
            });
        };

        const fitted = await doubleClickAt(0.5, 0.25);
        await page.getByRole("button", { name: "+" }).click();
        await page.getByRole("button", { name: "+" }).click();
        await page.locator(".pdf-viewer-scroll").evaluate((element) => element.scrollTo(0, 0));
        const zoomed = await doubleClickAt(0.5, 0.25);

        // The fixture is US Letter, 612 × 792pt: this is (306, 198). A
        // conversion that forgot the zoom, or the page border — which
        // the app's box-sizing reset once squeezed inside the page —
        // lands points away.
        for (const spot of [fitted, zoomed]) {
            expect(spot?.page).toBe(1);
            expect(Math.abs((spot?.x ?? 0) - 306)).toBeLessThan(1);
            expect(Math.abs((spot?.y ?? 0) - 198)).toBeLessThan(1);
        }
    });

    test("scrolls to a jump target and flashes its line", async ({ page }) => {
        await openFixture(page);

        await page.evaluate(() => window.setPdfTarget?.({ page: 3, x: 100, y: 300 }));

        const third = page.locator(PAGES).nth(2);
        await expect(third.locator(".pdf-sync-marker")).toHaveCount(1);
        await expect(third).toBeInViewport();
        // The marker removes itself once it has faded.
        await expect(third.locator(".pdf-sync-marker")).toHaveCount(0, { timeout: 5000 });
    });
});
