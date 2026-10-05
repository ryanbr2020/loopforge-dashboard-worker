-- Content tags derived from sampled frames by content_tagger.py (aspen color, moving water, ...).
-- tags is comma-wrapped (",a,b,") so a single LIKE '%,tag,%' matches whole tags.
CREATE TABLE IF NOT EXISTS clip_content (
  clip_key TEXT PRIMARY KEY,
  tags TEXT NOT NULL DEFAULT ','
);
