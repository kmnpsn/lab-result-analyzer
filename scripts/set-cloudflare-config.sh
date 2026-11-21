#!/usr/bin/env bash
# チャットログやシェル履歴、Gitリポジトリに D1 Database ID (UUID) 等を残さず
# ~/.config/lab-result-analyzer/cloudflare.env (chmod 600) に保存するスクリプト。

set -euo pipefail

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/lab-result-analyzer"
CONFIG_FILE="$CONFIG_DIR/cloudflare.env"

umask 077
mkdir -p "$CONFIG_DIR"

# 既存値があれば読み込む（画面には表示しない）
if [ -f "$CONFIG_FILE" ]; then
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
fi

echo "=== Cloudflare 設定の安全な登録（入力値は画面に表示されません）==="
echo "保存先: $CONFIG_FILE (permission 600)"
echo ""

read -r -s -p "1. D1 Database ID (CF_D1_DATABASE_ID) [空Enterで既存維持]: " input_db_id
echo ""
if [ -n "${input_db_id:-}" ]; then
  CF_D1_DATABASE_ID="$(printf '%s' "$input_db_id" | tr -d ' \t\r\n')"
fi

read -r -s -p "2. Cloudflare Account ID (CLOUDFLARE_ACCOUNT_ID) [任意・空Enterでスキップ]: " input_acc_id
echo ""
if [ -n "${input_acc_id:-}" ]; then
  CLOUDFLARE_ACCOUNT_ID="$(printf '%s' "$input_acc_id" | tr -d ' \t\r\n')"
fi

read -r -s -p "3. Cloudflare API Token (CLOUDFLARE_API_TOKEN) [任意・空Enterでスキップ]: " input_token
echo ""
if [ -n "${input_token:-}" ]; then
  CLOUDFLARE_API_TOKEN="$(printf '%s' "$input_token" | tr -d ' \t\r\n')"
fi

if [ -z "${CF_D1_DATABASE_ID:-}" ]; then
  echo "エラー: CF_D1_DATABASE_ID が設定されていません。" >&2
  exit 1
fi

{
  printf 'CF_D1_DATABASE_ID=%q\n' "${CF_D1_DATABASE_ID}"
  if [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
    printf 'CLOUDFLARE_ACCOUNT_ID=%q\n' "${CLOUDFLARE_ACCOUNT_ID}"
  fi
  if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
    printf 'CLOUDFLARE_API_TOKEN=%q\n' "${CLOUDFLARE_API_TOKEN}"
  fi
} > "$CONFIG_FILE"

chmod 600 "$CONFIG_FILE"
echo "保存完了: $CONFIG_FILE (UUID やトークンはログに出力していません)"
