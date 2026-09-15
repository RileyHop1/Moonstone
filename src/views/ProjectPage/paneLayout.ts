/**
 * The editor area's split layout: a tree of panes, each showing one
 * file, arranged in rows and columns.
 *
 * Everything here is pure — and means it. Ids are supplied by the
 * caller rather than minted from a module counter, so the same inputs
 * always give the same tree and a test can assert on a whole layout by
 * value. {@link createPaneIdFactory} is where the impurity lives, and
 * the page holds one.
 *
 * The tree is the whole model — which file a pane shows, where panes
 * sit relative to each other, and how the space between them is
 * divided — so it can be reasoned about and tested without mounting an
 * editor. The project page owns the loaded documents separately, keyed
 * by pane id, because two panes may show the same file and each needs
 * its own editor state.
 *
 * The shape follows VS Code's: splitting a pane inside a row that
 * already runs the same way adds a sibling rather than nesting another
 * level. Without that, splitting right three times gives three levels
 * of nesting where the user asked for three columns.
 */

/** Identifies one pane. Values come from a {@link createPaneIdFactory}. */
export type PaneId = string;

/** A pane showing a single file. */
export interface PaneLeaf {
    readonly kind: "leaf";
    readonly id: PaneId;
    /** The file shown, or null for a pane with nothing open yet. */
    readonly path: string | null;
}

/** How a split arranges its children. */
export type SplitDirection = "row" | "column";

/** A row or column of panes. */
export interface PaneSplit {
    readonly kind: "split";
    /**
     * Identifies this split. Splits carry an id purely so React can key
     * them: keying by position instead would remount every editor below
     * an insertion, throwing away its undo history and scroll position.
     */
    readonly id: PaneId;
    readonly direction: SplitDirection;
    readonly children: readonly PaneNode[];
    /**
     * Each child's share of the split, parallel to `children` and
     * summing to 1.
     *
     * Rendered as `flex-grow`, so the exact scale does not matter — but
     * keeping the sum at 1 means a share reads directly as a fraction
     * of the split, which is what makes the arithmetic checkable.
     */
    readonly sizes: readonly number[];
}

/** A node in the layout tree. */
export type PaneNode = PaneLeaf | PaneSplit;

/** Which edge of a pane a file was dropped on. */
export type DropSide = "left" | "right" | "top" | "bottom";

/**
 * The outcome of closing a pane.
 *
 * A plain updated tree would be ambiguous: `closePane` refuses to
 * remove the last pane and returns the layout unchanged, which is
 * indistinguishable from "closed a pane that happened to leave the tree
 * the same shape". A caller that then moved focus would keep it on a
 * pane it believed was gone.
 */
export interface CloseResult {
    readonly layout: PaneNode;
    /** False when the request was refused and nothing changed. */
    readonly closed: boolean;
}

/** Mints pane ids, unique within one factory's lifetime. */
export type PaneIdFactory = () => PaneId;

/**
 * Creates a source of pane ids.
 *
 * A factory rather than a module-level counter so nothing here holds
 * mutable global state, tests are independent of each other's history,
 * and a layout restored from disk can seed its own factory past the
 * highest id it contains instead of colliding with it.
 *
 * @param startAt - The last id already handed out; the next is one
 *   more. Pass the highest id in a restored layout.
 * @returns A function returning a fresh id each call.
 */
export function createPaneIdFactory(startAt = 0): PaneIdFactory {
    let counter = startAt;

    return () => {
        counter += 1;
        return `pane-${counter}`;
    };
}

/**
 * Builds the starting layout: one pane, showing one file.
 *
 * @param path - The file to show, or null for an empty pane.
 * @param id - The pane's id.
 * @returns A single-leaf layout.
 */
export function createLayout(path: string | null, id: PaneId): PaneNode {
    return { kind: "leaf", id, path };
}

/**
 * The direction a drop on the given side arranges panes in.
 *
 * @param side - The edge dropped on.
 * @returns `row` for left/right, `column` for top/bottom.
 */
function directionFor(side: DropSide): SplitDirection {
    return side === "left" || side === "right" ? "row" : "column";
}

/**
 * Whether a drop on this side puts the new pane before the target.
 *
 * @param side - The edge dropped on.
 * @returns True when the new pane comes first.
 */
function insertsBefore(side: DropSide): boolean {
    return side === "left" || side === "top";
}

/**
 * How much of a pane's smaller dimension counts as its edge.
 *
 * A quarter of the pane, but never more than {@link EDGE_MAX_PX}, so a
 * very large pane does not turn most of itself into a drop zone.
 */
