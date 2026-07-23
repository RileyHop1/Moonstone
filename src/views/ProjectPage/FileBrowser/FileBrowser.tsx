/**
 * Dockable file browser for the project page.
 *
 * Renders the project's file tree recursively; the header doubles as
 * the drag handle for docking the panel to either side of the window.
 * Rows offer a right-click context menu for file management, and the
 * header has quick new-file / new-folder buttons.
 */

import { useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { ContextMenu } from "../../../components/ContextMenu";
import type { ContextMenuItem } from "../../../components/ContextMenu";
import type { DockDragHandleProps } from "../../../shared/useDockDrag";
import { assertNever } from "../../../shared/types";
import type { FileNode, LoadState } from "../../../shared/types";
import "./FileBrowser.css";

/** A file-management request raised by the browser, handled by the page. */
export type FileOperation =
    | { readonly kind: "newFile"; readonly parentDir: string }
    | { readonly kind: "newFolder"; readonly parentDir: string }
    | { readonly kind: "rename"; readonly path: string; readonly currentName: string }
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
    /** Pointer handlers making the header a dock drag handle. */
    readonly dragHandleProps: DockDragHandleProps;
}

/** Where the context menu is open, and for which node. */
interface MenuState {
    readonly x: number;
    readonly y: number;
    readonly node: FileNode;
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
    dragHandleProps,
}: FileBrowserProps) {
    const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(new Set());
    const [menu, setMenu] = useState<MenuState | null>(null);

    /**
     * Toggles a directory open or closed.
     *
     * @param path - The directory's path.
     */
    function toggleDirectory(path: string): void {
        setExpandedPaths((previous) => {
            const next = new Set(previous);

            if (next.has(path)) {
                next.delete(path);
            } else {
                next.add(path);
            }

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

    const rootPath = tree.status === "ready" ? tree.data.path : null;

    return (
        <aside className="file-browser">
            <div className="file-browser-header" {...dragHandleProps} title="Drag to dock left or right">
                <span>Files</span>
                <span className="file-browser-header-actions">
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

            <div className="file-browser-body">
                {renderTree(tree, expandedPaths, selectedPath, onSelectFile, toggleDirectory, openMenu)}
            </div>

            {menu && (
                <ContextMenu
                    x={menu.x}
                    y={menu.y}
                    items={buildMenuItems(menu.node, onFileOperation)}
                    onClose={() => setMenu(null)}
                />
            )}
        </aside>
    );
}

/**
 * Builds the context menu entries for a node: directories can contain
 * new entries; everything can be renamed or deleted.
 *
 * @param node - The node the menu targets.
 * @param onFileOperation - The operation callback.
 * @returns The menu entries.
 */
function buildMenuItems(
    node: FileNode,
    onFileOperation: (operation: FileOperation) => void,
): readonly ContextMenuItem[] {
    const shared: readonly ContextMenuItem[] = [
        {
            label: "Rename",
            onClick: () => onFileOperation({ kind: "rename", path: node.path, currentName: node.name }),
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
 * @param expandedPaths - Directories currently expanded.
 * @param selectedPath - The open file's path.
 * @param onSelectFile - File click callback.
 * @param onToggleDirectory - Directory click callback.
 * @param onOpenMenu - Context menu callback.
 * @returns The state-appropriate body element.
 */
function renderTree(
    tree: LoadState<FileNode>,
    expandedPaths: ReadonlySet<string>,
    selectedPath: string | null,
    onSelectFile: (path: string) => void,
    onToggleDirectory: (path: string) => void,
    onOpenMenu: (event: ReactMouseEvent, node: FileNode) => void,
) {
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
                        <FileTreeNode
                            key={child.path}
                            node={child}
                            depth={0}
                            expandedPaths={expandedPaths}
                            selectedPath={selectedPath}
                            onSelectFile={onSelectFile}
                            onToggleDirectory={onToggleDirectory}
                            onOpenMenu={onOpenMenu}
                        />
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
    readonly expandedPaths: ReadonlySet<string>;
    readonly selectedPath: string | null;
    readonly onSelectFile: (path: string) => void;
    readonly onToggleDirectory: (path: string) => void;
    readonly onOpenMenu: (event: ReactMouseEvent, node: FileNode) => void;
}

/**
 * Renders one file or directory row (and, when expanded, the
 * directory's children).
 *
 * @param props - The node and tree interaction state.
 * @returns The row element.
 */
function FileTreeNode({
    node,
    depth,
    expandedPaths,
    selectedPath,
    onSelectFile,
    onToggleDirectory,
    onOpenMenu,
}: FileTreeNodeProps) {
    const indent = { paddingLeft: `${0.5 + depth * 0.85}rem` };

    switch (node.kind) {
        case "file": {
            const isSelected = node.path === selectedPath;

            return (
                <li>
                    <button
                        type="button"
                        className={`file-tree-row${isSelected ? " file-tree-row-selected" : ""}`}
                        style={indent}
                        onClick={() => onSelectFile(node.path)}
                        onContextMenu={(event) => onOpenMenu(event, node)}
                    >
                        <span className="file-tree-icon">📄</span>
                        <span className="file-tree-name">{node.name}</span>
                    </button>
                </li>
            );
        }

        case "directory": {
            const isExpanded = expandedPaths.has(node.path);

            return (
                <li>
                    <button
                        type="button"
                        className="file-tree-row"
                        style={indent}
                        onClick={() => onToggleDirectory(node.path)}
                        onContextMenu={(event) => onOpenMenu(event, node)}
                    >
                        <span
                            className={`file-tree-chevron${isExpanded ? " file-tree-chevron-open" : ""}`}
                        >
                            ▸
                        </span>
                        <span className="file-tree-name">{node.name}</span>
                    </button>

                    {isExpanded && (
                        <ul className="file-tree-list">
                            {node.children.map((child) => (
                                <FileTreeNode
                                    key={child.path}
                                    node={child}
                                    depth={depth + 1}
                                    expandedPaths={expandedPaths}
                                    selectedPath={selectedPath}
                                    onSelectFile={onSelectFile}
                                    onToggleDirectory={onToggleDirectory}
                                    onOpenMenu={onOpenMenu}
                                />
                            ))}
                        </ul>
                    )}
                </li>
            );
        }

        default:
            return assertNever(node);
    }
}
