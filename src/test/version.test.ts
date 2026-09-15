/**
 * The app's version is written in three places, and they have to agree.
 *
 * `package.json` is what the release workflow reads to decide whether
 * there is a new version to publish; `tauri.conf.json` is what the
 * installer and the about box show; `Cargo.toml` is what the compiled
 * binary reports. Bumping one and forgetting the others produces a
 * release tagged one thing and installing as another — which is only
 * noticed after it has shipped.
 *
 * Checked here rather than only in CI so the mistake is caught by
 * `npm test` before the commit, not after the push.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Repository root.
 *
 * Resolved from the working directory rather than `import.meta.url`:
 * under vitest's jsdom environment that is not a file URL.
 */
const ROOT = process.cwd();

/** Semantic version, as the release tag expects it. */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Reads a file from the repository root.
 *
 * @param relativePath - Path relative to the root.
 * @returns The file's contents.
 */
function readRepoFile(relativePath: string): string {
    return readFileSync(join(ROOT, relativePath), "utf8");
}

/**
 * The version declared in `package.json`.
 *
 * @returns The version string.
 */
function packageVersion(): string {
    const parsed: unknown = JSON.parse(readRepoFile("package.json"));

    if (typeof parsed !== "object" || parsed === null) {
        throw new Error("package.json is not an object");
    }

    const version = (parsed as { version?: unknown }).version;
    if (typeof version !== "string") throw new Error("package.json has no version");

    return version;
}

/**
 * The version declared in `src-tauri/tauri.conf.json`.
 *
 * @returns The version string.
 */
function tauriConfigVersion(): string {
    const parsed: unknown = JSON.parse(readRepoFile("src-tauri/tauri.conf.json"));

    if (typeof parsed !== "object" || parsed === null) {
        throw new Error("tauri.conf.json is not an object");
    }

    const version = (parsed as { version?: unknown }).version;
    if (typeof version !== "string") throw new Error("tauri.conf.json has no version");

    return version;
}

/**
 * The version declared in `src-tauri/Cargo.toml`.
 *
 * Read with a regex rather than a TOML parser: the file is small, the
 * field is in the first table, and a parser would be a dependency
 * added for one line.
 *
 * @returns The version string.
 */
function cargoVersion(): string {
    const manifest = readRepoFile("src-tauri/Cargo.toml");

    // The first `version = "..."` after `[package]`, so a dependency's
    // version cannot be picked up by mistake.
    const packageTable = manifest.split(/^\[/m).find((table) => table.startsWith("package]"));
    if (packageTable === undefined) throw new Error("Cargo.toml has no [package] table");

    const match = /^version\s*=\s*"([^"]+)"/m.exec(packageTable);
    if (!match?.[1]) throw new Error("Cargo.toml has no package version");

    return match[1];
}

describe("app version", () => {
    it("is the same in package.json, tauri.conf.json and Cargo.toml", () => {
        // A mismatch ships an installer whose version disagrees with the
        // release tag and with what the binary reports.
        expect({
            tauriConfig: tauriConfigVersion(),
            cargo: cargoVersion(),
        }).toEqual({
            tauriConfig: packageVersion(),
            cargo: packageVersion(),
        });
    });

    it("is a plain semantic version", () => {
        // The release workflow tags `v<version>`, so anything the tag
        // format cannot express would produce a tag nobody expects.
        expect(packageVersion()).toMatch(SEMVER);
    });
});
