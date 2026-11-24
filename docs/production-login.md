# 本番ログイン・招待制・SNS後追い連携 設計書

`kakeibo-app` の本番ログイン設計（ADR-007 / ADR-026 / `docs/production-login.md`）をベースに、「からだ手帳（`lab-result-analyzer`）」向けに整備した認証・招待・外部 ID 連携の正本（SoT）設計書。

---

## 1. 方針の要約

1. **一般的なログイン動線**:
   - 「ログインボタン押下 → Google（または連携済み SNS）で認証 → 初めてなら新規登録、登録済みならログイン」の一本道にする。
2. **初回 Owner 登録（`BOOTSTRAP_OWNER_EMAIL`）**:
   - 最初の 1 人目（Owner）はまだ誰も招待リンクを作れないため、Worker 環境変数 `BOOTSTRAP_OWNER_EMAIL` に Owner の Google メールアドレスを設定する。
   - `service_role='admin'` の User が 0 人の間だけ、そのメールの検証済み Google アカウントが招待なしで初回登録でき、自動的に `service_role='admin'`（Owner）になる。
3. **一般公開までは招待制（`REGISTRATION_MODE=invite_only|open`）**:
   - 2 人目以降は、Owner がアプリ内の「家族・知人を招待」画面から発行した 1 回限り・期限つきの招待 URL（`https://<host>/invite/<token>`）を受け取った人だけが新規登録できる。
   - 招待された人には **その人専用の「からだ手帳」（独立した `user_id` 境界）** が作られ、他人の採血結果や体調日記は一切見えない。
   - 一般公開時は環境変数を `REGISTRATION_MODE=open` に変えるだけで、招待なしでの新規登録（＋利用規約・プライバシー同意ステップ）に切り替わる。
4. **外部 Identity と内部 User の分離・各種 SNS の後追い連携（ADR-008）**:
   - 内部の `users` テーブルと、外部認証プロバイダの `auth_identities(provider, provider_subject, user_id)` テーブルを分離する。
   - `provider` は `google | apple | line | yahoo_japan | facebook | amazon` などの拡張可能な識別子とし、Google 固定の enum にはしない。
   - **後追い連携（マルチログイン）**: ログイン済みの利用者が「設定 ＞ ログイン方法の連携」から Apple ID / LINE / Yahoo / Facebook / Amazon 等を追加認証すると、`(provider, sub)` が未接続であることを確認したうえで同じ内部 `user_id` に紐付けられる（どの SNS からでも同じ自分の「からだ手帳」にログイン可能）。
   - **乗っ取り防止**: メールアドレスが同じという理由だけでの自動統合は行わない（必ずログイン済みセッションからの明示的な「連携追加」操作で紐付ける）。連携解除は有効なログイン手段が 1 つ以上残る場合のみ許可する。
5. **デモモードとの両立**:
   - `AUTH_MODE=demo` の環境では、OAuth Secret 未設定でも固定のデモユーザーで全画面・機能をそのまま試せる。

---

## 2. 認証・招待・後追い連携シーケンス

### 2.1 初回ログイン / 新規登録（Google OIDC + PKCE）
```text
利用者 -> Worker: GET /api/auth/google/start[?invite=<招待token>]
Worker: state / nonce / PKCE verifier を生成し、10分有効・HttpOnly の
        __Host-karada_oauth Cookie に HMAC 署名付きで保存（招待tokenがあれば同梱）
Worker -> 利用者: 302 Google 認可 URL へリダイレクト
Google -> Worker: GET /api/auth/google/callback?code&state
Worker: transaction Cookie を即削除し state を定数時間比較、code をトークン交換して ID token (RS256) を検証
Worker -> D1: auth_identities(provider='google', provider_subject=sub) を検索
  [A] 登録済み:
      紐づく user_id の Session を発行
  [B] 未登録 かつ admin 不在 かつ email == BOOTSTRAP_OWNER_EMAIL:
      同一 D1 batch で users(service_role='admin') + auth_identities + Session を作成
  [C] 未登録 かつ REGISTRATION_MODE=invite_only:
      有効・未使用の招待（token_hash 一致 かつ email_normalized 一致）を原子的に消費できた場合のみ、
      同一 D1 batch で users(service_role='user') + auth_identities + Session を作成
  [D] 未登録 かつ REGISTRATION_MODE=open:
      利用規約・プライバシー同意を確認のうえ users + auth_identities + Session を作成
  [E] 上記以外（招待外）:
      User・Session を作らず /login?error=not_invited へリダイレクト
Worker -> 利用者: Set-Cookie __Host-karada_session + 302 /
```

