# Apex Arena Assets

Apex Arena's static web assets and downloadable content repository. It contains the page markup, styles, scripts, images, fonts, maps, logos, icons, and profile-picture bundle used by the game.

## Repository layout

- `assets/` - Images, fonts, maps, logos, icons, and bundled profile pictures
- `html/pages/` - Page markup
- `css/pages/` - Page styles
- `js/pages/` - Page scripts
- `js/data/` - Shared data modules
- `manifest.json` - Generated hashes and sizes used to identify and download content
- `manifest.config.json` - Classifies JavaScript and HTML entries for the game client
- `generate-manifest.js` - Generates `manifest.json`

## Updating assets

1. Add or modify files under `assets/`, `html/`, `css/`, or `js/`.
2. If you add JavaScript or HTML, add the relative path and its kind to `manifest.config.json`.
3. Regenerate the manifest:

   ```bash
   node generate-manifest.js
   ```

4. Commit the changed content together with `manifest.json`.

ZIP files under `assets/` are represented as bundles in the manifest. Loose files are listed individually.

## License

See [LICENCE](LICENCE). The project and its source code are copyrighted and all rights reserved; permission is required to reproduce or modify it.
