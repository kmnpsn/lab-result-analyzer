import { Injectable } from '@angular/core';
import {
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
  PROVIDER_META,
  createFallbackProfile,
  createFallbackRecords,
  createSampleOcrResult,
  generateLocalAnalysis,
  parseLabTextLocally,
} from './fallback-engine';

export interface BootstrapResponse {
  profile: UserProfile;
  records: LabRecord[];
  standards: ReferenceStandard[];
  providers: AiProviderName[];
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

const STORAGE_STATE_KEY = 'lab_analyzer_offline_state_v1';
const STORAGE_AI_KEY = 'lab_analyzer_ai_config_v1';

@Injectable({ providedIn: 'root' })
export class ApiService {
  isOffline = false;

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

  private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }

  async bootstrap(): Promise<BootstrapResponse> {
    try {
      const data = await this.fetchJson<BootstrapResponse>('/api/bootstrap');
      this.isOffline = false;
      return {
        profile: data.profile,
        records: data.records ?? [],
        standards: data.standards?.length ? data.standards : REFERENCE_STANDARDS,
        providers: data.providers?.length ? data.providers : ['gemini', 'openai', 'claude'],
      };
    } catch {
      this.isOffline = true;
      const local = this.loadLocalState();
      return {
        profile: local.profile,
        records: local.records,
        standards: REFERENCE_STANDARDS,
        providers: ['gemini', 'openai', 'claude'],
      };
    }
  }

  async updateProfile(profile: Partial<UserProfile>): Promise<UserProfile> {
    try {
      const updated = await this.fetchJson<UserProfile>('/api/profile', {
        method: 'PUT',
        body: JSON.stringify(profile),
      });
      this.isOffline = false;
      return updated;
    } catch {
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
      const saved = await this.fetchJson<LabRecord>('/api/records', {
        method: 'POST',
        body: JSON.stringify({
          ...record,
          provider: aiConfig.provider,
          model: aiConfig.model,
          apiKey,
        }),
      });
      this.isOffline = false;
      return saved;
    } catch {
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
      await this.fetchJson<{ deleted: boolean }>(`/api/records/${id}`, {
        method: 'DELETE',
      });
      this.isOffline = false;
    } catch {
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
      const res = await this.fetchJson<OcrResponse>('/api/ocr', {
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
      });
      this.isOffline = false;
      return res;
    } catch {
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
      const res = await this.fetchJson<AnalyzeResponse>('/api/analyze', {
        method: 'POST',
        body: JSON.stringify({
          record: params.record,
          history: params.history,
          profile: params.profile,
          provider: params.provider,
          model: params.model,
          apiKey: params.apiKey?.trim() || undefined,
        }),
      });
      this.isOffline = false;
      return res;
    } catch {
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
