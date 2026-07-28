/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

/**
 * Resolves a path relative to this config file.
 *
 * @param relativePath - Path relative to the project root.
 * @returns The absolute path.
 */
const fromRoot = (relativePath: string): string =>
  fileURLToPath(new URL(relativePath, import.meta.url));

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  resolve: {
    // `dictionary-en`'s entry point reads its data with node:fs, which
    // cannot run in a webview, and its `exports` field blocks importing
    // the data files directly. Alias them so the spell checker can pull
    // them in with Vite's `?raw`, keeping npm as the source of truth
    // for dictionary updates.
    //
    // Regex finds, not string keys: a string alias only prefix-matches
    // on a `/` boundary, so it would never match the `?raw` suffix.
    alias: [
      // Unanchored at the end so the `?raw` suffix survives the
      // replacement and Vite still inlines the file as a string.
      {
        find: /^dictionary-en\/aff/,
        replacement: fromRoot("node_modules/dictionary-en/index.aff"),
      },
      {
        find: /^dictionary-en\/dic/,
        replacement: fromRoot("node_modules/dictionary-en/index.dic"),
      },
    ],
  },

  // Vitest configuration; suites live in src/test/.
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: false,
    // The Playwright specs in src/test/browser need a real browser and
    // would fail under jsdom. They run via `npm run test:browser`.
    exclude: ["**/node_modules/**", "**/dist/**", "src/test/browser/**"],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
