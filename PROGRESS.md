# PROGRESS.md — からだ手帳（`lab-result-analyzer`）開発進捗ログ

---

## 2026-11-21: Core v1 構築・スマホ PWA 対応・日々の体調日記・3段構え防御の本番反映

1. **`6703057` — Initial commit: Lab Result Analyzer (Angular + Cloudflare Workers + D1 + Multi-AI)**
   - Angular 19 スタンドアロン SPA + Cloudflare Workers + D1（`0001_init.sql`）+ Gemini/OpenAI/Claude 切替アダプター・ローカル相関エンジン・単体テスト 8 件を構築。
2. **`185ffbc` / `095ddcf` — D1 UUID 秘匿ラッパー & 本番 D1 デプロイ開通**
   - `scripts/set-cloudflare-config.sh` と `scripts/run-wrangler.mjs` を追加し、リポジトリやログに D1 の UUID を出さずにリモートマイグレーションと `https://lab-result-analyzer.kmnpsn.workers.dev` へのデプロイを開通。
3. **`efa66e3` / `26c1264` — スマホ PWA UI & レイアウト修正・AI 切替の管理者専用化**
   - `kakeibo-app` 流の下部固定 4 タブバー・タブ連動ヘッダー色・カメラ撮影・2〜3 行カード表示を実装。
   - 実機確認で見つかったスマホでの横幅はみ出し・下部タブ見切れを `minmax(0, 1fr)` / `overflow-x: hidden` で修正し、AI プロバイダ切替を一般ユーザー画面から非表示化（`?admin=1` 専用化）。
4. **`6aeb08a` — 毎日の体調日記モード・汎用 5 軸スコア・3段構えセキュリティ & サーキットブレーカー・CSV 出力**
   - `0002_daily_wellness_and_security.sql` を本番 D1 へ適用。
   - 採血なしの日々の体調日記（`record_type: 'daily'`）と症状タグ、汎用 5 軸スコア、3段構え防御（CSP/HSTS、手動メンテナンススイッチ、オート・サーキットブレーカー、ADR-030 エラー分離）、Excel 対応 CSV 書き出し、公開準備枠を実装。単体テスト 13 件 PASS。
5. **`8549491` — アプリ名「からだ手帳」への改称 & 家計簿お揃いテイストの新アイコン反映**
   - 名称を「からだ手帳」に統一し、ティール背景＋クリーム色と茶色のクリップボード＆ハート＋短い脚 2 本の新アイコン（`icon.svg`, `icon-192.png`, `icon-512.png`）を本番デプロイ。

## 2026-11-22: SoT ドキュメント整備 & 初回 Owner・招待制・Google OIDC・各種 SNS 後追い連携の本番反映

6. **`91733eb` / `09c1b27` — SoT ドキュメント一式 & `docs/production-login.md` 整備**
   - `SPEC.md`, `ROADMAP.md`, `TODO.md`, `DECISIONS.md`, `PROGRESS.md`, `docs/production-login.md` を作成。
7. **Phase B 認証・招待制・SNS 後追い連携の実装 & 本番 D1（`0003`）反映**
   - `migrations/0003_auth_identities_and_invites.sql` をローカル・本番 D1 に適用。
   - `worker/auth.ts` およびフロントエンド設定タブに、初回 Owner（`BOOTSTRAP_OWNER_EMAIL`）、Google OIDC（PKCE + `__Host-` Cookie + CSRF）、1回限り招待 URL 発行・受諾（`/invite/:token`）、6種 SNS（Google / LINE / Apple ID / Yahoo! JAPAN / Facebook / Amazon）の後追い連携・解除・乗っ取り防止ガード、ログアウト、アカウント自己削除を実装し本番デプロイ完了。単体テスト全 6 スイート・20 件 PASS。

## 2026-11-24: 本番 Google OIDC 実交換・ユーザー完全分離（`user_profiles` / `user_id`）・削除/リセット正常化

