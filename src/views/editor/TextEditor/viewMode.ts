/**
 * Editor view-mode plumbing: the CodeMirror compartment that swaps the
 * live-preview configuration at runtime, and the mode → extension
 * mapping behind the Source / Live / Read-only switch.
 *
 * The compartment is a module singleton, and that is safe with any
 * number of editors on screen. A `Compartment` is only an identity
 * key: its *content* lives in each editor's state, so reconfiguring
 * one editor leaves every other alone. Verified with two editors side
 * by side before the split view was built — switching one to source
 * mode left the other rendering.
 */

import { Compartment, EditorState, Facet } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { assertNever } from "../../../shared/types";
import type { ViewMode } from "../../../shared/types";
import { frozenFacet, livePreview } from "./LivePreview";
import type { ImageSourceResolver, LinkOpener } from "./LivePreview";

/** Compartment holding whichever preview configuration is active. */
export const previewCompartment = new Compartment();

/**
 * Compartment holding whether this editor is frozen.
 *
 * Deliberately *not* folded into {@link previewCompartment}, although
 * it only affects the preview. Freezing changes every time the user
 * moves between panes, and reconfiguring the preview compartment
 * replaces the whole live-preview extension — a lot of churn for one
 * boolean. Its own compartment makes focusing a pane the cheapest
 * dispatch there is.
 */
export const frozenCompartment = new Compartment();

/**
 * The freeze extension for an editor.
 *
 * @param isFrozen - True for a pane the user is not working in.
 * @returns The extension publishing it into editor state.
 */
export function frozenExtension(isFrozen: boolean): Extension {
    return frozenFacet.of(isFrozen);
}

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

/** Everything the preview needs beyond the view mode itself. */
export interface PreviewOptions {
    /**
     * Turns `\includegraphics` paths into loadable URLs; omitted,
     * images render as placeholders.
     */
    readonly resolveImageSource?: ImageSourceResolver | undefined;
    /**
     * Opens `\url`/`\href` targets; omitted, link chips render without
     * an open affordance.
     */
    readonly openLink?: LinkOpener | undefined;
    /**
     * False for a file whose profile says it must not be rendered — a
     * `.sty` or a `.csv`. Separate from the view mode because the two
     * answer different questions: the mode is what the *user* asked
     * for and applies to the whole page, while this is what the *file*
     * can support. A `.bib` open beside a `.tex` must stay raw without
     * dragging the `.tex` out of live mode.
     */
    readonly renderPreview?: boolean | undefined;
}

/**
 * Maps a view mode to the extension the preview compartment should
 * hold.
 *
 * - `source` — no preview at all; raw LaTeX, editable.
 * - `live` — the reveal-at-cursor preview.
 * - `readonly` — preview with reveal disabled, and the editor made
 *   non-editable so the source never shows.
 *
 * Read-only survives `renderPreview: false`: the user asked for a
 * document they cannot edit, and a file that happens not to render is
 * still not theirs to type into.
 *
 * @param mode - The desired view mode.
 * @param options - Preview resolvers, and whether this file renders at
 *   all.
 * @returns The extension for that mode.
 */
export function previewExtensionForMode(
    mode: ViewMode,
    options: PreviewOptions = {},
): Extension {
    const { resolveImageSource, openLink, renderPreview = true } = options;

    switch (mode) {
        case "source":
            return [viewModeFacet.of(mode)];
        case "live":
            return renderPreview
                ? [viewModeFacet.of(mode), livePreview({ resolveImageSource, openLink })]
                : [viewModeFacet.of(mode)];
        case "readonly":
            return [
                viewModeFacet.of(mode),
                ...(renderPreview
                    ? [livePreview({ reveal: false, resolveImageSource, openLink })]
                    : []),
                EditorState.readOnly.of(true),
                EditorView.editable.of(false),
            ];
        default:
            // A fourth mode must fail loudly here rather than silently
            // returning nothing, which is what the missing-return check
            // alone would allow once someone adds a default elsewhere.
            return assertNever(mode);
    }
}
