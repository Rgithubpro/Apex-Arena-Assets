#!/usr/bin/env node
/**
 * Apex Arena — Manifest Generator
 * ---------------------------------
 * Run this locally, from inside your `apex-arena-assets` repo root
 * (next to your `assets/`, `js/`, `html/`, `css/` folders), before
 * pushing a new version:
 *
 *     node generate-manifest.js
 *
 * It walks assets/, js/, html/, and css/, and produces a manifest.json
 * with TWO kinds of entries:
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
 * Code/markup delivery: every file under js/ or html/ ALSO gets a
 * "kind" field on its loose entry, read from manifest.config.json
 * (hand-maintained, sits next to this script — see that file's
 * "_comment" for what each kind means and how it's applied
 * client-side by cache.js's applyStyles/applyHTML/applyScripts /
 * resolveModuleUrl). A file under js/ or html/ with no entry in
 * manifest.config.json is NOT excluded from the manifest — it still
 * gets a loose entry — but is logged as a warning, since the client
 * won't know how to apply it (no "kind" means applyHTML/applyScripts
 * silently skip it, and it'll never actually load).
 *
 * "page"-kind HTML entries also carry a "pageKey" — derived from the
 * filename (html/pages/home.html -> "home") — purely as manifest
 * metadata for anyone inspecting it; the client does NOT need this to
 * apply the page (the file's own root element already carries its
 * real id + class="page"), so getting this wrong doesn't break
 * anything client-side.
 *
 * CSS files need no "kind" — applyStyles() treats every *.css loose
 * asset identically, so nothing to classify.
 *
 * You never hand-edit manifest.json — re-run this script any time
 * assets/code/markup change, before pushing. manifest.config.json,
 * unlike manifest.json, IS hand-edited — update it whenever you add a
 * new js/ or html/ file.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────

const ASSETS_ROOT = path.join(__dirname, 'assets');
const JS_ROOT = path.join(__dirname, 'js');
const HTML_ROOT = path.join(__dirname, 'html');
const CSS_ROOT = path.join(__dirname, 'css');
const CONFIG_PATH = path.join(__dirname, 'manifest.config.json');
const IGNORE = new Set(['.DS_Store']);

// ─────────────────────────────────────────────────────────────

function hashBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

function walk(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
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

function loadKindConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.warn(`WARNING: manifest.config.json not found at ${CONFIG_PATH} — no js/ or html/ file will get a "kind", so none of them will actually apply client-side.\n`);
    return {};
  }
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  // Strip documentation keys (anything starting with "_") — they're
  // notes for humans editing this file, not real path entries.
  for (const key of Object.keys(raw)) {
    if (key.startsWith('_')) delete raw[key];
  }
  return raw;
}

function deriveePageKey(relPath) {
  // "html/pages/home.html" -> "home"
  const base = path.basename(relPath, path.extname(relPath));
  return base;
}

function main() {
  console.log('Apex Arena — generating manifest...\n');

  if (!fs.existsSync(ASSETS_ROOT)) {
    console.error(`ERROR: could not find "assets" folder at ${ASSETS_ROOT}`);
    process.exit(1);
  }

  const kindConfig = loadKindConfig();
  const unclassified = [];

  const manifest = {
    generated: new Date().toISOString(),
    bundles: {}, // "assets/icons/ranks/profile-pictures.zip" -> { hash, size, prefix }
    loose: {},   // "assets/logos/logo-discord.png" -> { hash, size } | "js/pages/home.js" -> { hash, size, kind }
  };

  let totalBytes = 0;
  let zipCount = 0;
  let looseCount = 0;

  // ---- assets/ (binaries; zips get their own "bundles" treatment) ----
  for (const absPath of walk(ASSETS_ROOT)) {
    const relPath = path.relative(__dirname, absPath).split(path.sep).join('/');
    const buf = fs.readFileSync(absPath);
    const size = buf.length;
    totalBytes += size;

    if (absPath.toLowerCase().endsWith('.zip')) {
      zipCount++;
      const zipDirRel = relPath.slice(0, -4); // strip ".zip" -> folder prefix its contents unpack into
      manifest.bundles[relPath] = { hash: hashBuffer(buf), size, prefix: zipDirRel };
      console.log(`  bundle "${relPath}" -> unpacks to "${zipDirRel}/" (1 manifest entry)`);
      continue;
    }

    manifest.loose[relPath] = { hash: hashBuffer(buf), size };
    looseCount++;
  }

  // ---- js/ and html/ (code + markup; every file needs a "kind") ----
  for (const root of [JS_ROOT, HTML_ROOT]) {
    for (const absPath of walk(root)) {
      const relPath = path.relative(__dirname, absPath).split(path.sep).join('/');
      const buf = fs.readFileSync(absPath);
      const size = buf.length;
      totalBytes += size;

      const entry = { hash: hashBuffer(buf), size };
      const kind = kindConfig[relPath];
      if (kind) {
        entry.kind = kind;
        if (kind === 'page') entry.pageKey = deriveePageKey(relPath);
      } else {
        unclassified.push(relPath);
      }

      manifest.loose[relPath] = entry;
      looseCount++;
    }
  }

  // ---- css/ (loose, no "kind" needed — applyStyles() treats every *.css the same) ----
  for (const absPath of walk(CSS_ROOT)) {
    const relPath = path.relative(__dirname, absPath).split(path.sep).join('/');
    const buf = fs.readFileSync(absPath);
    const size = buf.length;
    totalBytes += size;
    manifest.loose[relPath] = { hash: hashBuffer(buf), size };
    looseCount++;
  }

  const manifestPath = path.join(__dirname, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const manifestSize = fs.statSync(manifestPath).size;

  console.log(`\nDone. Wrote manifest.json (${(manifestSize / 1024).toFixed(1)} KB)`);
  console.log(`  ${zipCount} bundle${zipCount === 1 ? '' : 's'}, ${looseCount} loose file${looseCount === 1 ? '' : 's'}`);
  console.log(`  Total size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

  if (unclassified.length) {
    console.warn(`\nWARNING: ${unclassified.length} js/html file(s) have no entry in manifest.config.json — they were still added to manifest.json, but with no "kind" they will NOT be applied client-side (applyHTML/applyScripts skip anything without a "kind"):`);
    for (const p of unclassified) console.warn(`  - ${p}`);
    console.warn(`Add each one to manifest.config.json, then re-run this script.`);
  }

  console.log(`\nNext: commit manifest.json (and any changed assets/js/html/css), then push/tag this version.`);
  console.log(`Remember: the branch/tag name you push as must match the value in your Supabase`);
  console.log(`general-data table's "game_version" row (currently used as the jsDelivr @version).`);
}

main();