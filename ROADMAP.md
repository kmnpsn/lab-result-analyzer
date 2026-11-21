# ROADMAP.md — からだ手帳（`lab-result-analyzer`）開発ロードマップ

本リポジトリを工程管理・仕様の正本（Single Source of Truth: SoT）とする。

---

## 1. 現在地（Current State: 2026-11-22）

- **Current Phase:** Core v1 COMPLETE（本番 Workers + D1 稼働中: `https://lab-result-analyzer.kmnpsn.workers.dev`）
- **Next Phase:** Phase A（運用の足場・定期バックアップ）/ Phase B（招待制ログインの本番接続）

| Phase | 名称 | 状態 | 概要 |
| --- | --- | --- | --- |
| **P1** | フルスタック基盤 & D1 構築 | **COMPLETE** | Angular + Cloudflare Workers + D1 + UUID 秘匿デプロイ基盤（`185ffbc`, `095ddcf`） |
| **P2** | 採血記録 & 2軸相関グラフ | **COMPLETE** | 男女別21項目基準値、画像/文字読み取り、2軸 SVG チャート、相関エンジン（`6703057`） |
| **P3** | スマホ PWA & 家計簿流 UI | **COMPLETE** | 下部固定4タブ、タブ別ヘッダー色、2〜3行カード化、横はみ出し解消（`efa66e3`, `26c1264`） |
| **P4** | 毎日の体調日記 & 汎用5軸化 | **COMPLETE** | 採血なしの日記モード、汎用5軸スコア、症状タグ、CSV 出力（`6aeb08a`） |
| **P5** | 3段構え防御 & ブランド確定 | **COMPLETE** | セキュリティヘッダー、サーキットブレーカー、ADR-030、「からだ手帳」＆お揃いアイコン（`8549491`） |
| **P6** | 認証・招待制・SNS後追い連携実装 | **COMPLETE** | `0003` D1 適用、初回 Owner `BOOTSTRAP_OWNER_EMAIL`、Google OIDC、招待リンク、6種 SNS 後追い連携、単体テスト 20件 PASS |

---

## 2. 正式運用・一般公開・有料化までの道筋（Phase A 〜 Phase D）

家計簿アプリ（`kakeibo-app`）の `docs/roadmap-official-operation.md` と同じ段階・関門（Human Gate）で進める。

| Phase | 内容 | 入る条件（Gate） |
| --- | --- | --- |
| **Phase A** | **運用の足場（バックアップ・監視）** | Core v1 完了後（現在ここ） |
| **Phase B** | **招待制ログインの実接続（家族・クローズド利用）** | Gate B: Phase A が完了し、日々の体調日記・採血記録が実機で問題なく使えている |
| **Phase C** | **一般公開（誰でも登録できる状態）** | Gate C: Owner が一般公開すると決める |
| **Phase D** | **有料化（フリーミアム / サブスク導入）** | Gate D: Owner が料金プランと開始時期を決める |

### Phase A：運用の足場
- **A-1 定期暗号化バックアップ**: GitHub Actions で毎日 D1 データを書き出し、`BACKUP_PASSPHRASE` で暗号化して保存する仕組みと復元手順書（runbook）の整備。
- **A-2 障害・サーキットブレーカー発火の把握**: ADR-030 の固定エラーコード（`CIRCUIT_OPEN`, `INTERNAL` 等）に基づくログ確認手順とメンテナンススイッチ運用手順の整備。
- **A-3 費用の見張り**: Cloudflare Workers / D1 無料枠および AI API 利用量の月次確認手順。

### Phase B：招待制のまま正式運用（マルチユーザー実接続・設計正本: [`docs/production-login.md`](docs/production-login.md)）
- **B-1 初回 Owner 登録（`BOOTSTRAP_OWNER_EMAIL`）と Google OIDC ログイン＋招待リンク（`/invite/:token`）**:
  - 管理者不在時のみ `BOOTSTRAP_OWNER_EMAIL` で最初の Owner を招待なし登録し、2人目以降は Owner が発行する 1 回限りの招待 URL で登録する。すべての記録を `user_id`（所有者境界）で完全分離する。
- **B-2 外部 Identity 分離（`auth_identities`）による SNS 後追い連携基盤**:
  - Google で登録したあと、設定画面から Apple ID / LINE / Yahoo! / Facebook / Amazon 等を同じ `user_id` に追加連携できる仕組み。
- **B-3 アカウントと健康データの自己削除**: 利用者自身が自分のアカウントと全記録を消去できる機能。
- **B-4 診察用サマリー印刷 / PDF 出力**: 主治医に見せやすい 1 枚サマリー表示。

### Phase C：一般公開
- **C-1 登録モード切替**: `REGISTRATION_MODE=invite_only` から `open` への切り替えと、利用規約・プライバシーポリシー同意ステップの必須化。
- **C-2 外部 ID プロバイダ拡張**: Google に加え、Apple ID / LINE / Yahoo 等のソーシャルログイン対応。
- **C-3 悪用・スパム対策の強化**: 新規登録・画像読み取り API のユーザー単位レート制限。

### Phase D：有料化（課金接続）
- **D-1 無料枠と有料枠（Plus / Pro）の確定**:
  - 無料プラン: 日々の体調日記・手入力採血記録・基本グラフ・CSV 書き出しは無制限、カメラ AI 自動読み取りは月 N 回まで。
  - Plus / Pro プラン: カメラ AI 読み取り枠の拡大、長期の詳細相関レポート、診察用 PDF 出力など。
- **D-2 決済サービス連携**: Stripe 等の外部決済と `users.plan_tier` の連動（カード情報は本アプリで保持しない）。
- **D-3 特定商取引法に基づく表記・有料利用規約の整備**。
