/**
 * Dockable file browser for the project page.
 *
 * Renders the project's file tree recursively; the header doubles as
 * the drag handle for docking the panel and holds quick actions
 * (new file/folder, expand/collapse all). Rows support a right-click
 * context menu, inline rename, and drag-and-drop to move entries
 * between folders.
 */

import { useState } from "react";
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";
import { ContextMenu } from "../../../components/ContextMenu";
import type { ContextMenuItem } from "../../../components/ContextMenu";
import { RenameInput } from "./RenameInput";
import type { DockDragHandleProps } from "../../../shared/useDockDrag";
import { assertNever } from "../../../shared/types";
import type { FileNode, LoadState } from "../../../shared/types";
import "./FileBrowser.css";

/** A file-management request raised by the browser, handled by the page. */
export type FileOperation =
    | { readonly kind: "newFile"; readonly parentDir: string }
    | { readonly kind: "newFolder"; readonly parentDir: string }
    | { readonly kind: "move"; readonly sourcePath: string; readonly destDir: string }
    | { readonly kind: "delete"; readonly path: string; readonly name: string };

/** Props for {@link FileBrowser}. */
export interface FileBrowserProps {
    /** The project's file tree load state. */
    readonly tree: LoadState<FileNode>;
    /** Path of the file currently open in the editor, if any. */
    readonly selectedPath: string | null;
    /** Called when the user clicks a file. */
    readonly onSelectFile: (path: string) => void;
    /** Called when the user requests a file-management operation. */
    readonly onFileOperation: (operation: FileOperation) => void;
    /** Renames an entry; resolves to an error message or null on success. */
    readonly onRename: (path: string, newName: string) => Promise<string | null>;
    /** Pointer handlers making the header a dock drag handle. */
    readonly dragHandleProps: DockDragHandleProps;
}

/** Where the context menu is open, and for which node. */
interface MenuState {
    readonly x: number;
    readonly y: number;
    readonly node: FileNode;
}

/** Shared interaction state and callbacks threaded to every tree row. */
interface TreeInteraction {
    readonly expandedPaths: ReadonlySet<string>;
    readonly selectedPath: string | null;
    readonly renamingPath: string | null;
    readonly dropTargetPath: string | null;
    readonly onSelectFile: (path: string) => void;
    readonly onToggleDirectory: (path: string) => void;
    readonly onOpenMenu: (event: ReactMouseEvent, node: FileNode) => void;
    readonly onStartRename: (path: string) => void;
    readonly onExitRename: () => void;
    readonly onCommitRename: (path: string, newName: string) => Promise<string | null>;
    readonly onDragStartNode: (path: string) => void;
    readonly onDragEnd: () => void;
    readonly onDragOverDir: (path: string) => void;
    readonly onDropOnDir: (destDir: string) => void;
}

/**
 * Renders the file browser panel.
 *
 * @param props - Tree data, selection, and interaction callbacks.
 * @returns The panel element.
 */
