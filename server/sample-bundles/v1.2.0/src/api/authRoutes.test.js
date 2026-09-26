import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import authRouter from '../api/authRoutes.js';

vi.mock('../auth/refreshTokenRotation.js', () => ({
  rotateRefreshToken: vi.fn(),
}));

import { rotateRefreshToken } from '../auth/refreshTokenRotation.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', authRouter);
  return app;
}

describe('POST /api/auth/refresh', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when refreshToken is missing', async () => {
    const res = await request(buildApp()).post('/api/auth/refresh').send({});
    expect(res.status).toBe(400);
  });

  it('returns new tokens on success', async () => {
    rotateRefreshToken.mockResolvedValueOnce({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });
    const res = await request(buildApp())
      .post('/api/auth/refresh')
      .send({ refreshToken: 'old-token' });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBe('new-access');
  });

  it('returns 401 when token is invalid', async () => {
    rotateRefreshToken.mockRejectedValueOnce(new Error('Token revoked'));
    const res = await request(buildApp())
      .post('/api/auth/refresh')
      .send({ refreshToken: 'bad-token' });
    expect(res.status).toBe(401);
  });
});
