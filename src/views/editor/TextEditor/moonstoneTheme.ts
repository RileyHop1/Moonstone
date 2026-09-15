import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { Compartment } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { isDarkTheme } from "../../../shared/themes";
import type { Theme } from "../../../shared/types";

/**
 * Moonstone gem theme for CodeMirror.
 *
 * Chrome (background, gutters, selection, cursor) is wired to the global
 * theme variables in `styles.css` so the editor stays in sync with the rest
 * of the app. Syntax colours use a restrained moonlit palette — cool
 * silver-blues with a few soft accents for differentiation.
 */

// Syntax colours route through CSS variables so the light theme
// (styles.css `[data-theme="light"]`) restyles the editor too.
const keyword = "var(--syn-keyword)";
const name = "var(--syn-name)";
const string = "var(--syn-string)";
const number = "var(--syn-number)";
const comment = "var(--syn-comment)";
const operator = "var(--syn-operator)";
const heading = "var(--syn-heading)";

const moonstoneHighlight = HighlightStyle.define([
    // Dimmed so comments visually recede from rendered content.
    { tag: t.comment, color: comment, fontStyle: "italic", opacity: "0.6" },
    { tag: [t.keyword, t.modifier, t.controlKeyword], color: keyword },
    { tag: [t.name, t.function(t.variableName), t.labelName], color: name },
    { tag: [t.variableName, t.propertyName], color: "var(--syn-variable)" },
    { tag: [t.string, t.special(t.string), t.regexp], color: string },
    { tag: [t.number, t.bool, t.null, t.atom], color: number },
    { tag: [t.operator, t.punctuation, t.bracket, t.derefOperator], color: operator },
    { tag: [t.tagName, t.angleBracket], color: name },
    { tag: [t.attributeName], color: keyword },
    { tag: [t.heading], color: heading, fontWeight: "bold" },
    { tag: [t.strong], fontWeight: "bold" },
    { tag: [t.emphasis], fontStyle: "italic" },
    { tag: [t.link, t.url], color: name, textDecoration: "underline" },
    { tag: [t.escape, t.meta], color: operator },
    { tag: t.invalid, color: "var(--syn-invalid)" },
]);

/**
 * The editor chrome, in terms of the global palette.
 *
 * Every colour is a variable, so switching `data-theme` on the root
 * restyles the editor with no work here — including the interactive
 * surfaces, which used to be hardcoded rgba literals of the *dark*
 * accent and therefore stayed wrong in the light theme.
 */
const moonstoneEditorSpec = {
    "&": {
        color: "var(--text-primary)",
        backgroundColor: "transparent",
    },
    ".cm-content": {
        caretColor: "var(--accent)",
    },
    ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--accent)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "var(--surface-selection)",
    },
    ".cm-activeLine": {
        backgroundColor: "var(--surface-active-line)",
    },
    ".cm-gutters": {
        backgroundColor: "transparent",
        color: "var(--text-secondary)",
        border: "none",
        borderRight: "1px solid var(--border-color)",
    },
    ".cm-activeLineGutter": {
        backgroundColor: "var(--surface-active-line)",
        color: "var(--text-primary)",
    },
    ".cm-foldPlaceholder": {
        backgroundColor: "var(--bg-sidebar)",
        border: "none",
        color: "var(--text-secondary)",
    },
    ".cm-selectionMatch": {
        backgroundColor: "var(--surface-selected)",
    },
    "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
        backgroundColor: "var(--surface-drop-target)",
        outline: "1px solid var(--accent)",
    },
    ".cm-tooltip": {
        backgroundColor: "var(--bg-sidebar)",
        border: "1px solid var(--border-color)",
        color: "var(--text-primary)",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
        backgroundColor: "var(--accent)",
        color: "var(--bg-titlebar)",
    },
} as const;

/** Compartment holding whichever theme variant is active. */
export const themeCompartment = new Compartment();

const moonstoneDark = EditorView.theme(moonstoneEditorSpec, { dark: true });
const moonstoneLight = EditorView.theme(moonstoneEditorSpec, { dark: false });

/**
 * Builds the editor theme for a palette.
 *
 * The CSS variables would restyle the editor on their own, but
 * CodeMirror's `dark` flag is not cosmetic: it selects which half of
 * every `&dark` / `&light` rule in the base theme and in third-party
 * extensions applies. Left permanently `true`, the light theme
 * inherited CodeMirror's dark tooltips and panel chrome — light
 * everywhere except the parts the app does not style itself.
 *
 * Only two extensions exist no matter how many themes there are: every
 * palette is CSS, and the light/dark split is the sole thing CSS
 * cannot express.
 *
 * @param theme - The active palette.
 * @returns The chrome and syntax highlighting for that palette.
 */
export function moonstoneThemeForMode(theme: Theme): Extension {
    return [
        isDarkTheme(theme) ? moonstoneDark : moonstoneLight,
        syntaxHighlighting(moonstoneHighlight),
    ];
}