### 2.2 招待リンクの作成と利用（Owner のみ）
```text
Owner -> 設定「家族・知人を招待」: 相手のメールアドレスを入力して「招待をつくる」
Worker: token (32byte乱数) を生成し、D1 invitations には HMAC-SHA-256(token) のみ保存。
        画面には https://<host>/invite/<token> を1度だけ表示（再表示なし）。
Owner -> 相手: LINE 等で招待 URL を送る
相手 -> GET /invite/<token>:
        Worker が Referrer-Policy: no-referrer, Cache-Control: no-store 付きで SPA を返し、
        「招待を受けています — Googleで登録」画面から 2.1 へ進む。
```

### 2.3 各種 SNS アカウントの後追い連携（ログイン済み User）
```text
ログイン済み利用者 -> 設定「ログイン方法の追加連携」:
  「LINE を連携する」「Apple ID を連携する」「Yahoo! を連携する」等を選択
利用者 -> Worker: GET /api/auth/<provider>/link
Worker: 現在の有効な Session (user_id) を確認し、link_user_id を含めた署名付き transaction Cookie を発行
Provider -> Worker: GET /api/auth/<provider>/callback?code&state
Worker:
  1. Session の user_id と transaction Cookie の link_user_id が一致することを確認
  2. Provider の ID token / userinfo から (provider, provider_subject) を検証
  3. (provider, provider_subject) が既に別 user_id に紐づいている場合は 409 STATE_CONFLICT で拒否
  4. 未登録なら auth_identities に (user_id, provider, provider_subject, email) を INSERT
  5. 設定画面へ戻り「連携しました」を表示
```

---

## 3. データモデル（Cloudflare D1）

