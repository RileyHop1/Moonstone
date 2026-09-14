/**
 * The editor area's split layout: a tree of panes, each showing one
 * file, arranged in rows and columns.
 *
 * Everything here is pure. The tree is the whole model — which file a
 * pane shows, and where panes sit relative to each other — so it can be
 * reasoned about and tested without mounting an editor. The project
 * page owns the loaded documents separately, keyed by pane id, because
 * two panes may show the same file and each needs its own editor state.
 *
 * The shape follows VS Code's: splitting a pane inside a row that
 * already runs the same way adds a sibling rather than nesting another
 * level. Without that, splitting right three times gives three levels
 * of nesting where the user asked for three columns.
 */

/** Identifies one pane. Values come from {@link nextPaneId}. */
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
}

/** A node in the layout tree. */
export type PaneNode = PaneLeaf | PaneSplit;

/** Which edge of a pane a file was dropped on. */
export type DropSide = "left" | "right" | "top" | "bottom";

/** Monotonic source of pane ids, unique within a session. */
let paneCounter = 0;

/**
 * Mints a fresh pane id.
 *
 * @returns An id no live pane is using.
 */
export function nextPaneId(): PaneId {
    paneCounter += 1;
    return `pane-${paneCounter}`;
}

/**
 * Builds the starting layout: one pane, showing one file.
 *
 * @param path - The file to show, or null for an empty pane.
 * @returns A single-leaf layout.
 */
export function createLayout(path: string | null): PaneNode {
    return { kind: "leaf", id: nextPaneId(), path };
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
 * Splits a pane, putting a new one beside it.
 *
 * When the pane already sits in a split running the same way, the new
 * pane joins it as a sibling instead of nesting a fresh split inside —
 * three splits to the right should give three columns, not three levels
 * of tree.
 *
 * @param node - The layout root.
 * @param targetId - The pane being split.
 * @param side - Which edge of it the new pane goes on.
 * @param path - The file the new pane shows.
 * @param newId - Id for the new pane.
 * @returns The updated layout.
 */
export function splitPane(
    node: PaneNode,
    targetId: PaneId,
    side: DropSide,
    path: string | null,
    newId: PaneId,
): PaneNode {
    const newPane: PaneLeaf = { kind: "leaf", id: newId, path };

    if (node.kind === "leaf") {
        if (node.id !== targetId) return node;

        return {
            kind: "split",
            id: nextPaneId(),
            direction: directionFor(side),
            children: insertsBefore(side) ? [newPane, node] : [node, newPane],
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

        return { ...node, children };
    }

    return {
        ...node,
        children: node.children.map((child) => splitPane(child, targetId, side, path, newId)),
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
 * @returns The updated layout, unchanged when `id` is the only pane.
 */
export function closePane(node: PaneNode, id: PaneId): PaneNode {
    if (node.kind === "leaf") return node;

    const kept = node.children
        .filter((child) => !(child.kind === "leaf" && child.id === id))
        .map((child) => closePane(child, id));

    // A split with one child is just that child, promoted.
    const first = kept[0];
    if (kept.length === 1 && first) return first;

    // Every child gone would leave an empty split; keep the original.
    if (kept.length === 0) return node;

    return { ...node, children: kept };
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
