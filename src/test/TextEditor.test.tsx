/**
 * Tests that the editor applies its own configuration.
 *
 * This is the behaviour finding A-1 was about. The project page used to
 * own seven compartment-reconfigure effects bound to a single
 * `EditorView`, so a second editor on screen would keep whatever
 * settings it mounted with and silently drift. These tests mount the
 * real component and change the prop, which is the only way to catch a
 * regression back to initial-only settings — the pure
 * `reconfigurationEffects` tests would still pass.
 */

import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { EditorView } from "@codemirror/view";
import { TextEditor } from "../views/editor/TextEditor/TextEditor";
import type { EditorConfiguration } from "../views/editor/TextEditor/editorConfiguration";

/** A plain starting configuration. */
const BASE: EditorConfiguration = {
    viewMode: "live",
    modalMode: "none",
    spellCheckEnabled: false,
    theme: "dark",
    lineNumberMode: "absolute",
    showDiagnostics: false,
    references: [],
};

/**
 * Mounts the editor and hands back its view plus a way to re-render it
 * under a different configuration.
 *
 * @param configuration - The configuration to mount under.
 * @returns The mounted view and a re-render helper.
 */
function mountEditor(configuration: EditorConfiguration) {
    // A holder rather than a plain `let`: the assignment happens inside
    // a callback, and TypeScript's flow analysis would otherwise narrow
    // the variable to `null` and call the guard below dead.
    const captured: { view: EditorView | null } = { view: null };

    const props = {
        initialDoc: "\\section{Hello}\n\nSome prose.\n",
        onDiagnosticsToggled: vi.fn(),
        onViewReady: (ready: EditorView) => {
            captured.view = ready;
        },
        onDocChanged: vi.fn(),
        onSaveRequested: vi.fn(),
    };

    const utils = render(<TextEditor {...props} configuration={configuration} />);

    const rerenderWith = (next: EditorConfiguration): void => {
        utils.rerender(<TextEditor {...props} configuration={next} />);
    };

    const view = captured.view;
    if (view === null) throw new Error("The editor did not report a view");

    return { view, rerenderWith, ...utils };
}

describe("TextEditor configuration", () => {
    it("applies the configuration it mounts with", () => {
        const { view } = mountEditor({ ...BASE, viewMode: "readonly" });

        expect(view.state.readOnly).toBe(true);
    });

    it("applies a configuration change without remounting", () => {
        const { view, rerenderWith } = mountEditor(BASE);
        expect(view.state.readOnly).toBe(false);

        rerenderWith({ ...BASE, viewMode: "readonly" });

        // Same view object: the change was reconfigured in place rather
        // than rebuilt, which is what preserves the undo history.
        expect(view.state.readOnly).toBe(true);
    });

    it("keeps the document and the view identity across a change", () => {
        const { view, rerenderWith } = mountEditor(BASE);
        const before = view.state.doc.toString();

        rerenderWith({ ...BASE, theme: "light", spellCheckEnabled: true });

        expect(view.state.doc.toString()).toBe(before);
    });

    it("ignores a re-render that changes nothing", () => {
        const { view, rerenderWith } = mountEditor(BASE);
        const before = view.state;

        // An equal-but-new object is what a parent rebuilding its memo
        // produces; it must not churn the editor's state.
        rerenderWith({ ...BASE });

        expect(view.state).toBe(before);
    });

    it("hands the view back before destroying it", () => {
        const onViewDestroyed = vi.fn();
        const captured: { view: EditorView | null } = { view: null };

        const utils = render(
            <TextEditor
                initialDoc="x"
                configuration={BASE}
                onDiagnosticsToggled={vi.fn()}
                onViewReady={(view) => {
                    captured.view = view;
                }}
                onViewDestroyed={onViewDestroyed}
                onDocChanged={vi.fn()}
                onSaveRequested={vi.fn()}
            />,
        );

        utils.unmount();

        expect(onViewDestroyed).toHaveBeenCalledTimes(1);
        expect(onViewDestroyed).toHaveBeenCalledWith(captured.view);
    });
});
