import {
  REQUEST_ID_HEADER,
  SERVER_ERROR_CODES,
  type ServerErrorCode,
} from '../src/shared/error-codes.ts';
import { withSecurityHeaders } from '../src/shared/security-headers.ts';

export interface SecurityEnv {
  MAINTENANCE_MODE?: string;
}

export interface StructuredSecurityLog {
  level: 'info' | 'warn' | 'error';
  code: ServerErrorCode;
  status: number;
  route: string;
  requestId: string;
  timestamp: string;
}

export interface CircuitStateSnapshot {
  open: boolean;
  openUntilMs: number;
  recentErrors: number;
  reason: 'error_spike' | 'write_spike' | 'manual' | null;
}

export const CIRCUIT_WINDOW_MS = 60_000;
export const CIRCUIT_COOLDOWN_MS = 60_000;
export const CIRCUIT_ERROR_THRESHOLD = 10;
export const WRITE_RATE_LIMIT_THRESHOLD = 15;
export const WRITE_CIRCUIT_TRIP_THRESHOLD = 30;

const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': `Content-Type, Authorization, ${REQUEST_ID_HEADER}`,
  'Access-Control-Expose-Headers': `${REQUEST_ID_HEADER}, Retry-After`,
};

let errorTimestamps: number[] = [];
const writeTimestampsByClient = new Map<string, number[]>();
let circuitOpenUntilMs = 0;
let circuitReason: 'error_spike' | 'write_spike' | 'manual' | null = null;
let recentSecurityLogs: StructuredSecurityLog[] = [];

