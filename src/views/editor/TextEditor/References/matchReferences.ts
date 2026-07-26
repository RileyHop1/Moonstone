/**
 * Ranking for reference search.
 *
 * The point of searching by more than the citation key is that authors
 * remember papers by title and author, not by whatever key they typed
 * a year ago. So a query is matched against the key, title, authors
 * and year alike, and the results come back in one list — which is
 * also why the backend merges every `.bib` file in the project before
 * this ever runs.
 */

import type { Reference } from "../../../../shared/types";

/**
 * Scores, in descending order of usefulness. A key match is the
 * strongest signal available: the author typed part of the thing they
 * are literally inserting.
 */
const SCORE = {
    keyPrefix: 100,
    keyContains: 80,
    titlePrefix: 60,
    titleContains: 40,
    authorContains: 30,
    yearExact: 20,
} as const;

/** A reference and how well it matched, kept together for sorting. */
interface ScoredReference {
    readonly reference: Reference;
    readonly score: number;
}

/**
 * Scores one reference against a lowercased query.
 *
 * @param reference - The reference to score.
 * @param query - Lowercased search text; never empty.
 * @returns The score, or null when the reference does not match.
 */
function scoreReference(reference: Reference, query: string): number | null {
    const key = reference.key.toLowerCase();

    if (key.startsWith(query)) return SCORE.keyPrefix;
    if (key.includes(query)) return SCORE.keyContains;

    const title = reference.title.toLowerCase();

    if (title.startsWith(query)) return SCORE.titlePrefix;
    if (title.includes(query)) return SCORE.titleContains;

    const matchesAuthor = reference.authors.some((author) =>
        author.toLowerCase().includes(query),
    );
    if (matchesAuthor) return SCORE.authorContains;

    if (reference.year === query) return SCORE.yearExact;

    return null;
}

/**
 * Filters and ranks references for a query.
 *
 * @param references - Every reference in the project.
 * @param query - What the author has typed; empty offers everything.
 * @param limit - Most results to return.
 * @returns Matching references, best first, then by key.
 */
export function matchReferences(
    references: readonly Reference[],
    query: string,
    limit: number,
): readonly Reference[] {
    const trimmed = query.trim().toLowerCase();

    // With nothing typed yet, the whole bibliography is the answer;
    // it arrives key-sorted from the backend.
    if (trimmed.length === 0) return references.slice(0, limit);

    const scored: ScoredReference[] = [];

    for (const reference of references) {
        const score = scoreReference(reference, trimmed);
        if (score === null) continue;

        scored.push({ reference, score });
    }

    scored.sort((left, right) => {
        if (left.score !== right.score) return right.score - left.score;

        return left.reference.key.localeCompare(right.reference.key);
    });

    return scored.slice(0, limit).map((entry) => entry.reference);
}

/**
 * Formats a reference's authors for a one-line summary.
 *
 * @param authors - Author names as written in the `.bib` entry.
 * @returns A short author label, empty when there are none.
 */
export function describeAuthors(authors: readonly string[]): string {
    const [first] = authors;
    if (!first) return "";

    // Names are usually "Last, First"; the family name alone is what
    // makes a citation recognisable at a glance.
    const familyName = first.split(",")[0]?.trim() ?? first;

    return authors.length > 1 ? `${familyName} et al.` : familyName;
}

/**
 * Builds the one-line detail shown beside a completion.
 *
 * @param reference - The reference being offered.
 * @returns Author and year, e.g. "Knuth, 1984".
 */
export function describeReference(reference: Reference): string {
    return [describeAuthors(reference.authors), reference.year]
        .filter((part) => part.length > 0)
        .join(", ");
}
