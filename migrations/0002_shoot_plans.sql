CREATE TABLE IF NOT EXISTS shoot_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  location TEXT NOT NULL,
  target_content TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shoot_plans_date ON shoot_plans(date);
CREATE INDEX IF NOT EXISTS idx_shoot_plans_status ON shoot_plans(status);
