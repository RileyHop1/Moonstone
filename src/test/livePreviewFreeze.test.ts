/**
 * Tests for freezing an unfocused pane's rendering.
 *
 * plan.md: *"there should be a highlight window which is the one the
 * user is clicked into, this will have the normal features of
 * rerendering… For the other windows we should render once and cache
 * their look."*
 *
 * The obvious reading — swap an inactive pane for a static snapshot —
 * would cost its undo history, selection and scroll position on every
 * focus change, which is precisely what the pane work went out of its
 * way to preserve. So it is implemented as *freezing*: the pane keeps
 * its `EditorView`, but the preview stops rebuilding and holds the
 * decorations it last produced.
 *
 * Two kinds of assertion here, and the distinction matters:
 *
 * - **What the user sees** — a frozen pane never reveals source, still
 *   follows edits, and comes back to life the moment it is focused.
 * - **What it costs** — the decoration sets are the *same objects*
 *   across a cursor move. Without this, an implementation that only
 *   made `isRevealed` return false would look identical and do all the
 *   same work, which is the entire point of the feature.
 */

import { describe, expect, it, afterEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { Compartment } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import {
    blockPreviewField,
    frozenFacet,
    inlineMathPlugin,
    livePreview,
} from "../views/editor/TextEditor/LivePreview/livePreview";

/** Editors mounted by the current test, torn down afterwards. */
let mounted: EditorView[] = [];

afterEach(() => {
    for (const view of mounted) view.destroy();
    mounted = [];
});

/**
 * A document with something for each layer: inline maths for the
 * viewport-scoped plugin, display maths for the whole-document field.
 */
const DOC = [
    "Some prose with $x^2$ in it.",
    "",
    "$$",
    String.raw`\sum_{k=1}^{n} k`,
    "$$",
    "",
    "More prose.",
].join("\n");

/** Offset of the `x` inside the inline `$x^2$`. */
const INSIDE_INLINE_MATH = DOC.indexOf("$x^2$") + 1;

/** Offset inside the display-maths block. */
const INSIDE_DISPLAY_MATH = DOC.indexOf(String.raw`\sum`) + 2;

/** Somewhere in plain prose, touching nothing rendered. */
const IN_PROSE = DOC.indexOf("More prose.") + 4;

/** Everything one mounted editor lets a test do. */
interface Harness {
    readonly view: EditorView;
    /** Freezes or unfreezes, the way focusing a pane does. */
    readonly setFrozen: (isFrozen: boolean) => void;
    /** The inline layer's current decoration set. */
    readonly inlineDecorations: () => unknown;
    /** The block layer's current decoration sets. */
    readonly blockDecorations: () => unknown;
}

/**
 * Mounts a preview editor whose freeze state can be changed the way
 * the app changes it — by reconfiguring a compartment, not by
 * rebuilding the view.
 *
 * @param options - Whether to start frozen, and where the cursor sits.
 * @returns The harness.
 */
function mountPreview(options: { frozen: boolean; anchor: number }): Harness {
    const parent = document.createElement("div");
    document.body.appendChild(parent);

    const frozen = new Compartment();
    const freezeExtension = (isFrozen: boolean): Extension => frozenFacet.of(isFrozen);

    const view = new EditorView({
        doc: DOC,
        selection: { anchor: options.anchor },
        extensions: [frozen.of(freezeExtension(options.frozen)), livePreview()],
        parent,
    });

    mounted.push(view);

    return {
        view,
        setFrozen: (isFrozen) => {
            view.dispatch({ effects: frozen.reconfigure(freezeExtension(isFrozen)) });
        },
        inlineDecorations: () => view.plugin(inlineMathPlugin)?.decorations,
        blockDecorations: () => view.state.field(blockPreviewField),
    };
}

/**
 * Whether the editor is showing raw source rather than a rendered
 * widget.
 *
 * KaTeX embeds the original TeX in a MathML `<annotation>`, so the
 * naive reading of `textContent` finds the "source" in perfectly
 * rendered maths. Stripping `.katex-mathml` first is what the rest of
 * the preview suite does, for the same reason.
 *
 * @param view - The editor.
 * @param source - The source text that reveal would expose.
 * @returns True when the raw source is on screen.
 */
function showsSource(view: EditorView, source: string): boolean {
    const content = view.dom.querySelector(".cm-content");
    if (!content) return false;

    const visible = content.cloneNode(true) as HTMLElement;
    for (const mathml of visible.querySelectorAll(".katex-mathml")) mathml.remove();

    return visible.textContent?.includes(source) ?? false;
}

describe("a frozen editor holds its look", () => {
    it("renders inline maths the cursor is sitting in", () => {
        // Live, this is the one thing that would show as source. That
        // is right for the pane being typed in and wrong for one the
        // user is only looking at.
        const { view } = mountPreview({ frozen: true, anchor: INSIDE_INLINE_MATH });

        expect(view.dom.querySelector(".katex")).not.toBeNull();
        expect(showsSource(view, "$x^2$")).toBe(false);
    });

    it("renders display maths the cursor is sitting in", () => {
        const { view } = mountPreview({ frozen: true, anchor: INSIDE_DISPLAY_MATH });

        expect(showsSource(view, String.raw`\sum_{k=1}^{n} k`)).toBe(false);
    });

    it("reveals the same maths once the pane is focused", () => {
        // The control for both tests above: if reveal had simply
        // stopped working, they would pass and this would fail.
        const { view, setFrozen } = mountPreview({
            frozen: true,
            anchor: INSIDE_INLINE_MATH,
        });

        setFrozen(false);

        expect(showsSource(view, "$x^2$")).toBe(true);
    });
});

describe("a frozen editor does not rebuild on a cursor move", () => {
    it("hands back the very same inline decorations", () => {
        const harness = mountPreview({ frozen: true, anchor: IN_PROSE });
        const before = harness.inlineDecorations();

        harness.view.dispatch({ selection: { anchor: INSIDE_INLINE_MATH } });

        expect(harness.inlineDecorations()).toBe(before);
    });

    it("hands back the very same block decorations", () => {
        const harness = mountPreview({ frozen: true, anchor: IN_PROSE });
        const before = harness.blockDecorations();

        harness.view.dispatch({ selection: { anchor: INSIDE_DISPLAY_MATH } });

        expect(harness.blockDecorations()).toBe(before);
    });

    it("still rebuilds when not frozen", () => {
        // The control. Without it, a preview that had stopped rebuilding
        // altogether would pass the two tests above.
        const harness = mountPreview({ frozen: false, anchor: IN_PROSE });
        const inlineBefore = harness.inlineDecorations();
        const blockBefore = harness.blockDecorations();

        harness.view.dispatch({ selection: { anchor: INSIDE_DISPLAY_MATH } });

        expect(harness.inlineDecorations()).not.toBe(inlineBefore);
        expect(harness.blockDecorations()).not.toBe(blockBefore);
    });
});

describe("a frozen editor still follows the document", () => {
    it("rebuilds the inline layer on an edit", () => {
        // Decorations sit at document positions. Holding stale ones over
        // changed text would render the wrong characters — and a rename
        // repoints a file under a pane nobody is watching, which is
        // exactly where that would go unnoticed.
        const harness = mountPreview({ frozen: true, anchor: IN_PROSE });
        const before = harness.inlineDecorations();

        harness.view.dispatch({ changes: { from: 0, insert: "New. " } });

        expect(harness.inlineDecorations()).not.toBe(before);
    });

    it("rebuilds the block layer on an edit", () => {
        const harness = mountPreview({ frozen: true, anchor: IN_PROSE });
        const before = harness.blockDecorations();

        harness.view.dispatch({ changes: { from: 0, insert: "New. " } });

        expect(harness.blockDecorations()).not.toBe(before);
    });

    it("renders maths typed into a frozen pane", () => {
        const { view } = mountPreview({ frozen: true, anchor: IN_PROSE });
        const end = view.state.doc.length;

        view.dispatch({ changes: { from: end, insert: " and $y^3$ too." } });

        expect(showsSource(view, "$y^3$")).toBe(false);
        expect(view.dom.querySelectorAll(".katex").length).toBeGreaterThan(1);
    });
});

describe("focusing a pane brings it back immediately", () => {
    it("rebuilds both layers on unfreeze, with no further transaction", () => {
        // The reconfiguring transaction carries no document change and
        // no selection, so it slips past every other rebuild guard. The
        // user is about to type; the reveal has to be back before they
        // do, not on their first keystroke.
        const harness = mountPreview({ frozen: true, anchor: INSIDE_INLINE_MATH });
        const inlineBefore = harness.inlineDecorations();
        const blockBefore = harness.blockDecorations();

        harness.setFrozen(false);

        expect(harness.inlineDecorations()).not.toBe(inlineBefore);
        expect(harness.blockDecorations()).not.toBe(blockBefore);
    });

    it("rebuilds both layers on freeze too", () => {
        // The other direction, which is what hides the source in the
        // pane the user just left.
        const harness = mountPreview({ frozen: false, anchor: INSIDE_INLINE_MATH });
        expect(showsSource(harness.view, "$x^2$")).toBe(true);

        harness.setFrozen(true);

        expect(showsSource(harness.view, "$x^2$")).toBe(false);
    });

    it("survives the round trip without touching the document", () => {
        const harness = mountPreview({ frozen: false, anchor: INSIDE_INLINE_MATH });
        const doc = harness.view.state.doc.toString();

        harness.setFrozen(true);
        harness.setFrozen(false);

        expect(harness.view.state.doc.toString()).toBe(doc);
        expect(harness.view.state.selection.main.anchor).toBe(INSIDE_INLINE_MATH);
    });
});
