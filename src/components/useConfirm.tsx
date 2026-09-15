/**
 * Asking the user to confirm something, from ordinary async code.
 *
 * `window.confirm` is a function call that returns a boolean, which is
 * why it was convenient — but it is also unstyled, blocking, and
 * untestable without stubbing a global. A React modal cannot return a
 * boolean, so this bridges the two: `confirm()` returns a promise that
 * settles when the user answers, leaving the calling code shaped
 * exactly as it was.
 */

import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

/** What to ask, and how to label the answer. */
export interface ConfirmRequest {
    readonly title: string;
    readonly message: string;
    readonly confirmLabel: string;
    /** Styles the confirming button as destructive. */
    readonly isDestructive?: boolean;
}

/** A confirmation prompt and the element that renders it. */
export interface Confirmation {
    /** Asks the user; resolves true when they confirm. */
    readonly confirm: (request: ConfirmRequest) => Promise<boolean>;
    /** Render this somewhere in the tree, or nothing is ever shown. */
    readonly dialog: ReactNode;
}

/**
 * Provides a promise-based confirmation prompt.
 *
 * @returns The `confirm` function and the dialog element to render.
 */
export function useConfirm(): Confirmation {
    const [request, setRequest] = useState<ConfirmRequest | null>(null);

    // The pending promise's resolver. A ref because settling it is not
    // a render input, and because a second prompt must be able to find
    // the first one's resolver to decline it.
    const resolveRef = useRef<((confirmed: boolean) => void) | null>(null);

    const settle = useCallback((confirmed: boolean): void => {
        const resolve = resolveRef.current;
        resolveRef.current = null;
        setRequest(null);
        resolve?.(confirmed);
    }, []);

    const confirm = useCallback((next: ConfirmRequest): Promise<boolean> => {
        // A prompt arriving while one is open declines the old one
        // rather than abandoning its promise unsettled, which would
        // leave the earlier caller awaiting forever.
        resolveRef.current?.(false);

        return new Promise<boolean>((resolve) => {
            resolveRef.current = resolve;
            setRequest(next);
        });
    }, []);

    const dialog = request ? (
        <ConfirmDialog
            title={request.title}
            message={request.message}
            confirmLabel={request.confirmLabel}
            isDestructive={request.isDestructive ?? false}
            onConfirm={() => {
                settle(true);
            }}
            onCancel={() => {
                settle(false);
            }}
        />
    ) : null;

    return { confirm, dialog };
}
