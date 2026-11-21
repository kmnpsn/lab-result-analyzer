-- 0002_daily_wellness_and_security.sql: 日々の体調日記・認証・招待・課金プラン基盤

-- 1. 記録種別（'daily' = 体調日記のみ, 'lab' = 採血結果＋体調記録）と症状タグを追加
ALTER TABLE lab_records ADD COLUMN record_type TEXT NOT NULL DEFAULT 'lab' CHECK (record_type IN ('daily', 'lab'));
ALTER TABLE lab_records ADD COLUMN symptom_tags TEXT NOT NULL DEFAULT '';

-- 2. 一般公開・招待制・課金プラン（ガワ）用のユーザー・セッション・招待テーブル
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  display_name TEXT NOT NULL DEFAULT 'ゲスト',
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'member')),
  plan_tier TEXT NOT NULL DEFAULT 'free' CHECK (plan_tier IN ('free', 'plus', 'pro')),
  monthly_ocr_used INTEGER NOT NULL DEFAULT 0,
  monthly_ocr_limit INTEGER NOT NULL DEFAULT 10,
  terms_accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO users (id, email, display_name, role, plan_tier, monthly_ocr_used, monthly_ocr_limit)
VALUES (1, null, 'サンプル利用者', 'owner', 'free', 1, 10);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invitations (
  token TEXT PRIMARY KEY,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note TEXT NOT NULL DEFAULT '',
  consumed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
