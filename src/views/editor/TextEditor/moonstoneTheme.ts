import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

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
    { tag: t.comment, color: comment, fontStyle: "italic" },
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

const moonstoneEditor = EditorView.theme(
    {
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
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
            {
                backgroundColor: "rgba(169, 198, 255, 0.18)",
            },
        ".cm-activeLine": {
            backgroundColor: "rgba(169, 198, 255, 0.05)",
        },
        ".cm-gutters": {
            backgroundColor: "transparent",
            color: "var(--text-secondary)",
            border: "none",
            borderRight: "1px solid var(--border-color)",
        },
        ".cm-activeLineGutter": {
            backgroundColor: "rgba(169, 198, 255, 0.05)",
            color: "var(--text-primary)",
        },
        ".cm-foldPlaceholder": {
            backgroundColor: "var(--bg-sidebar)",
            border: "none",
            color: "var(--text-secondary)",
        },
        ".cm-selectionMatch": {
            backgroundColor: "rgba(169, 198, 255, 0.12)",
        },
        "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
            backgroundColor: "rgba(169, 198, 255, 0.2)",
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
    },
    { dark: true },
);

/** Combined Moonstone gem theme: chrome + syntax highlighting. */
export const moonstone: Extension = [
    moonstoneEditor,
    syntaxHighlighting(moonstoneHighlight),
];
