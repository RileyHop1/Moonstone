/**
 * What the live preview offers the rest of the app.
 *
 * Deliberately small. This barrel used to re-export all 33 of the
 * module's internals — every scanner, `ClaimedRanges`, `findGroupEnd`
 * — because the test suite imported through it, which made the public
 * API a mirror of the implementation: any internal rename was a
 * breaking change to a "public" surface nobody outside consumed.
 *
 * Two things fixed that. The scanners moved to `../latex`, where the
 * spell checker and diagnostics can reach them without going through a
 * rendering module; and tests now import the concrete module they are
 * testing, which is more honest about what they exercise. What is left
 * here is what the preview actually offers: an extension, and the two
 * hooks the host fills in.
 */

export { frozenFacet, livePreview } from "./livePreview";
export type { ImageSourceResolver, LinkOpener, LivePreviewOptions } from "./livePreview";
