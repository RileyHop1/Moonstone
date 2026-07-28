/**
 * Tests for the macro scanner.
 *
 * Real preambles are the target here: the cases come from an arXiv
 * paper whose macros rendered as red error text before this existed.
 */

import { describe, expect, it } from "vitest";
import { findMacros } from "../views/editor/TextEditor/LivePreview/findMacros";

describe("findMacros", () => {
    it("reads a simple definition", () => {
        expect(findMacros(String.raw`\newcommand{\dmodel}{d_{\text{model}}}`)).toEqual({
            "\\dmodel": String.raw`d_{\text{model}}`,
        });
    });

    it("reads the unbraced name form", () => {
        // `\newcommand\foo{...}` is as ordinary as the braced form.
        expect(findMacros(String.raw`\newcommand\kq{q}`)).toEqual({ "\\kq": "q" });
    });

    it("keeps parameters, which KaTeX understands", () => {
        expect(findMacros(String.raw`\newcommand{\mc}[1]{\mathcal{#1}}`)).toEqual({
            "\\mc": String.raw`\mathcal{#1}`,
        });
    });

    it("skips a default value for an optional parameter", () => {
        const source = String.raw`\newcommand*\samethanks[1][\value{footnote}]{\footnotemark[#1]}`;

        expect(findMacros(source)).toEqual({ "\\samethanks": String.raw`\footnotemark[#1]` });
    });

    it("matches nested braces in the body", () => {
        const source = String.raw`\newcommand{\mbf}[1]{\mathbf{\textrm{#1}}}`;

        expect(findMacros(source)).toEqual({ "\\mbf": String.raw`\mathbf{\textrm{#1}}` });
    });

    it("lets a later definition win", () => {
        const source = [
            String.raw`\newcommand{\vec}{first}`,
            String.raw`\renewcommand{\vec}{second}`,
        ].join("\n");

        expect(findMacros(source)).toEqual({ "\\vec": "second" });
    });

    it("turns a declared operator into \\operatorname", () => {
        const source = String.raw`\DeclareMathOperator{\argmax}{arg\,max}`;

        expect(findMacros(source)).toEqual({ "\\argmax": String.raw`\operatorname{arg\,max}` });
    });

    it("keeps the star on a starred operator", () => {
        const source = String.raw`\DeclareMathOperator*{\argmin}{arg\,min}`;

        expect(findMacros(source)).toEqual({ "\\argmin": String.raw`\operatorname*{arg\,min}` });
    });

    it("does not mistake \\renewcommand for \\newcommand", () => {
        // The names overlap, so a careless pattern reads the wrong one.
        expect(findMacros(String.raw`\renewcommand{\a}{x}`)).toEqual({ "\\a": "x" });
    });

    it("collects several definitions from one preamble", () => {
        const source = [
            String.raw`\documentclass{article}`,
            String.raw`\newcommand{\dmodel}{d_{\text{model}}}`,
            String.raw`\newcommand{\dff}{d_{\text{ff}}}`,
            String.raw`\newcommand\mc[1]{\mathcal{#1}}`,
            String.raw`\begin{document}`,
        ].join("\n");

        expect(Object.keys(findMacros(source)).sort()).toEqual(["\\dff", "\\dmodel", "\\mc"]);
    });

    it("ignores a definition whose body never closes", () => {
        // Malformed input degrades to "no macro", matching the rest of
        // the preview: a half-read body would render as nonsense.
        expect(findMacros(String.raw`\newcommand{\broken}{oops`)).toEqual({});
    });

    it("ignores something that only looks like a definition", () => {
        expect(findMacros(String.raw`\newcommandish{\x}{y}`)).toEqual({});
        expect(findMacros(String.raw`\newcommand`)).toEqual({});
    });

    it("finds nothing in a document that defines nothing", () => {
        expect(findMacros("Just prose with $x^2$ in it.")).toEqual({});
    });
});
