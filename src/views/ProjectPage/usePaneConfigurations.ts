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

/**
 * Looks up the configuration for the file a pane has open.
 *
 * @param path - The open document's path, or null for an empty pane.
 * @returns That file's configuration. Calling twice with the same path
 *   returns the same object.
 */
export type PaneConfigurationLookup = (path: string | null) => EditorConfiguration;

/**
 * Derives per-file configurations from the page's shared settings.
 *
 * @param base - The settings common to every pane. Everything except
 *   `profile` and `resolveImageSource`, which this fills in.
 * @returns A lookup from document path to configuration.
 */
export function usePaneConfigurations(
    base: Omit<EditorConfiguration, "profile" | "resolveImageSource">,
): PaneConfigurationLookup {
    return useMemo(() => {
        // Keyed by path rather than by pane, so two panes showing the
        // same file share one configuration and a pane keeps its object
        // when an unrelated pane opens something.
        const byPath = new Map<string | null, EditorConfiguration>();

        return (path) => {
            const cached = byPath.get(path);
            if (cached) return cached;

            const built: EditorConfiguration = {
                ...base,
                profile: editorProfileForPath(path),
                resolveImageSource: createImageSourceResolver(path),
            };

            byPath.set(path, built);
            return built;
        };
    }, [base]);
}