const EDGE_FRACTION = 0.25;

/** Upper bound on how wide an edge zone gets, in pixels. */
const EDGE_MAX_PX = 120;

/**
 * Works out which edge of a pane a point is nearest.
 *
 * The middle is not an edge: dropping there replaces the pane's file
 * rather than splitting, which is what VS Code does and what stops
 * every drop from making another column.
 *
 * Distances are compared in **pixels**, not as fractions of each axis.
 * Comparing fractions makes the answer depend on the pane's aspect
 * ratio: on a pane 1600x300, a point 200px from the left and 80px from
 * the top would resolve to "top", because 200/1600 is less than 80/300
 * — even though the left edge is two and a half times further away.
 *
 * @param offsetX - Distance from the pane's left edge, in pixels.
 * @param offsetY - Distance from the pane's top edge, in pixels.
 * @param width - The pane's width in pixels.
 * @param height - The pane's height in pixels.
 * @returns The nearest edge, or null for the middle.
 */
export function edgeForPoint(
    offsetX: number,
    offsetY: number,
    width: number,
    height: number,
): DropSide | null {
    // A pane with no area has no edges to be near; this is also what
    // jsdom reports, where nothing has layout.
    if (width <= 0 || height <= 0) return null;

    const distances: readonly (readonly [DropSide, number])[] = [
        ["left", offsetX],
        ["right", width - offsetX],
        ["top", offsetY],
        ["bottom", height - offsetY],
    ];

    // Whichever edge the point is closest to wins, so the corners
    // resolve to something rather than to nothing.
    const [side, distance] = distances.reduce((best, candidate) =>
        candidate[1] < best[1] ? candidate : best,
    );

    // Scaled off the smaller dimension so a short, wide pane keeps a
    // usable top and bottom zone.
    const threshold = Math.min(EDGE_FRACTION * Math.min(width, height), EDGE_MAX_PX);

    return distance <= threshold ? side : null;
}

/**
 * Lists every pane in the tree, left to right and top to bottom.
 *
 * @param node - The layout root.
 * @returns Each leaf, in reading order.
 */
export function listPanes(node: PaneNode): readonly PaneLeaf[] {
    if (node.kind === "leaf") return [node];

    return node.children.flatMap(listPanes);
}

/**
 * Finds a pane by id.
 *
 * @param node - The layout root.
 * @param id - The pane to find.
 * @returns The pane, or null when the id is not in this tree.
 */
export function findPane(node: PaneNode, id: PaneId): PaneLeaf | null {
    return listPanes(node).find((pane) => pane.id === id) ?? null;
}

/**
 * Replaces the file a pane shows.
 *
 * @param node - The layout root.
 * @param id - The pane to change.
 * @param path - The file it should show.
 * @returns The updated layout.
 */
export function setPaneFile(node: PaneNode, id: PaneId, path: string | null): PaneNode {
    if (node.kind === "leaf") {
        return node.id === id ? { ...node, path } : node;
    }

    return {
        ...node,
        children: node.children.map((child) => setPaneFile(child, id, path)),
    };
}

/**
 * Scales a list of shares so it sums to 1.
 *
 * @param sizes - The shares to normalise.
 * @returns The scaled shares, or equal shares when they sum to nothing.
 */
function normaliseSizes(sizes: readonly number[]): readonly number[] {
    const total = sizes.reduce((sum, size) => sum + size, 0);

    if (total <= 0) return sizes.map(() => 1 / sizes.length);

    return sizes.map((size) => size / total);
}

/** Ids needed to split a pane: one for the new pane, one for the split. */
export interface SplitIds {
    /** Id for the newly created pane. */
    readonly paneId: PaneId;
    /**
     * Id for the split, used only when a new one has to be created.
     * Inserting into an existing split leaves it unused.
     */
    readonly splitId: PaneId;
}

/**
 * Splits a pane, putting a new one beside it.
 *
 * When the pane already sits in a split running the same way, the new
 * pane joins it as a sibling instead of nesting a fresh split inside —
 * three splits to the right should give three columns, not three levels
 * of tree.
 *
 * The new pane takes half of the target's share, so splitting one pane
 * of three does not disturb the other two.
 *
 * @param node - The layout root.
 * @param targetId - The pane being split.
 * @param side - Which edge of it the new pane goes on.
 * @param path - The file the new pane shows.
 * @param ids - Ids for the new pane and, if needed, the new split.
 * @returns The updated layout.
 */
