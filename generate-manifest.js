#!/usr/bin/env node
/**
 * Apex Arena — Manifest Generator
 * ---------------------------------
 * Run this locally, from inside your `apex-arena-assets` repo root
 * (next to your `assets/` folder), before pushing a new version:
 *
 *     node generate-manifest.js
 *
 * It walks `assets/` and produces a manifest.json with TWO kinds of
 * entries:
 *
 *   - "bundles": one entry PER ZIP FILE, keyed by the zip's own path,
 *     hashed as a whole. A zip can only ever be downloaded and
 *     applied as one atomic unit — the client can't fetch "just one
 *     file out of it" — so there is no value in hashing its contents
 *     individually, and doing so was bloating the manifest for no
 *     benefit (4100 profile pictures = 4100 pointless entries when
 *     one hash of the zip already tells the client everything it
 *     needs: "did anything in here change, yes or no"). We also
 *     record the zip's file list, so the client knows which final
 *     paths it will produce once unzipped, without having to unzip
 *     it just to find out.
 *
 *   - "loose": one entry per individual file NOT inside a zip,
 *     hashed individually as before — these genuinely can be
 *     diffed and fetched one at a time.
 *
 * You never hand-edit manifest.json — re-run this script any time
 * assets change, before pushing.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────

const ASSETS_ROOT = path.join(__dirname, 'assets');
const IGNORE = new Set(['.DS_Store']);

// ─────────────────────────────────────────────────────────────

function hashBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

function walk(dir, base = dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(walk(full, base));
    } else {
      results.push(full);
    }
  }
  return results;
}

function main() {
  console.log('Apex Arena — generating manifest...\n');

  if (!fs.existsSync(ASSETS_ROOT)) {
    console.error(`ERROR: could not find "assets" folder at ${ASSETS_ROOT}`);
    process.exit(1);
  }

  const manifest = {
    generated: new Date().toISOString(),
    bundles: {}, // "assets/icons/ranks/profile-pictures.zip" -> { hash, size, prefix, files: [...] }
    loose: {},   // "assets/logos/logo-apple.png" -> { hash, size }
  };

  const allFiles = walk(ASSETS_ROOT);
  let totalBytes = 0;
  let zipCount = 0;
  let looseCount = 0;

  for (const absPath of allFiles) {
    const relPath = path.relative(__dirname, absPath).split(path.sep).join('/');
    const buf = fs.readFileSync(absPath);
    const size = buf.length;
    totalBytes += size;

    if (absPath.toLowerCase().endsWith('.zip')) {
      zipCount++;
      const zipDirRel = relPath.slice(0, -4); // strip ".zip" -> folder prefix its contents unpack into

      manifest.bundles[relPath] = {
        hash: hashBuffer(buf), // hash of the ZIP itself, not its contents
        size,
        prefix: zipDirRel,
      };

      console.log(`  bundle "${relPath}" -> unpacks to "${zipDirRel}/" (1 manifest entry)`);
      continue;
    }

    // Loose file
    manifest.loose[relPath] = { hash: hashBuffer(buf), size };
    looseCount++;
  }

  const manifestPath = path.join(__dirname, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const manifestSize = fs.statSync(manifestPath).size;

  console.log(`\nDone. Wrote manifest.json (${(manifestSize / 1024).toFixed(1)} KB)`);
  console.log(`  ${zipCount} bundle${zipCount === 1 ? '' : 's'}, ${looseCount} loose file${looseCount === 1 ? '' : 's'}`);
  console.log(`  Total asset size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`\nNext: commit manifest.json (and any changed assets/zips), then push/tag this version.`);
  console.log(`Remember: the branch/tag name you push as must match the value in your Supabase`);
  console.log(`general-data table's "game_version" row (currently used as the jsDelivr @version).`);
}

main();