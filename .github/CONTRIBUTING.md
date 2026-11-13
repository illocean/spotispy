# Contributing to Spotispy

Thanks for your interest in improving Spotispy. This project is a local-only
Spicetify extension and custom app; the notes below explain how to propose a
change and what is expected of a pull request.

## Before you start

- Read [AGENTS.md](../AGENTS.md) for the architecture map and the invariants that
  any change must respect. In particular:
  - `sources.js` is the single place endpoints are defined.
  - `boot.js` is the one scheduler singleton (both the extension and the app call
    into it).
  - `index.js` exports the `FILES` list; `tools/build.js` derives both bundles
    from it. Add new source files there.
  - The IndexedDB store is named `playlist-watchtower`; rename it would orphan
    existing user data. Migrate, do not rename.
  - UI uses `h`/`createElement`, not a JSX toolchain.
  - No third-party network calls; the app is local-only.
- Open an issue first for anything larger than a bug fix, so the approach can be
  discussed before you write code.

## Development setup

Requires Node.js 20 or newer.

```powershell
npm install      # once: jsdom + fake-indexeddb + react for the UI suite
npm test         # unit suite
npm run test:ui  # UI suite in jsdom
npm run test:all # both
npm run build    # writes dist/ (never touches the live install)
```

`dist/` is gitignored build output. Never edit it by hand, and never commit it.

## Making a change

1. Create a branch off `main`.
2. Keep the change focused; one logical change per pull request.
3. Add or update tests that would fail without your change. The unit suite covers
   pure modules and view models; the UI suite renders every route in jsdom against
   a synthetic Spotify fixture (`tests/support/harness.js` is the sanctioned way to
   boot the app in Node — reuse it rather than hand-rolling a jsdom setup).
4. Run `npm run test:all` and `npm run build` before opening the pull request.
5. Write a clear PR description: the problem, the cause, the fix, and how it was
   validated. Do not use emojis in code, commit messages, or docs.

## Code style

- CommonJS (`"type": "commonjs"`); plain `"use strict"` modules, no ESM/TypeScript
  in `src/`.
- Match the existing flat, Spicetify-native dark design language: one near-black
  surface, 1px hairline borders, a single green accent (`--spice-button`), no
  gradients or glows. Details live in `src/pwt/ui/style.css`.
- Keep error handling honest: never fabricate a status, a date, or a number the
  underlying source did not supply (see "Hard constraints" in the README).

## Reporting bugs

Open a GitHub issue with the [bug report template](ISSUE_TEMPLATE/bug_report.md).
Include the diagnostics dump from Settings (Diagnostics) if the problem is
runtime-related: it is the fastest way to see what actually happened.

By contributing you agree that your contributions are licensed under the
[MIT License](../LICENSE).