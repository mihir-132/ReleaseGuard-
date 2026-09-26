import AdmZip from 'adm-zip';
import { existsSync, statSync, rmSync } from 'fs';

const zipPath = 'sample-data/v1.2.0-bundle.zip';

if (!existsSync(zipPath)) {
  console.error('ZIP not found:', zipPath);
  process.exit(1);
}

const stat = statSync(zipPath);
console.log(`ZIP size: ${stat.size} bytes`);

const zip = new AdmZip(zipPath);
const entries = zip.getEntries();
console.log(`\nEntries (${entries.length}):`);
const entryNames = entries.map(e => e.entryName);
for (const name of entryNames) {
  console.log(`  • ${name}`);
}

const requiredFiles = [
  'v1.2.0/manifest.json',
  'v1.2.0/diff.patch',
  'v1.2.0/package.json',
  'v1.2.0/.env.example',
];
console.log('\nRequired file check:');
let allOk = true;
for (const f of requiredFiles) {
  const found = entryNames.includes(f);
  if (!found) allOk = false;
  console.log(`  ${found ? '✅' : '❌'} ${f}`);
}

// Test extraction
const tmpDir = 'sample-data/.verify-extract';
zip.extractAllTo(tmpDir, true);
const manifestOk = existsSync(`${tmpDir}/v1.2.0/manifest.json`);
console.log(`\nExtraction test: ${manifestOk ? '✅ manifest.json found after extraction' : '❌ manifest.json missing after extraction'}`);
rmSync(tmpDir, { recursive: true, force: true });
console.log('Temp extraction cleaned up.');

process.exit(allOk && manifestOk ? 0 : 1);
