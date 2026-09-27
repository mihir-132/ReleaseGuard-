/**
 * upload — POST a ZIP bundle to /api/upload.
 *
 * @param {File} file - The ZIP File object selected by the user.
 * @returns {Promise<{ runId: string, manifest: object }>}
 * @throws {Error} with a human-readable message on non-2xx responses.
 */
export async function uploadBundle(file) {
  const formData = new FormData();
  formData.append('bundle', file);

  const res = await fetch('/api/upload', {
    method: 'POST',
    body: formData,
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(json.error || `Upload failed (HTTP ${res.status})`);
  }

  return json;
}
