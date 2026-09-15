/**
 * Modal asking the user to confirm something before it happens.
 *
 * Replaces `window.confirm`, which the project page used for discarding
 * unsaved changes and for deleting a file. The native dialog is
 * unstyled — it looks like a browser in the middle of a desktop app,
 * ignoring the seven themes everything else follows — and it blocks the
 * whole event loop. It is also untestable without stubbing a global,
 * which the suite had to do.
 *
 * Shares `NameDialog`'s markup and styling, so the two read as the same
 * component family.
 */

import { useEffect, useRef } from "react";

/** Props for {@link ConfirmDialog}. */
export interface ConfirmDialogProps {
    /** Dialog heading, e.g. "Discard changes?". */
    readonly title: string;
    /** The question or consequence, in a sentence. */
    readonly message: string;
    /** Label of the confirming button, e.g. "Discard". */
    readonly confirmLabel: string;
    /**
     * Whether the action destroys something, styling the confirm button
     * as such. Deleting a file is destructive; leaving a project is not.
     */
    readonly isDestructive?: boolean;
    /** Called when the user confirms. */
    readonly onConfirm: () => void;
    /** Called when the user declines or dismisses the dialog. */
    readonly onCancel: () => void;
}

/**
 * Renders a confirmation modal.
 *
 * @param props - Labels and the confirm/cancel callbacks.
 * @returns The dialog element.
 */
export function ConfirmDialog({
    title,
    message,
    confirmLabel,
    isDestructive = false,
    onConfirm,
    onCancel,
}: ConfirmDialogProps) {
    const cancelRef = useRef<HTMLButtonElement | null>(null);

    // Focus starts on Cancel, not on the confirming button: a stray
    // Enter should not delete a file.
    useEffect(() => {
        cancelRef.current?.focus();
    }, []);

    // Escape dismisses, matching every other modal and the native dialog
    // this replaces.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === "Escape") onCancel();
        };

        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [onCancel]);

    return (
        <div className="dialog-overlay" onClick={onCancel}>
            {/* Stop clicks inside the panel from dismissing the dialog. */}
            <div
                className="dialog-panel"
                role="alertdialog"
                aria-modal="true"
                aria-label={title}
                onClick={(event) => {
                    event.stopPropagation();
                }}
            >
                <h2 className="dialog-title">{title}</h2>

                <p className="dialog-message">{message}</p>

                <div className="dialog-buttons">
                    <button
                        ref={cancelRef}
                        type="button"
                        className="dialog-button"
                        onClick={onCancel}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className={`dialog-button dialog-button-primary${
                            isDestructive ? " dialog-button-destructive" : ""
                        }`}
                        onClick={onConfirm}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
