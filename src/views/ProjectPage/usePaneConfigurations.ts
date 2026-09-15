/**
 * Turns the page's one set of editor settings into a configuration per
 * open file.
 *
 * Most of an {@link EditorConfiguration} is a preference — the theme,
 * the modal mode — and is the same everywhere. Two fields are not:
 *
 * - `profile`, which follows the file's extension, so a `.bib` beside a
 *   `.tex` is not parsed as LaTeX.
 * - `resolveImageSource`, which resolves `\includegraphics` relative to
 *   the document's own directory.
 *
 * Both were derived from the *active* document and handed to every
 * pane, which meant an unfocused pane resolved its images against
 * whichever directory the focused pane happened to be in — a bug
 * introduced the moment a second pane existed, and invisible until two
 * files in different directories were open at once.
 *
 * Identity is the subtle requirement. `TextEditor` diffs the object it
 * was handed against the one it is running under, so a fresh
 * configuration per render would reconfigure every compartment in every
 * pane on every render — rebuilding preview decorations and resetting
 * modal state. The cache lives inside the memo and is keyed by path, so
 * a pane's object is the same object until the settings themselves
 * change.
 */

import { useMemo } from "react";
import { createImageSourceResolver } from "../../shared/tauri";
import { editorProfileForPath } from "../editor/TextEditor/editorProfile";
import type { EditorConfiguration } from "../editor/TextEditor/editorConfiguration";

/** What a pane needs a configuration for. */
export interface PaneConfigurationKey {
    /** The open document's path, or null for an empty pane. */
    readonly path: string | null;
    /** True when another pane has focus, so this one's preview holds. */
    readonly isFrozen: boolean;
}

/**
 * Looks up the configuration for a pane.
 *
 * @param key - The pane's document and whether it is frozen.
 * @returns Its configuration. Calling twice with the same key returns
 *   the same object.
 */
export type PaneConfigurationLookup = (key: PaneConfigurationKey) => EditorConfiguration;

/** The settings a page supplies; the rest are filled in per pane. */
type SharedSettings = Omit<EditorConfiguration, "profile" | "resolveImageSource" | "isFrozen">;

/**
 * Derives per-pane configurations from the page's shared settings.
 *
 * @param base - The settings common to every pane. Everything except
 *   `profile`, `resolveImageSource` and `isFrozen`, which this fills
 *   in.
 * @returns A lookup from a pane's document and freeze state to its
 *   configuration.
 */
export function usePaneConfigurations(base: SharedSettings): PaneConfigurationLookup {
    return useMemo(() => {
        // Keyed by path rather than by pane, so two panes showing the
        // same file share one configuration and a pane keeps its object
        // when an unrelated pane opens something.
        //
        // Two caches rather than one keyed on a composite string:
        // freezing is the *only* thing two panes on the same file can
        // disagree about, and a pair of maps says so without having to
        // pick a separator that a path cannot contain.
        const frozen = new Map<string | null, EditorConfiguration>();
        const live = new Map<string | null, EditorConfiguration>();

        return ({ path, isFrozen }) => {
            const cache = isFrozen ? frozen : live;
            const cached = cache.get(path);
            if (cached) return cached;

            const built: EditorConfiguration = {
                ...base,
                profile: editorProfileForPath(path),
                resolveImageSource: createImageSourceResolver(path),
                isFrozen,
            };

            cache.set(path, built);
            return built;
        };
    }, [base]);
}
