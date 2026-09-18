/**
 * Structural checks on the CI workflows.
 *
 * Workflow files are code that only ever runs on someone else's
 * machine, and their failure mode is quiet: a malformed `needs`, a job
 * renamed but not updated, a trigger that stops matching, and the
 * pipeline simply does less than it looks like it does. GitHub reports
 * a syntax error, but it will happily run a workflow whose gating is
 * wrong.
 *
 * These are deliberately about *wiring*, not about what each step does.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/** Resolved from the working directory; see `themePalette.test.ts`. */
const WORKFLOWS = join(process.cwd(), ".github", "workflows");

/** The permissions a job or workflow asks for. */
type Permissions = Record<string, string> | string | null | undefined;

/** One job as declared in a workflow. */
interface WorkflowJob {
    readonly needs?: string | readonly string[];
    readonly uses?: string;
    readonly if?: string;
    readonly "runs-on"?: unknown;
    readonly permissions?: Permissions;
}

/** A parsed workflow file. */
interface Workflow {
    readonly name?: string;
    readonly on?: Record<string, unknown>;
    readonly permissions?: Permissions;
    readonly jobs: Record<string, WorkflowJob>;
}

/**
 * Parses one workflow.
 *
 * @param file - File name inside `.github/workflows`.
 * @returns The parsed workflow.
 */
function readWorkflow(file: string): Workflow {
    return parse(readFileSync(join(WORKFLOWS, file), "utf8")) as Workflow;
}

/** Every workflow file in the repository. */
const files = readdirSync(WORKFLOWS).filter((file) => file.endsWith(".yml"));

/**
 * A job's dependencies as a list, however they were written.
 *
 * @param job - The job to read.
 * @returns Its dependency job ids.
 */
function needsOf(job: WorkflowJob): readonly string[] {
    if (job.needs === undefined) return [];

    return typeof job.needs === "string" ? [job.needs] : job.needs;
}

describe("workflows", () => {
    it("are all present", () => {
        expect(files).toEqual(
            expect.arrayContaining(["frontend.yml", "release.yml", "review.yml", "rust.yml"]),
        );
    });

    it.each(files)("%s parses and declares jobs", (file) => {
        const workflow = readWorkflow(file);

        expect(workflow.jobs).toBeTypeOf("object");
        expect(Object.keys(workflow.jobs).length).toBeGreaterThan(0);
    });

    it.each(files)("%s only depends on jobs that exist", (file) => {
        // A `needs` naming a job that was renamed does not fail the
        // workflow — it makes the depending job never run.
        const workflow = readWorkflow(file);
        const ids = Object.keys(workflow.jobs);

        for (const [id, job] of Object.entries(workflow.jobs)) {
            for (const dependency of needsOf(job)) {
                expect(ids, `${file}: job "${id}" needs "${dependency}"`).toContain(dependency);
            }
        }
    });

    it.each(files)("%s runs on both default branch names", (file) => {
        // The repository's default branch is `main`, but `master` is
        // configured too so a rename does not silently stop CI.
        const workflow = readWorkflow(file);
        const push = workflow.on?.push as { branches?: string[] } | undefined;

        if (!push) return;

        expect(push.branches).toContain("main");
        expect(push.branches).toContain("master");
    });
});

describe("the release workflow", () => {
    const release = readWorkflow("release.yml");

    it("gates every build on the checks passing", () => {
        // Releasing from code that would not have been merged is the
        // one thing this pipeline must never do.
        const draft = release.jobs.draft;

        expect(needsOf(draft ?? {})).toContain("checks");
        expect(needsOf(draft ?? {})).toContain("rust");
    });

    it("reuses the pull-request checks rather than copying them", () => {
        expect(release.jobs.checks?.uses).toBe("./.github/workflows/frontend.yml");
    });

    it("publishes only after every platform has built", () => {
        expect(needsOf(release.jobs.publish ?? {})).toContain("build");
    });

    it("decides whether to release before doing any work", () => {
        // The cheap gate: a commit that does not bump the version must
        // not spin up four platform builders to discover that.
        for (const id of ["checks", "rust"]) {
            expect(release.jobs[id]?.needs, id).toContain("version");
            expect(release.jobs[id]?.if).toContain("should-release");
        }
    });

    it("builds for Windows, macOS and Linux", () => {
        const source = readFileSync(join(WORKFLOWS, "release.yml"), "utf8");

        expect(source).toContain("windows-latest");
        expect(source).toContain("macos-latest");
        expect(source).toContain("ubuntu-22.04");
    });
});

describe("the frontend workflow", () => {
    it("can be called by the release workflow", () => {
        // Without `workflow_call` the release's `checks` job cannot
        // reference it, and the release would run ungated.
        const frontend = readWorkflow("frontend.yml");

        expect(frontend.on).toHaveProperty("workflow_call");
    });
});

