/**
 * Freezes what counts as "revealed" while the user is dragging out a
 * selection.
 *
 * The preview reveals source wherever the selection lands, and hiding
 * a block's `\begin`/`\end` lines is what makes it a block. So a drag
 * that grows into a block un-hides those lines *mid-drag*: the content
 * below shifts down, the pointer ends up over a different line than
 * the one it was travelling toward, and the selection collapses to
 * wherever it landed. Dragging outside a block is unaffected, because
 * revealing inline commands swaps text without changing how many lines
 * there are — which is exactly the "works outside a block, breaks
 * inside one" behaviour this fixes.
 *
 * The fix is to hold the reveal decision still for the length of the
 * gesture: the selection recorded at mouse-down is what the preview
 * reads until the button comes back up, so the layout cannot move
 * underneath the pointer.
 */

import { StateEffect, StateField } from "@codemirror/state";
import type { EditorSelection, EditorState, Extension, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";

/** Starts a gesture, carrying the selection to freeze reveal at. */
const startPointerSelection = StateEffect.define<EditorSelection>();

/** Ends the gesture, handing reveal back to the live selection. */
const endPointerSelection = StateEffect.define<null>();

/**
 * The selection reveal is pinned to while a drag is in progress, or
 * null when the live selection should be used.
 */
const pointerSelectionField = StateField.define<EditorSelection | null>({
    create: () => null,

    update(pinned, transaction) {
        for (const effect of transaction.effects) {
            if (effect.is(startPointerSelection)) return effect.value;
            if (effect.is(endPointerSelection)) return null;
        }

        return pinned;
    },
});

/**
 * The selection the preview should reveal against.
 *
 * @param state - The editor state.
 * @returns The frozen selection during a drag, otherwise the live one.
 */
export function revealSelection(state: EditorState): EditorSelection {
    return state.field(pointerSelectionField, false) ?? state.selection;
}

/**
 * Reports whether a transaction starts or ends a drag.
 *
 * The preview layers rebuild on selection changes, and the transaction
 * that ends a drag carries none — so without this the frozen reveal
 * would outlive the gesture.
 *
 * @param transaction - The transaction to inspect.
 * @returns True when the frozen selection changed.
 */
export function togglesPointerSelection(transaction: Transaction): boolean {
    return transaction.effects.some(
        (effect) => effect.is(startPointerSelection) || effect.is(endPointerSelection),
    );
}

/**
 * Reports whether an update starts or ends a drag.
 *
 * @param update - The view update to inspect.
 * @returns True when the frozen selection changed.
 */
export function updateTogglesPointerSelection(update: ViewUpdate): boolean {
    return update.transactions.some(togglesPointerSelection);
}

/**
 * Watches for drag-selection gestures.
 *
 * @returns The field and its mouse tracking.
 */
export function pointerSelectionTracker(): Extension {
    return [
        pointerSelectionField,
        EditorView.domEventHandlers({
            // `pointerdown`, not `mousedown`: it fires first, so the
            // selection captured here is the one from *before* the
            // click. Capturing after CodeMirror has moved the cursor
            // would freeze reveal at a cursor sitting inside the block,
            // which reveals it — the very thing being avoided.
            pointerdown(event, view) {
                // Only a primary-button drag selects text.
                if (!event.isPrimary || event.button !== 0) return false;

                // Released anywhere — the pointer routinely leaves the
                // editor while dragging — so the listener is on the
                // window and removes itself.
                const finish = (): void => {
                    window.removeEventListener("pointerup", finish);
                    window.removeEventListener("pointercancel", finish);
                    view.dispatch({ effects: endPointerSelection.of(null) });
                };
                window.addEventListener("pointerup", finish);
                window.addEventListener("pointercancel", finish);

                view.dispatch({ effects: startPointerSelection.of(view.state.selection) });

                // Never handled here: CodeMirror still owns the drag.
                return false;
            },
        }),
    ];
}
