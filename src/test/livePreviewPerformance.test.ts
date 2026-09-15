/**
 * A regression ceiling for live-preview typing cost.
 *
 * `docs/live-preview.md` records 4.0ms median / 7.0ms worst per
 * keystroke on a 3,185-line document, measured by hand. Nothing in the
 * repo reproduced that, so a regression would only ever have surfaced
 * as "typing feels sluggish" months later.
 *
 * This is deliberately a **ceiling, not a benchmark**. CI machines are
 * slower and noisier than a developer's laptop, so the threshold is
 * many times the measured figure: it is here to catch an order-of-
 * magnitude regression — a scan that became quadratic, a cache that
 * stopped caching — not to police a millisecond.
 */

import { describe, expect, it, afterEach } from "vitest";
import { EditorView } from "@codemirror/view";
import { frozenExtension, previewExtensionForMode } from "../views/editor/TextEditor/viewMode";

/** Editors mounted by the current test, torn down afterwards. */
let mounted: EditorView[] = [];

afterEach(() => {
    for (const view of mounted) view.destroy();
    mounted = [];
});

/** Keystrokes timed per run. */
const KEYSTROKES = 40;

/**
 * Ceiling for the median keystroke, in milliseconds.
 *
 * ~25x the 4.0ms measured locally. A real regression in this code path
 * has historically meant rescanning or rebuilding the whole document
 * per keystroke, which is far more than 25x.
 */
const MEDIAN_CEILING_MS = 100;

/**
 * Builds a document of roughly `lines` lines with a realistic mix of
 * the constructs the preview actually scans for.
 *
 * @param lines - Approximate line count.
 * @returns The document text.
 */
function generateDocument(lines: number): string {
    const block = [
        String.raw`\section{A section heading}`,
        "",
        String.raw`Some prose with an inline $e^{i\pi} + 1 = 0$ equation and a`,
        String.raw`\textbf{bold run}, a \alpha symbol, and a \cite{knuth84}.`,
        "",
        String.raw`\begin{equation}`,
        String.raw`  \sum_{k=1}^{n} k = \frac{n(n+1)}{2}`,
        String.raw`\end{equation}`,
        "",
        "% A comment that must never be rendered: $not math$.",
        "",
    ];

    const repeats = Math.ceil(lines / block.length);

    return Array.from({ length: repeats }, () => block.join("\n")).join("\n");
}

/**
 * Mounts a preview editor over the given document.
 *
 * @param doc - The document text.
 * @param isFrozen - True to mount it the way an unfocused pane is
 *   configured: rendering held rather than rebuilt.
 * @returns The mounted view.
 */
function mountPreview(doc: string, isFrozen = false): EditorView {
    const parent = document.createElement("div");
    document.body.appendChild(parent);

    const view = new EditorView({
        doc,
        selection: { anchor: doc.length },
        extensions: [frozenExtension(isFrozen), previewExtensionForMode("live")],
        parent,
    });

    mounted.push(view);
    return view;
}

/**
 * The median of a list of numbers.
 *
 * Median rather than mean because one garbage collection pause should
 * not decide whether the suite passes.
 *
 * @param values - The samples.
 * @returns The middle value.
 */
function median(values: readonly number[]): number {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = sorted[Math.floor(sorted.length / 2)];

    if (middle === undefined) throw new Error("No samples to take a median of");

    return middle;
}

/**
 * Times a sweep of cursor moves across the whole document.
 *
 * @param view - The editor to move the cursor in.
 * @returns One sample per move, in milliseconds.
 */
function timeCursorMoves(view: EditorView): number[] {
    const samples: number[] = [];

    for (let index = 0; index < KEYSTROKES; index++) {
        const anchor = Math.floor((view.state.doc.length / KEYSTROKES) * index);

        const started = performance.now();
        view.dispatch({ selection: { anchor } });
        samples.push(performance.now() - started);
    }

    return samples;
}

