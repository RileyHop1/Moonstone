/**
 * Renders the pane layout tree as nested flex rows and columns.
 *
 * Purely structural: it walks the tree and hands each leaf to
 * {@link EditorPane}, passing the same callbacks straight through. All
 * the decisions about what the tree should look like live in
 * `paneLayout.ts`, and all the state lives in the project page.
 */

import { EditorPane } from "./EditorPane";
import type { PaneDocument } from "./EditorPane";
import type { DropSide, PaneId, PaneNode } from "./paneLayout";
import type { EditorView } from "@codemirror/view";
import type { EditorConfiguration } from "../editor/TextEditor/editorConfiguration";

/** Props for {@link PaneTree}. */
export interface PaneTreeProps {
    /** The subtree to render. */
    readonly node: PaneNode;
    /**
     * This node's share of its parent split, rendered as `flex-grow`.
     * Omitted at the root, which simply fills the editor area.
     */
    readonly size?: number | undefined;
    /** Open documents, keyed by pane. */
    readonly documents: ReadonlyMap<PaneId, PaneDocument>;
    /** Panes with unsaved changes. */
    readonly dirtyPanes: ReadonlySet<PaneId>;
    /** The pane driving the toolbar. */
    readonly activePaneId: PaneId;
    /** False when only one pane is open, hiding its close button. */
    readonly canClose: boolean;
    /** Settings every pane's editor runs under. */
    readonly configuration: EditorConfiguration;
    readonly onActivate: (paneId: PaneId) => void;
    readonly onDropFile: (paneId: PaneId, side: DropSide | null, path: string) => void;
    readonly onClose: (paneId: PaneId) => void;
    readonly onViewReady: (paneId: PaneId, view: EditorView) => void;
    readonly onViewDestroyed: (paneId: PaneId) => void;
    readonly onDocChanged: (paneId: PaneId) => void;
    readonly onSaveRequested: (paneId: PaneId) => void;
    readonly onDiagnosticsToggled: (visible: boolean) => void;
}

/**
 * Renders one node of the layout tree.
 *
 * @param props - The subtree plus everything a pane needs.
 * @returns The rendered subtree.
 */
export function PaneTree({ node, size, ...shared }: PaneTreeProps) {
    if (node.kind === "leaf") {
        return (
            <EditorPane
                paneId={node.id}
                size={size}
                document={shared.documents.get(node.id) ?? null}
                isActive={node.id === shared.activePaneId}
                isDirty={shared.dirtyPanes.has(node.id)}
                canClose={shared.canClose}
                configuration={shared.configuration}
                onActivate={shared.onActivate}
                onDropFile={shared.onDropFile}
                onClose={shared.onClose}
                onViewReady={shared.onViewReady}
                onViewDestroyed={shared.onViewDestroyed}
                onDocChanged={shared.onDocChanged}
                onSaveRequested={shared.onSaveRequested}
                onDiagnosticsToggled={shared.onDiagnosticsToggled}
            />
        );
    }

    return (
        // The root split fills the editor area; a nested one takes the
        // share its parent allotted it.
        <div
            className={`pane-split pane-split-${node.direction}`}
            style={{ flexGrow: size ?? 1 }}
        >
            {node.children.map((child, index) => (
                // Keyed by node id, never by position: keying by index
                // would remount every editor below an insertion and
                // throw away its undo history.
                <PaneTree
                    key={child.id}
                    node={child}
                    size={node.sizes[index] ?? 1 / node.children.length}
                    {...shared}
                />
            ))}
        </div>
    );
}
