# Lab Result Analyzer — 採血結果AI診断 & 持病・体調10段階スコア相関管理アプリ

持病や慢性症状を持つ方が、定期的な**血液検査結果（客観データ）**と採血時点の**年齢・性別・体重・5つの10段階体調スコア（主観データ）**を紐付けて記録・可視化し、マルチAIプロバイダ（**Google Gemini / OpenAI / Anthropic Claude**）で個人内の時系列相関を診断できる Web アプリケーションです。

---

## 主な機能

1. **採血結果の AI Vision OCR 読み取り & 手入力補正**
   - 検査結果表の画像・PDFアップロード（AI Vision 構造化抽出）およびテキスト貼り付けパーサーに対応。
   - 読み取り後にすべての検査項目・数値・単位・基準値（下限/上限）を画面上で手入力修正可能。
   - APIキー未設定の環境でも、テキスト解析パーサーおよび持病管理向けサンプルプリセットにより、OCR読取から手修正・登録までの一連のフローを即座に体験できます。
2. **身体情報 & 5項目の10段階体調スコアリング**
   - 採血日・医療機関・体重（BMI自動算出）に加え、当時の主観的体調を10段階（1〜10）で記録：
     - **総合体調** (`overall_score`)
     - **倦怠感の少なさ・活力** (`fatigue_score`)
     - **睡眠の質** (`sleep_score`)
     - **痛み・不快感の少なさ** (`pain_score`)
     - **食欲・胃腸の調子** (`appetite_score`)
   - 自覚症状や服薬変更メモ（`condition_note`）もあわせて保存。
3. **採血推移 × 体調10段階スコア 2軸オーバーレイ相関グラフ**
   - 選択した採血項目（`Hb`, `Ferritin`, `CRP`, `ALT`, `eGFR`, `HbA1c`, `TSH`, `WBC` 等）の推移と性別基準値帯（緑色バンド）を左軸に、10段階体調スコアや体重推移を右軸に重ねて SVG 描画。
   - ピアソン相関係数 $r$ の自動算出により、「Hb・フェリチン回復と倦怠感スコア改善の連動」や「CRP上昇と痛みスコア悪化の連動」など個人特有の傾向を可視化。
4. **マルチAIプロバイダ切替対応の相関診断レポート**
   - **Gemini** (`gemini-2.5-flash`) / **OpenAI** (`gpt-4o-mini`) / **Claude** (`claude-sonnet-4-5`) をいつでも切り替えて再分析可能。
   - APIキー未設定時でも、高精度な内蔵ローカル相関分析エンジンがフォールバック動作し、①基準値評価サマリー、②体調10段階スコア・持病・過去推移との相関考察、③主治医への確認ポイント・生活アドバイスを生成します。

---

## 技術スタック

- **フロントエンド**: Angular 19 (Standalone Components, Signals, SVG 2軸チャート)
- **バックエンド**: Cloudflare Workers (`worker/index.ts`, `worker/ai-providers.ts`)
- **データベース**: Cloudflare D1 (SQLite) + ローカル開発用インメモリ自動フォールバック（初期サンプル4回分シード済み）
- **単体テスト**: Node.js 標準テストランナー (`node --experimental-strip-types --test`)
- **CI/CD**: GitHub Actions (`.github/workflows/deploy.yml`)

---

## ローカル起動・テスト手順

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. 単体テストの実行

```bash
npm test
```

### 3. フロントエンドのビルド & Worker ローカル起動

```bash
# Angular 本番ビルド（dist/lab-result-analyzer/browser に出力）
npm run build:web

# ローカル D1 マイグレーション適用（任意：未適用でも自動作成＆シードされます）
npm run db:migrate:local

# Cloudflare Workers + Static Assets のローカル起動
npm run dev:worker
```

> `npm start` (`ng serve`) 単体で起動した場合でも、フロントエンド内蔵のフォールバック機構により全画面・全機能をプレビューできます。

---

## Cloudflare D1 & Workers 自動デプロイ設定手順

本リポジトリには GitHub Actions ワークフロー（`.github/workflows/deploy.yml`）が含まれており、`main` ブランチへの push 時に「単体テスト → Angular ビルド → D1 マイグレーション → Cloudflare Workers デプロイ」が自動実行されます。

### ステップ 1: Cloudflare D1 データベースの作成

初回のみ、ローカル端末または Cloudflare ダッシュボードで D1 データベースを作成します。

```bash
npx wrangler d1 create lab-result-db
```

出力された `database_id` を `wrangler.jsonc` の `d1_databases[0].database_id` に設定してください。

### ステップ 2: GitHub Secrets の登録

GitHub リポジトリの **Settings > Secrets and variables > Actions** に以下のシークレットを登録します：

| Secret 名 | 説明 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare Workers と D1 の編集権限を持つ API トークン |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare アカウント ID |

### ステップ 3: AI プロバイダ API キーの設定（任意）

サーバー側でデフォルトの AI API キーを設定する場合は、Worker シークレットとして登録します（画面上の「設定」タブからブラウザ単位で API キーを指定して利用することも可能です）。

```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
```
