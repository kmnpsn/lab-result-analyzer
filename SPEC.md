# からだ手帳（`lab-result-analyzer`）仕様書

## 1. 目的

「からだ手帳」の Goal は、**持病や指定難病（クローン病、自己免疫疾患、貧血、腎・肝疾患など）を持つ方が、日々の体調日記（主観データ）と定期的な採血結果（客観データ）を無理なく記録し、自分自身の「数値と体調のつながり」を振り返れること**である。

- 病院・検査機関向けの専門システムではなく、患者・生活者本人が毎日スマホや PC から親しみやすく使える「健康手帳」として設計する。
- 外部 AI API キーを個人で持たない一般利用者でも、すべての基本機能（日々の体調記録、採血結果の登録、基準値判定、2軸推移グラフ、相関傾向の振り返り、CSV 書き出し）が完結して動作することを必須条件とする。
- AI プロバイダ（Gemini / OpenAI / Claude）の切り替えは運営・管理者側の内部責務とし、一般利用者の画面には露出させない。

Core User Flow:

`基本情報・持病設定 → 日々の体調日記 / 採血記録 → ホームで推移・つながり確認 → くわしく見るで診察メモ確認`

---

## 2. 機能一覧（Core v1 実装済み Baseline）

| 領域 | 機能 | 状態 | 備考 |
| --- | --- | --- | --- |
| **記録モード** | 📝 毎日の体調日記（採血なし） | 実装済 | 採血項目 0 件で日付・体重・5軸スコア・症状タグ・ひとこと日記を保存 |
| **記録モード** | 🧪 採血結果＋体調の記録 | 実装済 | カメラ撮影 / 画像・PDF 読み取り / 文字抽出 / 手入力修正に対応 |
| **5軸体調スコア** | 1〜10 段階の主観評価（5項目） | 実装済 | ①全体の調子 ②元気さ ③からだの快適さ（不調のなさ） ④睡眠・休養 ⑤食事・日常生活 |
| **症状タグ** | ワンタップ症状・出来事タグ | 実装済 | `体調安定`, `だるさ・疲労`, `おなかの不調`, `微熱・熱っぽさ`, `関節・筋肉の違和感`, `お薬の変更` 等 |
| **基準値判定** | 性別連動の基準範囲マスタ（21項目） | 実装済 | 女性 / 男性 / その他 に応じて `L`（低め）/ `N`（基準内）/ `H`（高め）を自動判定 |
| **可視化** | 検査値 × 体調スコア 2軸 SVG チャート | 実装済 | 左軸＝検査値＋基準範囲帯（緑）、右軸＝体調スコア（1〜10）＋体重推移 |
| **振り返り** | 数値と体調のつながり・診察ヒント | 実装済 | ①数値のまとめ ②体調や過去推移とのつながり ③診察で聞いてみたいこと |
| **スマホ / PWA** | 下部固定4タブ＋タブ連動ヘッダー色 | 実装済 | ホーム（ティール）/ 記録（オレンジ）/ くわしく（ブルー）/ 設定（シルバーグレー） |
| **スマホ / PWA** | 文字切れゼロの 2〜3行カード表示 | 実装済 | スマホ幅では横長テーブルをカード化し、横スクロール・文字見切れを防止 |
| **データ出力** | CSV エクスポート | 実装済 | UTF-8 BOM 付き CSV（Excel でそのまま文字化けせず開ける形式） |
| **防御・運用** | 3段構えセキュリティ & サーキットブレーカー | 実装済 | CSP/HSTS、手動メンテナンススイッチ、連続異常時の自動 DB 遮断＋待機画面 |
| **エラー案内** | ADR-030 エラーコード分離 | 実装済 | サーバーログは固定コード＋`requestId`（医療データ非出力）、画面は平易な日本語 |

---

## 3. アーキテクチャ

- **Frontend:** TypeScript + Angular 19（Standalone Component）、PC ワイド表示とスマートフォン PWA（下部固定タブ・カードレイアウト）のレスポンシブ併用
- **Backend / API:** Cloudflare Workers（Static Assets 同梱の単一 Worker 構成）
- **Database:** Cloudflare D1（SQLite）
- **AI Adapter:** サーバー内部で Gemini / OpenAI / Claude を切り替え可能（キー未設定時は決定論的ローカル相関エンジンへ自動フォールバック）
- **Secret / Config 保護:** D1 の `database_id`（UUID）や認証トークンは Git リポジトリ・チャットログに残さず、`~/.config/lab-result-analyzer/cloudflare.env`（`chmod 600`）または GitHub Actions Secrets から `scripts/run-wrangler.mjs` で実行時のみ注入する。

---

## 4. データモデル（Cloudflare D1）

初期 DDL は [`migrations/0001_init.sql`](migrations/0001_init.sql)、拡張 DDL（体調日記・認証・招待・プラン枠）は [`migrations/0002_daily_wellness_and_security.sql`](migrations/0002_daily_wellness_and_security.sql) で管理する。

1. **`user_profile`**: 基本プロフィール（表示名、年齢、性別、身長、持病メモ、常用薬メモ）
2. **`lab_records`**: 記録ヘッダ
   - `record_type`: `'daily'`（体調日記のみ）または `'lab'`（採血結果あり）
   - `tested_at`（`YYYY-MM-DD`）、`facility_name`、`weight_kg`
   - 5軸スコア（1〜10 整数）: `overall_score`, `fatigue_score`, `pain_score`, `sleep_score`, `appetite_score`
   - `symptom_tags`（カンマ区切り）、`condition_note`
   - 振り返りコメント: `ai_summary`, `ai_correlation`, `ai_advice`
3. **`lab_items`**: 採血項目明細（`record_id`, `category`, `item_code`, `item_name`, `value`, `unit`, `ref_low`, `ref_high`, `flag`, `ai_comment`）
4. **`users` / `auth_sessions` / `invitations`**: 将来の招待制運用・一般公開・有料プラン（`free` / `plus` / `pro`）向けの所有者・セッション・招待管理テーブル

---

## 5. セキュリティ・データ保護方針

1. **Prepared Statement の徹底**: すべての D1 クエリはパラメータバインドを使用し、文字列連結による SQL を禁止する。
2. **医療・健康データのログ非出力（ADR-030）**: 検査数値、持病名、服薬メモ、症状メモ、個人名、トークンを `console.log` に一切出力しない。ログは `level`, `code`, `status`, `route`, `requestId`, `timestamp` のみとする。
3. **3段構えの防御**:
   - 第1段: 全応答に CSP / HSTS / `X-Frame-Options: DENY` / `nosniff` / `Permissions-Policy: camera=(self)` を付与。
   - 第2段: オーナー手動スイッチ（`MAINTENANCE_MODE=on`）で即座に DB アクセスを止め、待機画面へ切り替え。
   - 第3段: 短時間の連続エラーや過剰書き込みを検知すると自動でサーキットを開き（`503 CIRCUIT_OPEN`）、DB を保護する。
4. **医療免責の明示**: 本アプリは医療行為（確定診断・治療指示）ではなく、日々の振り返りと主治医への相談を助ける健康管理ツールであることを画面に明記する。
