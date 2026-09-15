/**
 * Sets the app's version in all three places that declare it.
 *
 * Releasing is triggered by the version in `package.json` reaching the
 * default branch, but `tauri.conf.json` and `Cargo.toml` carry it too —
 * they decide what the installer and the compiled binary report. Doing
 * it by hand means three edits and a test failure when one is missed,
 * so it is one command instead:
 *
 *     npm run version:set -- 0.2.0
 *
 * Nothing here touches git. Review the diff, commit, and the release
 * workflow does the rest when it lands on main.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** Semantic version, as the release tag expects it. */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Replaces exactly one match, failing loudly when the file has changed
 * shape rather than writing something unintended.
 *
 * @param {string} relativePath - File to rewrite, relative to the root.
 * @param {RegExp} pattern - Must match exactly once, with one group for
 *   the old version.
 * @param {(match: string, version: string) => string} replace - Builds
 *   the replacement line.
 * @param {string} version - The new version.
 */
function rewrite(relativePath, pattern, replace, version) {
    const path = join(ROOT, relativePath);
    const before = readFileSync(path, "utf8");

    const matches = before.match(new RegExp(pattern.source, pattern.flags + "g"));
    if (!matches || matches.length !== 1) {
        throw new Error(
            `Expected exactly one version line in ${relativePath}, found ${matches?.length ?? 0}.`,
        );
    }

    const after = before.replace(pattern, (match) => replace(match, version));
    writeFileSync(path, after);

    console.log(`  ${relativePath}`);
}

const version = process.argv[2];

if (!version) {
    console.error("Usage: npm run version:set -- <version>");
    process.exit(1);
}

if (!SEMVER.test(version)) {
    console.error(`"${version}" is not a semantic version (e.g. 1.2.3 or 1.2.3-beta.1).`);
    process.exit(1);
}

console.log(`Setting version to ${version}:`);

rewrite(
    "package.json",
    /"version": "[^"]+"/,
    (_match, next) => `"version": "${next}"`,
    version,
);

rewrite(
    "src-tauri/tauri.conf.json",
    /"version": "[^"]+"/,
    (_match, next) => `"version": "${next}"`,
    version,
);

// Anchored to the start of a line so a dependency's version cannot be
// rewritten by mistake; `[package]` declares its own first.
rewrite(
    "src-tauri/Cargo.toml",
    /^version = "[^"]+"$/m,
    (_match, next) => `version = "${next}"`,
    version,
);

console.log("\nCommit these, and the release workflow publishes when they reach main.");