```sql
-- users: 内部ユーザー（健康データの所有者境界）
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT UNIQUE,                    -- 不透明な内部識別子 (例: u_xxx)
  email TEXT,
  display_name TEXT NOT NULL DEFAULT 'ゲスト',
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'member')),
  service_role TEXT NOT NULL DEFAULT 'user' CHECK (service_role IN ('admin', 'user')),
  plan_tier TEXT NOT NULL DEFAULT 'free' CHECK (plan_tier IN ('free', 'plus', 'pro')),
  monthly_ocr_used INTEGER NOT NULL DEFAULT 0,
  monthly_ocr_limit INTEGER NOT NULL DEFAULT 10,
  terms_accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- auth_identities: 外部認証プロバイダとの 1対多 紐付け（後追いSNS連携用）
CREATE TABLE IF NOT EXISTS auth_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,                   -- 'google' | 'apple' | 'line' | 'yahoo_japan' | 'facebook' | 'amazon'
  provider_subject TEXT NOT NULL,           -- OIDC sub またはプロバイダ固有ユーザーID
  email_snapshot TEXT,
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, provider_subject)
);
CREATE INDEX IF NOT EXISTS idx_auth_identities_user_id ON auth_identities(user_id);

-- auth_sessions: 失効可能な D1 セッション（平文トークンは保存しない）
CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,                      -- HMAC-SHA-256(session_token)
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  absolute_expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- invitations: 1回限り・期限つきの招待（平文トークンは保存しない）
CREATE TABLE IF NOT EXISTS invitations (
  token TEXT PRIMARY KEY,                   -- HMAC-SHA-256(invite_token)
  email_normalized TEXT,
  email_display TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note TEXT NOT NULL DEFAULT '',
  consumed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  consumed_at TEXT,
  revoked_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## 4. Cookie・CSRF・秘匿情報の扱い

- **Session Cookie**: `__Host-karada_session=<32byte乱数>`、`Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2419200`（28日）。D1 には `SESSION_SECRET` による HMAC ハッシュのみ保存する。
- **CSRF 防御**: GET / HEAD 以外のすべての変更系 API で `Origin` 完全一致と `X-Karada-CSRF` ヘッダー（Session から導出したトークンとの定数時間比較）を検証する。
- **Referrer 保護**: `/invite/*` と `/api/auth/*` の応答には `Referrer-Policy: no-referrer` と `Cache-Control: no-store` を付与し、招待トークンや認可コードを外部へ漏らさない。
- **Secrets（Cloudflare 側で Owner が管理・リポジトリ非保存）**:
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `OAUTH_TRANSACTION_SECRET`
  - 非 Secret 変数: `REGISTRATION_MODE`（`invite_only` / `open`）、`BOOTSTRAP_OWNER_EMAIL`、`GOOGLE_REDIRECT_URI`、`AUTH_MODE`（`demo` / `production`）

---

## 5. Owner の手順（Google のログイン設定作成 〜 Cloudflare 登録）

### 手順 1: Google Cloud Console で OAuth クライアントを作る（10分）

1. https://console.cloud.google.com/ を開き、上部のプロジェクト選択から新しいプロジェクト（例: `karada-techo`）を作る（または既存プロジェクトを選ぶが、同意画面のアプリ名を「からだ手帳」にするため新プロジェクト推奨）。
2. 左メニューから **「Google Auth Platform」**（または **「API とサービス」＞「OAuth 同意画面」**）を開き、「開始」を押す。
   - **アプリ名**: `からだ手帳`
   - **ユーザー サポートメール**: ご自身のメールアドレス
   - **対象（User Type）**: `外部`
   - **デベロッパーの連絡先情報**: ご自身のメールアドレスを入れて作成する。
3. **「対象」（または「テストユーザー」）** 画面で、テストユーザーとして **ご自身と招待したいご家族の Google アカウント** を追加する（一般公開するまでは「テスト」のままで問題ありません）。
4. **「クライアント」＞「クライアントを作成」**（または「認証情報を作成」＞「OAuth クライアント ID」）を押す。
   - **アプリケーションの種類**: `ウェブ アプリケーション`
   - **名前**: `からだ手帳 Web`
   - **承認済みの JavaScript 生成元**:
     ```text
     https://lab-result-analyzer.kmnpsn.workers.dev
     ```
   - **承認済みのリダイレクト URI**（1文字でも違うと動かないためそのままコピー）:
     ```text
     https://lab-result-analyzer.kmnpsn.workers.dev/api/auth/google/callback
     ```
5. 作成すると **「クライアント ID」** と **「クライアント シークレット」** が表示されるため、画面を開いたまま次の手順へ進む。

### 手順 2: Cloudflare Worker に設定を登録する（3分）

ターミナルで `lab-result-analyzer` フォルダを開き、以下のワンコマンド登録スクリプトを実行する（入力した Client ID / Secret は画面やログに残らず、`SESSION_SECRET` と `OAUTH_TRANSACTION_SECRET` は `openssl rand -base64 32` で自動生成されます）：

```bash
cd ~/work/lab-result-analyzer
npm run cf:oauth
```

（※ 1行ずつ手動で登録したい場合は以下でも同じです）
```bash
npx wrangler secret put GOOGLE_CLIENT_ID --name lab-result-analyzer
npx wrangler secret put GOOGLE_CLIENT_SECRET --name lab-result-analyzer
npx wrangler secret put GOOGLE_REDIRECT_URI --name lab-result-analyzer
npx wrangler secret put BOOTSTRAP_OWNER_EMAIL --name lab-result-analyzer
openssl rand -base64 32 | npx wrangler secret put SESSION_SECRET --name lab-result-analyzer
openssl rand -base64 32 | npx wrangler secret put OAUTH_TRANSACTION_SECRET --name lab-result-analyzer
```

- D1 のログイン用テーブル（`0003_auth_identities_and_invites.sql`）と Worker コードは **すでに本番へ適用・デプロイ済み** のため、上記を登録した瞬間から https://lab-result-analyzer.kmnpsn.workers.dev で本物の Google ログイン（招待制）がそのまま動きます。

---

## 6. LINE Login の開通手順（無料・個人開発可・所要約 5〜10 分）

LINE Login を登録すると、コードの再デプロイなしで **ログイン画面の「LINE でログイン」** と **設定画面の「LINE を後追い連携」** が自動的に有効になります。

### 手順 1: LINE Developers コンソールでチャネルを作る
1. https://developers.line.biz/console/ を開き、ご自身の LINE アカウントでログインする。
2. **プロバイダー** を作成する（例: `TakTech` または `からだ手帳`）。
3. **「新規チャネル作成」＞「LINEログイン」** を選ぶ。
   - **チャネル名**: `からだ手帳`
   - **チャネル説明**: `日々の体調日記と採血結果を記録・管理するアプリ`
   - **アプリタイプ**: `ウェブアプリ` にチェック
   - **メールアドレス**: ご自身のメールアドレス
4. 作成後、**「LINEログイン設定」** タブを開き、**コールバック URL** に以下を登録する：
   ```text
   https://lab-result-analyzer.kmnpsn.workers.dev/api/auth/line/callback
   ```
5. （任意・招待登録でも使いたい場合）**「チャネル基本設定」** タブの下部にある **「メールアドレス取得権限」** を「申請」して有効化しておくと、LINE 経由の招待登録時にもメールアドレス照合ができます（Google で登録したあとに LINE を後追い連携するだけならメール権限なしでも動作します）。
6. チャネル上部のステータスが「開発中」のままだと自分のアカウントしか使えないため、家族・招待ユーザーも使う場合は **「公開」** に切り替える。
7. **「チャネル基本設定」** タブに表示される **チャネル ID** と **チャネルシークレット** を控える。

### 手順 2: ワンコマンドで Cloudflare Worker に登録する
```bash
cd ~/work/lab-result-analyzer
npm run cf:line
```

---

## 7. Amazon（Login with Amazon）の開通手順（無料・個人開発可・所要約 5〜10 分）

※ 将来の課金（Amazon Pay）を見据えた **Amazon アカウントログイン／後追い連携** の開通手順です（Login with Amazon 自体は無料で個人でも即開通できます。将来の実決済・Amazon Pay 接続時は Phase D にて Seller Central の加盟店登録を別途行います）。

### 手順 1: Amazon Developer Console でセキュリティプロファイルを作る
1. https://developer.amazon.com/loginwithamazon/console/site/lwa/overview.html を開き、Amazon アカウントでサインインする（初回のみ開発者登録：無料）。
2. **「新しいセキュリティプロファイルの作成」** を押す。
   - **セキュリティプロファイル名**: `からだ手帳`
   - **セキュリティプロファイルの説明**: `日々の体調日記と採血結果を記録するアプリ`
   - **同意画面のプライバシー規約 URL**: `https://lab-result-analyzer.kmnpsn.workers.dev/`
3. 作成後、一覧の歯車アイコンから **「ウェブ設定」** を開き、「編集」を押す。
   - **許可された JavaScript オリジン**:
     ```text
     https://lab-result-analyzer.kmnpsn.workers.dev
     ```
   - **許可されたリターン URL**:
     ```text
     https://lab-result-analyzer.kmnpsn.workers.dev/api/auth/amazon/callback
     ```
4. 同じ「ウェブ設定」画面に表示される **クライアント ID** と **クライアントシークレット** を控える。

### 手順 2: ワンコマンドで Cloudflare Worker に登録する
```bash
cd ~/work/lab-result-analyzer
npm run cf:amazon
```
