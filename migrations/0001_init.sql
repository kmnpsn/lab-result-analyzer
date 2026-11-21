-- 0001_init.sql: 採血結果診断＆持病体調管理スキーマ (Cloudflare D1)

CREATE TABLE IF NOT EXISTS user_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT 'ユーザー',
  birth_year INTEGER,
  age INTEGER DEFAULT 35,
  sex TEXT NOT NULL DEFAULT 'male' CHECK (sex IN ('male', 'female', 'other')),
  height_cm REAL DEFAULT 170.0,
  chronic_conditions TEXT NOT NULL DEFAULT '',
  medications TEXT NOT NULL DEFAULT '',
  preferred_provider TEXT NOT NULL DEFAULT 'gemini' CHECK (preferred_provider IN ('gemini', 'openai', 'claude')),
  preferred_model TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO user_profile (id, name, age, sex, height_cm, chronic_conditions, medications, preferred_provider)
VALUES (1, 'サンプル患者', 38, 'male', 170.0, '慢性疲労・軽度貧血傾向・肝機能経過観察', '鉄剤（フェロミア）・ウルソデオキシコール酸', 'gemini');

CREATE TABLE IF NOT EXISTS lab_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tested_at TEXT NOT NULL,
  facility_name TEXT NOT NULL DEFAULT '',
  weight_kg REAL,
  overall_score INTEGER NOT NULL DEFAULT 5 CHECK (overall_score BETWEEN 1 AND 10),
  fatigue_score INTEGER NOT NULL DEFAULT 5 CHECK (fatigue_score BETWEEN 1 AND 10),
  sleep_score INTEGER NOT NULL DEFAULT 5 CHECK (sleep_score BETWEEN 1 AND 10),
  pain_score INTEGER NOT NULL DEFAULT 5 CHECK (pain_score BETWEEN 1 AND 10),
  appetite_score INTEGER NOT NULL DEFAULT 5 CHECK (appetite_score BETWEEN 1 AND 10),
  condition_note TEXT NOT NULL DEFAULT '',
  ai_provider TEXT NOT NULL DEFAULT '',
  ai_model TEXT NOT NULL DEFAULT '',
  ai_summary TEXT NOT NULL DEFAULT '',
  ai_correlation TEXT NOT NULL DEFAULT '',
  ai_advice TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lab_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL REFERENCES lab_records(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'その他',
  item_code TEXT NOT NULL,
  item_name TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  ref_low REAL,
  ref_high REAL,
  flag TEXT NOT NULL DEFAULT 'N' CHECK (flag IN ('L', 'N', 'H')),
  ai_comment TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_lab_records_tested_at ON lab_records(tested_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_items_record_id ON lab_items(record_id);
CREATE INDEX IF NOT EXISTS idx_lab_items_item_code ON lab_items(item_code);