describe("live preview performance", () => {
    it("keeps typing in a large document under the ceiling", () => {
        const doc = generateDocument(3000);
        const view = mountPreview(doc);

        // The cursor sits at the end, in prose, which is where a person
        // typing actually is — and where reveal is not doing extra work.
        const samples: number[] = [];

        for (let index = 0; index < KEYSTROKES; index++) {
            const at = view.state.doc.length;

            // Timed around `dispatch` alone. Measuring across an
            // animation frame would time the frame (16.7ms) instead and
            // hide everything faster than it; CodeMirror updates the
            // DOM synchronously inside dispatch.
            const started = performance.now();
            view.dispatch({ changes: { from: at, insert: "a" } });
            samples.push(performance.now() - started);
        }

        expect(median(samples)).toBeLessThan(MEDIAN_CEILING_MS);
    });

    it("keeps cursor movement in a large document under the ceiling", () => {
        // Moving the cursor rebuilds the whole-document decoration set,
        // because reveal state may have changed anywhere — so it has a
        // real cost worth bounding, separately from typing.
        //
        // This does *not* verify the scan cache: at this threshold a
        // rescan per move is far too cheap to show up (confirmed by
        // defeating the cache and watching this still pass). The cache
        // is pinned by reference equality in `livePreview.test.ts`,
        // which is the right tool for a structural guarantee.
        const view = mountPreview(generateDocument(3000));

        expect(median(timeCursorMoves(view))).toBeLessThan(MEDIAN_CEILING_MS);
    });
});

describe("a workspace of several panes", () => {
    /**
     * Types into `view` and returns one sample per keystroke.
     *
     * @param view - The editor to type into.
     * @returns The samples, in milliseconds.
     */
    function timeTyping(view: EditorView): number[] {
        const samples: number[] = [];

        for (let index = 0; index < KEYSTROKES; index++) {
            const at = view.state.doc.length;

            const started = performance.now();
            view.dispatch({ changes: { from: at, insert: "a" } });
            samples.push(performance.now() - started);
        }

        return samples;
    }

    it("costs no more with four panes open than with one", () => {
        // plan.md expected the opposite — "having multiple windows
        // scanned and rendered at once can be dangerous for
        // performance" — which is what the freezing work was for.
        //
        // It is not what happens. Each pane is an independent
        // `EditorView` over its own `EditorState`, so a keystroke in
        // one dispatches into that one alone; the other three are never
        // asked to do anything. Measured at 1.16ms solo against 1.14ms
        // with four open, which is noise.
        //
        // This test exists to keep that true. If typing ever starts
        // costing more per extra pane, something has begun broadcasting
        // transactions across panes and this is where it shows up.
        const doc = generateDocument(3000);

        const solo = mountPreview(doc);
        timeTyping(solo);
        const soloCost = median(timeTyping(solo));

        const focused = mountPreview(doc);
        for (let pane = 0; pane < 3; pane++) mountPreview(doc, true);
        timeTyping(focused);
        const workspaceCost = median(timeTyping(focused));

        expect(workspaceCost).toBeLessThan(MEDIAN_CEILING_MS);
        // Generous, because these are sub-millisecond numbers on a
        // noisy machine. It is the *shape* being asserted: flat, not
        // linear in the number of panes.
        expect(workspaceCost).toBeLessThan(soloCost * 3);
    });

    it("keeps a frozen pane's own transactions under the ceiling", () => {
        // A pane nobody is typing in still gets transactions: the
        // scroll wheel, a splitter drag, and the click that focuses it.
        // Frozen, those skip the rebuild — measured at 0.32ms against
        // 0.82ms live, a 2.6x saving on an already small number.
        //
        // The ratio is *not* asserted here. That the rebuild is skipped
        // is a structural fact, and `livePreviewFreeze.test.ts` pins it
        // by reference identity, which cannot be fooled by a fast
        // machine the way a timing threshold can.
        expect(
            median(timeCursorMoves(mountPreview(generateDocument(3000), true))),
        ).toBeLessThan(MEDIAN_CEILING_MS);
    });
});
