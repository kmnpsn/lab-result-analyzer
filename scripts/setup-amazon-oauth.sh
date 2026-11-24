#!/usr/bin/env bash
# Login with Amazon の Client ID / Client Secret を画面・ログに出さずに受け取り、
# Cloudflare Worker へ一括登録するスクリプト。

set -euo pipefail

WORKER_NAME="lab-result-analyzer"
DEFAULT_REDIRECT_URI="https://lab-result-analyzer.kmnpsn.workers.dev/api/auth/amazon/callback"

echo "=== からだ手帳 Amazon (Login with Amazon) 本番設定の一括登録 ==="
echo "※ 入力した文字は画面にもログにも表示されません。"
echo ""

read -r -s -p "1. Amazon クライアント ID (AMAZON_CLIENT_ID): " client_id
echo ""
client_id="$(printf '%s' "${client_id:-}" | tr -d ' \t\r\n')"

read -r -s -p "2. Amazon クライアントシークレット (AMAZON_CLIENT_SECRET): " client_secret
echo ""
client_secret="$(printf '%s' "${client_secret:-}" | tr -d ' \t\r\n')"

read -r -p "3. リダイレクト URL [空Enterで ${DEFAULT_REDIRECT_URI}]: " redirect_uri
redirect_uri="$(printf '%s' "${redirect_uri:-$DEFAULT_REDIRECT_URI}" | tr -d ' \t\r\n')"

if [ -z "$client_id" ] || [ -z "$client_secret" ]; then
  echo "エラー: AMAZON_CLIENT_ID と AMAZON_CLIENT_SECRET は必須です。" >&2
  exit 1
fi

echo ""
echo "Cloudflare Worker ($WORKER_NAME) に Amazon ログインの Secret を登録しています..."

printf '%s' "$client_id" | npx wrangler secret put AMAZON_CLIENT_ID --name "$WORKER_NAME"
printf '%s' "$client_secret" | npx wrangler secret put AMAZON_CLIENT_SECRET --name "$WORKER_NAME"
printf '%s' "$redirect_uri" | npx wrangler secret put AMAZON_REDIRECT_URI --name "$WORKER_NAME"

echo ""
echo "✅ 完了しました！Amazon ログインおよび後追い連携が自動的に有効になりました。"
