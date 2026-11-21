// Stable error codes (ADR-030 準拠). Worker・Client・Test で共有する単一カタログ。
// 画面には絶対に出さず、サーバーログと JSON エラー応答 `{"error":{"code","requestId"}}` にのみ使用する。

export const SERVER_ERROR_CODES = {
  AUTH_SESSION_REQUIRED: { status: 401 },
  AUTH_UNAVAILABLE: { status: 401 },
  AUTH_ORIGIN_MISMATCH: { status: 403 },
  AUTH_CSRF_MISMATCH: { status: 403 },
  AUTH_NOT_ADMIN: { status: 403 },
  REQUEST_INVALID: { status: 400 },
  PAYLOAD_TOO_LARGE: { status: 413 },
  ROUTE_NOT_FOUND: { status: 404 },
  METHOD_NOT_ALLOWED: { status: 405 },
  RATE_LIMITED: { status: 429 },
  SERVICE_PAUSED: { status: 503 },
  CIRCUIT_OPEN: { status: 503 },
  RECORD_NOT_FOUND: { status: 404 },
  PLAN_LIMIT_REACHED: { status: 409 },
  INTERNAL: { status: 500 },
} as const satisfies Record<string, { status: number }>;

export type ServerErrorCode = keyof typeof SERVER_ERROR_CODES;
export type ClientOnlyErrorCode = 'NETWORK' | 'UNKNOWN';
export type AppErrorCode = ServerErrorCode | ClientOnlyErrorCode;

export const REQUEST_ID_HEADER = 'x-karada-request-id';

export function isServerErrorCode(value: unknown): value is ServerErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SERVER_ERROR_CODES, value);
}

/**
 * 画面に表示するやさしい日本語案内（ADR-030: (1)何が起きたか (2)保存されたか (3)次に何をすればよいか）
 */
export function friendlyErrorMessage(code: unknown, context: 'read' | 'write' | 'delete' | 'ocr' = 'read'): string {
  const savedNotice =
    context === 'write'
      ? '入力中の内容はまだ保存されていませんが、画面に残っています。'
      : context === 'delete'
        ? '記録は削除されていません。'
        : '';

  switch (code) {
    case 'SERVICE_PAUSED':
    case 'CIRCUIT_OPEN':
      return `ただいまアクセスが集中しているか、点検のため一時的に止めています。${savedNotice}しばらく時間をおいてから、もう一度開いてください。`;
    case 'RATE_LIMITED':
      return `短時間に操作が重なったため、一時的にお待ちいただいています。${savedNotice}1分ほどあけてから、もう一度お試しください。`;
    case 'REQUEST_INVALID':
      return `入力内容に確認が必要な項目があります。${savedNotice}日付や数値をご確認のうえ、もう一度お試しください。`;
    case 'PAYLOAD_TOO_LARGE':
      return `画像またはファイルのサイズが大きすぎます。もう少し小さい写真を選ぶか、直接数値を入力してください。`;
    case 'AUTH_SESSION_REQUIRED':
    case 'AUTH_CSRF_MISMATCH':
      return `ログインの有効期限が切れました。${savedNotice}画面を開き直してから、もう一度お試しください。`;
    case 'PLAN_LIMIT_REACHED':
      return `今月の自動読み取り回数の上限に達しました。数値の手入力はそのままお使いいただけます。`;
    case 'RECORD_NOT_FOUND':
      return `指定された記録が見つかりませんでした。画面を開き直して最新の状態をご確認ください。`;
    case 'NETWORK':
      return `通信がうまくいきませんでした。${savedNotice}電波の良いところで、もう一度お試しください。`;
    default:
      if (context === 'ocr') {
        return '紙の読み取りがうまくいきませんでした。下の欄から直接数値を入力してお使いいただけます。';
      }
      return `うまく処理できませんでした。${savedNotice}しばらくしてから、もう一度お試しください。`;
  }
}
