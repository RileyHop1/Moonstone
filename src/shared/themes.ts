/**
 * The application's themes, in one place.
 *
 * A theme is a palette in `styles.css` selected by `data-theme` on the
 * document element. Almost everything follows from the CSS variables
 * alone — this registry exists for the two things CSS cannot answer:
 * what to show in the settings list, and whether CodeMirror should
 * treat the editor as dark (a boolean baked into its theme extension,
 * see `moonstoneTheme.ts`).
 *
 * Adding a theme means adding an entry here and a palette block in
 * `styles.css`. `src/test/themePalette.test.ts` checks the two stay in
 * step, and the browser contrast audit runs over every entry.
 */

/** One selectable theme. */
export interface ThemeDefinition {
    /** Stored in settings and written to `data-theme`. */
    readonly id: string;
    /** Shown in the settings list. */
    readonly label: string;
    /**
     * Whether the palette is dark. Drives CodeMirror's `dark` flag,
     * which selects which half of every `&dark`/`&light` rule applies
     * — including in extensions the app does not style.
     */
    readonly isDark: boolean;
    /**
     * Contrast ratio the palette's text must clear, when it promises
     * more than the WCAG AA default of 4.5:1.
     *
     * A theme that calls itself high contrast is making a claim, and
     * the browser audit holds it to this number instead — otherwise
     * "high contrast" means whatever the palette happened to land on.
     */
    readonly minContrast?: number;
}

/**
 * Every theme, in display order.
 *
 * `dark` and `light` keep their plain ids because they are already
 * persisted in users' settings files; renaming them would silently
 * reset everyone to the default.
 */
export const THEMES = [
    { id: "dark", label: "Dark", isDark: true },
    { id: "light", label: "Light", isDark: false },
    { id: "bloodmoon", label: "Blood Moon", isDark: true },
    { id: "bluemoon", label: "Blue Moon", isDark: true },
    { id: "harvestmoon", label: "Harvest Moon", isDark: true },
    { id: "newmoon", label: "New Moon", isDark: true },
    // WCAG AAA, not AA: the whole point of the theme.
    { id: "eclipse", label: "Eclipse", isDark: true, minContrast: 7 },
] as const satisfies readonly ThemeDefinition[];

/** Colour theme of the application. */
export type Theme = (typeof THEMES)[number]["id"];

/**
 * The same list, widened to the interface.
 *
 * `THEMES` is `as const` so `Theme` can be derived from its ids — which
 * also narrows every entry to exactly the keys it declares, making an
 * optional field like `minContrast` unreadable off the union. This view
 * restores the declared shape for callers that iterate the list.
 */
export const THEME_LIST: readonly ThemeDefinition[] = THEMES;

/** The theme a fresh install starts with. */
export const DEFAULT_THEME: Theme = "dark";

/**
 * Reports whether a theme's palette is dark.
 *
 * @param theme - The theme to look up.
 * @returns True when the palette is dark.
 */
export function isDarkTheme(theme: Theme): boolean {
    return THEMES.find((candidate) => candidate.id === theme)?.isDark ?? true;
}

/**
 * Coerces a stored value to a known theme.
 *
 * Anything unrecognised — a hand-edited settings file, or a theme from
 * a newer build — falls back to the default rather than leaving the
 * app with a `data-theme` no stylesheet answers to.
 *
 * @param value - The value read from storage.
 * @returns A theme that definitely exists.
 */
export function normalizeTheme(value: unknown): Theme {
    return THEMES.find((candidate) => candidate.id === value)?.id ?? DEFAULT_THEME;
}
