/**
 * Tracks whether the modal editor is in insert mode, so line numbering
 * can follow it.
 *
 * Neither modal package puts its mode in the editor state, so it is
 * observed after each update and mirrored into a state field — which
 * is where a facet can read it from.
 */

import { StateEffect, StateField } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import type { PluginValue, ViewUpdate } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";
import type { ModalMode } from "../../../../shared/types";

/** Class Helix puts on the scroller whenever its cursor is a block. */
const HELIX_BLOCK_CURSOR_CLASS = "cm-hx-block-cursor";

/** Records a change in insert mode. */
const setInsertMode = StateEffect.define<boolean>();

/**
 * Whether the editor is currently accepting text rather than commands.
 *
 * Without modal editing every keystroke inserts text, so the field
 * starts — and stays — true.
 */
export const insertModeField = StateField.define<boolean>({
    create: () => true,
    update(value, transaction) {
        for (const effect of transaction.effects) {
            if (effect.is(setInsertMode)) return effect.value;
        }

        return value;
    },
});

/**
 * Reads the modal editor's current mode.
 *
 * Vim exposes its state through `getCM`. Helix publishes nothing, so
 * its block cursor stands in: Helix shows a block in every mode except
 * insert, which is exactly the distinction being drawn here.
 *
 * @param view - The editor to inspect.
 * @param modalMode - Which modal system is active.
 * @returns True when the editor is in insert mode.
 */
export function detectInsertMode(view: EditorView, modalMode: ModalMode): boolean {
    switch (modalMode) {
        case "none":
            return true;

        case "vim":
            return getCM(view)?.state?.vim?.insertMode === true;

        case "helix":
            return !view.scrollDOM.classList.contains(HELIX_BLOCK_CURSOR_CLASS);
    }
}

/**
 * Builds the watcher that keeps {@link insertModeField} current.
 *
 * @param modalMode - Which modal system is active.
 * @returns The field and its watcher.
 */
export function insertModeTracker(modalMode: ModalMode): Extension {
    /**
     * Brings the field in line with the editor's actual mode.
     *
     * The field is compared against rather than a remembered value, so
     * the very first sync happens too: the field starts optimistically
     * true, while a modal editor starts in normal mode.
     *
     * @param view - The editor to sync.
     */
    function sync(view: EditorView): void {
        const detected = detectInsertMode(view, modalMode);
        if (detected === view.state.field(insertModeField)) return;

        // Dispatching inside an update is not allowed, so the change
        // lands on the next tick — one frame after the mode switch,
        // which is imperceptible.
        queueMicrotask(() => {
            if (detected === view.state.field(insertModeField)) return;

            view.dispatch({ effects: setInsertMode.of(detected) });
        });
    }

    const watcher = ViewPlugin.define((view): PluginValue => {
        sync(view);

        return {
            update: (update: ViewUpdate) => sync(update.view),
        };
    });

    // Seed the field from the configuration rather than letting it
    // default: a modal editor always starts in normal mode, and every
    // compartment reconfigure re-runs `create`. Relying on the watcher
    // to correct the start value made numbering depend on whether the
    // modal package had attached itself yet.
    return [insertModeField.init(() => modalMode === "none"), watcher];
}
