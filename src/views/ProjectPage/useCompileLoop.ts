/**
 * Runs compiles one at a time, however often they are asked for.
 *
 * Compiling on save means requests arrive faster than compiles finish.
 * Running them side by side would have two engines writing the same
 * build directory; dropping the late ones would leave the PDF behind
 * the source. Instead a request made mid-compile is remembered, and one
 * more compile runs when the current one ends — however many requests
 * piled up, since they all want the same thing: the latest source.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** How long after a save the compile waits, so a burst builds once. */
export const COMPILE_ON_SAVE_DELAY_MS = 500;

/** The compile loop's state and controls. */
export interface CompileLoop {
    /** True while a compile is running. */
    readonly isCompiling: boolean;
    /** Compiles now, or straight after the compile already running. */
    readonly compileNow: () => void;
    /** Compiles once requests have stopped for a moment. */
    readonly compileSoon: () => void;
}

/**
 * Serialises and debounces compiles.
 *
 * @param compile - Runs one compile; always the latest one passed.
 * @returns The loop's state and controls.
 */
export function useCompileLoop(compile: () => Promise<void>): CompileLoop {
    const [isCompiling, setIsCompiling] = useState(false);
    const compileRef = useRef(compile);
    compileRef.current = compile;

    const isRunningRef = useRef(false);
    const isQueuedRef = useRef(false);
    const timerRef = useRef<number | null>(null);

    const clearTimer = useCallback((): void => {
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        timerRef.current = null;
    }, []);

    const compileNow = useCallback((): void => {
        clearTimer();

        if (isRunningRef.current) {
            isQueuedRef.current = true;
            return;
        }

        isRunningRef.current = true;
        setIsCompiling(true);

        void (async () => {
            try {
                do {
                    isQueuedRef.current = false;
                    await compileRef.current();
                    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- set by compileNow while the await above was pending, which ESLint's flow analysis does not follow
                } while (isQueuedRef.current);
            } catch (error: unknown) {
                console.error("Compile failed unexpectedly", { error });
            } finally {
                isRunningRef.current = false;
                setIsCompiling(false);
            }
        })();
    }, [clearTimer]);

    const compileSoon = useCallback((): void => {
        clearTimer();
        timerRef.current = window.setTimeout(compileNow, COMPILE_ON_SAVE_DELAY_MS);
    }, [clearTimer, compileNow]);

    // A pending compile must not fire into a project that has closed.
    useEffect(() => clearTimer, [clearTimer]);

    return useMemo(
        () => ({ isCompiling, compileNow, compileSoon }),
        [isCompiling, compileNow, compileSoon],
    );
}
