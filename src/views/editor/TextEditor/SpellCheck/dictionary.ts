/**
 * Lazy access to the spelling dictionary.
 *
 * The Hunspell data is around half a megabyte, so it is behind a
 * dynamic import: a user who never opens a document, or who turns
 * spell checking off, never pays for it. The load happens once and is
 * shared by every editor.
 */

import type NSpell from "nspell";

/** Checks and suggests corrections for single words. */
export interface Dictionary {
    /**
     * Reports whether a word is spelled correctly.
     *
     * @param word - The word to check.
     * @returns True when the word is known.
     */
    readonly isCorrect: (word: string) => boolean;
    /**
     * Suggests corrections for a misspelled word.
     *
     * @param word - The misspelled word.
     * @returns Candidate corrections, best first.
     */
    readonly suggest: (word: string) => readonly string[];
}

/** In-flight or completed load, so the data is fetched once. */
let loading: Promise<Dictionary | null> | null = null;

/**
 * Loads the dictionary, reusing the load already in progress.
 *
 * @returns The dictionary, or null when it could not be loaded.
 */
export function loadDictionary(): Promise<Dictionary | null> {
    loading ??= buildDictionary();
    return loading;
}

/**
 * Fetches the Hunspell data and wraps it.
 *
 * A failure here must not break editing, so it resolves to null and
 * the checker simply reports nothing.
 *
 * @returns The dictionary, or null on failure.
 */
async function buildDictionary(): Promise<Dictionary | null> {
    try {
        const [{ default: nspell }, aff, dic] = await Promise.all([
            import("nspell"),
            // Aliased in vite.config.ts — see the note there.
            import("dictionary-en/aff?raw"),
            import("dictionary-en/dic?raw"),
        ]);

        const speller: NSpell = nspell(aff.default, dic.default);

        return {
            isCorrect: (word) => speller.correct(word),
            suggest: (word) => speller.suggest(word).slice(0, MAX_SUGGESTIONS),
        };
    } catch (error) {
        console.error("Could not load the spelling dictionary", error);
        return null;
    }
}

/** Suggestions offered per misspelling; more is noise in a menu. */
const MAX_SUGGESTIONS = 5;