export function FileBrowser({
    tree,
    selectedPath,
    onSelectFile,
    onFileOperation,
    onRename,
    dragHandleProps,
}: FileBrowserProps) {
    const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(new Set());
    const [menu, setMenu] = useState<MenuState | null>(null);
    const [renamingPath, setRenamingPath] = useState<string | null>(null);
    const [draggedPath, setDraggedPath] = useState<string | null>(null);
    const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);

    /**
     * Toggles a directory open or closed.
     *
     * @param path - The directory's path.
     */
    function toggleDirectory(path: string): void {
        setExpandedPaths((previous) => {
            const next = new Set(previous);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
    }

    /**
     * Opens the context menu for a node at the cursor position.
     *
     * @param event - The contextmenu mouse event.
     * @param node - The node the row represents.
     */
    function openMenu(event: ReactMouseEvent, node: FileNode): void {
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY, node });
    }

    /**
     * Records the drop target for a directory the dragged entry may
     * legally move into.
     *
     * @param path - The directory being hovered.
     */
    function handleDragOverDir(path: string): void {
        if (draggedPath === null || isInvalidMove(draggedPath, path)) return;
        setDropTargetPath(path);
    }

    /**
     * Requests a move when an entry is dropped onto a directory.
     *
     * @param destDir - The directory dropped onto.
     */
    function handleDropOnDir(destDir: string): void {
        const source = draggedPath;
        setDraggedPath(null);
        setDropTargetPath(null);
        if (source === null || isInvalidMove(source, destDir)) return;
        onFileOperation({ kind: "move", sourcePath: source, destDir });
    }

    const rootPath = tree.status === "ready" ? tree.data.path : null;
    const directoryPaths = tree.status === "ready" ? collectDirectoryPaths(tree.data) : [];
    const hasDirectories = directoryPaths.length > 0;

    const interaction: TreeInteraction = {
        expandedPaths,
        selectedPath,
        renamingPath,
        dropTargetPath,
        onSelectFile,
        onToggleDirectory: toggleDirectory,
        onOpenMenu: openMenu,
        onStartRename: setRenamingPath,
        onExitRename: () => setRenamingPath(null),
        onCommitRename: onRename,
        onDragStartNode: setDraggedPath,
        onDragEnd: () => {
            setDraggedPath(null);
            setDropTargetPath(null);
        },
        onDragOverDir: handleDragOverDir,
        onDropOnDir: handleDropOnDir,
    };

    return (
        <aside className="file-browser">
            <div className="file-browser-header" {...dragHandleProps} title="Drag to dock left or right">
                <span>Files</span>
                <span className="file-browser-header-actions">
                    <button
                        type="button"
                        className="file-browser-action"
                        title="Expand all folders"
                        disabled={!hasDirectories}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => setExpandedPaths(new Set(directoryPaths))}
                    >
                        ⊞
                    </button>
                    <button
                        type="button"
                        className="file-browser-action"
                        title="Collapse all folders"
                        disabled={!hasDirectories}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => setExpandedPaths(new Set())}
                    >
                        ⊟
                    </button>
                    <button
                        type="button"
                        className="file-browser-action"
                        title="New file"
                        disabled={rootPath === null}
                        // Stop the dock-drag handle from swallowing the click.
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => {
                            if (rootPath === null) return;
                            onFileOperation({ kind: "newFile", parentDir: rootPath });
                        }}
                    >
                        +🗎
                    </button>
                    <button
                        type="button"
                        className="file-browser-action"
                        title="New folder"
                        disabled={rootPath === null}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => {
                            if (rootPath === null) return;
                            onFileOperation({ kind: "newFolder", parentDir: rootPath });
                        }}
                    >
                        +🗀
                    </button>
                </span>
            </div>

            <div
                className="file-browser-body"
                // Dropping on the empty body moves the entry to the root.
                onDragOver={(event) => {
                    if (rootPath !== null && draggedPath !== null) event.preventDefault();
                }}
                onDrop={() => {
                    if (rootPath !== null) handleDropOnDir(rootPath);
                }}
            >
                {renderTree(tree, interaction)}
            </div>

            {menu && (
                <ContextMenu
                    x={menu.x}
                    y={menu.y}
                    items={buildMenuItems(menu.node, onFileOperation, setRenamingPath)}
                    onClose={() => setMenu(null)}
                />
            )}
        </aside>
    );
}

/**
 * Reports whether moving `source` into `destDir` is disallowed: a
 * directory cannot move into itself or one of its descendants.
 *
 * @param source - Path of the entry being moved.
 * @param destDir - Path of the destination directory.
 * @returns True when the move must be rejected.
 */
function isInvalidMove(source: string, destDir: string): boolean {
    return destDir === source || destDir.startsWith(`${source}\\`) || destDir.startsWith(`${source}/`);
}

/**
 * Collects every directory path in the tree (for expand-all).
 *
 * @param node - The tree node to walk.
 * @returns All directory paths at and below the node.
 */
function collectDirectoryPaths(node: FileNode): readonly string[] {
    if (node.kind === "file") return [];
    return [node.path, ...node.children.flatMap(collectDirectoryPaths)];
}

/**
 * Builds the context menu entries for a node: directories can contain
 * new entries; everything can be renamed or deleted.
 *
 * @param node - The node the menu targets.
 * @param onFileOperation - The operation callback.
 * @param onStartRename - Begins inline rename for a path.
 * @returns The menu entries.
 */
function buildMenuItems(
    node: FileNode,
    onFileOperation: (operation: FileOperation) => void,
    onStartRename: (path: string) => void,
): readonly ContextMenuItem[] {
    const shared: readonly ContextMenuItem[] = [
        {
            label: "Rename",
            onClick: () => onStartRename(node.path),
        },
        {
            label: "Delete",
            danger: true,
            onClick: () => onFileOperation({ kind: "delete", path: node.path, name: node.name }),
        },
    ];

    if (node.kind === "file") return shared;

    return [
        {
            label: "New File",
            onClick: () => onFileOperation({ kind: "newFile", parentDir: node.path }),
        },
        {
            label: "New Folder",
            onClick: () => onFileOperation({ kind: "newFolder", parentDir: node.path }),
        },
        ...shared,
    ];
}

