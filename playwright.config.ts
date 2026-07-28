/**
 * Playwright configuration for Moonstone's browser tests.
 *
 * These cover what jsdom cannot: real layout, pointer geometry and key
 * handling. They run against the Vite dev server — the frontend only,
 * with no Tauri backend — so they are kept out of `npm test` and run
 * with `npm run test:browser` instead.
 */

import { defineConfig, devices } from "@playwright/test";

/** The port `vite.config.ts` pins with `strictPort`. */
const DEV_SERVER_PORT = 1420;

const baseURL = `http://localhost:${DEV_SERVER_PORT}`;

export default defineConfig({
    testDir: "./src/test/browser",
    // Browser specs are named `*.browser.spec.ts` so the vitest suites
    // in `src/test` and these never pick each other up.
    testMatch: /.*\.browser\.spec\.ts/,
    fullyParallel: true,
    // A failing assertion here usually means a real geometry bug, not
    // flake, so retries would only hide it.
    retries: 0,
    reporter: process.env.CI ? "github" : "list",

    use: {
        baseURL,
        // Kept on failure only: traces are large and these run often.
        trace: "retain-on-failure",
    },

    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],

    webServer: {
        command: "npm run dev",
        url: baseURL,
        // Reuse a server already running locally; CI always starts fresh.
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
});
