# Security Policy

## Supported versions

Spotispy is a local-only tool that runs inside your own Spotify client. Only the
latest state of the `main` branch is supported.

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Report suspected vulnerabilities privately through GitHub's **Security advisories**
("Report a vulnerability" on the repository's Security tab), or by contacting a
maintainer directly. Include:

- a description of the issue and its impact,
- steps to reproduce (a minimal reproduction is ideal),
- the affected file(s) and version/commit.

You can expect an initial response within a few days. Please give us a reasonable
window to address the issue before any public disclosure.

## Scope notes

- Spotispy is **local-only**: it stores data in your browser's IndexedDB and
  `LocalStorage`, and makes no third-party network requests. It never follows,
  unfollows, or plays anything on your behalf, and observes only what your
  account can already see.
- Reports about the Spotify client itself, Spicetify, or third-party services are
  out of scope; report those to their respective projects.
- The install scripts (`tools/install.ps1`, `tools/uninstall.ps1`) modify your
  local Spotify configuration. Reports about those are in scope.