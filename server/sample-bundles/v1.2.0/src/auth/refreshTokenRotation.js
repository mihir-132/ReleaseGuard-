import { verifyRefreshToken, signAccessToken, signRefreshToken } from './jwt.js';
import { invalidateRefreshToken, storeRefreshToken, isRefreshTokenValid } from './tokenStore.js';

/**
 * Rotate a refresh token:
 * 1. Verify the incoming refresh token
 * 2. Invalidate it (one-time use)
 * 3. Issue a new access + refresh token pair
 *
 * @param {string} incomingRefreshToken
 * @returns {{ accessToken: string, refreshToken: string }}
 */
export async function rotateRefreshToken(incomingRefreshToken) {
  const payload = verifyRefreshToken(incomingRefreshToken);

  const isValid = await isRefreshTokenValid(incomingRefreshToken);
  if (!isValid) {
    throw new Error('Refresh token has already been used or revoked');
  }

  await invalidateRefreshToken(incomingRefreshToken);

  const userPayload = { sub: payload.sub, role: payload.role };
  const newAccessToken = signAccessToken(userPayload);
  const newRefreshToken = signRefreshToken(userPayload);

  await storeRefreshToken(newRefreshToken, payload.sub);

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}
