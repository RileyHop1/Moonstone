/**
 * Downloads the Tectonic CLI that ships with Moonstone as a Tauri
 * sidecar.
 *
 * Tectonic is the TeX engine. It is shipped as a prebuilt binary rather
 * than linked as a crate because the `tectonic` crate needs five system
 * C libraries via `pkg-config`, which the release matrix cannot supply
 * on every target — see `docs/pdf-compilation.md` for the evidence.
 *
 * The binaries are **not committed**: 20 MB each, one per platform, and
 * reproducible from an upstream release. This script fetches the one
 * the current host needs, or an explicit target for a cross build.
 *
 * Usage:
 *   npm run tectonic:fetch
 *   npm run tectonic:fetch -- --target x86_64-apple-darwin
 *   npm run tectonic:fetch -- --force
 */

import { createWriteStream } from "node:fs";
import { chmod, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

/** Pinned so a Tectonic release cannot change the engine under a build. */
const VERSION = "0.17.0";

/** Where Tauri's `externalBin` expects to find the sidecar. */
const BIN_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "binaries");

/**
 * Upstream's asset name per Rust target triple.
 *
 * Only the four targets `release.yml` builds are listed. An unlisted
 * target is a deliberate failure rather than a guess, because guessing
 * wrong yields a binary that cannot run and a confusing error much
 * later.
 */
const ASSETS = {
    "x86_64-pc-windows-msvc": `tectonic-${VERSION}-x86_64-pc-windows-msvc.zip`,
    "aarch64-apple-darwin": `tectonic-${VERSION}-aarch64-apple-darwin.tar.gz`,
    "x86_64-apple-darwin": `tectonic-${VERSION}-x86_64-apple-darwin.tar.gz`,
    "x86_64-unknown-linux-gnu": `tectonic-${VERSION}-x86_64-unknown-linux-gnu.tar.gz`,
};

/**
 * The Rust target triple this machine builds for by default.
 *
 * Read from `rustc` rather than mapped from `process.platform`, because
 * `rustc` is the thing whose answer Tauri's sidecar naming has to
 * match.
 *
 * @returns The host target triple.
 */
function hostTarget() {
    const output = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
    const host = /^host:\s*(.+)$/m.exec(output)?.[1]?.trim();

    if (!host) throw new Error("Could not read the host target from `rustc -vV`");

    return host;
}

/**
 * Reads the `--target` and `--force` arguments.
 *
 * @returns The chosen target and whether to re-download.
 */
function readArguments() {
    const args = process.argv.slice(2);
    const targetIndex = args.indexOf("--target");

    return {
        target: targetIndex === -1 ? hostTarget() : args[targetIndex + 1],
        force: args.includes("--force"),
    };
}

/**
 * Downloads a URL to a file, following redirects.
 *
 * @param url - What to fetch.
 * @param destination - Where to write it.
 */
async function download(url, destination) {
    const response = await fetch(url, { redirect: "follow" });

    if (!response.ok || !response.body) {
        throw new Error(`Could not download ${url}: HTTP ${response.status}`);
    }

    await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

/**
 * The `tar` to unpack with.
 *
 * On Windows this is deliberately the absolute path to the system's
 * own **bsdtar**, not whatever `tar` is on PATH. A Git Bash shell puts
 * GNU tar ahead of it, and GNU tar cannot read a zip archive at all —
 * which is the only format upstream publishes for Windows. Elsewhere
 * the archives are `.tar.gz`, which every `tar` handles.
 *
 * @returns The executable to run.
 */
function tarCommand() {
    if (process.platform !== "win32") return "tar";

    return join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
}

/**
 * Unpacks the downloaded archive into a directory.
 *
 * The archive is named **relative to `cwd`** rather than passed as an
 * absolute path, because GNU tar reads `C:\…` as a remote `host:path`
 * and tries to open a network connection. Keeping colons out of the
 * argument sidesteps that without a GNU-only `--force-local` flag that
 * bsdtar would reject.
 *
 * @param archiveName - The archive's file name, inside `into`.
 * @param into - Directory holding the archive and receiving its
 *   contents.
 */
function unpack(archiveName, into) {
    execFileSync(tarCommand(), ["-xf", archiveName], { cwd: into, stdio: "inherit" });
}

/**
 * Finds the `tectonic` executable inside an unpacked archive.
 *
 * Upstream has not always put it at the same depth, so this looks
 * rather than assumes.
 *
 * @param root - The unpacked directory.
 * @returns Path to the executable.
 */
async function findExecutable(root) {
    const entries = await readdir(root, { withFileTypes: true, recursive: true });
    const match = entries.find(
        (entry) =>
            entry.isFile() && (entry.name === "tectonic" || entry.name === "tectonic.exe"),
    );

    if (!match) throw new Error(`No tectonic executable found in ${root}`);

    return join(match.parentPath ?? match.path ?? root, match.name);
}

/**
 * Fetches the sidecar for one target, unless it is already there.
 */
async function main() {
    const { target, force } = readArguments();
    const asset = ASSETS[target];

    if (!asset) {
        throw new Error(
            `No Tectonic build is mapped for ${target}. ` +
                `Known targets: ${Object.keys(ASSETS).join(", ")}`,
        );
    }

    const suffix = target.includes("windows") ? ".exe" : "";
    const finalPath = join(BIN_DIR, `tectonic-${target}${suffix}`);

    if (!force) {
        const existing = await stat(finalPath).catch(() => null);
        if (existing) {
            console.log(`Tectonic ${VERSION} already present at ${finalPath}`);
            return;
        }
    }

    await mkdir(BIN_DIR, { recursive: true });

    const work = join(BIN_DIR, `.fetch-${target}`);
    await rm(work, { recursive: true, force: true });
    await mkdir(work, { recursive: true });

    const archive = join(work, asset);
    const url =
        `https://github.com/tectonic-typesetting/tectonic/releases/download/` +
        `tectonic%40${VERSION}/${asset}`;

    console.log(`Downloading Tectonic ${VERSION} for ${target}…`);
    await download(url, archive);

    unpack(asset, work);

    const executable = await findExecutable(work);
    await rename(executable, finalPath);
    // tar preserves the mode, but a rename across a fresh directory on
    // some filesystems does not; setting it is cheap insurance.
    if (!suffix) await chmod(finalPath, 0o755);

    await rm(work, { recursive: true, force: true });

    console.log(`Tectonic ${VERSION} ready at ${finalPath}`);
}

await main();
