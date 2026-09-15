/**
 * Test suite for inline reference search: where completion offers
 * itself, how results are ranked, and what the editor actually returns
 * for a real document.
 */

import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView, basicSetup } from "codemirror";
import {
    CompletionContext,
    completionStatus,
    currentCompletions,
    startCompletion,
} from "@codemirror/autocomplete";
import type { CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import {
    describeAuthors,
    describeReference,
    findCitationContext,
    matchReferences,
    referencesExtension,
} from "../views/editor/TextEditor/References";
import type { Reference } from "../shared/types";

/**
 * Builds a reference fixture.
 *
 * @param overrides - Fields to override on the default entry.
 * @returns The reference.
 */
function makeReference(overrides: Partial<Reference> = {}): Reference {
    return {
        key: "knuth1984",
        entryType: "book",
        title: "The TeXbook",
        authors: ["Knuth, Donald E."],
        year: "1984",
        sourcePath: "C:/root/demo/refs.bib",
        sourceName: "refs.bib",
        ...overrides,
    };
}

/** A small bibliography spanning two source files. */
const REFERENCES: readonly Reference[] = [
    makeReference(),
    makeReference({
        key: "lamport1994",
        title: "LaTeX: A Document Preparation System",
        authors: ["Lamport, Leslie"],
        year: "1994",
    }),
    makeReference({
        key: "goossens1993",
        title: "The LaTeX Companion",
        authors: ["Goossens, Michel", "Mittelbach, Frank", "Samarin, Alexander"],
        year: "1993",
        sourcePath: "C:/root/demo/chapters/more.bib",
        sourceName: "more.bib",
    }),
];

describe("findCitationContext", () => {
    it("offers completion inside a cite argument", () => {
        const text = "See \\cite{knu";

        expect(findCitationContext(text, text.length)).toEqual({
            from: text.indexOf("knu"),
            query: "knu",
        });
    });

    it("offers completion with nothing typed yet", () => {
        const text = "See \\cite{";

        expect(findCitationContext(text, text.length)).toEqual({
            from: text.length,
            query: "",
        });
    });

    it("recognises the whole cite family", () => {
        for (const command of [
            "cite",
            "citep",
            "citet",
            "nocite",
            "textcite",
            "autocite",
            "parencite",
            "citeauthor",
        ]) {
            const text = `\\${command}{ab`;

            expect(findCitationContext(text, text.length), command).not.toBeNull();
        }
    });

    it("completes the key after the last comma in a multi-key citation", () => {
        const text = "\\cite{first,second,thi";

        expect(findCitationContext(text, text.length)).toEqual({
            from: text.indexOf("thi"),
            query: "thi",
        });
    });

    it("skips whitespace after a comma", () => {
        const text = "\\cite{first, sec";

        expect(findCitationContext(text, text.length)).toEqual({
            from: text.indexOf("sec"),
            query: "sec",
        });
    });

    it("looks past optional arguments", () => {
        const text = "\\citep[see][p.~3]{knu";

        expect(findCitationContext(text, text.length)?.query).toBe("knu");
    });

    it("does not offer completion outside a citation", () => {
        for (const text of [
            "plain prose",
            "\\section{Introduction",
            "\\ref{fig:one",
            "\\textbf{bold",
        ]) {
            expect(findCitationContext(text, text.length), text).toBeNull();
        }
    });

    it("does not offer completion once the argument is closed", () => {
        const text = "\\cite{knuth1984} and more prose";

        expect(findCitationContext(text, text.length)).toBeNull();
    });

    it("does not offer completion inside a comment", () => {
        const text = "% \\cite{knu";

        expect(findCitationContext(text, text.length)).toBeNull();
    });

    it("still offers completion after an escaped percent sign", () => {
        const text = "100\\% of \\cite{knu";

        expect(findCitationContext(text, text.length)?.query).toBe("knu");
    });

    it("stops offering once the text stops looking like a key", () => {
        // A citation key cannot contain a space.
        const text = "\\cite{knuth 1984";

        expect(findCitationContext(text, text.length)).toBeNull();
    });
});

describe("matchReferences", () => {
    it("offers everything when nothing is typed", () => {
        expect(matchReferences(REFERENCES, "", 50)).toHaveLength(3);
    });

    it("matches on the citation key", () => {
        const matches = matchReferences(REFERENCES, "lam", 50);

        expect(matches.map((reference) => reference.key)).toEqual(["lamport1994"]);
    });

    it("matches on the title", () => {
        // The point of the feature: the author remembers the paper, not
        // the key someone typed a year ago.
        const matches = matchReferences(REFERENCES, "companion", 50);

        expect(matches.map((reference) => reference.key)).toEqual(["goossens1993"]);
    });

    it("matches on an author", () => {
        const matches = matchReferences(REFERENCES, "mittelbach", 50);

        expect(matches.map((reference) => reference.key)).toEqual(["goossens1993"]);
    });

    it("matches on the year", () => {
        const matches = matchReferences(REFERENCES, "1984", 50);

        expect(matches.map((reference) => reference.key)).toEqual(["knuth1984"]);
    });

    it("is case-insensitive", () => {
        expect(matchReferences(REFERENCES, "TEXBOOK", 50)).toHaveLength(1);
    });

    it("ranks key matches above title matches", () => {
        const references = [
            makeReference({ key: "smith2020", title: "A paper about latex" }),
            makeReference({ key: "latex1994", title: "Something else" }),
        ];

        const matches = matchReferences(references, "latex", 50);

        expect(matches.map((reference) => reference.key)).toEqual(["latex1994", "smith2020"]);
    });

    it("returns nothing when no reference matches", () => {
        expect(matchReferences(REFERENCES, "quantum", 50)).toHaveLength(0);
    });

    it("respects the result limit", () => {
        expect(matchReferences(REFERENCES, "", 2)).toHaveLength(2);
    });
});

describe("describeAuthors", () => {
    it("uses the family name of a single author", () => {
        expect(describeAuthors(["Knuth, Donald E."])).toBe("Knuth");
    });

    it("abbreviates multiple authors", () => {
        expect(describeAuthors(["Goossens, Michel", "Mittelbach, Frank"])).toBe(
            "Goossens et al.",
        );
    });

    it("is empty when there are no authors", () => {
        expect(describeAuthors([])).toBe("");
    });

    it("omits a missing year from the summary", () => {
        expect(describeReference(makeReference({ year: "" }))).toBe("Knuth");
    });
});

describe("reference completion in the editor", () => {
    /**
     * Runs the reference completion source against a document.
     *
     * @param doc - Document contents; the cursor goes at the end.
     * @param references - Bibliography to offer.
     * @param explicit - Whether completion was explicitly requested.
     * @returns The completion result, or null.
     */
    function complete(
        doc: string,
        references: readonly Reference[] = REFERENCES,
        explicit = false,
    ): CompletionResult | null {
        const state = EditorState.create({
            doc,
            selection: { anchor: doc.length },
            extensions: [referencesExtension(references)],
        });

        const [source] = state.languageDataAt<CompletionSource>("autocomplete", doc.length);
        expect(source).toBeTypeOf("function");

        const result = source!(new CompletionContext(state, doc.length, explicit));
        // The source is synchronous: it searches an in-memory list, so
        // there is nothing to await.
        expect(result).not.toBeInstanceOf(Promise);

        return result as CompletionResult | null;
    }

    it("offers matching references inside a citation", () => {
        const result = complete("See \\cite{lam");

        expect(result).not.toBeNull();
        expect(result?.options.map((option) => option.label)).toEqual(["lamport1994"]);
    });

    it("replaces only the partially typed key", () => {
        const doc = "See \\cite{first,lam";
        const result = complete(doc);

        expect(result?.from).toBe(doc.indexOf("lam"));
    });

    it("shows the author and year as the completion detail", () => {
        const result = complete("\\cite{knu");

        expect(result?.options[0]?.detail).toBe("Knuth, 1984");
        expect(result?.options[0]?.info).toBe("The TeXbook");
    });

    it("keeps its own ranking rather than refiltering by label", () => {
        // Without this, a title-only match would be dropped because the
        // key does not contain the query.
        const result = complete("\\cite{companion");

        expect(result?.filter).toBe(false);
        expect(result?.options.map((option) => option.label)).toEqual(["goossens1993"]);
    });

    it("offers nothing outside a citation", () => {
        expect(complete("just prose")).toBeNull();
    });

    it("stays quiet on an empty key unless asked explicitly", () => {
        expect(complete("\\cite{")).toBeNull();
        expect(complete("\\cite{", REFERENCES, true)?.options).toHaveLength(3);
    });

    it("offers nothing when the project has no bibliography", () => {
        expect(complete("\\cite{lam", [])).toBeNull();
    });
});

describe("completion sessions in a live editor", () => {
    /**
     * Types a citation into a real editor and waits for the completion
     * session to settle.
     *
     * Calling the source directly is not enough: CodeMirror tracks a
     * running query by the identity of the source that started it, so a
     * source rebuilt on every `languageData` lookup leaves the session
     * pending forever and no popup ever opens — the source returns
     * perfectly good results the whole time. Only driving a real view
     * catches that.
     *
     * @param typed - Text to type at the end of the document.
     * @returns The labels currently offered.
     */
    async function typeAndCollect(typed: string): Promise<readonly string[]> {
        const parent = document.createElement("div");
        document.body.appendChild(parent);

        const view = new EditorView({
            doc: "Prose. ",
            parent,
            extensions: [basicSetup, referencesExtension(REFERENCES)],
        });

        try {
            view.dispatch({
                changes: { from: view.state.doc.length, insert: typed },
                selection: { anchor: view.state.doc.length + typed.length },
                userEvent: "input.type",
            });
            startCompletion(view);

            for (let attempt = 0; attempt < 40; attempt++) {
                await new Promise((resolve) => setTimeout(resolve, 25));
                if (completionStatus(view.state) === "active") break;
            }

            return currentCompletions(view.state).map((completion) => completion.label);
        } finally {
            view.destroy();
            parent.remove();
        }
    }

    it("opens a session and offers the matching reference", async () => {
        expect(await typeAndCollect("\\cite{lam")).toEqual(["lamport1994"]);
    });

    it("opens a session for a title match", async () => {
        expect(await typeAndCollect("\\cite{companion")).toEqual(["goossens1993"]);
    });
});