describe("the Tectonic sidecar", () => {
    /** One step of a job, as far as this cares. */
    interface Step {
        readonly run?: string;
        readonly uses?: string;
    }

    /**
     * Every job in a workflow that has inline steps.
     *
     * @param file - The workflow file name.
     * @returns Each job id with its steps.
     */
    function jobsWithSteps(file: string): readonly [string, readonly Step[]][] {
        const workflow = readWorkflow(file) as Workflow & {
            jobs: Record<string, { steps?: readonly Step[] }>;
        };

        return Object.entries(workflow.jobs)
            .filter(([, job]) => Array.isArray(job.steps))
            .map(([id, job]) => [id, job.steps ?? []]);
    }

    it.each(files)("%s fetches it before anything that builds Rust", (file) => {
        // `externalBin` makes the sidecar a *build* requirement, not
        // just a bundling one: tauri-build stops with "resource path
        // binaries/tectonic-… doesn't exist" before a single test runs.
        //
        // Missed once already — the fetch was added to `rust.yml` and
        // to the release's `build` job, but not to the release's own
        // `rust` job, which would have failed the first release.
        for (const [id, steps] of jobsWithSteps(file)) {
            const buildsRust = steps.findIndex((step) =>
                /\bcargo\s+(build|test)\b/.test(step.run ?? ""),
            );
            if (buildsRust === -1) continue;

            const fetches = steps.findIndex((step) =>
                (step.run ?? "").includes("tectonic:fetch"),
            );

            expect(
                fetches,
                `${file}: job "${id}" runs cargo without fetching the Tectonic sidecar first`,
            ).not.toBe(-1);
            expect(
                fetches,
                `${file}: job "${id}" fetches the sidecar after it builds, which is too late`,
            ).toBeLessThan(buildsRust);
        }
    });

    it("is fetched for the matrix target, not the host, when releasing", () => {
        // The macOS jobs cross-compile: the Intel build runs on an
        // Apple Silicon runner and needs the *Intel* engine bundled.
        const source = readFileSync(join(WORKFLOWS, "release.yml"), "utf8");

        expect(source).toContain("tectonic:fetch -- --target ${{ matrix.sidecar }}");
    });
});

describe("reusable workflow permissions", () => {
    /**
     * Every job a workflow calls into, following local `uses:` links.
     *
     * @param file - The calling workflow's file name.
     * @returns The called workflow's file and each of its jobs.
     */
    function calledJobs(
        file: string,
    ): readonly { readonly called: string; readonly id: string; readonly job: WorkflowJob }[] {
        const workflow = readWorkflow(file);
        const results: { called: string; id: string; job: WorkflowJob }[] = [];

        for (const job of Object.values(workflow.jobs)) {
            const local = job.uses?.match(/^\.\/\.github\/workflows\/(.+)$/)?.[1];
            if (local === undefined) continue;

            for (const [id, nested] of Object.entries(readWorkflow(local).jobs)) {
                results.push({ called: local, id, job: nested });
            }
        }

        return results;
    }

    it.each(files)("%s calls nothing that needs more permission than it has", (file) => {
        // This is the check that was missing when a release run failed
        // with "The nested job 'reviewdog' is requesting
        // 'pull-requests: write', but is only allowed
        // 'pull-requests: none'." — the whole workflow refused to start
        // and produced zero jobs.
        //
        // GitHub validates this when it *loads* the file, before any
        // `if:` is evaluated, so guarding the job on `pull_request` did
        // not help. Nothing in the repo caught it because these tests
        // only checked wiring.
        const caller = readWorkflow(file);
        const granted = caller.permissions;

        for (const { called, id, job } of calledJobs(file)) {
            const wanted = job.permissions;
            if (wanted === undefined || wanted === null) continue;

            const scopes = typeof wanted === "string" ? {} : wanted;

            for (const [scope, level] of Object.entries(scopes)) {
                if (level === "none" || level === "read") continue;

                const allowed =
                    typeof granted === "object" && granted !== null
                        ? granted[scope]
                        : undefined;

                expect(
                    allowed,
                    `${file} calls ${called}, whose job "${id}" wants "${scope}: ${level}" — ` +
                        `grant it at the top of ${file}, or move that job out of the ` +
                        `reusable workflow`,
                ).toBe(level);
            }
        }
    });

    it("keeps the pull-request reviewer out of the reusable workflow", () => {
        // Where it must not go back to. `frontend.yml` is called by the
        // release pipeline, which has no business writing to pull
        // requests.
        const frontend = readWorkflow("frontend.yml");

        for (const [id, job] of Object.entries(frontend.jobs)) {
            const permissions = job.permissions;
            // A bare `permissions:` key parses to null, and `typeof null`
            // is "object", so the null check is not redundant.
            const scopes =
                typeof permissions === "object" && permissions !== null ? permissions : {};

            expect(Object.entries(scopes).filter(([, level]) => level === "write")).toEqual([]);
            expect(id).not.toBe("reviewdog");
        }
    });
});
