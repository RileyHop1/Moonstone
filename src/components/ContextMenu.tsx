/**
 * Fixed-position context menu shown at the cursor on right-click.
 * Closes on outside click or Escape.
 */

import { useEffect, useRef } from "react";
import "../styles/ContextMenu.css";

/** One context menu entry. */
export interface ContextMenuItem {
    /** Text shown for the entry. */
    readonly label: string;
    /** Runs when the entry is clicked (menu closes afterwards). */
    readonly onClick: () => void;
    /** True renders the entry in the destructive (red) style. */
    readonly danger?: boolean;
}

/** Props for {@link ContextMenu}. */
export interface ContextMenuProps {
    /** Viewport x coordinate the menu opens at. */
    readonly x: number;
    /** Viewport y coordinate the menu opens at. */
    readonly y: number;
    /** The entries to display, in order. */
    readonly items: readonly ContextMenuItem[];
    /** Called when the menu should close (outside click, Escape). */
    readonly onClose: () => void;
}

/**
 * Renders the context menu at the given viewport position.
 *
 * @param props - Position, entries, and the close callback.
 * @returns The menu element.
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
    const menuRef = useRef<HTMLUListElement>(null);

    // Close on any outside interaction or Escape.
    useEffect(() => {
        function handleMouseDown(event: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        }

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") onClose();
        }

        document.addEventListener("mousedown", handleMouseDown);
        document.addEventListener("keydown", handleKeyDown);

        return () => {
            document.removeEventListener("mousedown", handleMouseDown);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [onClose]);

    return (
        <ul
            ref={menuRef}
            className="context-menu"
            style={{ left: x, top: y }}
            role="menu"
        >
            {items.map((item) => (
                <li
                    key={item.label}
                    role="menuitem"
                    className={`context-menu-item${item.danger ? " context-menu-item-danger" : ""}`}
                    onClick={() => {
                        item.onClick();
                        onClose();
                    }}
                >
                    {item.label}
                </li>
            ))}
        </ul>
    );
}
