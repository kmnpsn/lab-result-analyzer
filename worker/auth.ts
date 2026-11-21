import {
  AUTH_PROVIDERS,
  type AccountSummary,
  type AuthProviderId,
  type InvitationSummary,
  type LinkedIdentity,
  type PlanTier,
  type RegistrationMode,
  type ServiceRole,
  type UserProfile,
} from '../src/shared/types.ts';
import type { D1DatabaseLike } from './index.ts';
import { createErrorResponse, finalizeResponse } from './security.ts';

export interface AuthEnv {
  AUTH_MODE?: 'demo' | 'production' | string;
  REGISTRATION_MODE?: RegistrationMode;
  BOOTSTRAP_OWNER_EMAIL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  SESSION_SECRET?: string;
  OAUTH_TRANSACTION_SECRET?: string;
}

export const SESSION_COOKIE_NAME = '__Host-karada_session';
export const OAUTH_COOKIE_NAME = '__Host-karada_oauth';
export const CSRF_HEADER_NAME = 'x-karada-csrf';
export const SESSION_MAX_AGE_SECONDS = 28 * 24 * 60 * 60; // 28 days (2,419,200s)
export const OAUTH_MAX_AGE_SECONDS = 10 * 60; // 10 minutes

export interface InternalUserRecord {
  id: number;
  public_id: string;
  email: string | null;
  display_name: string;
  role: 'owner' | 'member';
  service_role: ServiceRole;
  plan_tier: PlanTier;
  monthly_ocr_used: number;
  monthly_ocr_limit: number;
  terms_accepted: boolean;
  created_at: string;
  is_demo_seed?: boolean;
}

