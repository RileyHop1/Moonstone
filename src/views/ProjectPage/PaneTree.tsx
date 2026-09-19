/**
 * Renders the pane layout tree as nested flex rows and columns.
 *
 * Purely structural: it walks the tree and hands each leaf to
 * {@link EditorPane}, passing the same callbacks straight through. All
 * the decisions about what the tree should look like live in
 * `paneLayout.ts`, and all the state lives in the project page.
 */

import { Fragment, useRef } from "react";
import { EditorPane } from "./EditorPane";
import type { PaneDocument } from "./EditorPane";
import { PaneSplitter } from "./PaneSplitter";
import type { DropSide, PaneId, PaneNode, PaneSplit } from "./paneLayout";
import type { EditorView } from "@codemirror/view";
import type { PaneConfigurationLookup } from "./usePaneConfigurations";
import type { PdfLocation } from "../../shared/types";

/** Everything a pane needs, passed unchanged down the whole tree. */
export interface PaneTreeShared {
    /** Open documents, keyed by pane. */
    readonly documents: ReadonlyMap<PaneId, PaneDocument>;
    /** Panes with unsaved changes. */
    readonly dirtyPanes: ReadonlySet<PaneId>;
    /** The pane driving the toolbar. */
    readonly activePaneId: PaneId;
    /** False when only one pane is open, hiding its close button. */
    readonly canClose: boolean;
    /**
     * Settings for a pane's editor, looked up by the file it has open.
     *
     * A lookup rather than one shared object because two of the fields
     * follow the *document*, not the user's preferences: the file-type
     * profile and the image resolver.
     */
    readonly configurationFor: PaneConfigurationLookup;
    readonly onActivate: (paneId: PaneId) => void;
    readonly onDropFile: (paneId: PaneId, side: DropSide | null, path: string) => void;
    readonly onClose: (paneId: PaneId) => void;
    readonly onViewReady: (paneId: PaneId, view: EditorView) => void;
    readonly onViewDestroyed: (paneId: PaneId) => void;
    readonly onDocChanged: (paneId: PaneId) => void;
    readonly onSaveRequested: (paneId: PaneId) => void;
    readonly onDiagnosticsToggled: (visible: boolean) => void;
    /** A spot for one pane's PDF to scroll to, from a jump in the source. */
    readonly pdfTarget: { readonly paneId: PaneId; readonly location: PdfLocation } | null;
    readonly onPdfDoubleClick: (pdfPath: string, location: PdfLocation) => void;
    /**
     * Called when a splitter moves, with the new shares for the two
     * panes either side of boundary `index` in split `splitId`.
     */
    readonly onResizeSplit: (
        splitId: PaneId,
        index: number,
        beforeSize: number,
        afterSize: number,
    ) => void;
}

/** Props for {@link PaneTree}. */
export interface PaneTreeProps extends PaneTreeShared {
    /** The subtree to render. */
    readonly node: PaneNode;
    /**
     * This node's share of its parent split, rendered as `flex-grow`.
     * Omitted at the root, which simply fills the editor area.
     */
    readonly size?: number | undefined;
}

/**
 * One child's share, falling back to an equal division.
 *
 * @param node - The split to read.
 * @param index - Which child.
 * @returns That child's share.
 */
function sizeAt(node: PaneSplit, index: number): number {
    return node.sizes[index] ?? 1 / node.children.length;
}

/**
 * Renders one node of the layout tree.
 *
 * @param props - The subtree plus everything a pane needs.
 * @returns The rendered subtree.
 */
export function PaneTree({ node, size, ...shared }: PaneTreeProps) {
    if (node.kind === "leaf") {
        const document = shared.documents.get(node.id) ?? null;
        const isActive = node.id === shared.activePaneId;

        return (
            <EditorPane
                paneId={node.id}
                size={size}
                document={document}
                isActive={isActive}
                isDirty={shared.dirtyPanes.has(node.id)}
                canClose={shared.canClose}
                configuration={shared.configurationFor({
                    path: document?.path ?? null,
                    // Every pane but the focused one holds its
                    // rendering — see `frozenFacet`.
                    isFrozen: !isActive,
                })}
                onActivate={shared.onActivate}
                onDropFile={shared.onDropFile}
                onClose={shared.onClose}
                onViewReady={shared.onViewReady}
                onViewDestroyed={shared.onViewDestroyed}
                onDocChanged={shared.onDocChanged}
                onSaveRequested={shared.onSaveRequested}
                onDiagnosticsToggled={shared.onDiagnosticsToggled}
                pdfTarget={
                    shared.pdfTarget?.paneId === node.id ? shared.pdfTarget.location : null
                }
                onPdfDoubleClick={shared.onPdfDoubleClick}
            />
        );
    }

    return <PaneSplitView node={node} size={size} {...shared} />;
}

/** Props for {@link PaneSplitView}. */
interface PaneSplitViewProps extends PaneTreeShared {
    readonly node: PaneSplit;
    readonly size?: number | undefined;
}

/**
 * Renders a row or column of panes, with a draggable boundary between
 * each neighbouring pair.
 *
 * Split out from {@link PaneTree} so it can hold a ref to its own
 * element: a splitter converts pointer movement into shares, which
 * needs the pixel extent of the split it divides, and measuring it here
 * avoids threading a registry of elements down the tree.
 *
 * @param props - The split, its share, and everything a pane needs.
 * @returns The rendered split.
 */
function PaneSplitView({ node, size, ...shared }: PaneSplitViewProps) {
    const splitRef = useRef<HTMLDivElement | null>(null);

    /**
     * The split's extent along the axis it divides.
     *
     * Measured when a drag starts rather than kept in state: it changes
     * with every window resize, and a stale value scales the whole drag.
     */
    const measureExtent = (): number => {
        const box = splitRef.current?.getBoundingClientRect();
        if (!box) return 0;

        return node.direction === "row" ? box.width : box.height;
    };

    return (
        // The root split fills the editor area; a nested one takes the
        // share its parent allotted it.
        <div
            ref={splitRef}
            className={`pane-split pane-split-${node.direction}`}
            style={{ flexGrow: size ?? 1 }}
        >
            {node.children.map((child, index) => (
                // Keyed by node id, never by position: keying by index
                // would remount every editor below an insertion and
                // throw away its undo history.
                <Fragment key={child.id}>
                    {index > 0 && (
                        <PaneSplitter
                            direction={node.direction}
                            beforeSize={sizeAt(node, index - 1)}
                            afterSize={sizeAt(node, index)}
                            measureExtent={measureExtent}
                            onResize={(beforeSize, afterSize) => {
                                shared.onResizeSplit(node.id, index - 1, beforeSize, afterSize);
                            }}
                        />
                    )}
                    <PaneTree node={child} size={sizeAt(node, index)} {...shared} />
                </Fragment>
            ))}
        </div>
    );
}
