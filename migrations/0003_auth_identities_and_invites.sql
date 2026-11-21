-- 0003_auth_identities_and_invites.sql: 外部Identity分離 (SNS後追い連携)・初回Owner・招待リンク拡張

-- 1. users に service_role ('admin' | 'user') と public_id を追加
ALTER TABLE users ADD COLUMN public_id TEXT;
ALTER TABLE users ADD COLUMN service_role TEXT NOT NULL DEFAULT 'admin' CHECK (service_role IN ('admin', 'user'));

UPDATE users SET public_id = 'u_owner_default', service_role = 'admin' WHERE id = 1 AND public_id IS NULL;

-- 2. 外部認証プロバイダとの 1対多 紐付けテーブル (Google / Apple / LINE / Yahoo! / Facebook / Amazon)
CREATE TABLE IF NOT EXISTS auth_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  email_snapshot TEXT,
  display_name_snapshot TEXT,
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, provider_subject)
);

CREATE INDEX IF NOT EXISTS idx_auth_identities_user_id ON auth_identities(user_id);

INSERT OR IGNORE INTO auth_identities (user_id, provider, provider_subject, email_snapshot, display_name_snapshot)
VALUES (1, 'google', 'demo-google-sub-001', 'owner@example.com', 'サンプル利用者 (Google)');

-- 3. invitations に宛先メールアドレス・状態管理カラムを追加
ALTER TABLE invitations ADD COLUMN email_normalized TEXT NOT NULL DEFAULT '';
ALTER TABLE invitations ADD COLUMN email_display TEXT NOT NULL DEFAULT '';
ALTER TABLE invitations ADD COLUMN consumed_at TEXT;
ALTER TABLE invitations ADD COLUMN revoked_at TEXT;

-- 4. lab_records に user_id (所有者境界) を追加
ALTER TABLE lab_records ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_lab_records_user_id ON lab_records(user_id, tested_at DESC);
