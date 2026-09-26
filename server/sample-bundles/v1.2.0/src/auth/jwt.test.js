import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken } from '../auth/jwt.js';

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
});

describe('jwt helpers', () => {
  it('signs and verifies an access token', () => {
    const token = signAccessToken({ sub: 'user-1', role: 'user' });
    const decoded = verifyAccessToken(token);
    expect(decoded.sub).toBe('user-1');
    expect(decoded.role).toBe('user');
  });

  it('signs and verifies a refresh token', () => {
    const token = signRefreshToken({ sub: 'user-2', role: 'admin' });
    const decoded = verifyRefreshToken(token);
    expect(decoded.sub).toBe('user-2');
  });

  it('throws when verifying with wrong secret', () => {
    const token = signAccessToken({ sub: 'user-3' });
    process.env.JWT_SECRET = 'wrong-secret';
    expect(() => verifyAccessToken(token)).toThrow();
  });
});
