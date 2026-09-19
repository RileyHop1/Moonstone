/**
 * Tests for the compile loop's scheduling: one compile at a time, one
 * catch-up compile for everything asked for meanwhile, and saves in a
 * burst collapsing into one compile.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { COMPILE_ON_SAVE_DELAY_MS, useCompileLoop } from "../views/ProjectPage/useCompileLoop";

/**
 * A compile that finishes only when the test says so.
 *
 * @returns The compile function, how often it ran, and a finisher.
 */
function controllableCompile() {
    const finishers: (() => void)[] = [];
    const compile = vi.fn(
        () =>
            new Promise<void>((resolve) => {
                finishers.push(resolve);
            }),
    );

    /** Finishes the oldest running compile and lets the loop react. */
    const finish = async (): Promise<void> => {
        await act(async () => {
            finishers.shift()?.();
            await Promise.resolve();
        });
    };

    return { compile, finish };
}

describe("useCompileLoop", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("runs one catch-up compile for every request made mid-compile", async () => {
        const { compile, finish } = controllableCompile();
        const { result } = renderHook(() => useCompileLoop(compile));

        act(() => result.current.compileNow());
        act(() => {
            result.current.compileNow();
            result.current.compileNow();
        });

        expect(compile).toHaveBeenCalledTimes(1);
        expect(result.current.isCompiling).toBe(true);

        await finish();
        expect(compile).toHaveBeenCalledTimes(2);

        await finish();
        expect(compile).toHaveBeenCalledTimes(2);
        expect(result.current.isCompiling).toBe(false);
    });

    it("collapses a burst of saves into one compile", async () => {
        const { compile, finish } = controllableCompile();
        const { result } = renderHook(() => useCompileLoop(compile));

        act(() => {
            result.current.compileSoon();
            vi.advanceTimersByTime(COMPILE_ON_SAVE_DELAY_MS - 1);
            result.current.compileSoon();
            vi.advanceTimersByTime(COMPILE_ON_SAVE_DELAY_MS - 1);
        });
        expect(compile).not.toHaveBeenCalled();

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(compile).toHaveBeenCalledTimes(1);
        await finish();
    });

    it("does not fire a pending compile after unmounting", () => {
        const { compile } = controllableCompile();
        const { result, unmount } = renderHook(() => useCompileLoop(compile));

        act(() => result.current.compileSoon());
        unmount();
        vi.advanceTimersByTime(COMPILE_ON_SAVE_DELAY_MS);

        expect(compile).not.toHaveBeenCalled();
    });

    it("recovers from a compile that throws", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const compile = vi.fn(() => Promise.reject(new Error("boom")));
        const { result } = renderHook(() => useCompileLoop(compile));

        await act(async () => {
            result.current.compileNow();
            await Promise.resolve();
        });

        expect(result.current.isCompiling).toBe(false);
        act(() => result.current.compileNow());
        expect(compile).toHaveBeenCalledTimes(2);
    });
});