export function splitPane(
    node: PaneNode,
    targetId: PaneId,
    side: DropSide,
    path: string | null,
    ids: SplitIds,
): PaneNode {
    const newPane: PaneLeaf = { kind: "leaf", id: ids.paneId, path };

    if (node.kind === "leaf") {
        if (node.id !== targetId) return node;

        return {
            kind: "split",
            id: ids.splitId,
            direction: directionFor(side),
            children: insertsBefore(side) ? [newPane, node] : [node, newPane],
            sizes: [0.5, 0.5],
        };
    }

    const targetIndex = node.children.findIndex(
        (child) => child.kind === "leaf" && child.id === targetId,
    );

    // A direct child of a split running the same way: insert alongside.
    if (targetIndex >= 0 && node.direction === directionFor(side)) {
        const at = insertsBefore(side) ? targetIndex : targetIndex + 1;

        const children = [...node.children];
        children.splice(at, 0, newPane);

        // The new pane takes half of what the pane it split had.
        const share = (node.sizes[targetIndex] ?? 1 / node.children.length) / 2;
        const sizes = [...node.sizes];
        sizes[targetIndex] = share;
        sizes.splice(at, 0, share);

        return { ...node, children, sizes: normaliseSizes(sizes) };
    }

    return {
        ...node,
        children: node.children.map((child) => splitPane(child, targetId, side, path, ids)),
    };
}

/**
 * Removes a pane, collapsing any split left holding a single child.
 *
 * The last pane is never removed: an editor area with no panes has
 * nowhere to open the next file.
 *
 * @param node - The layout root.
 * @param id - The pane to close.
 * @returns The updated layout and whether anything was actually closed.
 */
export function closePane(node: PaneNode, id: PaneId): CloseResult {
    // The root is the only pane; there is nowhere to put the next file.
    if (node.kind === "leaf") return { layout: node, closed: false };

    const layout = removePane(node, id);

    return { layout, closed: findPane(node, id) !== null };
}

/**
 * Removes a pane from a subtree, collapsing splits left with one child.
 *
 * @param node - The subtree to remove from.
 * @param id - The pane to remove.
 * @returns The updated subtree.
 */
function removePane(node: PaneNode, id: PaneId): PaneNode {
    if (node.kind === "leaf") return node;

    // Drop the target, then recurse into whatever is left. Sizes are
    // carried through the same filter so they stay parallel to children.
    const surviving = node.children
        .map((child, index) => ({ child, size: node.sizes[index] ?? 0 }))
        .filter((entry) => !(entry.child.kind === "leaf" && entry.child.id === id));

    const kept = surviving.map((entry) => removePane(entry.child, id));

    // A split with one child is just that child, promoted.
    const first = kept[0];
    if (kept.length === 1 && first) return first;

    // Every child gone would leave an empty split; keep the original.
    if (kept.length === 0) return node;

    // The closed pane's share is shared out in proportion, so the
    // remaining panes keep their relative sizes.
    return {
        ...node,
        children: kept,
        sizes: normaliseSizes(surviving.map((entry) => entry.size)),
    };
}

/**
 * Sets the shares of one split's children.
 *
 * @param node - The layout root.
 * @param splitId - The split to resize.
 * @param sizes - The new shares, one per child; normalised to sum to 1.
 * @returns The updated layout, unchanged when the sizes do not match
 *   the split's children or the id names no split.
 */
export function resizeSplit(
    node: PaneNode,
    splitId: PaneId,
    sizes: readonly number[],
): PaneNode {
    if (node.kind === "leaf") return node;

    if (node.id === splitId) {
        // A mismatched length would silently desynchronise sizes from
        // children, so the request is refused rather than half-applied.
        if (sizes.length !== node.children.length) return node;
        if (sizes.some((size) => !Number.isFinite(size) || size <= 0)) return node;

        return { ...node, sizes: normaliseSizes(sizes) };
    }

    return {
        ...node,
        children: node.children.map((child) => resizeSplit(child, splitId, sizes)),
    };
}

/**
 * Picks the pane that should take focus after another one closes.
 *
 * @param node - The layout root, after the close.
 * @param preferred - The pane that had focus, if it still exists.
 * @returns A pane id that is definitely in the tree.
 */
export function focusAfterClose(node: PaneNode, preferred: PaneId | null): PaneId {
    const panes = listPanes(node);

    if (preferred !== null && panes.some((pane) => pane.id === preferred)) {
        return preferred;
    }

    // `listPanes` never returns empty: `closePane` refuses to remove
    // the last pane, so the root is always at least one leaf.
    const first = panes[0];
    if (!first) throw new Error("Layout has no panes");

    return first.id;
}
