-- Signet Reviews — D1 Schema
-- Run via: wrangler d1 migrations apply signet-reviews --remote

CREATE TABLE IF NOT EXISTS reviews (
  -- Identity
  id          TEXT    PRIMARY KEY,   -- UUID from signetai daemon (idempotent key)

  -- Target
  target_type TEXT    NOT NULL CHECK (target_type IN ('skill', 'mcp')),
  target_id   TEXT    NOT NULL,      -- skill name or MCP server id

  -- Content
  display_name TEXT   NOT NULL,
  rating       INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title        TEXT    NOT NULL,
  body         TEXT    NOT NULL,

  -- Timestamps (ISO 8601, set by the originating daemon)
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  received_at TEXT    NOT NULL       -- when the Worker received this review
);

-- Fast lookups by target (the primary read pattern)
CREATE INDEX IF NOT EXISTS idx_reviews_target
  ON reviews (target_type, target_id);

-- Ordered listing for the "recent reviews" feed
CREATE INDEX IF NOT EXISTS idx_reviews_updated
  ON reviews (updated_at DESC);
