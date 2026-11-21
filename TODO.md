# TODO.md — からだ手帳 タスク・Backlog 管理

工程・フェーズの正本は [`ROADMAP.md`](ROADMAP.md)、設計判断の正本は [`DECISIONS.md`](DECISIONS.md) とする。

---

## 1. 完了済み（Core v1: 2026-11-21 〜 11-22）

- [x] **基盤・デプロイ**
  - [x] Angular 19 + Cloudflare Workers (Static Assets) + Cloudflare D1 単一構成の構築
  - [x] D1 `database_id`（UUID）をリポジトリ・チャットログに残さない秘匿ラッパー（`scripts/set-cloudflare-config.sh`, `scripts/run-wrangler.mjs`）
  - [x] 本番 D1 マイグレーション（`0001_init.sql`, `0002_daily_wellness_and_security.sql`）と `https://lab-result-analyzer.kmnpsn.workers.dev` 本番稼働
- [x] **日々の体調日記 & 採血結果管理**
  - [x] 「📝 今日の体調日記だけつける（採血なし）」と「🧪 採血結果も一緒に記録する」の 2 モード対応
  - [x] 特定の疾患に偏らない汎用 5 軸スコア（①全体の調子 ②元気さ ③からだの快適さ・不調のなさ ④睡眠・休養 ⑤食事・日常生活）
  - [x] 気になる症状・出来事のワンタップタグ（`おなかの不調`, `だるさ・疲労`, `微熱・熱っぽさ`, `関節・筋肉の違和感`, `お薬の変更` 等）
  - [x] 男女別 21 項目の基準値マスタとリアルタイム `L` / `N` / `H` 判定
  - [x] 採血数値（左軸＋基準範囲帯）× 体調スコア・体重（右軸）の 2 軸 SVG チャート
  - [x] Excel 対応（UTF-8 BOM 付き）CSV エクスポート
- [x] **スマホ（PWA）& UI ブラッシュアップ**
  - [x] アプリ名「からだ手帳」への統一と、家計簿アプリとお揃いテイストのアイコン（`icon.svg`, `192px`, `512px`）
  - [x] スマホ下部固定 4 タブバー ＋ タブ連動のヘッダー全体背景色・`theme-color` 切り替え
  - [x] スマホでの横はみ出し・下部タブ見切れの修正と、文字切れゼロの 2〜3 行カード表示
  - [x] 一般ユーザー画面からの AI プロバイダ切替・API キー欄の完全撤去（`?admin=1` の管理者モードのみ表示）
- [x] **セキュリティ・防御基盤（`kakeibo-app` 流用・強化）**
  - [x] ブラウザセキュリティヘッダー（CSP, HSTS, X-Frame-Options, nosniff, Permissions-Policy `camera=(self)`）
  - [x] 手動メンテナンススイッチ（`MAINTENANCE_MODE`）と待機画面（`ServicePauseGate`）
  - [x] 短時間の連続エラー・過剰書き込み時のオート・サーキットブレーカー（`503 CIRCUIT_OPEN`）
  - [x] ADR-030 準拠の固定エラーコードと平易な日本語エラー案内の分離（医療データのログ非出力）
  - [x] 単体テスト 5 スイート・13 件 PASS（`npm test`）

---

## 2. 次フェーズ Backlog（優先度順）

### Phase A：運用の足場・UI 微調整
- [ ] **D1 定期暗号化バックアップ Workflow**: `kakeibo-app`（#208 / #235）と同様に、毎日 D1 データを暗号化して保存する GitHub Actions と復元手順書の追加
- [ ] **診察時見せやすい「主治医共有用 1 枚サマリー」ビュー**: 直近 1〜3 か月の体調スコアの波・症状タグ回数・基準外だった採血項目をスマホ画面 1 枚（または印刷/PDF）でサッと見せられる表示
- [ ] **日々の体調日記の編集（後から同日の記録を更新・採血項目を追記）導線の強化**

### Phase B：招待制ログイン・マルチユーザー分離・SNS後追い連携（詳細設計: [`docs/production-login.md`](docs/production-login.md)）
- [ ] **`auth_identities` テーブルと所有者境界（`user_id`）のマイグレーション拡張**: 1人の内部 `users` に対して複数の外部認証（`google`, `apple`, `line`, `yahoo_japan`, `facebook`, `amazon`）を紐付けられる 1対多スキーマの適用
- [ ] **初回 Owner ブートストラップ（`BOOTSTRAP_OWNER_EMAIL`）と Google OIDC ログイン（PKCE + D1 Session + CSRF）の実接続**
- [ ] **招待リンク発行・受諾 UI/API（`/invite/:token`、Owner 専用、HMAC ハッシュ保存、1回限り）**
- [ ] **各種 SNS アカウントの後追い連携 UI/API（`/api/auth/:provider/link`）**: ログイン済みユーザーが設定画面から LINE / Apple ID / Yahoo / Facebook / Amazon 等を追加連携・解除（最低1つは残すガード付き）できる機能
- [ ] **アカウントと全記録の自己削除機能**

### Phase C / D：一般公開・外部認証拡張・有料プラン接続
- [ ] **利用規約・プライバシーポリシー同意画面の本番有効化（`REGISTRATION_MODE=open` 対応）**
- [ ] **Apple ID / LINE / Yahoo 等の追加ログイン連携**
- [ ] **有料プラン（Plus / Pro）の決済連携と月間カメラ自動読み取り枠の制御**
- [ ] **デザイン Backlog**: アプリアイコンのキャラクター化（手・目・鉛筆などを付けたバリエーション案の検討）
