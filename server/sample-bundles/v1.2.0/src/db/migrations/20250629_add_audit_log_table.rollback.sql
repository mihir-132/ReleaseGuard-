-- Migration: 20250629_add_audit_log_table
-- Direction: DOWN (rollback)
-- Description: Drops the audit_log table added in the UP migration.

DROP TABLE IF EXISTS audit_log;
