import { Injectable } from '@angular/core';
import {
  AccountSummary,
  AiProviderName,
  BiologicalSex,
  LabItem,
  LabRecord,
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

const STORAGE_STATE_KEY = 'lab_analyzer_offline_state_v2';
const STORAGE_AI_KEY = 'lab_analyzer_ai_config_v1';

export function createDefaultAccountSummary(): AccountSummary {
  return {
    registration_mode: 'demo',
    authenticated: false,
    email: null,
    display_name: 'ゲスト',
    plan_tier: 'free',
    monthly_ocr_used: 0,
    monthly_ocr_limit: 5,
    terms_accepted: true,
  };
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  isOffline = false;
  servicePaused = false;
  servicePausedCode: AppErrorCode | null = null;
  servicePausedReason = '';

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

  private async fetchJson<T>(url: string, init?: RequestInit, context: ErrorContext = 'read'): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
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

      if (isJson) {
        try {
          const body = (await res.json()) as { error?: { code?: unknown; requestId?: unknown } };
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

      const friendly = friendlyErrorMessage(code, context);
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
      return {
        profile: data.profile,
        records: data.records ?? [],
        standards: data.standards?.length ? data.standards : REFERENCE_STANDARDS,
        providers: data.providers?.length ? data.providers : ['gemini', 'openai', 'claude'],
        account: data.account ?? createDefaultAccountSummary(),
      };
    } catch (err) {
      if (!this.shouldFallbackOffline(err)) {
        throw err;
      }
      this.isOffline = true;
      const local = this.loadLocalState();
      return {
        profile: local.profile,
        records: local.records,
        standards: REFERENCE_STANDARDS,
        providers: ['gemini', 'openai', 'claude'],
        account: {
          ...createDefaultAccountSummary(),
          display_name: local.profile.name || 'ゲスト',
        },
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
}
