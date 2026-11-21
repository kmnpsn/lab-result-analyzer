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
