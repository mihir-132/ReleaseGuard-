import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findUserById } from '../db/userRepository.js';

// Mock pool module so no real DB connection is needed
vi.mock('../db/pool.js', () => ({
  query: vi.fn(),
}));

import { query } from '../db/pool.js';

describe('userRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when user is not found', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const result = await findUserById('missing-id');
    expect(result).toBeNull();
  });

  it('returns a picked user object when found', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: '1', email: 'alice@example.com', role: 'user', createdAt: new Date(), password: 'hashed' }],
    });
    const user = await findUserById('1');
    expect(user).toEqual(expect.objectContaining({ id: '1', email: 'alice@example.com' }));
    // password should NOT be included
    expect(user.password).toBeUndefined();
  });
});
