import { Injectable } from '@angular/core';
import {
  AccountSummary,
  AiProviderName,
  AuthProviderId,
  BiologicalSex,
  InvitationSummary,
  LabItem,
  LabRecord,
  LinkedIdentity,
  REFERENCE_STANDARDS,
  ReferenceStandard,
  UserProfile,
  computeFlag,
  lookupStandard,
} from '../shared/types';
import {
  AppErrorCode,
  friendlyErrorMessage,
  isServerErrorCode,
} from '../shared/error-codes';
import {
  PROVIDER_META,
  createFallbackAccountSummary,
  createFallbackProfile,
  createFallbackRecords,
  createSampleOcrResult,
  generateLocalAnalysis,
  parseLabTextLocally,
} from './fallback-engine';

export type ErrorContext = 'read' | 'write' | 'delete' | 'ocr';

export class ApiError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    public readonly status: number,
    public readonly friendlyMessage: string,
    public readonly requestId?: string
  ) {
    super(friendlyMessage);
    this.name = 'ApiError';
  }
}

export interface BootstrapResponse {
  profile: UserProfile;
  records: LabRecord[];
  standards: ReferenceStandard[];
  providers: AiProviderName[];
  account?: AccountSummary;
}

export interface AiClientConfig {
  provider: AiProviderName;
  model: string;
  apiKeys: Record<AiProviderName, string>;
}

export interface OcrResponse {
  tested_at?: string;
  facility_name?: string;
  items: LabItem[];
  note?: string;
}

export interface AnalyzeResponse {
  ai_summary: string;
  ai_correlation: string;
  ai_advice: string;
  item_comments?: Record<string, string>;
  provider_used?: string;
  model_used?: string;
}

export interface InviteVerifyResponse {
  valid: boolean;
  email_hint?: string;
  reason?: 'expired' | 'used' | 'revoked' | 'not_found';
}

export interface CreateInvitationResponse {
  invitation: InvitationSummary;
  invite_url: string;
}

const STORAGE_STATE_KEY = 'lab_analyzer_offline_state_v2';
const STORAGE_AI_KEY = 'lab_analyzer_ai_config_v1';
const STORAGE_ACCOUNT_KEY = 'lab_analyzer_offline_account_v1';

