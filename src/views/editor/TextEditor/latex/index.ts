/**
 * LaTeX lexing: where the constructs are in a document's text.
 *
 * Pure string scanning, with no idea that anything is rendered. Three
 * features depend on it — the live preview, the spell checker and the
 * diagnostics overlay — and it used to live inside the preview, so the
 * other two reached "where are the comments and verbatim blocks" by
 * importing from a *rendering* module. That is a layering accident: the
 * question is about LaTeX, not about drawing.
 *
 * Everything here takes text and returns ranges. Nothing here knows
 * about CodeMirror.
 */

export type { Interval } from "./interval";

export {
    findCommentRanges,
    findInertRegions,
    findLiteralRanges,
    maskChunk,
    maskInertRegions,
} from "./inertRegions";
export type { InertRegions } from "./inertRegions";

export { findMathRanges } from "./findMath";
export type { MathRange } from "./findMath";
export { findEnvironments } from "./findEnvironments";
export type { EnvRange } from "./findEnvironments";
export { findSections } from "./findSections";
export type { SectionRange } from "./findSections";
export { enumerateLabel, findListItems } from "./findListItems";
export type { ListItem } from "./findListItems";
export { findMacros } from "./findMacros";
export type { MacroTable } from "./findMacros";
export { findFormatRanges } from "./findFormatting";
export type { FormatRange, FormatStyle } from "./findFormatting";
export { findGraphicsRanges } from "./findGraphics";
export type { GraphicsRange } from "./findGraphics";
export { findRefRanges } from "./findRefs";
export type { RefKind, RefRange } from "./findRefs";
export { applyTextReplacements, findTextReplacements } from "./findTextReplacements";
export type { TextReplacement } from "./findTextReplacements";
export { findSymbolRanges, SYMBOLS } from "./symbols";
export type { SymbolRange } from "./symbols";
export { parseTabular } from "./parseTabular";
export type { TabularCell, TabularRows } from "./parseTabular";
export { findGroupEnd } from "./braces";
