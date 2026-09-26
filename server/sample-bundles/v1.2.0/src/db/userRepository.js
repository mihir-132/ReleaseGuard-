import { query } from './pool.js';
import _ from 'lodash';

/**
 * Find a user by ID.
 * Lodash v4 is used for safe object pick (upgraded from v3 in this release).
 * @param {string} id
 */
export async function findUserById(id) {
  const result = await query('SELECT * FROM users WHERE id = $1', [id]);
  if (result.rows.length === 0) return null;
  return _.pick(result.rows[0], ['id', 'email', 'role', 'createdAt']);
}

/**
 * Store a refresh token for a given user.
 * @param {string} token
 * @param {string} userId
 */
export async function storeRefreshToken(token, userId) {
  await query(
    'INSERT INTO refresh_tokens (token, user_id, created_at) VALUES ($1, $2, NOW())',
    [token, userId]
  );
}

/**
 * Check whether a refresh token is still valid (not invalidated).
 * @param {string} token
 * @returns {Promise<boolean>}
 */
export async function isRefreshTokenValid(token) {
  const result = await query(
    'SELECT 1 FROM refresh_tokens WHERE token = $1 AND invalidated_at IS NULL',
    [token]
  );
  return result.rows.length > 0;
}

/**
 * Invalidate a refresh token (mark as used).
 * @param {string} token
 */
export async function invalidateRefreshToken(token) {
  await query(
    'UPDATE refresh_tokens SET invalidated_at = NOW() WHERE token = $1',
    [token]
  );
}