export function createDefaultAccountSummary(): AccountSummary {
  return {
    registration_mode: 'demo',
    auth_mode: 'demo',
    authenticated: false,
    service_role: 'user',
    email: null,
    display_name: 'ゲスト',
    plan_tier: 'free',
    monthly_ocr_used: 0,
    monthly_ocr_limit: 10,
    terms_accepted: true,
    linked_identities: [],
    invitations: [],
  };
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  isOffline = false;
  servicePaused = false;
  servicePausedCode: AppErrorCode | null = null;
  servicePausedReason = '';
  private csrfToken: string | null = null;

  clearServicePause(): void {
    this.servicePaused = false;
    this.servicePausedCode = null;
    this.servicePausedReason = '';
  }

  getErrorMessage(err: unknown, context: ErrorContext = 'read'): string {
    if (err instanceof ApiError) {
      return err.friendlyMessage;
    }
    return friendlyErrorMessage('UNKNOWN', context);
  }

  loadAiConfig(): AiClientConfig {
    const defaults: AiClientConfig = {
      provider: 'gemini',
      model: PROVIDER_META.gemini.defaultModel,
      apiKeys: { gemini: '', openai: '', claude: '' },
    };
    try {
      const raw = localStorage.getItem(STORAGE_AI_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw) as Partial<AiClientConfig>;
      const provider: AiProviderName =
        parsed.provider === 'openai' || parsed.provider === 'claude' ? parsed.provider : 'gemini';
      return {
        provider,
        model: parsed.model || PROVIDER_META[provider].defaultModel,
        apiKeys: {
          gemini: parsed.apiKeys?.gemini ?? '',
          openai: parsed.apiKeys?.openai ?? '',
          claude: parsed.apiKeys?.claude ?? '',
        },
      };
    } catch {
      return defaults;
    }
  }

  saveAiConfig(config: AiClientConfig): void {
    try {
      localStorage.setItem(STORAGE_AI_KEY, JSON.stringify(config));
    } catch {
      // ignore storage errors
    }
  }

  private loadLocalState(): { profile: UserProfile; records: LabRecord[] } {
    try {
      const raw = localStorage.getItem(STORAGE_STATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { profile?: UserProfile; records?: LabRecord[] };
        if (parsed.profile && Array.isArray(parsed.records)) {
          return { profile: parsed.profile, records: parsed.records };
        }
      }
    } catch {
      // fallback to default seed
    }
    const profile = createFallbackProfile();
    const records = createFallbackRecords(profile.sex);
    this.saveLocalState(profile, records);
    return { profile, records };
  }

  private saveLocalState(profile: UserProfile, records: LabRecord[]): void {
    try {
      localStorage.setItem(STORAGE_STATE_KEY, JSON.stringify({ profile, records }));
    } catch {
      // ignore
    }
  }

  private loadLocalAccount(displayName?: string): AccountSummary {
    try {
      const raw = localStorage.getItem(STORAGE_ACCOUNT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AccountSummary;
        if (parsed && typeof parsed === 'object') {
          return {
            ...createFallbackAccountSummary(displayName),
            ...parsed,
            linked_identities: Array.isArray(parsed.linked_identities)
              ? parsed.linked_identities
              : createFallbackAccountSummary(displayName).linked_identities,
            invitations: Array.isArray(parsed.invitations) ? parsed.invitations : [],
          };
        }
      }
    } catch {
      // fallback to default
    }
    const fallback = createFallbackAccountSummary(displayName);
    this.saveLocalAccount(fallback);
    return fallback;
  }

  private saveLocalAccount(account: AccountSummary): void {
    try {
      localStorage.setItem(STORAGE_ACCOUNT_KEY, JSON.stringify(account));
    } catch {
      // ignore
    }
  }

  private syncCsrfFromAccount(account?: AccountSummary): void {
    if (account?.csrf_token) {
      this.csrfToken = account.csrf_token;
    }
  }

  private async fetchJson<T>(url: string, init?: RequestInit, context: ErrorContext = 'read'): Promise<T> {
    let res: Response;
    const method = (init?.method ?? 'GET').toUpperCase();
    const extraHeaders: Record<string, string> = {};
    if (this.csrfToken && method !== 'GET' && method !== 'HEAD') {
      extraHeaders['X-Karada-CSRF'] = this.csrfToken;
    }
    try {
      res = await fetch(url, {
        credentials: 'same-origin',
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...extraHeaders,
          ...(init?.headers ?? {}),
        },
      });
    } catch {
      // ネットワーク未接続・API未起動（オフラインフォールバック対象）
      throw new ApiError('NETWORK', 0, friendlyErrorMessage('NETWORK', context));
    }

    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');

    if (!res.ok) {
      let code: AppErrorCode = res.status === 503 ? 'SERVICE_PAUSED' : 'UNKNOWN';
      let requestId: string | undefined;
      let serverRawCode: string | undefined;

      if (isJson) {
        try {
          const body = (await res.json()) as { error?: { code?: unknown; requestId?: unknown } };
          if (typeof body?.error?.code === 'string') {
            serverRawCode = body.error.code;
          }
          if (isServerErrorCode(body?.error?.code)) {
            code = body.error.code;
          }
          if (typeof body?.error?.requestId === 'string') {
            requestId = body.error.requestId;
          }
        } catch {
          // ignore malformed error body
        }
      } else if (res.status === 404) {
        // ng serve 単体起動など API が存在せず HTML 404 を返すケース
        throw new ApiError('NETWORK', 404, friendlyErrorMessage('NETWORK', context));
      }

      let friendly = friendlyErrorMessage(code, context);
      if (res.status === 409 && serverRawCode === 'STATE_CONFLICT') {
        friendly = 'このアカウントはすでに別の利用者に連携されているか、唯一のログイン手段のため変更できません。';
      } else if (res.status === 403 && code === 'AUTH_NOT_ADMIN') {
        friendly = 'この操作は管理者（Owner）のみ利用できます。';
      }

      if (res.status === 503 || code === 'SERVICE_PAUSED' || code === 'CIRCUIT_OPEN') {
        this.servicePaused = true;
        this.servicePausedCode = code;
        this.servicePausedReason = friendly;
      }
      throw new ApiError(code, res.status, friendly, requestId);
    }

    if (!isJson) {
      throw new ApiError('NETWORK', res.status, friendlyErrorMessage('NETWORK', context));
    }

    this.clearServicePause();
    return (await res.json()) as T;
  }

  private shouldFallbackOffline(err: unknown): boolean {
    if (err instanceof ApiError) {
      // 503 停止・4xx 入力/権限/レート/プラン制限・500 サーバーエラーはオフライン扱いにせず UI に返す
      return err.code === 'NETWORK';
    }
    return true;
  }

  async bootstrap(): Promise<BootstrapResponse> {
    try {
      const data = await this.fetchJson<BootstrapResponse>('/api/bootstrap', undefined, 'read');
      this.isOffline = false;
      const account = data.account ?? createDefaultAccountSummary();
      this.syncCsrfFromAccount(account);
      return {
        profile: data.profile,
        records: data.records ?? [],
        standards: data.standards?.length ? data.standards : REFERENCE_STANDARDS,
        providers: data.providers?.length ? data.providers : ['gemini', 'openai', 'claude'],
        account,
      };
    } catch (err) {
      if (!this.shouldFallbackOffline(err)) {
        throw err;
      }
      this.isOffline = true;
      const local = this.loadLocalState();
      const localAccount = this.loadLocalAccount(local.profile.name || 'ゲスト');
      return {
        profile: local.profile,
        records: local.records,
        standards: REFERENCE_STANDARDS,
        providers: ['gemini', 'openai', 'claude'],
        account: localAccount,
      };
    }
  }

  async updateProfile(profile: Partial<UserProfile>): Promise<UserProfile> {
    try {
      const updated = await this.fetchJson<UserProfile>(
        '/api/profile',
        {
          method: 'PUT',
          body: JSON.stringify(profile),
        },
        'write'
      );
      this.isOffline = false;
      return updated;
    } catch (err) {
      if (!this.shouldFallbackOffline(err)) {
        throw err;
      }
      this.isOffline = true;
      const local = this.loadLocalState();
      const updated: UserProfile = {
        ...local.profile,
        ...profile,
        updated_at: new Date().toISOString(),
      };
      this.saveLocalState(updated, local.records);
      return updated;
    }
  }

  async createRecord(
    record: LabRecord,
    history: LabRecord[],
    profile: UserProfile,
    aiConfig: AiClientConfig
  ): Promise<LabRecord> {
    const apiKey = aiConfig.apiKeys[aiConfig.provider]?.trim() || undefined;
    try {
      const saved = await this.fetchJson<LabRecord>(
        '/api/records',
        {
          method: 'POST',
          body: JSON.stringify({
            ...record,
            provider: aiConfig.provider,
            model: aiConfig.model,
            apiKey,
          }),
        },
        'write'
      );
      this.isOffline = false;
      return saved;
    } catch (err) {
      if (!this.shouldFallbackOffline(err)) {
        throw err;
      }
      this.isOffline = true;
      const local = this.loadLocalState();
      const normalizedItems: LabItem[] = record.items.map((item) => {
        const { refLow, refHigh } =
          item.ref_low === null && item.ref_high === null
            ? lookupStandard(item.item_code || item.item_name, profile.sex)
            : { refLow: item.ref_low, refHigh: item.ref_high };
        return {
          ...item,
          ref_low: refLow,
          ref_high: refHigh,
          flag: computeFlag(item.value, refLow, refHigh),
        };
      });

      const nextId =
        local.records.reduce((max, r) => Math.max(max, r.id ?? 0), 0) + 1;
      const draft: LabRecord = {
        ...record,
        id: nextId,
        items: normalizedItems,
        created_at: new Date().toISOString(),
      };
      const analysis = generateLocalAnalysis(
        draft,
        history,
        profile,
        aiConfig.provider,
        aiConfig.model
      );
      const saved: LabRecord = {
        ...draft,
        ai_provider: analysis.provider_used,
        ai_model: analysis.model_used,
        ai_summary: analysis.ai_summary,
        ai_correlation: analysis.ai_correlation,
        ai_advice: analysis.ai_advice,
        items: draft.items.map((it) => ({
          ...it,
          ai_comment: analysis.item_comments[it.item_code] ?? it.ai_comment,
        })),
      };
      const nextRecords = [...local.records, saved];
      this.saveLocalState(local.profile, nextRecords);
      return saved;
    }
  }

  async deleteRecord(id: number): Promise<void> {
    try {
      await this.fetchJson<{ deleted: boolean }>(
        `/api/records/${id}`,
        {
          method: 'DELETE',
        },
        'delete'
      );
      this.isOffline = false;
    } catch (err) {
      if (!this.shouldFallbackOffline(err)) {
        throw err;
      }
      this.isOffline = true;
      const local = this.loadLocalState();
      this.saveLocalState(
        local.profile,
        local.records.filter((r) => r.id !== id)
      );
    }
  }

  async runOcr(params: {
    imageBase64?: string;
    mimeType?: string;
    rawText?: string;
    sex: BiologicalSex;
    aiConfig: AiClientConfig;
  }): Promise<OcrResponse> {
    const apiKey = params.aiConfig.apiKeys[params.aiConfig.provider]?.trim() || undefined;
    try {
      const res = await this.fetchJson<OcrResponse>(
        '/api/ocr',
        {
          method: 'POST',
          body: JSON.stringify({
            imageBase64: params.imageBase64,
            mimeType: params.mimeType,
            rawText: params.rawText,
            provider: params.aiConfig.provider,
            model: params.aiConfig.model,
            apiKey,
            sex: params.sex,
          }),
        },
        'ocr'
      );
      this.isOffline = false;
      return res;
    } catch (err) {
      if (!this.shouldFallbackOffline(err)) {
        throw err;
      }
      this.isOffline = true;
      if (params.rawText && params.rawText.trim()) {
        const parsed = parseLabTextLocally(params.rawText, params.sex);
        if (parsed.length > 0) {
          return {
            items: parsed,
            note: `オフラインパーサーで ${parsed.length} 項目を抽出しました。`,
          };
        }
      }
      const sample = createSampleOcrResult(params.sex);
      return {
        ...sample,
        note: 'オフライン環境のため模擬OCRサンプルを読み込みました。数値を手入力で調整してください。',
      };
    }
  }

  async reanalyze(params: {
    record: LabRecord;
    history: LabRecord[];
    profile: UserProfile;
    provider: AiProviderName;
    model: string;
    apiKey?: string;
  }): Promise<AnalyzeResponse> {
    try {
      const res = await this.fetchJson<AnalyzeResponse>(
        '/api/analyze',
        {
          method: 'POST',
          body: JSON.stringify({
            record: params.record,
            history: params.history,
            profile: params.profile,
            provider: params.provider,
            model: params.model,
            apiKey: params.apiKey?.trim() || undefined,
          }),
        },
        'read'
      );
      this.isOffline = false;
      return res;
    } catch (err) {
      if (!this.shouldFallbackOffline(err)) {
        throw err;
      }
      this.isOffline = true;
      return generateLocalAnalysis(
        params.record,
        params.history,
        params.profile,
        params.provider,
        params.model
      );
    }
  }

  // ===== 認証・招待・SNS後追い連携・アカウント管理 =====

  getGoogleLoginUrl(inviteToken?: string): string {
    if (inviteToken && inviteToken.trim()) {
      return `/api/auth/google/start?invite=${encodeURIComponent(inviteToken.trim())}`;
    }
    return '/api/auth/google/start';
  }

  async getSession(): Promise<AccountSummary> {
    try {
      const account = await this.fetchJson<AccountSummary>('/api/auth/session', undefined, 'read');
      this.isOffline = false;
      this.syncCsrfFromAccount(account);
      return account;
    } catch (err) {
      if (!this.shouldFallbackOffline(err)) {
        throw err;
      }
      this.isOffline = true;
      const local = this.loadLocalState();
      return this.loadLocalAccount(local.profile.name);
    }
  }

  async verifyInvite(token: string): Promise<InviteVerifyResponse> {
    try {
      const res = await this.fetchJson<InviteVerifyResponse>(
        `/api/invite/${encodeURIComponent(token)}/verify`,
        undefined,
        'read'
      );
      this.isOffline = false;
      return res;
    } catch (err) {
      if (!this.shouldFallbackOffline(err)) {
        throw err;
      }
      this.isOffline = true;
      const localAcc = this.loadLocalAccount();
      const matched = (localAcc.invitations ?? []).find(
        (inv) => inv.invite_url?.endsWith(`/${token}`) || inv.token_preview === token.slice(0, 8)
      );
      if (matched) {
        if (matched.status === 'pending') {
          return { valid: true, email_hint: matched.email_display };
        }
        return { valid: false, reason: matched.status };
      }
      if (token.startsWith('demo')) {
        return { valid: true, email_hint: 'family@example.com' };
      }
      return { valid: false, reason: 'not_found' };
    }
  }

  async linkIdentity(params: {
    provider: AuthProviderId;
    provider_subject?: string;
    email?: string;
    display_name?: string;
  }): Promise<LinkedIdentity[]> {
    try {
      const res = await this.fetchJson<{ linked_identities?: LinkedIdentity[] } | LinkedIdentity[]>(
        '/api/auth/identities/link',
        {
          method: 'POST',
          body: JSON.stringify(params),
        },
        'write'
      );
      this.isOffline = false;
      return Array.isArray(res) ? res : (res.linked_identities ?? []);
    } catch (err) {
      if (!this.shouldFallbackOffline(err)) {
        throw err;
      }
      this.isOffline = true;
      const localAcc = this.loadLocalAccount();
      const current = localAcc.linked_identities ?? [];
      if (!current.some((id) => id.provider === params.provider)) {
        const now = new Date().toISOString();
        const next: LinkedIdentity[] = [
          ...current,
          {
            id: current.reduce((m, x) => Math.max(m, x.id ?? 0), 0) + 1,
            provider: params.provider,
            provider_subject: params.provider_subject || `demo-${params.provider}-${Date.now().toString(36)}`,
            email_snapshot: params.email || localAcc.email || `${params.provider}@example.com`,
            display_name_snapshot: params.display_name || localAcc.display_name,
            linked_at: now,
            last_used_at: now,
          },
        ];
        localAcc.linked_identities = next;
        this.saveLocalAccount(localAcc);
        return next;
      }
      return current;
    }
  }

  async unlinkIdentity(provider: AuthProviderId): Promise<LinkedIdentity[]> {
    try {
      const res = await this.fetchJson<{ linked_identities?: LinkedIdentity[] } | LinkedIdentity[]>(
        `/api/auth/identities/${encodeURIComponent(provider)}`,
        {
          method: 'DELETE',
        },
        'delete'
      );
      this.isOffline = false;
      return Array.isArray(res) ? res : (res.linked_identities ?? []);
    } catch (err) {
      if (!this.shouldFallbackOffline(err)) {
        throw err;
      }
      this.isOffline = true;
      const localAcc = this.loadLocalAccount();
      const current = localAcc.linked_identities ?? [];
      if (current.length <= 1) {
        throw new ApiError(
          'UNKNOWN',
          409,
          '唯一のログイン手段のため解除できません。他のSNSを連携してから解除してください。'
        );
      }
      const next = current.filter((id) => id.provider !== provider);
      localAcc.linked_identities = next;
      this.saveLocalAccount(localAcc);
      return next;
    }
  }

  async createInvitation(params: {
    email: string;
    note?: string;
    expiresInDays?: number;
  }): Promise<CreateInvitationResponse> {
    try {
      const res = await this.fetchJson<CreateInvitationResponse>(
        '/api/auth/invitations',
        {
          method: 'POST',
          body: JSON.stringify(params),
        },
        'write'
      );
      this.isOffline = false;
      return res;
    } catch (err) {
      if (!this.shouldFallbackOffline(err)) {
        throw err;
      }
      this.isOffline = true;
      const localAcc = this.loadLocalAccount();
      const rawToken = `demo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
      const origin = typeof window !== 'undefined' ? window.location.origin : 'https://karada-note.example';
      const inviteUrl = `${origin}/invite/${rawToken}`;
      const now = new Date();
      const expires = new Date(now.getTime() + (params.expiresInDays ?? 7) * 86400 * 1000);
      const invitation: InvitationSummary = {
        token_preview: rawToken.slice(0, 8),
        email_display: params.email.trim(),
        note: (params.note ?? '').trim(),
        status: 'pending',
        created_at: now.toISOString(),
        expires_at: expires.toISOString(),
        invite_url: inviteUrl,
      };
      localAcc.invitations = [invitation, ...(localAcc.invitations ?? [])];
      this.saveLocalAccount(localAcc);
      return { invitation, invite_url: inviteUrl };
    }
  }

  async revokeInvitation(tokenPreview: string): Promise<void> {
    try {
      await this.fetchJson<{ revoked?: boolean }>(
        `/api/auth/invitations/${encodeURIComponent(tokenPreview)}`,
        {
          method: 'DELETE',
        },
        'delete'
      );
      this.isOffline = false;
    } catch (err) {
      if (!this.shouldFallbackOffline(err)) {
        throw err;
      }
      this.isOffline = true;
      const localAcc = this.loadLocalAccount();
      localAcc.invitations = (localAcc.invitations ?? []).map((inv) =>
        inv.token_preview === tokenPreview ? { ...inv, status: 'revoked' as const } : inv
      );
      this.saveLocalAccount(localAcc);
    }
  }

  async logout(allDevices = false): Promise<{ logged_out: boolean }> {
    const endpoint = allDevices ? '/api/auth/logout-all' : '/api/auth/logout';
    try {
      const res = await this.fetchJson<{ logged_out: boolean }>(
        endpoint,
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
        'write'
      );
      this.isOffline = false;
      this.csrfToken = null;
      return res;
    } catch (err) {
      if (!this.shouldFallbackOffline(err)) {
        throw err;
      }
      this.isOffline = true;
      const localAcc = this.loadLocalAccount();
      localAcc.authenticated = false;
      this.saveLocalAccount(localAcc);
      return { logged_out: true };
    }
  }

  async deleteAccount(): Promise<{ deleted: boolean; reset_demo?: boolean }> {
    try {
      const res = await this.fetchJson<{ deleted: boolean; reset_demo?: boolean }>(
        '/api/auth/account',
        {
          method: 'DELETE',
        },
        'delete'
      );
      this.isOffline = false;
      this.csrfToken = null;
      return res;
    } catch (err) {
      if (!this.shouldFallbackOffline(err)) {
        throw err;
      }
      this.isOffline = true;
      try {
        localStorage.removeItem(STORAGE_STATE_KEY);
        localStorage.removeItem(STORAGE_ACCOUNT_KEY);
      } catch {
        // ignore
      }
      return { deleted: true, reset_demo: true };
    }
  }
}
