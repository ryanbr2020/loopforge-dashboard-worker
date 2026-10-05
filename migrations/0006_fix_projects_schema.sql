-- Fix projects table schema to allow string IDs from Flask
CREATE TABLE projects_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT,
  duration INTEGER,
  loop_score REAL,
  loop_grade TEXT,
  file_path TEXT,
  thumb_url TEXT,
  loop_ready INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO projects_new
  SELECT id, name, location, duration, loop_score, loop_grade, file_path,
         thumb_url, loop_ready, status, created_at, updated_at
  FROM projects;

DROP TABLE projects;
ALTER TABLE projects_new RENAME TO projects;