export function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `req_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  }
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 第2段: 手動メンテナンススイッチ判定
 * env.MAINTENANCE_MODE が "on" | "true" | "1" | "yes" のとき有効
 */
export function isMaintenanceMode(env?: SecurityEnv): boolean {
  const raw = String(env?.MAINTENANCE_MODE ?? '')
    .trim()
    .toLowerCase();
  return raw === 'on' || raw === 'true' || raw === '1' || raw === 'yes';
}

function pruneWindow(timestamps: number[], nowMs: number, windowMs = CIRCUIT_WINDOW_MS): number[] {
  const cutoff = nowMs - windowMs;
  return timestamps.filter((t) => t > cutoff);
}

/**
 * 第3段: オート・サーキットブレーカー状態確認
 */
export function isCircuitOpen(nowMs = Date.now()): boolean {
  if (circuitOpenUntilMs > nowMs) {
    return true;
  }
  if (circuitOpenUntilMs !== 0 && circuitOpenUntilMs <= nowMs) {
    circuitOpenUntilMs = 0;
    circuitReason = null;
  }
  return false;
}

export function getCircuitState(nowMs = Date.now()): CircuitStateSnapshot {
  errorTimestamps = pruneWindow(errorTimestamps, nowMs);
  const open = isCircuitOpen(nowMs);
  return {
    open,
    openUntilMs: open ? circuitOpenUntilMs : 0,
    recentErrors: errorTimestamps.length,
    reason: open ? circuitReason : null,
  };
}

export function tripCircuitBreaker(
  reason: 'error_spike' | 'write_spike' | 'manual' = 'manual',
  cooldownMs = CIRCUIT_COOLDOWN_MS,
  nowMs = Date.now()
): void {
  circuitOpenUntilMs = nowMs + cooldownMs;
  circuitReason = reason;
}

export function resetSecurityState(): void {
  errorTimestamps = [];
  writeTimestampsByClient.clear();
  circuitOpenUntilMs = 0;
  circuitReason = null;
  recentSecurityLogs = [];
}

export const resetCircuitBreaker = resetSecurityState;

/**
 * 内部エラー発生時のカウント記録。
 * 短時間（60秒窓）に連続内部エラー（10回以上）が発生したら自動でサーキットを開く。
 */
export function recordServerFailure(nowMs = Date.now()): boolean {
  errorTimestamps = pruneWindow(errorTimestamps, nowMs);
  errorTimestamps.push(nowMs);
  if (errorTimestamps.length >= CIRCUIT_ERROR_THRESHOLD) {
    tripCircuitBreaker('error_spike', CIRCUIT_COOLDOWN_MS, nowMs);
    return true;
  }
  return false;
}

export function extractClientKey(request: Request): string {
  const cfIp = request.headers.get('cf-connecting-ip')?.trim();
  if (cfIp) return cfIp;
  const xff = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (xff) return xff;
  return 'default-client';
}

/**
 * 同一クライアントからの過剰書き込み監視（レート制限 & オート・サーキットブレーカー）
 */
export function recordWriteAttempt(
  clientKey: string,
  nowMs = Date.now()
): {
  allowed: boolean;
  code?: 'RATE_LIMITED' | 'CIRCUIT_OPEN';
  retryAfterSeconds?: number;
} {
  const key = clientKey || 'default-client';
  const prev = writeTimestampsByClient.get(key) || [];
  const pruned = pruneWindow(prev, nowMs);
  pruned.push(nowMs);
  writeTimestampsByClient.set(key, pruned);

  if (pruned.length >= WRITE_CIRCUIT_TRIP_THRESHOLD) {
    tripCircuitBreaker('write_spike', CIRCUIT_COOLDOWN_MS, nowMs);
    return {
      allowed: false,
      code: 'CIRCUIT_OPEN',
      retryAfterSeconds: 60,
    };
  }

  if (pruned.length > WRITE_RATE_LIMIT_THRESHOLD) {
    return {
      allowed: false,
      code: 'RATE_LIMITED',
      retryAfterSeconds: 60,
    };
  }

  return { allowed: true };
}

/**
 * ADR-030 準拠の構造化ログ出力。
 * 症状メモ・検査値・氏名等の医療/個人情報は一切含めず、
 * level, code, status, route, requestId, timestamp のみを記録する。
 */
export function logStructuredSecurityEvent(params: {
  level: 'info' | 'warn' | 'error';
  code: ServerErrorCode;
  status: number;
  route: string;
  requestId: string;
}): StructuredSecurityLog {
  const entry: StructuredSecurityLog = {
    level: params.level,
    code: params.code,
    status: params.status,
    route: params.route,
    requestId: params.requestId,
    timestamp: new Date().toISOString(),
  };
  recentSecurityLogs.push(entry);
  if (recentSecurityLogs.length > 100) {
    recentSecurityLogs.shift();
  }
  return entry;
}

export function getRecentSecurityLogs(): ReadonlyArray<StructuredSecurityLog> {
  return recentSecurityLogs;
}

/**
 * 第1段: 全レスポンスにセキュリティヘッダー・CORSヘッダー・x-karada-request-id を付与
 */
export function finalizeResponse(
  response: Response,
  requestId: string,
  extraHeaders?: Record<string, string>
): Response {
  const secured = withSecurityHeaders(response);
  secured.headers.set(REQUEST_ID_HEADER, requestId);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    if (!secured.headers.has(k)) {
      secured.headers.set(k, v);
    }
  }
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      secured.headers.set(k, v);
    }
  }
  return secured;
}

/**
 * ADR-030 固定エラーコード応答 `{"error":{"code","requestId"}}`
 */
export function createErrorResponse(
  code: ServerErrorCode,
  requestId: string,
  options?: {
    route?: string;
    retryAfterSeconds?: number;
    headers?: Record<string, string>;
  }
): Response {
  const status = SERVER_ERROR_CODES[code].status;
  const route = options?.route || '/api';
  logStructuredSecurityEvent({
    level: status >= 500 ? 'error' : 'warn',
    code,
    status,
    route,
    requestId,
  });

  const extraHeaders: Record<string, string> = {
    'Cache-Control': 'no-store',
    ...(options?.headers || {}),
  };
  if (options?.retryAfterSeconds !== undefined) {
    extraHeaders['Retry-After'] = String(options.retryAfterSeconds);
  }

  const raw = new Response(
    JSON.stringify({
      error: {
        code,
        requestId,
      },
    }),
    {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
    }
  );

  return finalizeResponse(raw, requestId, extraHeaders);
}

/**
 * `/api/*` リクエストに対する第2段（手動メンテナンススイッチ）＆第3段（オート・サーキットブレーカー＆レート制限）ゲート
 * 遮断時は DB に一切触れず即座にエラー Response を返す。通過時は null を返す。
 */
export function evaluateSecurityGate(
  request: Request,
  env: SecurityEnv | undefined,
  requestId: string,
  nowMs = Date.now()
): Response | null {
  const url = new URL(request.url);
  const route = url.pathname;

  // 第2段: 手動メンテナンススイッチ
  if (isMaintenanceMode(env)) {
    return createErrorResponse('SERVICE_PAUSED', requestId, {
      route,
      retryAfterSeconds: 300,
    });
  }

  // 第3段: オート・サーキットブレーカーが既に開いている場合
  if (isCircuitOpen(nowMs)) {
    return createErrorResponse('CIRCUIT_OPEN', requestId, {
      route,
      retryAfterSeconds: 60,
    });
  }

  // 第3段: 書き込み系リクエストのレート制限 & スパイク検知
  const method = request.method.toUpperCase();
  if (method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH') {
    const clientKey = extractClientKey(request);
    const guard = recordWriteAttempt(clientKey, nowMs);
    if (!guard.allowed && guard.code) {
      return createErrorResponse(guard.code, requestId, {
        route,
        retryAfterSeconds: guard.retryAfterSeconds ?? 60,
      });
    }
  }

  return null;
}
