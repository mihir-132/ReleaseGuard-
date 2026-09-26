-- Migration: 20250630_add_refresh_token_index
-- Direction: UP
-- Description: Adds an index on refresh_tokens.user_id to speed up token lookups
--              during refresh-token rotation (introduced in v1.2.0).
--
-- NOTE: No rollback file is provided for this migration.
--       Dropping the index is low-risk but requires manual intervention.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refresh_tokens_user_id
  ON refresh_tokens (user_id);

-- Also purge stale invalidated tokens older than 30 days (irreversible cleanup)
DELETE FROM refresh_tokens
  WHERE invalidated_at IS NOT NULL
    AND invalidated_at < NOW() - INTERVAL '30 days';
