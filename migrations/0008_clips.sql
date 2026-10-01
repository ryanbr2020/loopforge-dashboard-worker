-- Read-only snapshot of the local footage catalog (all_clips_scored.json + enrichment).
CREATE TABLE IF NOT EXISTS clips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  folder TEXT,
  score INTEGER NOT NULL DEFAULT 0,
  camera_source TEXT,
  duration REAL,
  resolution TEXT,
  fps REAL,
  codec TEXT,
  has_audio INTEGER DEFAULT 0,
  gps_region TEXT,
  gps_lat REAL,
  gps_lon REAL,
  date TEXT,
  season TEXT,
  size_mb REAL,
  trail_name TEXT,
  park_name TEXT,
  nearest_town TEXT,
  nearest_peak TEXT,
  elevation_ft REAL,
  drone_mode TEXT,
  reasons TEXT,
  hidden INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_clips_score ON clips(score DESC);
CREATE INDEX IF NOT EXISTS idx_clips_region ON clips(gps_region);
CREATE INDEX IF NOT EXISTS idx_clips_date ON clips(date);
CREATE INDEX IF NOT EXISTS idx_clips_camera ON clips(camera_source);
CREATE INDEX IF NOT EXISTS idx_clips_season ON clips(season);
CREATE INDEX IF NOT EXISTS idx_clips_filename ON clips(filename);
