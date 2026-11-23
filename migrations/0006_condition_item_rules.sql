-- 0006_condition_item_rules.sql: 持病・症状→関連検査項目の後追いカスタムマスタ (user_id 分離)

CREATE TABLE IF NOT EXISTS condition_item_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  keywords TEXT NOT NULL,
  item_codes TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto_suggested')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_condition_item_rules_user_id ON condition_item_rules(user_id);
