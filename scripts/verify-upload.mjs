/**
 * Verification script for Sub-Task 3 — Ingestion Endpoint.
 *
 * Starts the Express server as a child process, waits for it to be ready,
 * then:
 *   1. Checks GET /api/health
 *   2. POSTs sample-data/v1.2.0-bundle.zip to POST /api/upload
 *
 * Kills the server automatically when done (success or failure).
 */

import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SERVER_DIR = resolve(ROOT, 'server');
const ZIP_PATH = resolve(ROOT, 'sample-data', 'v1.2.0-bundle.zip');
const PORT = 3097;
const BASE = `http://localhost:${PORT}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function waitForServer(url, maxMs = 8000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tryFetch = () => {
      fetch(url)
        .then(() => resolve())
        .catch(() => {
          if (Date.now() - start > maxMs) return reject(new Error('Server did not start in time'));
          setTimeout(tryFetch, 250);
        });
    };
    tryFetch();
  });
}

function buildMultipart(fieldName, filename, fileBuffer) {
  const boundary = '----VerifyBoundary' + Date.now();
  const CRLF = '\r\n';
  const header =
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"${CRLF}` +
    `Content-Type: application/zip${CRLF}${CRLF}`;
  const footer = `${CRLF}--${boundary}--${CRLF}`;
  const body = Buffer.concat([
    Buffer.from(header),
    fileBuffer,
    Buffer.from(footer),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let server;
let exitCode = 0;

try {
  // Start server
  server = spawn('node', ['index.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  server.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  server.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[verify] Server exited unexpectedly with code ${code}`);
    }
  });

  // Wait until it responds
  await waitForServer(`${BASE}/api/health`);

  // --- Check 1: Health endpoint ---
  const healthRes = await fetch(`${BASE}/api/health`);
  const healthBody = await healthRes.json();
  console.log('\n✅ Health check');
  console.log(`   Status : ${healthRes.status}`);
  console.log(`   Body   : ${JSON.stringify(healthBody)}`);
  if (!healthBody.ok) throw new Error('Health check returned ok:false');

  // --- Check 2: Upload sample bundle ---
  const zipBuffer = readFileSync(ZIP_PATH);
  const { body, contentType } = buildMultipart('bundle', 'v1.2.0-bundle.zip', zipBuffer);

  const uploadRes = await fetch(`${BASE}/api/upload`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
  });
  const uploadBody = await uploadRes.json();

  console.log('\n✅ Upload check');
  console.log(`   Status : ${uploadRes.status}`);
  console.log(`   runId  : ${uploadBody.runId}`);
  console.log(`   manifest.name    : ${uploadBody.manifest?.name}`);
  console.log(`   manifest.version : ${uploadBody.manifest?.version}`);

  if (uploadRes.status !== 200) throw new Error(`Upload returned HTTP ${uploadRes.status}: ${JSON.stringify(uploadBody)}`);
  if (!uploadBody.runId) throw new Error('Response missing runId');
  if (!uploadBody.manifest) throw new Error('Response missing manifest');

  console.log('\n🎉 All verification checks passed.\n');

} catch (err) {
  console.error('\n❌ Verification failed:', err.message);
  exitCode = 1;
} finally {
  if (server) {
    // Detach stdio before killing to avoid the Windows libuv async-handle
    // assertion that fires when process.exit() races with pipe teardown.
    server.stdout.destroy();
    server.stderr.destroy();
    server.kill();
    // Give the OS a tick to reap the child, then exit cleanly.
    await new Promise((r) => setTimeout(r, 200));
  }
  process.exitCode = exitCode;
}
