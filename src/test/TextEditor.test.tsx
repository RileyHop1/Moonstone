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
import { language } from "@codemirror/language";
import {
    DEFAULT_EDITOR_PROFILE,
    editorProfileForExtension,
} from "../views/editor/TextEditor/editorProfile";
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
    profile: DEFAULT_EDITOR_PROFILE,
};

/** The document the configuration tests use when they do not care. */
const DEFAULT_DOC = "\\section{Hello}\n\nSome prose.\n";

/**
 * Mounts the editor and hands back its view plus a way to re-render it
 * under a different configuration.
 *
 * @param configuration - The configuration to mount under.
 * @returns The mounted view and a re-render helper.
 */
function mountEditor(configuration: EditorConfiguration, initialDoc = DEFAULT_DOC) {
    // A holder rather than a plain `let`: the assignment happens inside
    // a callback, and TypeScript's flow analysis would otherwise narrow
    // the variable to `null` and call the guard below dead.
    const captured: { view: EditorView | null } = { view: null };

    const props = {
        initialDoc,
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

describe("TextEditor file-type profiles", () => {
    /**
     * A `.bib` entry whose title contains LaTeX. Every part of it was
     * being rendered: the `$…$` became maths and `\'{e}` an accented
     * character, in a file that is bibliographic data, not prose.
     */
    const BIB_ENTRY = [
        "@article{shannon48,",
        "  title = {A Mathematical Theory of $H(X)$ Communication},",
        "  author = {Shannon, Claude},",
        "}",
        "",
    ].join("\n");

    it("renders maths in a LaTeX document", () => {
        // The control. Without it, the assertion below would pass for a
        // preview that had stopped working altogether.
        const { view } = mountEditor(
            { ...BASE, profile: editorProfileForExtension("tex") },
            "Some prose $H(X)$ here.\n",
        );

        expect(view.dom.querySelector(".katex")).not.toBeNull();
    });

    it("renders no maths in a .bib file", () => {
        const { view } = mountEditor(
            { ...BASE, profile: editorProfileForExtension("bib") },
            BIB_ENTRY,
        );

        expect(view.dom.querySelector(".katex")).toBeNull();
    });

    it("leaves a .bib file's text exactly as written", () => {
        const { view } = mountEditor(
            { ...BASE, profile: editorProfileForExtension("bib") },
            BIB_ENTRY,
        );

        expect(view.state.doc.toString()).toBe(BIB_ENTRY);
        expect(view.dom.querySelector(".cm-content")?.textContent).toContain("$H(X)$");
    });

    it("does not parse a plain-text file as LaTeX", () => {
        const { view } = mountEditor(
            { ...BASE, profile: editorProfileForExtension("csv") },
            "name,formula\nalpha,$x^2$\n",
        );

        expect(view.state.facet(language)).toBeNull();
    });

    it("parses a LaTeX source file, but does not render it", () => {
        // The middle profile: a `\newcommand` body is a definition, so
        // highlighting helps and rendering misleads.
        const { view } = mountEditor(
            { ...BASE, profile: editorProfileForExtension("sty") },
            "\\newcommand{\\E}{$\\mathbb{E}$}\n",
        );

        expect(view.state.facet(language)).not.toBeNull();
        expect(view.dom.querySelector(".katex")).toBeNull();
    });

    it("switches profile in place when a pane's file type changes", () => {
        // A pane that opens a `.bib` over a `.tex` must not keep the
        // LaTeX parser, and must not remount — that would cost the undo
        // history of whatever else is open.
        const { view, rerenderWith } = mountEditor(
            { ...BASE, profile: editorProfileForExtension("tex") },
            "Prose $H(X)$ here.\n",
        );
        expect(view.state.facet(language)).not.toBeNull();

        rerenderWith({ ...BASE, profile: editorProfileForExtension("bib") });

        expect(view.state.facet(language)).toBeNull();
        expect(view.dom.querySelector(".katex")).toBeNull();
    });

    it("keeps a read-only document read-only even when it does not render", () => {
        // The view mode is the user's request and the profile is the
        // file's capability; a file that cannot render is still not
        // theirs to type into.
        const { view } = mountEditor(
            { ...BASE, viewMode: "readonly", profile: editorProfileForExtension("csv") },
            "a,b\n1,2\n",
        );

        expect(view.state.readOnly).toBe(true);
    });
});
