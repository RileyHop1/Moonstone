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

/** One job as declared in a workflow. */
interface WorkflowJob {
    readonly needs?: string | readonly string[];
    readonly uses?: string;
    readonly if?: string;
    readonly "runs-on"?: unknown;
}

/** A parsed workflow file. */
interface Workflow {
    readonly name?: string;
    readonly on?: Record<string, unknown>;
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
            expect.arrayContaining(["frontend.yml", "release.yml", "rust.yml"]),
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
