-- 0004_user_profiles_per_user.sql: ユーザー単位プロフィールテーブル (user_profiles) による完全分離

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '利用者',
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

-- 既存のデモ用 user_profile (id = 1) があれば user_id = 1 へ移行（新規アカウントには一切コピーしない）
INSERT OR IGNORE INTO user_profiles (
  user_id, name, birth_year, age, sex, height_cm,
  chronic_conditions, medications, preferred_provider, preferred_model, updated_at
)
SELECT
  1, name, birth_year, age, sex, height_cm,
  chronic_conditions, medications, preferred_provider, preferred_model, updated_at
FROM user_profile
WHERE id = 1 AND EXISTS (SELECT 1 FROM users WHERE id = 1);
