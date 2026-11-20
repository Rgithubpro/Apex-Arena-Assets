# Apex Arena Assets

Assets and downloadable content used by [Apex Arena](https://github.com/Rgithubpro/Apex-Arena).

This repository contains the project's static content, including images, fonts, maps, icons, profile-picture bundles, page markup, styles, scripts, and generated download manifests.

- **Main project:** https://github.com/Rgithubpro/Apex-Arena
- **Database server:** https://github.com/Rgithubpro/Apex-Arena-Database-Server
- **Authentication server:** https://github.com/Rgithubpro/Apex-Arena-Auth-Server

## Repository layout

- `assets/` — Images, fonts, maps, logos, icons, and asset bundles
- `html/pages/` — Page markup
- `css/pages/` — Page styles
- `js/pages/` — Page scripts
- `js/data/` — Shared data modules
- `manifest.json` — Generated content hashes and download sizes
- `manifest.config.json` — JavaScript and HTML manifest configuration
- `generate-manifest.js` — Manifest generator

## Updating assets

1. Add or modify files in `assets/`, `html/`, `css/`, or `js/`.
2. Add JavaScript or HTML entries to `manifest.config.json` when necessary.
3. Run `node generate-manifest.js`.
4. Commit the changed assets together with `manifest.json`.

## License

See [LICENCE](LICENCE). All rights reserved.