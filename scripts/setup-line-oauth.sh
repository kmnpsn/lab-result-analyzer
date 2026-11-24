#!/usr/bin/env bash
# LINE Login の Channel ID / Channel Secret を画面・ログに出さずに受け取り、
# Cloudflare Worker へ一括登録するスクリプト。

set -euo pipefail

WORKER_NAME="lab-result-analyzer"
DEFAULT_REDIRECT_URI="https://lab-result-analyzer.kmnpsn.workers.dev/api/auth/line/callback"

echo "=== からだ手帳 LINE Login 本番設定の一括登録 ==="
echo "※ 入力した文字は画面にもログにも表示されません。"
echo ""

read -r -s -p "1. LINE チャネル ID (LINE_CHANNEL_ID): " channel_id
echo ""
channel_id="$(printf '%s' "${channel_id:-}" | tr -d ' \t\r\n')"

read -r -s -p "2. LINE チャネルシークレット (LINE_CHANNEL_SECRET): " channel_secret
echo ""
channel_secret="$(printf '%s' "${channel_secret:-}" | tr -d ' \t\r\n')"

read -r -p "3. コールバック URL [空Enterで ${DEFAULT_REDIRECT_URI}]: " redirect_uri
redirect_uri="$(printf '%s' "${redirect_uri:-$DEFAULT_REDIRECT_URI}" | tr -d ' \t\r\n')"

if [ -z "$channel_id" ] || [ -z "$channel_secret" ]; then
  echo "エラー: LINE_CHANNEL_ID と LINE_CHANNEL_SECRET は必須です。" >&2
  exit 1
fi

echo ""
echo "Cloudflare Worker ($WORKER_NAME) に LINE Login の Secret を登録しています..."

printf '%s' "$channel_id" | npx wrangler secret put LINE_CHANNEL_ID --name "$WORKER_NAME"
printf '%s' "$channel_secret" | npx wrangler secret put LINE_CHANNEL_SECRET --name "$WORKER_NAME"
printf '%s' "$redirect_uri" | npx wrangler secret put LINE_REDIRECT_URI --name "$WORKER_NAME"

echo ""
echo "✅ 完了しました！LINE ログインおよび後追い連携が自動的に有効になりました。"
