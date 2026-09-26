/**
 * Focused tests for the Multer error-handling path in POST /api/upload.
 *
 * Strategy: mock ../middleware/upload.js so we control what `next` is called
 * with, then exercise runUploadMiddleware and the route's error mapping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import multer from 'multer';

// ---------------------------------------------------------------------------
// Mock the upload middleware module BEFORE importing the route under test.
// The factory must be synchronous and return the mock shape.
// ---------------------------------------------------------------------------
vi.mock('../middleware/upload.js', () => {
  // Default: call next() with no error (success path).
  const singleFn = vi.fn((_req, _res, next) => next());
  const mockUpload = { single: vi.fn(() => singleFn) };
  return { default: mockUpload };
});

// Import after the mock is registered so the route sees our stub.
const { runUploadMiddleware } = await import('../routes/upload.js');
// Access the mock to control it per-test.
const { default: mockUpload } = await import('../middleware/upload.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal mock req/res that satisfy Express middleware expectations. */
function makeMocks() {
  const req = { headers: {}, body: {} };
  const statusMock = vi.fn();
  const jsonMock = vi.fn();
  const res = {
    status: vi.fn().mockReturnValue({ json: jsonMock }),
    json: jsonMock,
  };
  return { req, res, jsonMock };
}

function makeMulierError(code) {
  const err = new multer.MulterError(code, 'bundle');
  return err;
}

// ---------------------------------------------------------------------------
// runUploadMiddleware — Promise resolution behaviour
// ---------------------------------------------------------------------------

describe('runUploadMiddleware', () => {
  beforeEach(() => {
    // Reset to success path before each test.
    mockUpload.single.mockReturnValue((_req, _res, next) => next());
  });

  it('resolves when multer calls next() with no error', async () => {
    const { req, res } = makeMocks();
    await expect(runUploadMiddleware(req, res)).resolves.toBeUndefined();
  });

  it('rejects with the error when multer calls next(err)', async () => {
    const err = makeMulierError('LIMIT_FILE_SIZE');
    mockUpload.single.mockReturnValue((_req, _res, next) => next(err));

    const { req, res } = makeMocks();
    await expect(runUploadMiddleware(req, res)).rejects.toBe(err);
  });

  it('rejects with a plain Error for fileFilter rejections', async () => {
    const err = Object.assign(new Error('Only ZIP files are accepted.'), { status: 400 });
    mockUpload.single.mockReturnValue((_req, _res, next) => next(err));

    const { req, res } = makeMocks();
    await expect(runUploadMiddleware(req, res)).rejects.toBe(err);
  });
});

// ---------------------------------------------------------------------------
// POST /api/upload — error response mapping
// ---------------------------------------------------------------------------

describe('POST /api/upload — Multer error JSON responses', () => {
  beforeEach(() => {
    // Default: call next() with no error (success path).
    mockUpload.single.mockReturnValue((_req, _res, next) => next());
  });

  it('returns 413 JSON for LIMIT_FILE_SIZE MulterError', async () => {
    const err = makeMulierError('LIMIT_FILE_SIZE');
    mockUpload.single.mockReturnValue((_req, _res, next) => next(err));

    // Import the router and grab the route handler via its stack.
    const { default: router } = await import('../routes/upload.js');
    const layer = router.stack.find(
      (l) => l.route && l.route.path === '/' && l.route.methods.post
    );
    const handler = layer.route.stack[0].handle;

    const { req, res } = makeMocks();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.status().json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('File too large') })
    );
  });

  it('returns 400 JSON for non-size MulterError (LIMIT_UNEXPECTED_FILE)', async () => {
    const err = makeMulierError('LIMIT_UNEXPECTED_FILE');
    mockUpload.single.mockReturnValue((_req, _res, next) => next(err));

    const { default: router } = await import('../routes/upload.js');
    const layer = router.stack.find(
      (l) => l.route && l.route.path === '/' && l.route.methods.post
    );
    const handler = layer.route.stack[0].handle;

    const { req, res } = makeMocks();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.status().json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Unexpected') })
    );
  });

  it('returns 400 JSON for a plain Error (fileFilter rejection)', async () => {
    const err = Object.assign(new Error('Only ZIP files are accepted.'), { status: 400 });
    mockUpload.single.mockReturnValue((_req, _res, next) => next(err));

    const { default: router } = await import('../routes/upload.js');
    const layer = router.stack.find(
      (l) => l.route && l.route.path === '/' && l.route.methods.post
    );
    const handler = layer.route.stack[0].handle;

    const { req, res } = makeMocks();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.status().json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Only ZIP files are accepted.' })
    );
  });
});
