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
import { ViewPlugin } from "@codemirror/view";
import type { EditorView, PluginValue, ViewUpdate } from "@codemirror/view";

/** Starts a gesture, carrying the selection to freeze reveal at. */
const startPointerSelection = StateEffect.define<EditorSelection>();

/** Ends the gesture, handing reveal back to the live selection. */
const endPointerSelection = StateEffect.define();

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
    return [pointerSelectionField, ViewPlugin.fromClass(PointerSelectionGestures)];
}

/**
 * Registers the drag-selection listeners and, crucially, takes them
 * away again when the editor goes.
 *
 * A `ViewPlugin` rather than plain `domEventHandlers` because the
 * gesture's `pointerup`/`pointercancel` listeners live on the
 * **window** — the pointer routinely leaves the editor mid-drag — and
 * nothing else in an extension gets told when the view is destroyed. An
 * editor unmounted mid-drag (a pane closed, the file deleted, the view
 * mode switched) would otherwise leave those listeners attached until
 * the next click anywhere in the app, whereupon they dispatch into a
 * destroyed view. CodeMirror ignores that dispatch, so the leak is
 * completely silent.
 *
 * One `AbortController` covers every listener, so `destroy` cannot
 * forget one.
 */
class PointerSelectionGestures implements PluginValue {
    /** Aborted on destroy, removing every listener at once. */
    private readonly gestures = new AbortController();

    /** Aborted when the current drag ends; null when none is running. */
    private active: AbortController | null = null;

    /**
     * @param view - The editor this plugin belongs to.
     */
    constructor(private readonly view: EditorView) {
        view.dom.addEventListener("pointerdown", this.handlePointerDown, {
            signal: this.gestures.signal,
        });
    }

    /**
     * Starts tracking a drag-selection gesture.
     *
     * `pointerdown`, not `mousedown`: it fires first, so the selection
     * captured here is the one from *before* the click. Capturing after
     * CodeMirror has moved the cursor would freeze reveal at a cursor
     * sitting inside the block, which reveals it — the very thing being
     * avoided.
     */
    private readonly handlePointerDown = (event: PointerEvent): void => {
        // Only a primary-button drag selects text.
        if (!event.isPrimary || event.button !== 0) return;

        this.active?.abort();
        const gesture = new AbortController();
        this.active = gesture;

        const finish = (): void => {
            gesture.abort();
            this.active = null;
            this.view.dispatch({ effects: endPointerSelection.of(null) });
        };

        // Released anywhere, so these go on the window rather than the
        // editor. Both the gesture's own controller and the plugin's
        // can cancel them.
        for (const type of ["pointerup", "pointercancel"]) {
            window.addEventListener(type, finish, {
                signal: AbortSignal.any([gesture.signal, this.gestures.signal]),
            });
        }

        this.view.dispatch({
            effects: startPointerSelection.of(this.view.state.selection),
        });
    };

    /** Removes every listener this plugin registered. */
    destroy(): void {
        this.gestures.abort();
        this.active = null;
    }
}
