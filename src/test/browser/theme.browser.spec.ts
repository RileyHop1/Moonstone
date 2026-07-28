/**
 * Contrast audit for both palettes.
 *
 * Deliberately *not* screenshot baselines. Pixel baselines are
 * platform-sensitive — font rendering differs between a dev machine
 * and CI — and every intentional design change becomes a baseline
 * update. What "the light theme is washed out" actually means is
 * measurable: text that does not separate from its background, and
 * interactive surfaces that do not register against theirs. Both are
 * computed here, in whatever browser is running, and stay true across
 * machines.
 *
 * Thresholds follow WCAG 2.1: 4.5:1 for body text, 3:1 for large text
 * and for meaningful non-text boundaries such as borders.
 */

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { THEME_LIST } from "../../shared/themes";

/** WCAG AA for normal-sized text. */
const AA_TEXT = 4.5;

/** WCAG AA for large text and non-text boundaries. */
const AA_LARGE = 3;

/**
 * Smallest contrast ratio at which a tinted surface is perceptible
 * against the surface it sits on.
 *
 * Not a WCAG figure — hover and selection tints are decorative, and no
 * standard sets a floor for them. It is a regression guard: 1.05 is
 * about where a flat fill stops being visible, and it is exactly what
 * a dark-tuned tint scored when reused on a light background.
 */
const PERCEPTIBLE = 1.05;

/** One measured pair. */
interface ContrastCheck {
    readonly label: string;
    readonly ratio: number;
}

/**
 * Opens the workspace harness in a given palette.
 *
 * @param page - The Playwright page.
 * @param theme - Palette to apply.
 */
async function openTheme(page: Page, theme: string): Promise<void> {
    await page.goto(`/src/test/browser/workspaceHarness.html?theme=${theme}&names=short`);
    await page.waitForFunction(() => (window as { moonstoneReady?: boolean }).moonstoneReady);

    // A typo in a theme id would otherwise leave the default palette in
    // place and quietly audit it twice.
    await expect(page.locator(`:root[data-theme="${theme}"]`)).toHaveCount(1);
}

/**
 * Measures contrast ratios between palette variables.
 *
 * Runs in the page so the values are whatever the browser actually
 * resolved, including any compositing of translucent tints.
 *
 * @param page - The Playwright page.
 * @param pairs - Foreground/background variable pairs to measure.
 * @returns One result per pair.
 */
async function measureContrast(
    page: Page,
    pairs: readonly (readonly [string, string, string])[],
): Promise<ContrastCheck[]> {
    return page.evaluate((toMeasure) => {
        const styles = getComputedStyle(document.documentElement);

        /**
         * Resolves a CSS colour to RGBA channels by asking the browser
         * rather than parsing, so every notation is handled.
         */
        const toRgba = (colour: string): [number, number, number, number] => {
            const probe = document.createElement("div");
            probe.style.color = colour;
            document.body.appendChild(probe);
            const resolved = getComputedStyle(probe).color;
            probe.remove();

            const parts = resolved.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1];
            return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
        };

        /** Composites a possibly translucent colour over an opaque one. */
        const composite = (
            top: [number, number, number, number],
            bottom: [number, number, number, number],
        ): [number, number, number] => [
            top[0] * top[3] + bottom[0] * (1 - top[3]),
            top[1] * top[3] + bottom[1] * (1 - top[3]),
            top[2] * top[3] + bottom[2] * (1 - top[3]),
        ];

        /** WCAG relative luminance. */
        const luminance = ([r, g, b]: [number, number, number]): number => {
            const channel = (value: number): number => {
                const scaled = value / 255;
                return scaled <= 0.03928
                    ? scaled / 12.92
                    : Math.pow((scaled + 0.055) / 1.055, 2.4);
            };

            return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
        };

        return toMeasure.map(([label, foreground, background]) => {
            const backgroundRgba = toRgba(styles.getPropertyValue(background).trim());
            const backgroundRgb: [number, number, number] = [
                backgroundRgba[0],
                backgroundRgba[1],
                backgroundRgba[2],
            ];

            const foregroundRgb = composite(
                toRgba(styles.getPropertyValue(foreground).trim()),
                backgroundRgba,
            );

            const lighter = Math.max(luminance(foregroundRgb), luminance(backgroundRgb));
            const darker = Math.min(luminance(foregroundRgb), luminance(backgroundRgb));

            return { label, ratio: (lighter + 0.05) / (darker + 0.05) };
        });
    }, pairs);
}

