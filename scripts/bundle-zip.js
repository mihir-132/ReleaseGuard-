#!/usr/bin/env node
/**
 * scripts/bundle-zip.js
 *
 * Regenerate sample-data/v1.2.0-bundle.zip from server/sample-bundles/v1.2.0/
 *
 * Usage:
 *   node scripts/bundle-zip.js
 *   npm run bundle:zip   (via root package.json script)
 *
 * The ZIP contains a single root folder "v1.2.0/" so it is directly
 * extractable:  unzip v1.2.0-bundle.zip  →  v1.2.0/manifest.json ...
 */

import AdmZip from 'adm-zip';
import { readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BUNDLE_DIR = join(__dirname, '..', 'server', 'sample-bundles', 'v1.2.0');
const OUT_DIR = join(__dirname, '..', 'sample-data');
const OUT_FILE = join(OUT_DIR, 'v1.2.0-bundle.zip');
const BUNDLE_ROOT = 'v1.2.0';

/**
 * Recursively add all files from a directory into the ZIP archive.
 * Files are stored under a bundle-root prefix so extracting the ZIP
 * produces a single top-level folder.
 *
 * @param {AdmZip} zip
 * @param {string} dir  - absolute path to directory being walked
 * @param {string} base - relative zip-internal base path prefix
 */
function addDirToZip(zip, dir, base) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const zipPath = join(base, entry).replace(/\\/g, '/');
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      addDirToZip(zip, fullPath, zipPath);
    } else {
      zip.addLocalFile(fullPath, zipPath.substring(0, zipPath.lastIndexOf('/')));
    }
  }
}

const zip = new AdmZip();
addDirToZip(zip, BUNDLE_DIR, BUNDLE_ROOT);
zip.writeZip(OUT_FILE);

const entries = zip.getEntries();
console.log(`✅  Created ${relative(process.cwd(), OUT_FILE)}`);
console.log(`   ${entries.length} file(s) included:`);
for (const e of entries) {
  console.log(`   • ${e.entryName}`);
}
