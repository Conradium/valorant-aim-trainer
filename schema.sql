CREATE TABLE IF NOT EXISTS profiles (
  device_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  score INTEGER DEFAULT 0,
  accuracy REAL DEFAULT 0,
  split REAL DEFAULT 0,
  updated_at TEXT
);