/** Text that must be comfortably readable, with the surface it sits on. */
const TEXT_PAIRS = [
    ["primary text on the app background", "--text-primary", "--bg-app"],
    ["primary text in the editor", "--text-primary", "--bg-editor"],
    ["primary text in the sidebar", "--text-primary", "--bg-sidebar"],
    ["primary text on the preview surface", "--text-primary", "--bg-preview"],
    ["secondary text on the app background", "--text-secondary", "--bg-app"],
    ["secondary text in the sidebar", "--text-secondary", "--bg-sidebar"],
    ["secondary text in the titlebar", "--text-secondary", "--bg-titlebar"],
    ["accent as text in the sidebar", "--accent", "--bg-sidebar"],
    ["error text on the app background", "--error-color", "--bg-app"],
] as const;

/** Syntax colours, all of which are body text in the editor. */
const SYNTAX_PAIRS = [
    ["keyword", "--syn-keyword", "--bg-editor"],
    ["name", "--syn-name", "--bg-editor"],
    ["variable", "--syn-variable", "--bg-editor"],
    ["string", "--syn-string", "--bg-editor"],
    ["number", "--syn-number", "--bg-editor"],
    ["operator", "--syn-operator", "--bg-editor"],
    ["heading", "--syn-heading", "--bg-editor"],
    ["invalid", "--syn-invalid", "--bg-editor"],
] as const;

/** Tints that must register against the surface they cover. */
const SURFACE_PAIRS = [
    ["hover over the sidebar", "--surface-hover", "--bg-sidebar"],
    ["selected row in the sidebar", "--surface-selected", "--bg-sidebar"],
    ["active line in the editor", "--surface-active-line", "--bg-editor"],
    ["text selection in the editor", "--surface-selection", "--bg-editor"],
    ["drop target in the sidebar", "--surface-drop-target", "--bg-sidebar"],
] as const;

// Every registered theme is audited, so a new palette cannot ship
// without meeting the same bar as the two that came first.
for (const { id: theme, label, minContrast } of THEME_LIST) {
    // A theme may promise more than AA — Eclipse claims to be high
    // contrast, and this is what turns that from a label into a test.
    const textFloor = minContrast ?? AA_TEXT;

    // Comments sit behind the prose everywhere, but a palette built for
    // legibility should not bury them as deeply as an atmospheric one.
    const commentFloor = minContrast === undefined ? AA_LARGE : AA_TEXT;

    test.describe(`${label} theme`, () => {
        test(`body text meets ${textFloor}:1 everywhere it appears`, async ({ page }) => {
            await openTheme(page, theme);

            const failures = (await measureContrast(page, TEXT_PAIRS))
                .filter((check) => check.ratio < textFloor)
                .map((check) => `${check.label}: ${check.ratio.toFixed(2)}:1`);

            expect(failures, `below ${textFloor}:1`).toEqual([]);
        });

        test(`syntax colours meet ${textFloor}:1 against the editor`, async ({ page }) => {
            await openTheme(page, theme);

            const failures = (await measureContrast(page, SYNTAX_PAIRS))
                .filter((check) => check.ratio < textFloor)
                .map((check) => `${check.label}: ${check.ratio.toFixed(2)}:1`);

            expect(failures, `below ${textFloor}:1`).toEqual([]);
        });

        test("comments recede without becoming unreadable", async ({ page }) => {
            await openTheme(page, theme);

            // Comments are deliberately dimmed so they sit behind the
            // prose, but "dimmed" must not mean "illegible".
            const [comment] = await measureContrast(page, [
                ["comment", "--syn-comment", "--bg-editor"],
            ]);

            expect(comment?.ratio ?? 0).toBeGreaterThanOrEqual(commentFloor);
        });

        test("borders are visible against their surfaces", async ({ page }) => {
            await openTheme(page, theme);

            const [border] = await measureContrast(page, [
                ["border against the app background", "--border-color", "--bg-app"],
            ]);

            expect(border?.ratio ?? 0).toBeGreaterThanOrEqual(PERCEPTIBLE);
        });

        test("interactive surfaces register against what they cover", async ({ page }) => {
            await openTheme(page, theme);

            // The light theme's original failure: tints authored as
            // literals of the *dark* accent, which vanished over pale
            // backgrounds.
            const failures = (await measureContrast(page, SURFACE_PAIRS))
                .filter((check) => check.ratio < PERCEPTIBLE)
                .map((check) => `${check.label}: ${check.ratio.toFixed(3)}:1`);

            expect(failures, "tint is invisible against its surface").toEqual([]);
        });
    });
}

// A DOM scan for stray colour literals was tried here and removed: it
// only sees elements currently on screen, so rules for hover, selected
// and drop-target states — exactly where the literals were — never got
// evaluated, and it passed against the unfixed code. That check reads
// the stylesheets instead, in `src/test/themePalette.test.ts`.
