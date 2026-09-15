/**
 * A working `DataTransfer` stand-in for tests.
 *
 * jsdom does not implement `DataTransfer`, and `fireEvent.drop` will
 * happily accept any object in its place — which is a trap. A stub whose
 * `setData` records without storing, and which has no `types`, lets a
 * test pass while the code under test cannot actually read back what the
 * drag source wrote. This one stores what it is given and reports its
 * formats, so drag code behaves the way it will in a browser.
 */

import { act } from "@testing-library/react";

/**
 * Builds a `DataTransfer` stand-in that actually stores data.
 *
 * @param initial - Formats the drag starts out carrying.
 * @returns The stub, typed as a `DataTransfer` for use in fireEvent.
 */
export function makeDataTransfer(initial: Readonly<Record<string, string>> = {}): DataTransfer {
    const store = new Map<string, string>(Object.entries(initial));

    const stub = {
        effectAllowed: "uninitialized" as DataTransfer["effectAllowed"],
        dropEffect: "none" as DataTransfer["dropEffect"],

        get types(): readonly string[] {
            return Array.from(store.keys());
        },

        setData(format: string, data: string): void {
            store.set(format, data);
        },

        getData(format: string): string {
            return store.get(format) ?? "";
        },

        clearData(format?: string): void {
            if (format === undefined) store.clear();
            else store.delete(format);
        },
    };

    // Only the parts drag code touches are implemented; the rest of the
    // interface (files, items, setDragImage) is never reached in jsdom.
    return stub as unknown as DataTransfer;
}

/** A drag event's payload and where the pointer is. */
export interface DragEventInit {
    readonly dataTransfer: DataTransfer;
    readonly clientX?: number;
    readonly clientY?: number;
}

/**
 * Fires a drag event carrying real pointer coordinates.
 *
 * **`fireEvent.dragOver(element, {clientX})` does not work.** jsdom
 * implements no `DragEvent`, so Testing Library falls back to
 * constructing a plain `Event` — which has no `clientX` at all, and
 * silently ignores the one in the init. Handlers then read `undefined`,
 * every coordinate becomes `NaN`, and a test that looks like it is
 * dropping on an edge is really dropping nowhere in particular.
 *
 * A `MouseEvent` carries the coordinates properly and bubbles the same
 * way, so React's synthetic handlers see what they would in a browser.
 *
 * @param element - The element to dispatch on.
 * @param type - The drag event type, e.g. `"dragover"`.
 * @param init - The drag's payload and pointer position.
 */
export function fireDragEvent(element: Element, type: string, init: DragEventInit): void {
    const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: init.clientX ?? 0,
        clientY: init.clientY ?? 0,
    });

    // `dataTransfer` is not part of MouseEvent, and is read-only on the
    // events that do have it.
    Object.defineProperty(event, "dataTransfer", { value: init.dataTransfer });

    // Wrapped in `act` because this dispatches natively rather than
    // through `fireEvent`: without it React has not flushed the state
    // the handler set by the time the next assertion runs.
    act(() => {
        element.dispatchEvent(event);
    });
}
