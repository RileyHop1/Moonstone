/**
 * ESLint configuration.
 *
 * Type-aware linting is on for `src/` because most of the rules worth
 * having here — floating promises, unnecessary conditions, unsafe
 * assignments — need the type checker to say anything useful. The
 * config files at the repo root are linted without type information,
 * since `tsconfig.json` deliberately only includes `src`.
 */

import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: ["dist/**", "src-tauri/**", "playwright-report/**", "test-results/**"],
    },

    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,

    {
        files: ["src/**/*.{ts,tsx}"],
        languageOptions: {
            ecmaVersion: 2022,
            globals: globals.browser,
            parserOptions: {
                project: ["./tsconfig.json"],
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: {
            "react-hooks": reactHooks,
            "react-refresh": reactRefresh,
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
            "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

            // CLAUDE.md section 16: prefer `const` objects over enums, and
            // keep type-only imports explicit so bundlers can drop them.
            "@typescript-eslint/consistent-type-imports": [
                "error",
                { prefer: "type-imports", fixStyle: "separate-type-imports" },
            ],

            // CLAUDE.md section 14: structured logging, not console noise.
            // `console.error` stays allowed for genuine failures.
            "no-console": ["error", { allow: ["error", "warn"] }],

            // JSX event handlers are written as `onClick={() => setOpen(false)}`
            // throughout. Requiring a braced body on every one of them adds
            // two lines of noise per handler and catches nothing.
            "@typescript-eslint/no-confusing-void-expression": [
                "error",
                { ignoreArrowShorthand: true },
            ],

            // Interpolating a number into a string is deliberate and safe
            // (`${width}px`); the rule still catches nullable interpolation,
            // which is the case that actually produces "undefined" on screen.
            "@typescript-eslint/restrict-template-expressions": [
                "error",
                { allowNumber: true },
            ],
            // The codebase leans on interface merging in a few places and
            // uses `readonly` arrays heavily; these two fight that style
            // without catching real defects.
            "@typescript-eslint/no-invalid-void-type": "off",
            "@typescript-eslint/consistent-indexed-object-style": "off",
        },
    },

    // Tests reach into implementation details and build deliberately
    // malformed values to check the guards, so the strictest rules would
    // only be suppressed line by line.
    {
        files: ["src/test/**/*.{ts,tsx}"],
        rules: {
            "@typescript-eslint/no-unsafe-assignment": "off",
            "@typescript-eslint/no-unsafe-member-access": "off",
            "@typescript-eslint/no-unsafe-argument": "off",
            "@typescript-eslint/no-non-null-assertion": "off",
            "no-console": "off",

            // Inert stubs are the point: `src/test/setup.ts` installs a
            // do-nothing ResizeObserver because jsdom has no layout, and
            // several suites pass no-op callbacks where the component
            // requires one but the test does not care.
            "@typescript-eslint/no-empty-function": "off",

            // `mockTauri` rejects with a bare string on purpose: that is
            // what Rust's `Err(String)` looks like once it crosses the
            // Tauri bridge, and mocking it as an Error would test a shape
            // the real backend never produces.
            "@typescript-eslint/prefer-promise-reject-errors": "off",
            "@typescript-eslint/only-throw-error": "off",
            "@typescript-eslint/require-await": "off",
            "@typescript-eslint/no-redundant-type-constituents": "off",
        },
    },

    // Playwright specs run their assertions inside `page.evaluate`, which
    // is serialised into the browser — it cannot see module-scope imports,
    // so inline `import()` types are the only way to type those closures.
    {
        files: ["src/test/browser/**/*.{ts,tsx}"],
        rules: {
            "@typescript-eslint/consistent-type-imports": "off",
        },
    },

    // Root config files: no type information available.
    {
        files: ["*.{js,ts}"],
        extends: [tseslint.configs.disableTypeChecked],
        languageOptions: {
            globals: globals.node,
        },
    },
);
