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
import { previewExtensionForMode } from "../views/editor/TextEditor/viewMode";

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
 * @returns The mounted view.
 */
function mountPreview(doc: string): EditorView {
    const parent = document.createElement("div");
    document.body.appendChild(parent);

    const view = new EditorView({
        doc,
        selection: { anchor: doc.length },
        extensions: previewExtensionForMode("live"),
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

        const samples: number[] = [];
        for (let index = 0; index < KEYSTROKES; index++) {
            const anchor = Math.floor((view.state.doc.length / KEYSTROKES) * index);

            const started = performance.now();
            view.dispatch({ selection: { anchor } });
            samples.push(performance.now() - started);
        }

        expect(median(samples)).toBeLessThan(MEDIAN_CEILING_MS);
    });
});
