# Docs

Project assets and supporting documentation.

## Icons

All icons are hand-authored SVG in the app's flat, dark design language: a
near-black surface (`#121212` / `#0d0d0d`), a single green accent (`#1ed760`),
hairline borders, no gradients or glows. They render crisply at any size and
carry a `role="img"` plus `aria-label` for accessibility.

| File | Purpose | Size |
| --- | --- | --- |
| [`icon.svg`](icon.svg) | App icon (square). Use for the repo social preview, favicon, or a Spicetify card. | 128x128 |
| [`logo.svg`](logo.svg) | Horizontal wordmark (mark + "Spotispy"). Use in the README header or docs. | 320x64 |

To set the repository social preview image on GitHub: **Settings > General >
Social preview > Edit**, and upload a PNG exported from `icon.svg`
(GitHub does not accept SVG for the social preview).

## Design tokens (for reference)

Defined in `src/pwt/ui/style.css`:

| Token | Value | Use |
| --- | --- | --- |
| `--sp-bg` | `#121212` (Spotify `--spice-main`) | App surface |
| `--sp-bg-deep` | `#0d0d0d` | Deep surface / inset |
| `--sp-text` | `#ffffff` (Spotify `--spice-text`) | Primary text |
| `--sp-sub` | `#a7a7a7` (Spotify `--spice-subtext`) | Secondary text |
| `--sp-green` | `#1ed760` (Spotify `--spice-button`) | Accent, primary actions |
| `--sp-danger` | `#f15e6c` | Errors |
| `--sp-warning` | `#f5a623` | Degraded states |