/**
 * Renders the tree body for the current load state.
 *
 * @param tree - The file tree load state.
 * @param interaction - Shared row interaction state and callbacks.
 * @returns The state-appropriate body element.
 */
function renderTree(tree: LoadState<FileNode>, interaction: TreeInteraction) {
    switch (tree.status) {
        case "loading":
            return <p className="file-browser-status">Loading files…</p>;

        case "error":
            return <p className="file-browser-status file-browser-error">{tree.message}</p>;

        case "ready": {
            // The root node is the project directory itself; show its
            // children directly.
            const children = tree.data.kind === "directory" ? tree.data.children : [tree.data];

            if (children.length === 0) {
                return <p className="file-browser-status">This project is empty.</p>;
            }

            return (
                <ul className="file-tree-list">
                    {children.map((child) => (
                        <FileTreeNode key={child.path} node={child} depth={0} interaction={interaction} />
                    ))}
                </ul>
            );
        }

        default:
            return assertNever(tree);
    }
}

/** Props for {@link FileTreeNode}. */
interface FileTreeNodeProps {
    readonly node: FileNode;
    readonly depth: number;
    readonly interaction: TreeInteraction;
}

/**
 * Renders one file or directory row (and, when expanded, the
 * directory's children).
 *
 * @param props - The node, its depth, and shared interaction state.
 * @returns The row element.
 */
function FileTreeNode({ node, depth, interaction }: FileTreeNodeProps) {
    const indent = { paddingLeft: `${0.5 + depth * 0.85}rem` };
    const isRenaming = interaction.renamingPath === node.path;
    const isExpanded = node.kind === "directory" && interaction.expandedPaths.has(node.path);

    const icon =
        node.kind === "file" ? (
            <span className="file-tree-icon">📄</span>
        ) : (
            <span className={`file-tree-chevron${isExpanded ? " file-tree-chevron-open" : ""}`}>
                ▸
            </span>
        );

    /** The directory's nested children, when expanded. */
    const children =
        node.kind === "directory" && isExpanded ? (
            <ul className="file-tree-list">
                {node.children.map((child) => (
                    <FileTreeNode
                        key={child.path}
                        node={child}
                        depth={depth + 1}
                        interaction={interaction}
                    />
                ))}
            </ul>
        ) : null;

    // While renaming, the row is a plain container (an input may not be
    // nested inside the row's <button>).
    if (isRenaming) {
        return (
            <li>
                <div className="file-tree-row file-tree-row-renaming" style={indent}>
                    {icon}
                    <RenameInput
                        initialValue={node.name}
                        onCommit={(newName) => interaction.onCommitRename(node.path, newName)}
                        onExit={interaction.onExitRename}
                    />
                </div>
                {children}
            </li>
        );
    }

    const dragProps = {
        draggable: true,
        onDragStart: (event: ReactDragEvent) => {
            event.dataTransfer.setData("text/plain", node.path);
            event.dataTransfer.effectAllowed = "move";
            interaction.onDragStartNode(node.path);
        },
        onDragEnd: interaction.onDragEnd,
    };

    if (node.kind === "file") {
        const isSelected = node.path === interaction.selectedPath;

        return (
            <li>
                <button
                    type="button"
                    className={`file-tree-row${isSelected ? " file-tree-row-selected" : ""}`}
                    style={indent}
                    {...dragProps}
                    onClick={() => interaction.onSelectFile(node.path)}
                    onContextMenu={(event) => interaction.onOpenMenu(event, node)}
                >
                    {icon}
                    <span className="file-tree-name">{node.name}</span>
                </button>
            </li>
        );
    }

    const isDropTarget = interaction.dropTargetPath === node.path;

    return (
        <li>
            <button
                type="button"
                className={`file-tree-row${isDropTarget ? " file-tree-row-drop-target" : ""}`}
                style={indent}
                {...dragProps}
                onClick={() => interaction.onToggleDirectory(node.path)}
                onContextMenu={(event) => interaction.onOpenMenu(event, node)}
                onDragOver={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    interaction.onDragOverDir(node.path);
                }}
                onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    interaction.onDropOnDir(node.path);
                }}
            >
                {icon}
                <span className="file-tree-name">{node.name}</span>
            </button>

            {children}
        </li>
    );
}
