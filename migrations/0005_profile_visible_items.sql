-- 0005_profile_visible_items.sql: ユーザーごとの表示検査項目カスタマイズ (visible_item_codes)

ALTER TABLE user_profiles ADD COLUMN visible_item_codes TEXT NOT NULL DEFAULT '';
