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
