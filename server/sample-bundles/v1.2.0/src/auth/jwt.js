import jwt from 'jsonwebtoken';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';

/**
 * Sign a short-lived access token.
 * @param {object} payload
 * @returns {string}
 */
export function signAccessToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

/**
 * Sign a refresh token using the dedicated refresh secret.
 * The refresh secret is rotated independently of the access secret.
 * @param {object} payload
 * @returns {string}
 */
export function signRefreshToken(payload) {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_TTL });
}

/**
 * Verify and decode an access token.
 * @param {string} token
 * @returns {object}
 */
export function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

/**
 * Verify and decode a refresh token.
 * @param {string} token
 * @returns {object}
 */
export function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}
