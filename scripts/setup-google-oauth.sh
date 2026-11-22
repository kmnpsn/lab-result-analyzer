#!/usr/bin/env bash
# Google OAuth の Client ID / Secret と初回 Owner メールを画面・ログに出さずに受け取り、
# SESSION_SECRET / OAUTH_TRANSACTION_SECRET の自動生成と合わせて Cloudflare Worker へ一括登録するスクリプト。

set -euo pipefail

WORKER_NAME="lab-result-analyzer"
DEFAULT_REDIRECT_URI="https://lab-result-analyzer.kmnpsn.workers.dev/api/auth/google/callback"

echo "=== からだ手帳 Google OAuth 本番設定の一括登録 ==="
echo "※ 入力した文字は画面にもログにも表示されません。"
echo ""

read -r -s -p "1. Google クライアント ID (GOOGLE_CLIENT_ID): " client_id
echo ""
client_id="$(printf '%s' "${client_id:-}" | tr -d ' \t\r\n')"

read -r -s -p "2. Google クライアント シークレット (GOOGLE_CLIENT_SECRET): " client_secret
echo ""
client_secret="$(printf '%s' "${client_secret:-}" | tr -d ' \t\r\n')"

read -r -p "3. 初回 Owner の Google メールアドレス (BOOTSTRAP_OWNER_EMAIL): " owner_email
owner_email="$(printf '%s' "${owner_email:-}" | tr -d ' \t\r\n')"

read -r -p "4. リダイレクト URI [空Enterで ${DEFAULT_REDIRECT_URI}]: " redirect_uri
redirect_uri="$(printf '%s' "${redirect_uri:-$DEFAULT_REDIRECT_URI}" | tr -d ' \t\r\n')"

if [ -z "$client_id" ] || [ -z "$client_secret" ] || [ -z "$owner_email" ]; then
  echo "エラー: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, BOOTSTRAP_OWNER_EMAIL はすべて必須です。" >&2
  exit 1
fi

echo ""
echo "Cloudflare Worker ($WORKER_NAME) に Secret を登録しています..."

printf '%s' "$client_id" | npx wrangler secret put GOOGLE_CLIENT_ID --name "$WORKER_NAME"
printf '%s' "$client_secret" | npx wrangler secret put GOOGLE_CLIENT_SECRET --name "$WORKER_NAME"
printf '%s' "$redirect_uri" | npx wrangler secret put GOOGLE_REDIRECT_URI --name "$WORKER_NAME"
printf '%s' "$owner_email" | npx wrangler secret put BOOTSTRAP_OWNER_EMAIL --name "$WORKER_NAME"
openssl rand -base64 32 | tr -d '\r\n' | npx wrangler secret put SESSION_SECRET --name "$WORKER_NAME"
openssl rand -base64 32 | tr -d '\r\n' | npx wrangler secret put OAUTH_TRANSACTION_SECRET --name "$WORKER_NAME"
printf 'production' | npx wrangler secret put AUTH_MODE --name "$WORKER_NAME"

echo ""
echo "✅ 完了しました！Google OAuth 本番ログイン（招待制）が有効になりました。"
