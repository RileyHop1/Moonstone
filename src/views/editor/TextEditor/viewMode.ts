/**
 * Editor view-mode plumbing: the CodeMirror compartment that swaps the
 * live-preview configuration at runtime, and the mode → extension
 * mapping behind the Source / Live / Read-only switch.
 *
 * The compartment is a module singleton, which is safe because exactly
 * one editor exists at a time (the project page mounts a single
 * `TextEditor`, remounted per file). If Moonstone ever shows two
 * editors at once, give each its own compartment instance instead.
 */

import { Compartment, EditorState, Facet } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { ViewMode } from "../../../shared/types";
import { livePreview } from "./LivePreview";
import type { ImageSourceResolver } from "./LivePreview";

/** Compartment holding whichever preview configuration is active. */
export const previewCompartment = new Compartment();

/** The mode every editor session starts in. */
export const DEFAULT_VIEW_MODE: ViewMode = "live";

/**
 * Publishes the active view mode into editor state. The compartment
 * swaps extensions, which leaves no record of *which* mode produced
 * them; this facet makes the choice readable by anything holding a
 * state (the diagnostic panel today, other consumers later).
 */
export const viewModeFacet = Facet.define<ViewMode, ViewMode>({
    combine: (values) => values[0] ?? DEFAULT_VIEW_MODE,
});

/**
 * Maps a view mode to the extension the preview compartment should
 * hold.
 *
 * - `source` — no preview at all; raw LaTeX, editable.
 * - `live` — the reveal-at-cursor preview.
 * - `readonly` — preview with reveal disabled, and the editor made
 *   non-editable so the source never shows.
 *
 * @param mode - The desired view mode.
 * @param resolveImageSource - Turns `\includegraphics` paths into
 *   loadable URLs; omitted, images render as placeholders.
 * @returns The extension for that mode.
 */
export function previewExtensionForMode(
    mode: ViewMode,
    resolveImageSource?: ImageSourceResolver,
): Extension {
    switch (mode) {
        case "source":
            return [viewModeFacet.of(mode)];
        case "live":
            return [viewModeFacet.of(mode), livePreview({ resolveImageSource })];
        case "readonly":
            return [
                viewModeFacet.of(mode),
                livePreview({ reveal: false, resolveImageSource }),
                EditorState.readOnly.of(true),
                EditorView.editable.of(false),
            ];
    }
}