export interface InternalSessionRecord {
  id: string; // HMAC-SHA-256(raw_session_token)
  user_id: number;
  csrf_token: string;
  expires_at: string;
  absolute_expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export interface InternalInvitationRecord {
  token: string; // HMAC-SHA-256(raw_invite_token)
  email_normalized: string;
  email_display: string;
  created_by: number;
  note: string;
  consumed_by: number | null;
  consumed_at: string | null;
  revoked_at: string | null;
  expires_at: string;
  created_at: string;
}

interface OAuthTransactionPayload {
  state: string;
  nonce: string;
  codeVerifier: string;
  invite: string | null;
  exp: number;
}

interface AuthMemoryState {
  users: InternalUserRecord[];
  identities: Array<LinkedIdentity & { user_id: number }>;
  sessions: InternalSessionRecord[];
  invitations: InternalInvitationRecord[];
  activeUserId: number | null;
  defaultCsrfToken: string;
  nextUserId: number;
  nextIdentityId: number;
  bootstrapAdminClaimed: boolean;
}

function createInitialAuthMemoryState(): AuthMemoryState {
  const now = '2026-11-10T09:00:00Z';
  return {
    users: [
      {
        id: 1,
        public_id: 'u_owner_default',
        email: 'owner@example.com',
        display_name: 'サンプル患者',
        role: 'owner',
        service_role: 'admin',
        plan_tier: 'free',
        monthly_ocr_used: 1,
        monthly_ocr_limit: 10,
        terms_accepted: true,
        created_at: now,
        is_demo_seed: true,
      },
    ],
    identities: [
      {
        id: 1,
        user_id: 1,
        provider: 'google',
        provider_subject: 'demo-google-sub-001',
        email_snapshot: 'owner@example.com',
        display_name_snapshot: 'サンプル利用者 (Google)',
        linked_at: now,
        last_used_at: now,
      },
    ],
    sessions: [],
    invitations: [],
    activeUserId: 1,
    defaultCsrfToken: 'csrf_demo_default_token_001',
    nextUserId: 2,
    nextIdentityId: 2,
    bootstrapAdminClaimed: false,
  };
}

let authMemory: AuthMemoryState = createInitialAuthMemoryState();

export function resetAuthMemoryStore(): void {
  authMemory = createInitialAuthMemoryState();
}

export function getAuthMemoryState(): AuthMemoryState {
  return authMemory;
}

const AUTH_NO_STORE_HEADERS: Readonly<Record<string, string>> = {
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

function authJsonResponse(
  data: unknown,
  requestId: string,
  status = 200,
  extraHeaders?: Record<string, string>
): Response {
  const raw = new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
  return finalizeResponse(raw, requestId, {
    ...AUTH_NO_STORE_HEADERS,
    ...(extraHeaders || {}),
  });
}

export function createStateConflictResponse(
  message: string,
  requestId: string,
  route: string
): Response {
  const raw = new Response(
    JSON.stringify({
      error: {
        code: 'STATE_CONFLICT',
        message,
        requestId,
      },
    }),
    {
      status: 409,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Karada-Route': route,
      },
    }
  );
  return finalizeResponse(raw, requestId, { ...AUTH_NO_STORE_HEADERS });
}

export function randomBytesHex(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function base64UrlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlDecodeToString(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export async function sha256Base64Url(plain: string): Promise<string> {
  const data = new TextEncoder().encode(plain);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret || 'karada-default-hmac-secret'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function getSessionSecret(env?: AuthEnv): string {
  return env?.SESSION_SECRET?.trim() || 'karada-local-session-secret-key';
}

function getOAuthSecret(env?: AuthEnv): string {
  return (
    env?.OAUTH_TRANSACTION_SECRET?.trim() ||
    env?.SESSION_SECRET?.trim() ||
    'karada-local-oauth-transaction-secret-key'
  );
}

export function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get('cookie') || '';
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) result[k] = v;
  }
  return result;
}

function buildSessionCookieHeader(rawToken: string, maxAge = SESSION_MAX_AGE_SECONDS): string {
  return `${SESSION_COOKIE_NAME}=${rawToken}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

function buildOAuthCookieHeader(value: string, maxAge = OAUTH_MAX_AGE_SECONDS): string {
  return `${OAUTH_COOKIE_NAME}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function normalizeEmail(email: unknown): string {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function maskEmailHint(email: string): string {
  const norm = normalizeEmail(email);
  const atIdx = norm.indexOf('@');
  if (atIdx <= 0) return norm;
  const local = norm.slice(0, atIdx);
  const domain = norm.slice(atIdx + 1);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}***@${domain}`;
}

export function computeInvitationStatus(
  inv: InternalInvitationRecord,
  nowMs = Date.now()
): InvitationSummary['status'] {
  if (inv.revoked_at) return 'revoked';
  if (inv.consumed_at || inv.consumed_by !== null) return 'used';
  const expMs = Date.parse(inv.expires_at);
  if (!Number.isNaN(expMs) && expMs <= nowMs) return 'expired';
  return 'pending';
}

export function toInvitationSummary(
  inv: InternalInvitationRecord,
  inviteUrl?: string,
  nowMs = Date.now()
): InvitationSummary {
  const summary: InvitationSummary = {
    token_preview: inv.token.slice(0, 12),
    email_display: inv.email_display || inv.email_normalized,
    note: inv.note || '',
    status: computeInvitationStatus(inv, nowMs),
    created_at: inv.created_at,
    expires_at: inv.expires_at,
  };
  if (inviteUrl) {
    summary.invite_url = inviteUrl;
  }
  return summary;
}

export function isValidAuthProvider(provider: unknown): provider is AuthProviderId {
  return typeof provider === 'string' && AUTH_PROVIDERS.some((p) => p.id === provider);
}

export function getProviderLabel(provider: AuthProviderId): string {
  return AUTH_PROVIDERS.find((p) => p.id === provider)?.label || provider;
}

export function resolveRegistrationMode(env?: AuthEnv): RegistrationMode {
  if (env?.REGISTRATION_MODE === 'open' || env?.REGISTRATION_MODE === 'demo') {
    return env.REGISTRATION_MODE;
  }
  return 'invite_only';
}

export function resolveAuthMode(env?: AuthEnv): 'demo' | 'production' {
  if (env?.AUTH_MODE === 'production') return 'production';
  if (env?.AUTH_MODE === 'demo') return 'demo';
  if (env?.GOOGLE_CLIENT_ID && env?.GOOGLE_REDIRECT_URI) return 'production';
  return 'demo';
}

async function signOAuthTransaction(
  payload: OAuthTransactionPayload,
  env?: AuthEnv
): Promise<string> {
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const sig = await hmacSha256Hex(getOAuthSecret(env), encoded);
  return `${encoded}.${sig}`;
}

async function verifyOAuthTransaction(
  cookieVal: string | undefined,
  env?: AuthEnv,
  nowMs = Date.now()
): Promise<OAuthTransactionPayload | null> {
  if (!cookieVal) return null;
  const dotIdx = cookieVal.indexOf('.');
  if (dotIdx <= 0) return null;
  const encoded = cookieVal.slice(0, dotIdx);
  const sig = cookieVal.slice(dotIdx + 1);
  const expectedSig = await hmacSha256Hex(getOAuthSecret(env), encoded);
  if (!constantTimeEqual(sig, expectedSig)) return null;
  try {
    const parsed = JSON.parse(base64UrlDecodeToString(encoded)) as OAuthTransactionPayload;
    if (!parsed || typeof parsed.exp !== 'number' || parsed.exp < nowMs) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function resolveCurrentSessionContext(
  request: Request | undefined,
  env: AuthEnv & { DB?: D1DatabaseLike },
  fallbackProfile?: UserProfile
): Promise<{
  authenticated: boolean;
  user: InternalUserRecord | null;
  session: InternalSessionRecord | null;
  account: AccountSummary;
}> {
  const regMode = resolveRegistrationMode(env);
  const authMode = resolveAuthMode(env);
  const cookies = request ? parseCookies(request) : {};
  const rawSessionToken = cookies[SESSION_COOKIE_NAME] || cookies['karada_session'];
  const nowIso = new Date().toISOString();

  if (env.DB) {
    let sessionRow: InternalSessionRecord | null = null;
    let userRow: Record<string, unknown> | null = null;

    if (rawSessionToken) {
      const sessionHash = await hmacSha256Hex(getSessionSecret(env), rawSessionToken);
      const foundSession = await env.DB.prepare(
        `SELECT * FROM auth_sessions WHERE id = ? AND revoked_at IS NULL AND expires_at > ?`
      )
        .bind(sessionHash, nowIso)
        .first<Record<string, unknown>>();
      if (foundSession) {
        sessionRow = {
          id: String(foundSession.id),
          user_id: Number(foundSession.user_id),
          csrf_token: String(foundSession.csrf_token || ''),
          expires_at: String(foundSession.expires_at || ''),
          absolute_expires_at: String(foundSession.absolute_expires_at || foundSession.expires_at || ''),
          revoked_at: foundSession.revoked_at ? String(foundSession.revoked_at) : null,
          created_at: String(foundSession.created_at || ''),
        };
        userRow = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`)
          .bind(sessionRow.user_id)
          .first<Record<string, unknown>>();
      }
    } else if (authMode === 'demo' && authMemory.activeUserId !== null) {
      userRow = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`)
        .bind(authMemory.activeUserId)
        .first<Record<string, unknown>>();
    }

    if (!userRow) {
      const unauthAccount: AccountSummary = {
        registration_mode: regMode,
        auth_mode: authMode,
        authenticated: false,
        email: null,
        display_name: 'ゲスト',
        plan_tier: 'free',
        monthly_ocr_used: 0,
        monthly_ocr_limit: 10,
        terms_accepted: false,
        linked_identities: [],
        invitations: [],
      };
      return { authenticated: false, user: null, session: null, account: unauthAccount };
    }

    const userId = Number(userRow.id || 1);
    const serviceRole: ServiceRole = userRow.service_role === 'user' ? 'user' : 'admin';
    const planTier: PlanTier =
      userRow.plan_tier === 'plus' || userRow.plan_tier === 'pro' ? userRow.plan_tier : 'free';

    const user: InternalUserRecord = {
      id: userId,
      public_id: String(userRow.public_id || `u_${userId}`),
      email: userRow.email ? String(userRow.email) : 'owner@example.com',
      display_name: String(userRow.display_name || fallbackProfile?.name || 'サンプル患者'),
      role: userRow.role === 'member' ? 'member' : 'owner',
      service_role: serviceRole,
      plan_tier: planTier,
      monthly_ocr_used: Number(userRow.monthly_ocr_used ?? 1),
      monthly_ocr_limit: Number(userRow.monthly_ocr_limit ?? 10),
      terms_accepted: Boolean(userRow.terms_accepted_at ?? true),
      created_at: String(userRow.created_at || nowIso),
    };

    const idRows = await env.DB.prepare(
      `SELECT * FROM auth_identities WHERE user_id = ? ORDER BY id ASC`
    )
      .bind(userId)
      .all<Record<string, unknown>>();
    const linkedIdentities: LinkedIdentity[] = (idRows.results || []).map((r) => ({
      id: Number(r.id),
      provider: (r.provider as AuthProviderId) || 'google',
      provider_subject: String(r.provider_subject || ''),
      email_snapshot: r.email_snapshot ? String(r.email_snapshot) : null,
      display_name_snapshot: r.display_name_snapshot ? String(r.display_name_snapshot) : null,
      linked_at: String(r.linked_at || ''),
      last_used_at: String(r.last_used_at || ''),
    }));

    let invitations: InvitationSummary[] = [];
    if (serviceRole === 'admin') {
      const invRows = await env.DB.prepare(
        `SELECT * FROM invitations ORDER BY created_at DESC`
      ).all<Record<string, unknown>>();
      invitations = (invRows.results || []).map((r) =>
        toInvitationSummary({
          token: String(r.token || ''),
          email_normalized: String(r.email_normalized || ''),
          email_display: String(r.email_display || r.email_normalized || ''),
          created_by: Number(r.created_by || 1),
          note: String(r.note || ''),
          consumed_by: r.consumed_by !== null && r.consumed_by !== undefined ? Number(r.consumed_by) : null,
          consumed_at: r.consumed_at ? String(r.consumed_at) : null,
          revoked_at: r.revoked_at ? String(r.revoked_at) : null,
          expires_at: String(r.expires_at || ''),
          created_at: String(r.created_at || ''),
        })
      );
    }

    const account: AccountSummary = {
      registration_mode: regMode,
      auth_mode: authMode,
      authenticated: true,
      user_id: user.id,
      service_role: user.service_role,
      email: user.email,
      display_name: user.display_name,
      plan_tier: user.plan_tier,
      monthly_ocr_used: user.monthly_ocr_used,
      monthly_ocr_limit: user.monthly_ocr_limit,
      terms_accepted: user.terms_accepted,
      csrf_token: sessionRow?.csrf_token || authMemory.defaultCsrfToken,
      linked_identities: linkedIdentities,
      invitations,
    };

    return { authenticated: true, user, session: sessionRow, account };
  }

  // In-memory store resolution
  let session: InternalSessionRecord | null = null;
  let user: InternalUserRecord | null = null;

  if (rawSessionToken) {
    const sessionHash = await hmacSha256Hex(getSessionSecret(env), rawSessionToken);
    session =
      authMemory.sessions.find(
        (s) => s.id === sessionHash && s.revoked_at === null && s.expires_at > nowIso
      ) || null;
    if (session) {
      user = authMemory.users.find((u) => u.id === session!.user_id) || null;
    }
  } else if (authMemory.activeUserId !== null) {
    user = authMemory.users.find((u) => u.id === authMemory.activeUserId) || null;
    if (user) {
      session =
        authMemory.sessions.find(
          (s) => s.user_id === user!.id && s.revoked_at === null && s.expires_at > nowIso
        ) || null;
    }
  }

  if (!user) {
    const unauthAccount: AccountSummary = {
      registration_mode: regMode,
      auth_mode: authMode,
      authenticated: false,
      email: null,
      display_name: 'ゲスト',
      plan_tier: 'free',
      monthly_ocr_used: 0,
      monthly_ocr_limit: 10,
      terms_accepted: false,
      linked_identities: [],
      invitations: [],
    };
    return { authenticated: false, user: null, session: null, account: unauthAccount };
  }

  const linkedIdentities: LinkedIdentity[] = authMemory.identities
    .filter((i) => i.user_id === user!.id)
    .map(({ user_id: _uid, ...rest }) => ({ ...rest }));

  const invitations: InvitationSummary[] =
    user.service_role === 'admin'
      ? authMemory.invitations.map((inv) => toInvitationSummary(inv))
      : [];

  const displayName =
    user.id === 1 && fallbackProfile?.name ? fallbackProfile.name : user.display_name;

  const account: AccountSummary = {
    registration_mode: regMode,
    auth_mode: authMode,
    authenticated: true,
    user_id: user.id,
    service_role: user.service_role,
    email: user.email,
    display_name: displayName,
    plan_tier: user.plan_tier,
    monthly_ocr_used: user.monthly_ocr_used,
    monthly_ocr_limit: user.monthly_ocr_limit,
    terms_accepted: user.terms_accepted,
    csrf_token: session?.csrf_token || authMemory.defaultCsrfToken,
    linked_identities: linkedIdentities,
    invitations,
  };

  return { authenticated: true, user, session, account };
}

async function createSessionForUser(
  userId: number,
  env: AuthEnv & { DB?: D1DatabaseLike }
): Promise<{ rawToken: string; session: InternalSessionRecord; cookieHeader: string }> {
  const rawToken = randomBytesHex(32);
  const sessionHash = await hmacSha256Hex(getSessionSecret(env), rawToken);
  const csrfToken = `csrf_${randomBytesHex(16)}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  const session: InternalSessionRecord = {
    id: sessionHash,
    user_id: userId,
    csrf_token: csrfToken,
    expires_at: expiresAt,
    absolute_expires_at: expiresAt,
    revoked_at: null,
    created_at: now.toISOString(),
  };

  if (env.DB) {
    await env.DB.prepare(
      `INSERT INTO auth_sessions (id, user_id, csrf_token, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(session.id, session.user_id, session.csrf_token, session.expires_at, session.created_at)
      .run();
  } else {
    authMemory.sessions.push(session);
  }
  authMemory.activeUserId = userId;

  return {
    rawToken,
    session,
    cookieHeader: buildSessionCookieHeader(rawToken),
  };
}

async function authenticateGoogleIdentity(params: {
  email: string;
  sub: string;
  displayName?: string;
  inviteToken?: string | null;
  env: AuthEnv & { DB?: D1DatabaseLike };
}): Promise<{
  ok: boolean;
  reason?: 'not_invited' | 'expired' | 'used' | 'revoked' | 'email_mismatch';
  userId?: number;
  serviceRole?: ServiceRole;
  cookieHeader?: string;
  isNewUser?: boolean;
}> {
  const emailNormalized = normalizeEmail(params.email);
  const sub = params.sub.trim();
  const displayName =
    params.displayName?.trim() || emailNormalized.split('@')[0] || '利用者';
  const nowIso = new Date().toISOString();
  const regMode = resolveRegistrationMode(params.env);
  const bootstrapOwnerEmail = normalizeEmail(params.env.BOOTSTRAP_OWNER_EMAIL);

  if (params.env.DB) {
    const db = params.env.DB;
    const existingIdentity = await db
      .prepare(`SELECT * FROM auth_identities WHERE provider = 'google' AND provider_subject = ?`)
      .bind(sub)
      .first<Record<string, unknown>>();

    if (existingIdentity) {
      const userId = Number(existingIdentity.user_id);
      await db
        .prepare(`UPDATE auth_identities SET last_used_at = ? WHERE id = ?`)
        .bind(nowIso, Number(existingIdentity.id))
        .run();
      const userRow = await db
        .prepare(`SELECT * FROM users WHERE id = ?`)
        .bind(userId)
        .first<Record<string, unknown>>();
      const serviceRole: ServiceRole = userRow?.service_role === 'user' ? 'user' : 'admin';
      const { cookieHeader } = await createSessionForUser(userId, params.env);
      return { ok: true, userId, serviceRole, cookieHeader, isNewUser: false };
    }

    // Check if non-seed admin exists
    const adminCountRow = await db
      .prepare(
        `SELECT COUNT(*) as cnt FROM users WHERE service_role = 'admin' AND (public_id IS NULL OR public_id != 'u_owner_default')`
      )
      .first<{ cnt: number }>();
    const hasRealAdmin = Number(adminCountRow?.cnt ?? 0) > 0 || authMemory.bootstrapAdminClaimed;

    if (!hasRealAdmin && bootstrapOwnerEmail && emailNormalized === bootstrapOwnerEmail) {
      authMemory.bootstrapAdminClaimed = true;
      const publicId = `u_${randomBytesHex(8)}`;
      const insertUser = await db
        .prepare(
          `INSERT INTO users (public_id, email, display_name, role, service_role, plan_tier, monthly_ocr_used, monthly_ocr_limit, terms_accepted_at, created_at)
           VALUES (?, ?, ?, 'owner', 'admin', 'free', 0, 10, ?, ?)`
        )
        .bind(publicId, emailNormalized, displayName, nowIso, nowIso)
        .run();
      const newUserId = Number(insertUser.meta?.last_row_id || 2);
      await db
        .prepare(
          `INSERT INTO auth_identities (user_id, provider, provider_subject, email_snapshot, display_name_snapshot, linked_at, last_used_at)
           VALUES (?, 'google', ?, ?, ?, ?, ?)`
        )
        .bind(newUserId, sub, emailNormalized, `${displayName} (Google)`, nowIso, nowIso)
        .run();
      const { cookieHeader } = await createSessionForUser(newUserId, params.env);
      return { ok: true, userId: newUserId, serviceRole: 'admin', cookieHeader, isNewUser: true };
    }

    if (regMode === 'open') {
      const publicId = `u_${randomBytesHex(8)}`;
      const insertUser = await db
        .prepare(
          `INSERT INTO users (public_id, email, display_name, role, service_role, plan_tier, monthly_ocr_used, monthly_ocr_limit, terms_accepted_at, created_at)
           VALUES (?, ?, ?, 'member', 'user', 'free', 0, 10, ?, ?)`
        )
        .bind(publicId, emailNormalized, displayName, nowIso, nowIso)
        .run();
      const newUserId = Number(insertUser.meta?.last_row_id || 2);
      await db
        .prepare(
          `INSERT INTO auth_identities (user_id, provider, provider_subject, email_snapshot, display_name_snapshot, linked_at, last_used_at)
           VALUES (?, 'google', ?, ?, ?, ?, ?)`
        )
        .bind(newUserId, sub, emailNormalized, `${displayName} (Google)`, nowIso, nowIso)
        .run();
      const { cookieHeader } = await createSessionForUser(newUserId, params.env);
      return { ok: true, userId: newUserId, serviceRole: 'user', cookieHeader, isNewUser: true };
    }

    // invite_only mode
    if (!params.inviteToken) {
      return { ok: false, reason: 'not_invited' };
    }
    const tokenHash = await hmacSha256Hex(getSessionSecret(params.env), params.inviteToken);
    const invRow = await db
      .prepare(`SELECT * FROM invitations WHERE token = ?`)
      .bind(tokenHash)
      .first<Record<string, unknown>>();
    if (!invRow) {
      return { ok: false, reason: 'not_invited' };
    }
    if (invRow.revoked_at) {
      return { ok: false, reason: 'revoked' };
    }
    if (invRow.consumed_at || invRow.consumed_by) {
      return { ok: false, reason: 'used' };
    }
    if (Date.parse(String(invRow.expires_at || '')) <= Date.now()) {
      return { ok: false, reason: 'expired' };
    }
    const invEmail = normalizeEmail(invRow.email_normalized);
    if (invEmail && invEmail !== emailNormalized) {
      return { ok: false, reason: 'email_mismatch' };
    }

    const publicId = `u_${randomBytesHex(8)}`;
    const insertUser = await db
      .prepare(
        `INSERT INTO users (public_id, email, display_name, role, service_role, plan_tier, monthly_ocr_used, monthly_ocr_limit, terms_accepted_at, created_at)
         VALUES (?, ?, ?, 'member', 'user', 'free', 0, 10, ?, ?)`
      )
      .bind(publicId, emailNormalized, displayName, nowIso, nowIso)
      .run();
    const newUserId = Number(insertUser.meta?.last_row_id || 2);

    await db
      .prepare(
        `UPDATE invitations SET consumed_by = ?, consumed_at = ? WHERE token = ? AND consumed_at IS NULL`
      )
      .bind(newUserId, nowIso, tokenHash)
      .run();

    await db
      .prepare(
        `INSERT INTO auth_identities (user_id, provider, provider_subject, email_snapshot, display_name_snapshot, linked_at, last_used_at)
         VALUES (?, 'google', ?, ?, ?, ?, ?)`
      )
      .bind(newUserId, sub, emailNormalized, `${displayName} (Google)`, nowIso, nowIso)
      .run();

    const { cookieHeader } = await createSessionForUser(newUserId, params.env);
    return { ok: true, userId: newUserId, serviceRole: 'user', cookieHeader, isNewUser: true };
  }

  // In-memory store flow
  const existingIdentity = authMemory.identities.find(
    (id) => id.provider === 'google' && id.provider_subject === sub
  );
  if (existingIdentity) {
    existingIdentity.last_used_at = nowIso;
    const user = authMemory.users.find((u) => u.id === existingIdentity.user_id)!;
    const { cookieHeader } = await createSessionForUser(user.id, params.env);
    return {
      ok: true,
      userId: user.id,
      serviceRole: user.service_role,
      cookieHeader,
      isNewUser: false,
    };
  }

  // [B] 初回 Owner 判定 (管理者不在 かつ email === BOOTSTRAP_OWNER_EMAIL)
  const hasRealAdmin =
    authMemory.bootstrapAdminClaimed ||
    authMemory.users.some((u) => u.service_role === 'admin' && !u.is_demo_seed);

  if (!hasRealAdmin && bootstrapOwnerEmail && emailNormalized === bootstrapOwnerEmail) {
    authMemory.bootstrapAdminClaimed = true;
    const newUserId = authMemory.nextUserId++;
    const newUser: InternalUserRecord = {
      id: newUserId,
      public_id: `u_${randomBytesHex(8)}`,
      email: emailNormalized,
      display_name: displayName,
      role: 'owner',
      service_role: 'admin',
      plan_tier: 'free',
      monthly_ocr_used: 0,
      monthly_ocr_limit: 10,
      terms_accepted: true,
      created_at: nowIso,
      is_demo_seed: false,
    };
    authMemory.users.push(newUser);
    authMemory.identities.push({
      id: authMemory.nextIdentityId++,
      user_id: newUserId,
      provider: 'google',
      provider_subject: sub,
      email_snapshot: emailNormalized,
      display_name_snapshot: `${displayName} (Google)`,
      linked_at: nowIso,
      last_used_at: nowIso,
    });
    const { cookieHeader } = await createSessionForUser(newUserId, params.env);
    return { ok: true, userId: newUserId, serviceRole: 'admin', cookieHeader, isNewUser: true };
  }

  // [D] REGISTRATION_MODE=open
  if (regMode === 'open') {
    const newUserId = authMemory.nextUserId++;
    const newUser: InternalUserRecord = {
      id: newUserId,
      public_id: `u_${randomBytesHex(8)}`,
      email: emailNormalized,
      display_name: displayName,
      role: 'member',
      service_role: 'user',
      plan_tier: 'free',
      monthly_ocr_used: 0,
      monthly_ocr_limit: 10,
      terms_accepted: true,
      created_at: nowIso,
      is_demo_seed: false,
    };
    authMemory.users.push(newUser);
    authMemory.identities.push({
      id: authMemory.nextIdentityId++,
      user_id: newUserId,
      provider: 'google',
      provider_subject: sub,
      email_snapshot: emailNormalized,
      display_name_snapshot: `${displayName} (Google)`,
      linked_at: nowIso,
      last_used_at: nowIso,
    });
    const { cookieHeader } = await createSessionForUser(newUserId, params.env);
    return { ok: true, userId: newUserId, serviceRole: 'user', cookieHeader, isNewUser: true };
  }

  // [C] REGISTRATION_MODE=invite_only (デフォルト)
  if (!params.inviteToken) {
    return { ok: false, reason: 'not_invited' };
  }
  const tokenHash = await hmacSha256Hex(getSessionSecret(params.env), params.inviteToken);
  const invitation = authMemory.invitations.find((inv) => inv.token === tokenHash);
  if (!invitation) {
    return { ok: false, reason: 'not_invited' };
  }
  const status = computeInvitationStatus(invitation);
  if (status === 'revoked') {
    return { ok: false, reason: 'revoked' };
  }
  if (status === 'used') {
    return { ok: false, reason: 'used' };
  }
  if (status === 'expired') {
    return { ok: false, reason: 'expired' };
  }
  if (invitation.email_normalized && invitation.email_normalized !== emailNormalized) {
    return { ok: false, reason: 'email_mismatch' };
  }

  // 原子的消費 + User & Identity & Session 作成
  const newUserId = authMemory.nextUserId++;
  invitation.consumed_by = newUserId;
  invitation.consumed_at = nowIso;

  const newUser: InternalUserRecord = {
    id: newUserId,
    public_id: `u_${randomBytesHex(8)}`,
    email: emailNormalized,
    display_name: displayName,
    role: 'member',
    service_role: 'user',
    plan_tier: 'free',
    monthly_ocr_used: 0,
    monthly_ocr_limit: 10,
    terms_accepted: true,
    created_at: nowIso,
    is_demo_seed: false,
  };
  authMemory.users.push(newUser);
  authMemory.identities.push({
    id: authMemory.nextIdentityId++,
    user_id: newUserId,
    provider: 'google',
    provider_subject: sub,
    email_snapshot: emailNormalized,
    display_name_snapshot: `${displayName} (Google)`,
    linked_at: nowIso,
    last_used_at: nowIso,
  });

  const { cookieHeader } = await createSessionForUser(newUserId, params.env);
  return { ok: true, userId: newUserId, serviceRole: 'user', cookieHeader, isNewUser: true };
}

/**
 * Origin / CSRF 検証（ヘッダーが指定されている場合に厳密検証）
 */
function verifyMutationSecurityHeaders(
  request: Request,
  expectedCsrfToken: string | undefined,
  requestId: string,
  route: string
): Response | null {
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      const reqOrigin = new URL(request.url).origin;
      if (new URL(origin).origin !== reqOrigin) {
        return createErrorResponse('AUTH_ORIGIN_MISMATCH', requestId, {
          route,
          headers: AUTH_NO_STORE_HEADERS,
        });
      }
    } catch {
      return createErrorResponse('AUTH_ORIGIN_MISMATCH', requestId, {
        route,
        headers: AUTH_NO_STORE_HEADERS,
      });
    }
  }

  const csrfHeader = request.headers.get(CSRF_HEADER_NAME);
  if (csrfHeader !== null && expectedCsrfToken) {
    if (!constantTimeEqual(csrfHeader.trim(), expectedCsrfToken)) {
      return createErrorResponse('AUTH_CSRF_MISMATCH', requestId, {
        route,
        headers: AUTH_NO_STORE_HEADERS,
      });
    }
  }
  return null;
}

export async function handleAuthAndInviteRoutes(params: {
  request: Request;
  env: AuthEnv & { DB?: D1DatabaseLike };
  requestId: string;
  fallbackProfile?: UserProfile;
  onResetAccountRecords?: (userId: number, isDemoReset: boolean) => Promise<void>;
}): Promise<Response | null> {
  const { request, env, requestId, fallbackProfile, onResetAccountRecords } = params;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  // 1. GET /api/auth/session
  if (path === '/api/auth/session') {
    if (method !== 'GET') {
      return createErrorResponse('METHOD_NOT_ALLOWED', requestId, {
        route: path,
        headers: AUTH_NO_STORE_HEADERS,
      });
    }
    const { account } = await resolveCurrentSessionContext(request, env, fallbackProfile);
    return authJsonResponse({ ...account, account }, requestId);
  }

  // 2. GET /api/auth/google/start?invite=<token>
  if (path === '/api/auth/google/start') {
    if (method !== 'GET') {
      return createErrorResponse('METHOD_NOT_ALLOWED', requestId, {
        route: path,
        headers: AUTH_NO_STORE_HEADERS,
      });
    }
    const inviteToken = url.searchParams.get('invite')?.trim() || null;
    const hasMockQuery =
      url.searchParams.has('mock_email') || url.searchParams.has('mock_sub');

    // 実 OAuth Secret が設定されており、モック指定がない場合は Google OIDC 認可 URL へ 302 リダイレクト
    if (
      env.GOOGLE_CLIENT_ID &&
      env.GOOGLE_REDIRECT_URI &&
      !hasMockQuery &&
      env.AUTH_MODE !== 'demo'
    ) {
      const state = randomBytesHex(16);
      const nonce = randomBytesHex(16);
      const codeVerifier = base64UrlEncode(randomBytesHex(32));
      const codeChallenge = await sha256Base64Url(codeVerifier);

      const txCookieVal = await signOAuthTransaction(
        {
          state,
          nonce,
          codeVerifier,
          invite: inviteToken,
          exp: Date.now() + OAUTH_MAX_AGE_SECONDS * 1000,
        },
        env
      );

      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', env.GOOGLE_REDIRECT_URI);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', 'openid email profile');
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('nonce', nonce);
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');

      const redirectRes = new Response(null, {
        status: 302,
        headers: {
          Location: authUrl.toString(),
          'Set-Cookie': buildOAuthCookieHeader(txCookieVal),
        },
      });
      return finalizeResponse(redirectRes, requestId, { ...AUTH_NO_STORE_HEADERS });
    }

    // Demo / シミュレーションモード
    let mockEmail = url.searchParams.get('mock_email')?.trim() || '';
    if (!mockEmail) {
      if (inviteToken) {
        const tokenHash = await hmacSha256Hex(getSessionSecret(env), inviteToken);
        const foundInv = authMemory.invitations.find((inv) => inv.token === tokenHash);
        mockEmail =
          foundInv && computeInvitationStatus(foundInv) === 'pending'
            ? foundInv.email_normalized
            : 'uninvited-guest@example.com';
      } else {
        mockEmail = env.BOOTSTRAP_OWNER_EMAIL?.trim() || 'owner@example.com';
      }
    }

    const emailNormalized = normalizeEmail(mockEmail);
    const defaultSub =
      emailNormalized === 'owner@example.com' && !env.BOOTSTRAP_OWNER_EMAIL
        ? 'demo-google-sub-001'
        : `google-sub-${emailNormalized}`;
    const mockSub = url.searchParams.get('mock_sub')?.trim() || defaultSub;
    const mockName =
      url.searchParams.get('mock_name')?.trim() ||
      (emailNormalized === 'owner@example.com'
        ? fallbackProfile?.name || 'サンプル患者'
        : emailNormalized.split('@')[0]);

    const authResult = await authenticateGoogleIdentity({
      email: emailNormalized,
      sub: mockSub,
      displayName: mockName,
      inviteToken,
      env,
    });

    const wantsHtmlRedirect =
      (request.headers.get('accept') || '').includes('text/html') &&
      url.searchParams.get('format') !== 'json';

    if (!authResult.ok) {
      if (wantsHtmlRedirect) {
        const errRedirect = new Response(null, {
          status: 302,
          headers: {
            Location: `/?auth_error=${authResult.reason || 'not_invited'}`,
          },
        });
        return finalizeResponse(errRedirect, requestId, { ...AUTH_NO_STORE_HEADERS });
      }
      return authJsonResponse(
        {
          authenticated: false,
          reason: authResult.reason || 'not_invited',
          error: {
            code: 'AUTH_NOT_ADMIN',
            message: '有効な招待リンクが見つからないか、招待されたメールアドレスと一致しません。',
            requestId,
          },
        },
        requestId,
        403,
        { Location: `/?auth_error=${authResult.reason || 'not_invited'}` }
      );
    }

    if (wantsHtmlRedirect) {
      const okRedirect = new Response(null, {
        status: 302,
        headers: {
          Location: '/',
          ...(authResult.cookieHeader ? { 'Set-Cookie': authResult.cookieHeader } : {}),
        },
      });
      return finalizeResponse(okRedirect, requestId, { ...AUTH_NO_STORE_HEADERS });
    }

    const { account } = await resolveCurrentSessionContext(undefined, env, fallbackProfile);
    return authJsonResponse(
      {
        ...account,
        account,
        is_new_user: authResult.isNewUser,
        redirect_to: '/',
      },
      requestId,
      200,
      {
        Location: '/',
        ...(authResult.cookieHeader ? { 'Set-Cookie': authResult.cookieHeader } : {}),
      }
    );
  }

  // 3. GET /api/auth/google/callback?code=...&state=...
  if (path === '/api/auth/google/callback') {
    if (method !== 'GET') {
      return createErrorResponse('METHOD_NOT_ALLOWED', requestId, {
        route: path,
        headers: AUTH_NO_STORE_HEADERS,
      });
    }

    const cookies = parseCookies(request);
    const oauthCookie = cookies[OAUTH_COOKIE_NAME];
    const stateParam = url.searchParams.get('state')?.trim() || '';
    let inviteToken = url.searchParams.get('invite')?.trim() || null;

    if (oauthCookie) {
      const tx = await verifyOAuthTransaction(oauthCookie, env);
      if (!tx || (stateParam && !constantTimeEqual(stateParam, tx.state))) {
        return createErrorResponse('REQUEST_INVALID', requestId, {
          route: path,
          headers: {
            ...AUTH_NO_STORE_HEADERS,
            'Set-Cookie': buildOAuthCookieHeader('', 0),
          },
        });
      }
      if (!inviteToken && tx.invite) {
        inviteToken = tx.invite;
      }
    }

    const mockEmail =
      url.searchParams.get('mock_email')?.trim() ||
      env.BOOTSTRAP_OWNER_EMAIL?.trim() ||
      'owner@example.com';
    const emailNormalized = normalizeEmail(mockEmail);
    const defaultSub =
      emailNormalized === 'owner@example.com' && !env.BOOTSTRAP_OWNER_EMAIL
        ? 'demo-google-sub-001'
        : `google-sub-${emailNormalized}`;
    const mockSub = url.searchParams.get('mock_sub')?.trim() || defaultSub;
    const mockName =
      url.searchParams.get('mock_name')?.trim() || emailNormalized.split('@')[0];

    const authResult = await authenticateGoogleIdentity({
      email: emailNormalized,
      sub: mockSub,
      displayName: mockName,
      inviteToken,
      env,
    });

    const wantsHtmlRedirect =
      (request.headers.get('accept') || '').includes('text/html') &&
      url.searchParams.get('format') !== 'json';

    if (!authResult.ok) {
      if (wantsHtmlRedirect) {
        const errRedirect = new Response(null, {
          status: 302,
          headers: {
            Location: `/?auth_error=${authResult.reason || 'not_invited'}`,
            'Set-Cookie': buildOAuthCookieHeader('', 0),
          },
        });
        return finalizeResponse(errRedirect, requestId, { ...AUTH_NO_STORE_HEADERS });
      }
      return authJsonResponse(
        {
          authenticated: false,
          reason: authResult.reason || 'not_invited',
          error: {
            code: 'AUTH_NOT_ADMIN',
            message: '招待されていないか、招待の有効期限が切れています。',
            requestId,
          },
        },
        requestId,
        403,
        { Location: `/?auth_error=${authResult.reason || 'not_invited'}` }
      );
    }

    if (wantsHtmlRedirect) {
      const okRedirect = new Response(null, {
        status: 302,
        headers: {
          Location: '/',
          ...(authResult.cookieHeader ? { 'Set-Cookie': authResult.cookieHeader } : {}),
        },
      });
      return finalizeResponse(okRedirect, requestId, { ...AUTH_NO_STORE_HEADERS });
    }

    const { account } = await resolveCurrentSessionContext(undefined, env, fallbackProfile);
    return authJsonResponse(
      {
        ...account,
        account,
        is_new_user: authResult.isNewUser,
        redirect_to: '/',
      },
      requestId,
      200,
      {
        Location: '/',
        ...(authResult.cookieHeader ? { 'Set-Cookie': authResult.cookieHeader } : {}),
      }
    );
  }

  // 4. POST /api/auth/invitations (Owner service_role='admin' のみ)
  if (path === '/api/auth/invitations') {
    if (method !== 'POST') {
      return createErrorResponse('METHOD_NOT_ALLOWED', requestId, {
        route: path,
        headers: AUTH_NO_STORE_HEADERS,
      });
    }

    const ctx = await resolveCurrentSessionContext(request, env, fallbackProfile);
    if (!ctx.authenticated || !ctx.user) {
      return createErrorResponse('AUTH_SESSION_REQUIRED', requestId, {
        route: path,
        headers: AUTH_NO_STORE_HEADERS,
      });
    }

    const secErr = verifyMutationSecurityHeaders(
      request,
      ctx.account.csrf_token,
      requestId,
      path
    );
    if (secErr) return secErr;

    if (ctx.user.service_role !== 'admin') {
      return createErrorResponse('AUTH_NOT_ADMIN', requestId, {
        route: path,
        headers: AUTH_NO_STORE_HEADERS,
      });
    }

    let body: { email?: unknown; note?: unknown; expiresInDays?: unknown };
    try {
      body = (await request.json()) as {
        email?: unknown;
        note?: unknown;
        expiresInDays?: unknown;
      };
    } catch {
      return createErrorResponse('REQUEST_INVALID', requestId, {
        route: path,
        headers: AUTH_NO_STORE_HEADERS,
      });
    }

    const rawEmail = typeof body?.email === 'string' ? body.email.trim() : '';
    const emailNormalized = normalizeEmail(rawEmail);
    if (!emailNormalized || !isValidEmail(emailNormalized)) {
      return createErrorResponse('REQUEST_INVALID', requestId, {
        route: path,
        headers: AUTH_NO_STORE_HEADERS,
      });
    }

    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 200) : '';
    const daysRaw = Number(body?.expiresInDays ?? 7);
    const expiresInDays = Number.isNaN(daysRaw) ? 7 : Math.min(30, Math.max(-30, daysRaw));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresInDays * 86_400_000).toISOString();

    const rawToken = randomBytesHex(32); // 32 bytes (64 hex chars)
    const tokenHash = await hmacSha256Hex(getSessionSecret(env), rawToken);

    const record: InternalInvitationRecord = {
      token: tokenHash,
      email_normalized: emailNormalized,
      email_display: rawEmail,
      created_by: ctx.user.id,
      note,
      consumed_by: null,
      consumed_at: null,
      revoked_at: null,
      expires_at: expiresAt,
      created_at: now.toISOString(),
    };

    if (env.DB) {
      await env.DB.prepare(
        `INSERT INTO invitations (token, email_normalized, email_display, created_by, note, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          record.token,
          record.email_normalized,
          record.email_display,
          record.created_by,
          record.note,
          record.expires_at,
          record.created_at
        )
        .run();
    } else {
      authMemory.invitations.unshift(record);
    }

    const inviteUrl = `${url.origin}/invite/${rawToken}`;
    const invitationSummary = toInvitationSummary(record, inviteUrl);
    const updatedCtx = await resolveCurrentSessionContext(request, env, fallbackProfile);

    return authJsonResponse(
      {
        invitation: invitationSummary,
        invite_url: inviteUrl,
        invitations: updatedCtx.account.invitations || [invitationSummary],
      },
      requestId,
      201
    );
  }

  // 5. DELETE /api/auth/invitations/:tokenPreview (Owner のみ)
  const revokeMatch = path.match(/^\/api\/auth\/invitations\/([^/]+)$/);
  if (revokeMatch) {
    if (method !== 'DELETE') {
      return createErrorResponse('METHOD_NOT_ALLOWED', requestId, {
        route: path,
        headers: AUTH_NO_STORE_HEADERS,
      });
    }

    const ctx = await resolveCurrentSessionContext(request, env, fallbackProfile);
    if (!ctx.authenticated || !ctx.user) {
      return createErrorResponse('AUTH_SESSION_REQUIRED', requestId, {
        route: path,
        headers: AUTH_NO_STORE_HEADERS,
      });
    }

    const secErr = verifyMutationSecurityHeaders(
      request,
      ctx.account.csrf_token,
      requestId,
      path
    );
    if (secErr) return secErr;

    if (ctx.user.service_role !== 'admin') {
      return createErrorResponse('AUTH_NOT_ADMIN', requestId, {
        route: path,
        headers: AUTH_NO_STORE_HEADERS,
      });
    }

    const tokenPreview = decodeURIComponent(revokeMatch[1]).trim();
    const maybeHashed = await hmacSha256Hex(getSessionSecret(env), tokenPreview);
    const nowIso = new Date().toISOString();

    if (env.DB) {
      const rows = await env.DB.prepare(`SELECT * FROM invitations`).all<Record<string, unknown>>();
      const target = (rows.results || []).find((r) => {
        const t = String(r.token || '');
        return t.startsWith(tokenPreview) || t === maybeHashed;
      });
      if (!target) {
        return createErrorResponse('RECORD_NOT_FOUND', requestId, {
          route: path,
          headers: AUTH_NO_STORE_HEADERS,
        });
      }
      await env.DB.prepare(`UPDATE invitations SET revoked_at = ? WHERE token = ?`)
        .bind(nowIso, String(target.token))
        .run();
    } else {
      const target = authMemory.invitations.find(
        (inv) => inv.token.startsWith(tokenPreview) || inv.token === maybeHashed
      );
      if (!target) {
        return createErrorResponse('RECORD_NOT_FOUND', requestId, {
          route: path,
          headers: AUTH_NO_STORE_HEADERS,
        });
      }
      target.revoked_at = nowIso;
    }

    const updatedCtx = await resolveCurrentSessionContext(request, env, fallbackProfile);
    return authJsonResponse(
      {
        revoked: true,
        token_preview: tokenPreview,
        invitations: updatedCtx.account.invitations || [],
      },
      requestId
    );
  }

  // 6. GET /api/invite/:token/verify
  const verifyMatch = path.match(/^\/api\/invite\/([^/]+)\/verify$/);
  if (verifyMatch) {
    if (method !== 'GET') {
      return createErrorResponse('METHOD_NOT_ALLOWED', requestId, {
        route: path,
        headers: AUTH_NO_STORE_HEADERS,
      });
    }

    const rawToken = decodeURIComponent(verifyMatch[1]).trim();
    const tokenHash = await hmacSha256Hex(getSessionSecret(env), rawToken);

    let inv: InternalInvitationRecord | null = null;
    if (env.DB) {
      const row = await env.DB.prepare(`SELECT * FROM invitations WHERE token = ?`)
        .bind(tokenHash)
        .first<Record<string, unknown>>();
      if (row) {
        inv = {
          token: String(row.token || ''),
          email_normalized: String(row.email_normalized || ''),
          email_display: String(row.email_display || row.email_normalized || ''),
          created_by: Number(row.created_by || 1),
          note: String(row.note || ''),
          consumed_by: row.consumed_by !== null && row.consumed_by !== undefined ? Number(row.consumed_by) : null,
          consumed_at: row.consumed_at ? String(row.consumed_at) : null,
          revoked_at: row.revoked_at ? String(row.revoked_at) : null,
          expires_at: String(row.expires_at || ''),
          created_at: String(row.created_at || ''),
        };
      }
    } else {
      inv = authMemory.invitations.find((i) => i.token === tokenHash) || null;
    }

    if (!inv) {
      return authJsonResponse(
        {
          valid: false,
          email_hint: '',
          reason: 'not_found',
        },
        requestId
      );
    }

    const status = computeInvitationStatus(inv);
    const emailHint = maskEmailHint(inv.email_display || inv.email_normalized);

    if (status !== 'pending') {
      return authJsonResponse(
        {
          valid: false,
          email_hint: emailHint,
          reason: status, // 'expired' | 'used' | 'revoked'
        },
        requestId
      );
    }

    return authJsonResponse(
      {
        valid: true,
        email_hint: emailHint,
        expires_at: inv.expires_at,
        note: inv.note,
      },
      requestId
    );
  }

  // 7. POST /api/auth/identities/link (後追い SNS 連携)
  if (path === '/api/auth/identities/link') {
    if (method !== 'POST') {
      return createErrorResponse('METHOD_NOT_ALLOWED', requestId, {
        route: path,
        headers: AUTH_NO_STORE_HEADERS,
      });
    }

    const ctx = await resolveCurrentSessionContext(request, env, fallbackProfile);
    if (!ctx.authenticated || !ctx.user) {
      return createErrorResponse('AUTH_SESSION_REQUIRED', requestId, {
        route: path,
        headers: AUTH_NO_STORE_HEADERS,
      });
    }

    const secErr = verifyMutationSecurityHeaders(
      request,
      ctx.account.csrf_token,
      requestId,
      path
    );
    if (secErr) return secErr;

    let body: {
      provider?: unknown;
      provider_subject?: unknown;
      email?: unknown;
      display_name?: unknown;
    };
    try {
      body = (await request.json()) as {
        provider?: unknown;
        provider_subject?: unknown;
        email?: unknown;
        display_name?: unknown;
      };
    } catch {
      return createErrorResponse('REQUEST_INVALID', requestId, {
        route: path,
        headers: AUTH_NO_STORE_HEADERS,
      });
    }

    if (!isValidAuthProvider(body?.provider)) {
      return createErrorResponse('REQUEST_INVALID', requestId, {
        route: path,
        headers: AUTH_NO_STORE_HEADERS,
      });
    }

    const provider: AuthProviderId = body.provider;
    const providerLabel = getProviderLabel(provider);
    const providerSubject =
      typeof body.provider_subject === 'string' && body.provider_subject.trim()
        ? body.provider_subject.trim()
        : `demo-${provider}-sub-u${ctx.user.id}`;
    const emailSnapshot =
      typeof body.email === 'string' && body.email.trim()
        ? normalizeEmail(body.email)
        : ctx.user.email || `${provider}@example.com`;
    const displayNameSnapshot =
      typeof body.display_name === 'string' && body.display_name.trim()
        ? body.display_name.trim()
        : `${ctx.user.display_name} (${providerLabel})`;
    const nowIso = new Date().toISOString();

    if (env.DB) {
      const existingBySub = await env.DB.prepare(
        `SELECT * FROM auth_identities WHERE provider = ? AND provider_subject = ?`
      )
        .bind(provider, providerSubject)
        .first<Record<string, unknown>>();

      if (existingBySub) {
        return createStateConflictResponse(
          'このSNSアカウントは既に連携されています。',
          requestId,
          path
        );
      }

      const existingByProvider = await env.DB.prepare(
        `SELECT * FROM auth_identities WHERE user_id = ? AND provider = ?`
      )
        .bind(ctx.user.id, provider)
        .first<Record<string, unknown>>();

      if (existingByProvider) {
        return createStateConflictResponse(
          `${providerLabel} は既にこのアカウントに連携されています。`,
          requestId,
          path
        );
      }

      await env.DB.prepare(
        `INSERT INTO auth_identities (user_id, provider, provider_subject, email_snapshot, display_name_snapshot, linked_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          ctx.user.id,
          provider,
          providerSubject,
          emailSnapshot,
          displayNameSnapshot,
          nowIso,
          nowIso
        )
        .run();
    } else {
      const conflictBySub = authMemory.identities.find(
        (id) => id.provider === provider && id.provider_subject === providerSubject
      );
      if (conflictBySub) {
        return createStateConflictResponse(
          'このSNSアカウントは既に別のユーザーまたは現在のアカウントに連携されています。',
          requestId,
          path
        );
      }

      const conflictByProvider = authMemory.identities.find(
        (id) => id.user_id === ctx.user!.id && id.provider === provider
      );
      if (conflictByProvider) {
        return createStateConflictResponse(
          `${providerLabel} は既にこのアカウントに連携されています。`,
          requestId,
          path
        );
      }

      authMemory.identities.push({
        id: authMemory.nextIdentityId++,
        user_id: ctx.user.id,
        provider,
        provider_subject: providerSubject,
        email_snapshot: emailSnapshot,
        display_name_snapshot: displayNameSnapshot,
        linked_at: nowIso,
        last_used_at: nowIso,
      });
    }

    const updatedCtx = await resolveCurrentSessionContext(request, env, fallbackProfile);
    return authJsonResponse(
      {
        linked_identities: updatedCtx.account.linked_identities || [],
        account: updatedCtx.account,
      },
      requestId
    );
  }

  // 8. DELETE /api/auth/identities/:provider (SNS 連携解除)
  const unlinkMatch = path.match(/^\/api\/auth\/identities\/([^/]+)$/);
  if (unlinkMatch) {
    if (method !== 'DELETE') {
      return createErrorResponse('METHOD_NOT_ALLOWED', requestId, {
        route: path,
        headers: AUTH_NO_STORE_HEADERS,
      });
    }

    const ctx = await resolveCurrentSessionContext(request, env, fallbackProfile);
    if (!ctx.authenticated || !ctx.user) {
      return createErrorResponse('AUTH_SESSION_REQUIRED', requestId, {
        route: path,
        headers: AUTH_NO_STORE_HEADERS,
      });
    }

    const secErr = verifyMutationSecurityHeaders(
      request,
      ctx.account.csrf_token,
      requestId,
      path
    );
    if (secErr) return secErr;

    const targetProvider = decodeURIComponent(unlinkMatch[1]).trim();
    if (!isValidAuthProvider(targetProvider)) {
      return createErrorResponse('REQUEST_INVALID', requestId, {
        route: path,
        headers: AUTH_NO_STORE_HEADERS,
      });
    }

    const currentIdentities = ctx.account.linked_identities || [];
    const targetIdentity = currentIdentities.find((i) => i.provider === targetProvider);
    if (!targetIdentity) {
      return createErrorResponse('RECORD_NOT_FOUND', requestId, {
        route: path,
        headers: AUTH_NO_STORE_HEADERS,
      });
    }

    if (currentIdentities.length <= 1) {
      return createStateConflictResponse(
        '最後のログイン手段は解除できません。別のログイン方法を連携してから解除してください。',
        requestId,
        path
      );
    }

    if (env.DB) {
      await env.DB.prepare(`DELETE FROM auth_identities WHERE user_id = ? AND provider = ?`)
        .bind(ctx.user.id, targetProvider)
        .run();
    } else {
      authMemory.identities = authMemory.identities.filter(
        (i) => !(i.user_id === ctx.user!.id && i.provider === targetProvider)
      );
    }

    const updatedCtx = await resolveCurrentSessionContext(request, env, fallbackProfile);
    return authJsonResponse(
      {
        unlinked: true,
        provider: targetProvider,
        linked_identities: updatedCtx.account.linked_identities || [],
        account: updatedCtx.account,
      },
      requestId
    );
  }

  // 9. POST /api/auth/logout & POST /api/auth/logout-all
  if (path === '/api/auth/logout' || path === '/api/auth/logout-all') {
    if (method !== 'POST') {
      return createErrorResponse('METHOD_NOT_ALLOWED', requestId, {
        route: path,
        headers: AUTH_NO_STORE_HEADERS,
      });
    }

    const ctx = await resolveCurrentSessionContext(request, env, fallbackProfile);
    const nowIso = new Date().toISOString();
    const isAll = path === '/api/auth/logout-all';

    if (env.DB) {
      if (isAll && ctx.user) {
        await env.DB.prepare(`UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ?`)
          .bind(nowIso, ctx.user.id)
          .run();
      } else if (ctx.session) {
        await env.DB.prepare(`UPDATE auth_sessions SET revoked_at = ? WHERE id = ?`)
          .bind(nowIso, ctx.session.id)
          .run();
      }
    } else {
      if (isAll && ctx.user) {
        for (const s of authMemory.sessions) {
          if (s.user_id === ctx.user.id) {
            s.revoked_at = nowIso;
          }
        }
      } else if (ctx.session) {
        ctx.session.revoked_at = nowIso;
      }
    }

    authMemory.activeUserId = null;

    return authJsonResponse(
      {
        logged_out: true,
        scope: isAll ? 'all' : 'current',
      },
      requestId,
      200,
      {
        'Set-Cookie': buildSessionCookieHeader('', 0),
      }
    );
  }

  // 10. DELETE /api/auth/account
  if (path === '/api/auth/account') {
    if (method !== 'DELETE') {
      return createErrorResponse('METHOD_NOT_ALLOWED', requestId, {
        route: path,
        headers: AUTH_NO_STORE_HEADERS,
      });
    }

    const ctx = await resolveCurrentSessionContext(request, env, fallbackProfile);
    if (!ctx.authenticated || !ctx.user) {
      return createErrorResponse('AUTH_SESSION_REQUIRED', requestId, {
        route: path,
        headers: AUTH_NO_STORE_HEADERS,
      });
    }

    const targetUserId = ctx.user.id;
    const isDemoUser = targetUserId === 1;

    if (isDemoUser) {
      resetAuthMemoryStore();
      if (onResetAccountRecords) {
        await onResetAccountRecords(1, true);
      }
      return authJsonResponse(
        {
          deleted: true,
          reset_demo: true,
        },
        requestId
      );
    }

    if (env.DB) {
      await env.DB.prepare(`DELETE FROM auth_sessions WHERE user_id = ?`).bind(targetUserId).run();
      await env.DB.prepare(`DELETE FROM auth_identities WHERE user_id = ?`).bind(targetUserId).run();
      await env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(targetUserId).run();
    } else {
      authMemory.sessions = authMemory.sessions.filter((s) => s.user_id !== targetUserId);
      authMemory.identities = authMemory.identities.filter((i) => i.user_id !== targetUserId);
      authMemory.users = authMemory.users.filter((u) => u.id !== targetUserId);
      authMemory.activeUserId = null;
    }

    if (onResetAccountRecords) {
      await onResetAccountRecords(targetUserId, false);
    }

    return authJsonResponse(
      {
        deleted: true,
        reset_demo: false,
      },
      requestId,
      200,
      {
        'Set-Cookie': buildSessionCookieHeader('', 0),
      }
    );
  }

  return null;
}
