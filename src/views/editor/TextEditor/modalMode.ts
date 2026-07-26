/**
 * Optional modal editing (Vim or Helix), swapped at runtime through a
 * CodeMirror compartment (mirroring `viewMode.ts`). The two are
 * mutually exclusive — both install a modal keymap — so a single
 * `ModalMode` drives one compartment.
 *
 * Vim uses `@replit/codemirror-vim`; Helix uses `codemirror-helix`
 * (experimental, selection-first). Only built-in keybindings are
 * enabled — custom mappings and persistence are out of scope.
 *
 * The compartment is a module singleton, which is safe because exactly
 * one editor exists at a time (the project page mounts a single
 * `TextEditor`, remounted per file). If Moonstone ever shows two
 * editors at once, give each its own compartment instance instead.
 */

import { Compartment, Facet } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { vim } from "@replit/codemirror-vim";
import { helix } from "codemirror-helix";
import type { ModalMode } from "../../../shared/types";

/** Compartment holding the active modal keymap (or nothing). */
export const modalCompartment = new Compartment();

/** The modal mode an editor session starts in. */
export const DEFAULT_MODAL_MODE: ModalMode = "none";

/**
 * Publishes the active modal mode into editor state, for the same
 * reason as `viewModeFacet`: the compartment holds a keymap, not a
 * record of which mode asked for it.
 */
export const modalModeFacet = Facet.define<ModalMode, ModalMode>({
    combine: (values) => values[0] ?? DEFAULT_MODAL_MODE,
});

/**
 * Maps the modal mode to the extension the compartment should hold.
 *
 * @param mode - The desired modal editing style.
 * @returns The Vim/Helix extension, or nothing for plain editing.
 */
export function modalExtensionForMode(mode: ModalMode): Extension {
    switch (mode) {
        case "none":
            return [modalModeFacet.of(mode)];
        case "vim":
            return [modalModeFacet.of(mode), vim()];
        case "helix":
            return [modalModeFacet.of(mode), helix()];
    }
}