8. **Google OIDC 本番コールバック実装・デモデータ分離・削除正常化（`0004` 適用）**
   - `migrations/0004_user_profiles_per_user.sql` を追加し、`user_profiles` テーブルによるユーザーごとのプロフィール分離を導入。
   - `worker/auth.ts` の `GET /api/auth/google/callback` に Google OAuth2 Token Endpoint（PKCE）への認可コード交換・ID トークン検証・OIDC `userinfo` 照合を実装。
   - `worker/index.ts` で本番モード（`AUTH_MODE=production`）時のデモユーザー・サンプルデータ自動シードおよび未ログイン時のデモアカウントフォールバックを廃止し、全記録・プロフィール・削除・エクスポートを `user_id` 単位で完全分離。
   - `DELETE /api/auth/account` で該当ユーザーの D1 全データ（`lab_items`, `lab_records`, `user_profiles`, `invitations`, `auth_sessions`, `auth_identities`, `users`）を確実に削除するよう修正。
   - フロントエンドに本番未ログイン時のログインゲート画面を追加。単体テスト全 6 スイート・21 件 PASS。
9. **持病メモ連動の動的検査項目リスト & 設定画面の表示/非表示トグル（`0005` 適用）**
   - `migrations/0005_profile_visible_items.sql` を追加し、`user_profiles.visible_item_codes` でユーザーごとの表示項目設定を D1 に永続化。
   - 持病メモ（高尿酸血症・痛風 → `UA`, `Cr`, `eGFR` 等、10 疾患カテゴリ）から関連項目を自動抽出し、ホームのグラフ選択肢・採血記録の初期項目・プリセット一覧・CSV 出力へ動的に反映。
   - 設定タブの基準値一覧（PC テーブル / スマホカード）に各項目ごとの表示 ON/OFF トグル、おすすめバッジ（`★ おすすめ`）、「持病メモからおすすめ反映」「すべて表示」ボタンを追加。単体テスト全 6 スイート・22 件 PASS。
10. **持病・症状マスタの 28 カテゴリ拡充 & 後追いカスタムマスタ登録・自動提案（`0006` 適用）**
    - デフォルトの持病→検査項目マスタを 28 カテゴリへ拡充（IBD/クローン病・潰瘍性大腸炎、IBS/過敏性腸症候群、脊柱管狭窄症・坐骨神経痛・ヘルニア、関節リウマチ、骨粗鬆症、睡眠時無呼吸症候群 等）。
    - `migrations/0006_condition_item_rules.sql` と `/api/condition-rules`・`/api/condition-rules/suggest` を追加し、持病メモに未登録の病名・症状があれば採血関連項目候補を自動検知してワンクリックで後追い登録できる機能および手動マスタ追加・削除 UI を実装。単体テスト全 6 スイート・23 件 PASS。
11. **本番モードの未開通 SNS ダミー連携禁止 & ロックアウト防止ガード**
    - `AccountSummary.enabled_auth_providers` を追加し、本番モードでは実 OAuth 開通済みプロバイダ（現時点は `google` のみ）以外のダミー連携をサーバー側（`409 STATE_CONFLICT`）および設定 UI（「準備中（未接続）」）でブロック。
    - `DELETE /api/auth/identities/:provider` で、解除後に実際にログイン可能な手段が 0 件になる操作を拒否し、Google 連携解除によるロックアウトを構造的に防止。単体テスト全 6 スイート・24 件 PASS。
12. **LINE Login（OIDC + PKCE）& Login with Amazon（OAuth 2.0）実ログイン・後追い連携の実装**
    - `worker/auth.ts` に `/api/auth/line/{start,link,callback}`・`/api/auth/amazon/{start,link,callback}`・`/api/auth/google/link` を実装。Cloudflare Worker Secrets の登録有無に応じて `enabled_auth_providers` が自動有効化される設計とした。
    - `scripts/setup-line-oauth.sh`（`npm run cf:line`）・`scripts/setup-amazon-oauth.sh`（`npm run cf:amazon`）および `docs/production-login.md` のコンソール設定手順を追加。単体テスト全 6 スイート・25 件 PASS。
