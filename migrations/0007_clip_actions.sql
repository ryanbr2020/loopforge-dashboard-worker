CREATE TABLE IF NOT EXISTS clip_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clip_filename TEXT NOT NULL,
  action_type TEXT NOT NULL,
  value TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clip_actions_filename ON clip_actions(clip_filename);
CREATE INDEX IF NOT EXISTS idx_clip_actions_created_at ON clip_actions(created_at);
