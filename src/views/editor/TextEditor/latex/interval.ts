/**
 * The half-open range every scanner speaks in.
 *
 * Seven modules had declared this same two-field shape privately, which
 * is harmless until one of them wants to hand a range to another —
 * structural typing lets them, but nothing then says they mean the same
 * thing, and the next field added to one of them quietly diverges.
 *
 * Its own module rather than living with a scanner, so that depending on
 * "what a range is" does not mean depending on comment lexing or
 * whatever else that scanner happens to do.
 */

/**
 * A half-open range of document positions: `from` inclusive, `to`
 * exclusive.
 *
 * Positions are absolute offsets into the document unless a scanner's
 * own documentation says otherwise.
 */
export interface Interval {
    readonly from: number;
    readonly to: number;
}
