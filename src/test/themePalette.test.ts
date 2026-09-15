/**
 * Guards the rule that keeps both themes working: colours are defined
 * in `styles.css` and referenced everywhere else.
 *
 * This scans the source rather than the rendered page. A DOM-based
 * version was tried first and passed against the unfixed code, because
 * the offending rules were for hover, selected and drop-target states
 * — none of which are on screen while a test looks. Reading the
 * stylesheets covers every rule regardless of state.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, THEMES } from "../shared/themes";

/**
 * The app's source directory.
 *
 * Resolved from the working directory, not `import.meta.url`: these
 * suites run in jsdom, where `import.meta.url` is not a file URL.
 * Vite's glob import is no help either — the vitest config sets
 * `css: false`, so stylesheets arrive stubbed to empty strings, and a
 * scanner that reads nothing passes everything.
 */
const SOURCE_ROOT = join(process.cwd(), "src");

/** The one file allowed to name a colour. */
const PALETTE_FILE = "styles/styles.css";

/**
 * Lists source files that may carry styling.
 *
 * @param directory - Directory to walk.
 * @returns Paths of every `.css`, `.ts` and `.tsx` file beneath it.
 */
function collectStyleSources(directory: string): string[] {
    const found: string[] = [];

    for (const entry of readdirSync(directory)) {
        const full = join(directory, entry);

        if (statSync(full).isDirectory()) {
            // Bundled artwork and the suites themselves are not
            // shipped styling.
            if (entry === "assets" || entry === "test") continue;
            found.push(...collectStyleSources(full));
            continue;
        }

        if (/\.(css|tsx?)$/.test(entry)) found.push(full);
    }

    return found;
}

/**
 * A colour literal: hex, or an rgb/rgba/hsl function call.
 *
 * `rgb(var(--accent-rgb) / 0.1)` is deliberately *not* a literal — it
 * mixes an alpha into a palette variable, which is the supported way
 * to build a tint.
 */
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?)\(\s*(?!var\()[^)]*\)/g;

/**
 * Strips comments, so prose explaining a colour is not mistaken for
 * one being used.
 *
 * @param source - File contents.
 * @returns The contents with block and line comments removed.
 */
function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("theme palette", () => {
    it("defines colours only in styles.css", () => {
        const offenders: string[] = [];

        for (const file of collectStyleSources(SOURCE_ROOT)) {
            const path = relative(SOURCE_ROOT, file).replace(/\\/g, "/");
            if (path === PALETTE_FILE) continue;

            const literals = withoutComments(readFileSync(file, "utf8")).match(COLOUR_LITERAL);
            if (literals) offenders.push(`${path}: ${[...new Set(literals)].join(", ")}`);
        }

        // A literal here is not a style nit. It is a colour that cannot
        // follow the theme, which is how every interactive surface in
        // the app stayed dark-tuned in the light palette.
        expect(offenders).toEqual([]);
    });

    it("gives every theme the same set of variables", () => {
        const palette = readFileSync(join(SOURCE_ROOT, PALETTE_FILE), "utf8");

        const blockFor = (selector: string): string => {
            const start = palette.indexOf(selector);
            expect(start, `${selector} block is missing`).toBeGreaterThanOrEqual(0);
            const open = palette.indexOf("{", start);
            return palette.slice(open, palette.indexOf("}", open));
        };

        const namesIn = (block: string): Set<string> =>
            new Set(block.match(/--[\w-]+(?=\s*:)/g) ?? []);

        // Not everything in the palette block is a colour. Sizes are
        // deliberately shared by every theme — the editor's font size
        // is a user preference, not a property of the palette.
        const themeIndependent = new Set(["--editor-font-size"]);

        const base = [...namesIn(blockFor(":root {"))].filter(
            (name) => !themeIndependent.has(name),
        );

        const gaps: string[] = [];

        for (const theme of THEMES) {
            if (theme.id === DEFAULT_THEME) continue;

            const defined = namesIn(blockFor(`:root[data-theme="${theme.id}"]`));
            const missing = base.filter((name) => !defined.has(name));

            // A colour left out of a theme silently inherits the
            // default palette's value — which is how a "light" theme
            // ends up painting dark accents.
            if (missing.length) gaps.push(`${theme.id}: ${missing.join(", ")}`);
        }

        expect(gaps, "variables missing from a theme").toEqual([]);
    });

    it("has a palette block for every registered theme", () => {
        const palette = readFileSync(join(SOURCE_ROOT, PALETTE_FILE), "utf8");

        const unstyled = THEMES.filter(
            (theme) =>
                theme.id !== DEFAULT_THEME &&
                !palette.includes(`:root[data-theme="${theme.id}"]`),
        ).map((theme) => theme.id);

        // The registry drives the settings list, so a theme without a
        // palette would be offered and then do nothing.
        expect(unstyled, "registered but not styled").toEqual([]);
    });
});
