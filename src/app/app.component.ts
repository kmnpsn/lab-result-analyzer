import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AUTH_PROVIDERS,
  AccountSummary,
  AiProviderName,
  AuthProviderId,
  AuthProviderMeta,
  BiologicalSex,
  InvitationSummary,
  LabFlag,
  LabItem,
  LabRecord,
  LinkedIdentity,
  REFERENCE_STANDARDS,
  RecordType,
  ReferenceStandard,
  SYMPTOM_TAG_PRESETS,
  UserProfile,
  computeFlag,
  lookupStandard,
} from '../shared/types';
import { AiClientConfig, ApiService, createDefaultAccountSummary } from './api.service';
import {
  CorrelationInsight,
  PROVIDER_META,
  WELLNESS_METRICS,
  WellnessMetricDef,
  buildCorrelationInsight,
  createSampleOcrResult,
} from './fallback-engine';

type TabId = 'dashboard' | 'register' | 'detail' | 'settings';

const TAB_THEME_COLORS: Record<TabId, string> = {
  dashboard: '#0f766e', // ホーム・推移: ティールグリーン
  register: '#c2410c',  // 記録・読取: オレンジ
  detail: '#1d4ed8',    // 診断詳細: ブルー
  settings: '#475569',  // 設定・持病: シルバーグレー
};

interface ChartLabPoint {
  index: number;
  x: number;
  y: number;
  value: number;
  flag: LabFlag;
  date: string;
  record: LabRecord;
}

interface ChartWellnessSeries {
  key: WellnessMetricDef['key'];
  label: string;
  shortLabel: string;
  color: string;
  polyline: string;
  points: Array<{ index: number; x: number; y: number; value: number; date: string; record: LabRecord }>;
}

interface ChartModel {
  width: number;
  height: number;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  itemName: string;
  unit: string;
  refLow: number | null;
  refHigh: number | null;
  refBandY: number | null;
  refBandH: number | null;
  refLowY: number | null;
  refHighY: number | null;
  leftTicks: Array<{ y: number; label: string }>;
  rightTicks: Array<{ y: number; label: string }>;
  xLabels: Array<{ x: number; label: string; index: number }>;
  labPolyline: string;
  labPoints: ChartLabPoint[];
  wellnessSeries: ChartWellnessSeries[];
  weightPolyline: string;
  weightPoints: Array<{ x: number; y: number; weight: number; date: string }>;
  sortedRecords: LabRecord[];
}

interface DetailItemView {
  item: LabItem;
  gaugePercent: number;
  refStartPct: number;
  refWidthPct: number;
  delta: number | null;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  activeTab: TabId = 'dashboard';

  loading = true;
  saving = false;
  ocrLoading = false;
  analyzing = false;

  toastMessage = '';
  toastType: 'info' | 'success' | 'error' = 'info';
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  profile: UserProfile = {
    id: 1,
    name: '',
    age: 40,
    sex: 'female',
    height_cm: 160,
    chronic_conditions: '',
    medications: '',
    preferred_provider: 'gemini',
    preferred_model: PROVIDER_META.gemini.defaultModel,
  };
  profileForm: UserProfile = { ...this.profile };

  records: LabRecord[] = [];
  standards: ReferenceStandard[] = REFERENCE_STANDARDS;
  providers: AiProviderName[] = ['gemini', 'openai', 'claude'];
  account: AccountSummary = createDefaultAccountSummary();
  aiConfig: AiClientConfig;

  readonly providerMeta = PROVIDER_META;
  readonly wellnessMetrics = WELLNESS_METRICS;
  readonly symptomTagPresets = SYMPTOM_TAG_PRESETS;
  readonly authProviders = AUTH_PROVIDERS;
  readonly quickChartCodes = ['Hb', 'CRP', 'Ferritin', 'ALT', 'eGFR', 'HbA1c', 'WBC', 'TSH', 'LDL'];

  // 招待URLバナー & 認証エラー通知
  inviteToken: string | null = null;
  inviteChecking = false;
  inviteState: 'none' | 'valid' | 'invalid' = 'none';
  inviteEmailHint = '';
  inviteReason = '';
  authErrorBanner = '';

  // タブ4: 認証・SNS連携・家族招待・アカウント削除
  authBusy = false;
  linkingProvider: AuthProviderId | null = null;
  inviteEmailInput = '';
  inviteNoteInput = '';
  creatingInvite = false;
  latestCreatedInviteUrl = '';
  latestCreatedInviteEmail = '';
  revokingTokenPreview: string | null = null;
  deletingAccount = false;

  // サーキットブレーカー / メンテナンス待機画面
  previewServicePause = false;
  retryingPause = false;

  // タブ1: チャート設定 & 記録フィルタ
  selectedChartCode = 'Hb';
  recordFilter: 'all' | 'lab' | 'daily' = 'all';
  wellnessSelection: Record<WellnessMetricDef['key'], boolean> = {
    overall_score: true,
    fatigue_score: true,
    sleep_score: false,
    pain_score: false,
    appetite_score: false,
  };
  showWeightOverlay = true;
  hoveredPointIndex: number | null = null;

  // タブ2: 登録フォーム（2モード: daily / lab）
  formRecordType: RecordType = 'daily';
  formSymptomTags: string[] = [];
  formTestedAt = new Date().toISOString().slice(0, 10);
  formFacilityName = '';
  formWeightKg: number | null = null;
  formOverall = 7;
  formFatigue = 7;
  formSleep = 7;
  formPain = 7;
  formAppetite = 7;
  formConditionNote = '';
  formItems: LabItem[] = [];
  ocrRawText = '';
  ocrFileName = '';
  ocrPreviewUrl: string | null = null;
  ocrStatusMessage = '';
  isDragOver = false;
  presetToAdd = 'Hb';

  // タブ3: 詳細
  selectedRecordId: number | null = null;

  // タブ4: 設定（AI設定は ?admin=1 の管理者モード時のみ表示）
  showApiKey = false;
  isAdminMode = false;

  constructor(public api: ApiService) {
    this.aiConfig = this.api.loadAiConfig();
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      this.isAdminMode = params.get('admin') === '1';

      // /invite/<token> パスまたは ?invite=<token> クエリを検出
      const pathMatch = window.location.pathname.match(/^\/invite\/([^/?#]+)/);
      const tokenFromPath = pathMatch ? decodeURIComponent(pathMatch[1]) : null;
      const tokenFromQuery = params.get('invite');
      this.inviteToken = (tokenFromPath || tokenFromQuery || '').trim() || null;

      // 認証コールバックからのエラー案内
      const authError = params.get('auth_error') || params.get('error');
      if (authError === 'not_invited') {
        this.authErrorBanner =
          'この Google アカウントは招待されていません。招待リンクを受け取ったメールアドレスでログインしてください。';
      } else if (authError) {
        this.authErrorBanner =
          'ログイン処理が完了できませんでした。時間をおいてもう一度お試しください。';
      }
    }
  }

  async ngOnInit(): Promise<void> {
    const tasks: Array<Promise<unknown>> = [this.loadInitialData()];
    if (this.inviteToken) {
      tasks.push(this.verifyInviteToken(this.inviteToken));
    }
    await Promise.all(tasks);
  }

  private async verifyInviteToken(token: string): Promise<void> {
    this.inviteChecking = true;
    try {
      const res = await this.api.verifyInvite(token);
      if (res.valid) {
        this.inviteState = 'valid';
        this.inviteEmailHint = res.email_hint || '';
        this.inviteReason = '';
      } else {
        this.inviteState = 'invalid';
        this.inviteReason = res.reason || 'not_found';
      }
    } catch {
      this.inviteState = 'invalid';
      this.inviteReason = 'not_found';
    } finally {
      this.inviteChecking = false;
    }
  }

  dismissInviteBanner(): void {
    this.inviteState = 'none';
    this.inviteToken = null;
    this.inviteEmailHint = '';
    this.inviteReason = '';
  }

  dismissAuthErrorBanner(): void {
    this.authErrorBanner = '';
  }

  private async loadInitialData(): Promise<void> {
    this.loading = true;
    try {
      const data = await this.api.bootstrap();
      this.profile = data.profile;
      this.profileForm = { ...data.profile };
      this.records = this.sortRecordsDesc(data.records);
      this.standards = data.standards;
      this.providers = data.providers;
      if (data.account) {
        this.account = data.account;
      }

      if (this.records.length > 0) {
        this.selectedRecordId = this.records[0].id ?? null;
        this.formWeightKg = this.records[0].weight_kg ?? null;
      }

      // プロフィールの推奨プロバイダを初回のみ反映（ローカル設定が無い場合）
      if (this.profile.preferred_provider && !this.aiConfig.apiKeys[this.aiConfig.provider]) {
        this.aiConfig.provider = this.profile.preferred_provider;
        this.aiConfig.model =
          this.profile.preferred_model || PROVIDER_META[this.profile.preferred_provider].defaultModel;
      }

      // 登録フォーム初期行（標準項目を3つだけ用意）
      this.initDefaultFormItems();
      this.syncThemeColor();
    } catch (err) {
      if (!this.isServicePaused) {
        this.showToast(this.api.getErrorMessage(err, 'read'), 'error');
      }
    } finally {
      this.loading = false;
    }
  }

  // ===== サーキットブレーカー / メンテナンス待機画面 =====

  get isServicePaused(): boolean {
    return this.api.servicePaused || this.previewServicePause;
  }

  get servicePauseMessage(): string {
    if (this.api.servicePaused && this.api.servicePausedReason) {
      return this.api.servicePausedReason;
    }
    return 'ただいまアクセスが集中しているか、点検のため一時的に止めています。入力中の内容は保存されていません。しばらくしてからもう一度開いてください。';
  }

  toggleServicePausePreview(): void {
    this.previewServicePause = !this.previewServicePause;
  }

  async retryFromPause(): Promise<void> {
    if (this.previewServicePause && !this.api.servicePaused) {
      this.previewServicePause = false;
      return;
    }
    this.retryingPause = true;
    try {
      this.api.clearServicePause();
      await this.loadInitialData();
      if (!this.isServicePaused) {
        this.showToast('最新の状態を読み込みました', 'success');
      }
    } finally {
      this.retryingPause = false;
    }
  }

  // ===== タブ切替 & スマホヘッダー操作 =====

  selectTab(tab: TabId): void {
    this.activeTab = tab;
    this.syncThemeColor();
  }

  private syncThemeColor(): void {
    if (typeof document === 'undefined') return;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) {
      meta.content = TAB_THEME_COLORS[this.activeTab] || '#0f766e';
    }
  }

  get headerDateLabel(): string {
    const rec = this.selectedRecord ?? this.latestRecord;
    if (!rec?.tested_at) return '記録なし';
    const [y, m, d] = rec.tested_at.split('-');
    if (!y || !m || !d) return rec.tested_at;
    return `${y}年${Number(m)}月${Number(d)}日`;
  }

  get canPrevRecord(): boolean {
    if (this.records.length <= 1) return false;
    const current = this.selectedRecord ?? this.latestRecord;
    if (!current) return false;
    const idx = this.records.findIndex((r) => r.id === current.id);
    return idx >= 0 && idx < this.records.length - 1;
  }

  get canNextRecord(): boolean {
    if (this.records.length <= 1) return false;
    const current = this.selectedRecord ?? this.latestRecord;
    if (!current) return false;
    const idx = this.records.findIndex((r) => r.id === current.id);
    return idx > 0;
  }

  stepRecord(delta: -1 | 1): void {
    if (this.records.length <= 1) return;
    const current = this.selectedRecord ?? this.latestRecord;
    if (!current) return;
    const idx = this.records.findIndex((r) => r.id === current.id);
    // records は新しい順（降順）なので、過去（前）は idx + 1、新しい方（次）は idx - 1
    const nextIdx = delta < 0 ? idx + 1 : idx - 1;
    if (nextIdx >= 0 && nextIdx < this.records.length) {
      this.selectedRecordId = this.records[nextIdx].id ?? null;
    }
  }

  // ===== 共通ヘルパー =====

  showToast(message: string, type: 'info' | 'success' | 'error' = 'info'): void {
    this.toastMessage = message;
    this.toastType = type;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastMessage = '';
    }, 4200);
  }

  private sortRecordsDesc(list: LabRecord[]): LabRecord[] {
    return [...list].sort((a, b) => {
      const cmp = b.tested_at.localeCompare(a.tested_at);
      return cmp !== 0 ? cmp : (b.id ?? 0) - (a.id ?? 0);
    });
  }

  get latestRecord(): LabRecord | null {
    return this.records.length > 0 ? this.records[0] : null;
  }

  getRecordType(record: LabRecord): RecordType {
    if (record.record_type === 'daily') return 'daily';
    if (record.record_type === 'lab') return 'lab';
    return record.items.length > 0 ? 'lab' : 'daily';
  }

  getRecordTags(record: LabRecord): string[] {
    return (record.symptom_tags || '')
      .split(/[,、\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  get filteredRecords(): LabRecord[] {
    if (this.recordFilter === 'all') return this.records;
    return this.records.filter((r) => this.getRecordType(r) === this.recordFilter);
  }

  get labRecordCount(): number {
    return this.records.filter((r) => this.getRecordType(r) === 'lab').length;
  }

  get dailyRecordCount(): number {
    return this.records.filter((r) => this.getRecordType(r) === 'daily').length;
  }

  get latestLabRecord(): LabRecord | null {
    return this.records.find((r) => this.getRecordType(r) === 'lab') ?? null;
  }

  getRegistrationModeLabel(): string {
    if (this.account.registration_mode === 'invite_only') return '招待制（クローズド運用）';
    if (this.account.registration_mode === 'open') return '一般公開モード';
    return 'デモモード（お試し利用）';
  }

  getPlanTierLabel(): string {
    if (this.account.plan_tier === 'pro') return 'プロプラン';
    if (this.account.plan_tier === 'plus') return 'プラスプラン';
    return '無料プラン';
  }

  get bmi(): string {
    const h = this.profile.height_cm;
    const w = this.latestRecord?.weight_kg;
    if (!h || !w || h <= 0) return '--';
    const meters = h / 100;
    return (w / (meters * meters)).toFixed(1);
  }

  get profileFormBmi(): string {
    const h = this.profileForm.height_cm;
    const w = this.latestRecord?.weight_kg;
    if (!h || !w || h <= 0) return '--';
    const meters = h / 100;
    return (w / (meters * meters)).toFixed(1);
  }

  get chronicTags(): string[] {
    return (this.profile.chronic_conditions || '')
      .split(/[,、\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  getSexLabel(sex: BiologicalSex): string {
    if (sex === 'male') return '男性';
    if (sex === 'female') return '女性';
    return 'その他';
  }

  getScoreClass(score: number): string {
    if (score >= 7) return 'score-good';
    if (score >= 4) return 'score-mid';
    return 'score-low';
  }

  getAbnormalItems(record: LabRecord): LabItem[] {
    return record.items.filter((i) => i.flag === 'H' || i.flag === 'L');
  }

  getFlagLabel(flag: LabFlag): string {
    if (flag === 'H') return '高め';
    if (flag === 'L') return '低め';
    return '基準内';
  }

  switchProviderQuick(provider: AiProviderName): void {
    this.aiConfig.provider = provider;
    this.aiConfig.model = PROVIDER_META[provider].defaultModel;
    this.api.saveAiConfig(this.aiConfig);
    this.showToast(`AIプロバイダを ${PROVIDER_META[provider].label} (${this.aiConfig.model}) に切り替えました`, 'info');
  }

  // ===== タブ1: ダッシュボード & 2軸チャート =====

  get availableChartCodes(): Array<{ code: string; name: string }> {
    const map = new Map<string, string>();
    for (const code of this.quickChartCodes) {
      const std = this.standards.find((s) => s.code === code);
      if (std) map.set(std.code, std.name);
    }
    for (const rec of this.records) {
      for (const item of rec.items) {
        if (!map.has(item.item_code)) {
          map.set(item.item_code, item.item_name);
        }
      }
    }
    return Array.from(map.entries()).map(([code, name]) => ({ code, name }));
  }

  get correlationInsight(): CorrelationInsight {
    return buildCorrelationInsight(this.records, this.selectedChartCode);
  }

  get chartModel(): ChartModel {
    const width = 760;
    const height = 310;
    const plotLeft = 62;
    const plotRight = width - 58;
    const plotTop = 24;
    const plotBottom = height - 42;
    const plotW = plotRight - plotLeft;
    const plotH = plotBottom - plotTop;

    const sortedRecords = [...this.records].sort((a, b) => a.tested_at.localeCompare(b.tested_at));
    const { standard, refLow: stdLow, refHigh: stdHigh } = lookupStandard(
      this.selectedChartCode,
      this.profile.sex
    );

    const matchedItems = sortedRecords.map((rec) =>
      rec.items.find((it) => it.item_code === this.selectedChartCode || it.item_name === this.selectedChartCode)
    );
    const firstMatched = matchedItems.find((x): x is LabItem => !!x);

    const refLow = firstMatched?.ref_low ?? stdLow;
    const refHigh = firstMatched?.ref_high ?? stdHigh;
    const itemName = firstMatched?.item_name ?? standard?.name ?? this.selectedChartCode;
    const unit = firstMatched?.unit ?? standard?.unit ?? '';

    const numericValues: number[] = [];
    for (const it of matchedItems) {
      if (it && Number.isFinite(it.value)) numericValues.push(it.value);
    }
    if (refLow !== null) numericValues.push(refLow);
    if (refHigh !== null) numericValues.push(refHigh);

    let yMin = numericValues.length > 0 ? Math.min(...numericValues) : 0;
    let yMax = numericValues.length > 0 ? Math.max(...numericValues) : 100;
    if (yMin === yMax) {
      yMin = Math.max(0, yMin - 1);
      yMax = yMax + 1;
    } else {
      const margin = (yMax - yMin) * 0.16;
      yMin = Math.max(0, yMin - margin);
      yMax = yMax + margin;
    }

    const xFor = (i: number): number => {
      if (sortedRecords.length <= 1) return plotLeft + plotW / 2;
      return plotLeft + (i / (sortedRecords.length - 1)) * plotW;
    };
    const yLeft = (v: number): number => {
      const ratio = (v - yMin) / (yMax - yMin || 1);
      return plotBottom - ratio * plotH;
    };
    const yRight = (score: number): number => {
      const clamped = Math.max(1, Math.min(10, score));
      const ratio = (clamped - 1) / 9;
      return plotBottom - ratio * plotH;
    };

    const refLowY = refLow !== null ? yLeft(refLow) : null;
    const refHighY = refHigh !== null ? yLeft(refHigh) : null;
    let refBandY: number | null = null;
    let refBandH: number | null = null;
    if (refLowY !== null && refHighY !== null) {
      refBandY = Math.min(refLowY, refHighY);
      refBandH = Math.max(2, Math.abs(refLowY - refHighY));
    }

    const leftTicks: Array<{ y: number; label: string }> = [];
    for (let i = 0; i <= 4; i++) {
      const v = yMin + ((yMax - yMin) * i) / 4;
      const decimals = yMax - yMin < 5 ? 2 : yMax - yMin < 30 ? 1 : 0;
      leftTicks.push({ y: yLeft(v), label: v.toFixed(decimals) });
    }

    const rightTicks: Array<{ y: number; label: string }> = [1, 4, 7, 10].map((s) => ({
      y: yRight(s),
      label: String(s),
    }));

    const labelStep = sortedRecords.length > 8 ? Math.ceil(sortedRecords.length / 7) : 1;
    const xLabels = sortedRecords
      .map((rec, index) => ({
        x: xFor(index),
        label: rec.tested_at.slice(5), // MM-DD
        index,
      }))
      .filter((_, idx) => idx === 0 || idx === sortedRecords.length - 1 || idx % labelStep === 0);

    const labPoints: ChartLabPoint[] = [];
    sortedRecords.forEach((rec, index) => {
      const it = matchedItems[index];
      if (!it) return;
      labPoints.push({
        index,
        x: xFor(index),
        y: yLeft(it.value),
        value: it.value,
        flag: it.flag,
        date: rec.tested_at,
        record: rec,
      });
    });
    const labPolyline = labPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

    const wellnessSeries: ChartWellnessSeries[] = this.wellnessMetrics
      .filter((m) => this.wellnessSelection[m.key])
      .map((m) => {
        const pts = sortedRecords.map((rec, index) => ({
          index,
          x: xFor(index),
          y: yRight(rec[m.key]),
          value: rec[m.key],
          date: rec.tested_at,
          record: rec,
        }));
        return {
          key: m.key,
          label: m.label,
          shortLabel: m.shortLabel,
          color: m.color,
          points: pts,
          polyline: pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
        };
      });

    // 体重オーバーレイ（体重の最小・最大からプロット領域内に正規化）
    const weightPoints: Array<{ x: number; y: number; weight: number; date: string }> = [];
    if (this.showWeightOverlay) {
      const weights = sortedRecords
        .map((r) => r.weight_kg)
        .filter((w): w is number => typeof w === 'number' && Number.isFinite(w));
      if (weights.length > 0) {
        let wMin = Math.min(...weights);
        let wMax = Math.max(...weights);
        if (wMax - wMin < 2) {
          wMin -= 1.5;
          wMax += 1.5;
        } else {
          const pad = (wMax - wMin) * 0.2;
          wMin -= pad;
          wMax += pad;
        }
        sortedRecords.forEach((rec, index) => {
          if (typeof rec.weight_kg === 'number' && Number.isFinite(rec.weight_kg)) {
            const ratio = (rec.weight_kg - wMin) / (wMax - wMin || 1);
            weightPoints.push({
              x: xFor(index),
              y: plotBottom - ratio * plotH,
              weight: rec.weight_kg,
              date: rec.tested_at,
            });
          }
        });
      }
    }
    const weightPolyline = weightPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

    return {
      width,
      height,
      plotLeft,
      plotRight,
      plotTop,
      plotBottom,
      itemName,
      unit,
      refLow,
      refHigh,
      refBandY,
      refBandH,
      refLowY,
      refHighY,
      leftTicks,
      rightTicks,
      xLabels,
      labPolyline,
      labPoints,
      wellnessSeries,
      weightPolyline,
      weightPoints,
      sortedRecords,
    };
  }

  get hoveredRecord(): LabRecord | null {
    if (this.hoveredPointIndex === null) return null;
    return this.chartModel.sortedRecords[this.hoveredPointIndex] ?? null;
  }

  getHoveredLabItem(): LabItem | null {
    const rec = this.hoveredRecord;
    if (!rec) return null;
    return (
      rec.items.find((it) => it.item_code === this.selectedChartCode || it.item_name === this.selectedChartCode) ??
      null
    );
  }

  openRecordDetail(record: LabRecord): void {
    this.selectedRecordId = record.id ?? null;
    this.selectTab('detail');
  }

  async deleteRecord(record: LabRecord, event?: Event): Promise<void> {
    if (event) event.stopPropagation();
    if (record.id === undefined) return;
    const label = record.facility_name || (this.getRecordType(record) === 'daily' ? '体調日記' : '記録');
    if (!confirm(`${record.tested_at}（${label}）を削除しますか？`)) {
      return;
    }
    try {
      await this.api.deleteRecord(record.id);
      this.records = this.records.filter((r) => r.id !== record.id);
      if (this.selectedRecordId === record.id) {
        this.selectedRecordId = this.records[0]?.id ?? null;
      }
      this.showToast('記録を削除しました', 'info');
    } catch (err) {
      if (!this.isServicePaused) {
        this.showToast(this.api.getErrorMessage(err, 'delete'), 'error');
      }
    }
  }

  // ===== タブ2: 記録フォーム（体調日記 / 採血結果＋体調） =====

  setFormRecordType(type: RecordType): void {
    this.formRecordType = type;
    if (type === 'lab' && this.formItems.length === 0) {
      this.initDefaultFormItems();
    }
  }

  toggleSymptomTag(tag: string): void {
    const idx = this.formSymptomTags.indexOf(tag);
    if (idx >= 0) {
      this.formSymptomTags.splice(idx, 1);
    } else {
      this.formSymptomTags.push(tag);
    }
  }

  hasSymptomTag(tag: string): boolean {
    return this.formSymptomTags.includes(tag);
  }

  private initDefaultFormItems(): void {
    this.formItems = ['Hb', 'CRP', 'Ferritin'].map((code) => this.buildItemFromCode(code, 0));
  }

  private buildItemFromCode(code: string, value: number): LabItem {
    const { standard, refLow, refHigh } = lookupStandard(code, this.profile.sex);
    return {
      category: standard?.category ?? 'その他',
      item_code: standard?.code ?? code,
      item_name: standard?.name ?? code,
      value,
      unit: standard?.unit ?? '',
      ref_low: refLow,
      ref_high: refHigh,
      flag: computeFlag(value, refLow, refHigh),
    };
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver = true;
  }

  onDragLeave(): void {
    this.isDragOver = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      void this.processFile(file);
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      void this.processFile(file);
    }
    input.value = '';
  }

  private async processFile(file: File): Promise<void> {
    this.ocrFileName = file.name;
    this.ocrLoading = true;
    this.ocrStatusMessage = `${file.name} を ${PROVIDER_META[this.aiConfig.provider].label} で読み取り中...`;

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('ファイル読み込みに失敗しました'));
        reader.readAsDataURL(file);
      });

      this.ocrPreviewUrl = file.type.startsWith('image/') ? dataUrl : null;
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;

      const res = await this.api.runOcr({
        imageBase64: base64,
        mimeType: file.type || 'image/png',
        sex: this.profile.sex,
        aiConfig: this.aiConfig,
      });

      this.applyOcrResponse(res);
    } catch (err) {
      const msg = this.api.getErrorMessage(err, 'ocr');
      this.ocrStatusMessage = msg;
      if (!this.isServicePaused) {
        this.showToast(msg, 'error');
      }
    } finally {
      this.ocrLoading = false;
    }
  }

  async runTextOcr(): Promise<void> {
    if (!this.ocrRawText.trim()) {
      this.showToast('検査結果テキストを貼り付けてください', 'info');
      return;
    }
    this.ocrLoading = true;
    this.ocrStatusMessage = 'テキストから採血項目を抽出中...';
    try {
      const res = await this.api.runOcr({
        rawText: this.ocrRawText,
        sex: this.profile.sex,
        aiConfig: this.aiConfig,
      });
      this.applyOcrResponse(res);
    } catch (err) {
      const msg = this.api.getErrorMessage(err, 'ocr');
      this.ocrStatusMessage = msg;
      if (!this.isServicePaused) {
        this.showToast(msg, 'error');
      }
    } finally {
      this.ocrLoading = false;
    }
  }

  private applyOcrResponse(res: { tested_at?: string; facility_name?: string; items: LabItem[]; note?: string }): void {
    if (res.tested_at) this.formTestedAt = res.tested_at;
    if (res.facility_name) this.formFacilityName = res.facility_name;
    if (res.items && res.items.length > 0) {
      this.formItems = res.items.map((it) => {
        const { standard, refLow, refHigh } = lookupStandard(it.item_code || it.item_name, this.profile.sex);
        const low = it.ref_low ?? refLow;
        const high = it.ref_high ?? refHigh;
        return {
          ...it,
          category: it.category || standard?.category || 'その他',
          unit: it.unit || standard?.unit || '',
          ref_low: low,
          ref_high: high,
          flag: computeFlag(it.value, low, high),
        };
      });
      this.ocrStatusMessage =
        res.note || `${this.formItems.length} 件の項目を読み取りました。下の欄で数値を確認・修正できます。`;
      this.showToast(`${this.formItems.length} 件の項目を読み取りました`, 'success');
    } else {
      this.ocrStatusMessage = 'うまく読み取れませんでした。下の欄から直接入力してください。';
      this.showToast('読み取れなかったため、手入力をご利用ください', 'error');
    }
  }

  loadSampleToForm(): void {
    const sample = createSampleOcrResult(this.profile.sex);
    this.formRecordType = 'lab';
    this.formTestedAt = sample.tested_at;
    this.formFacilityName = sample.facility_name;
    this.formWeightKg = this.latestRecord?.weight_kg ?? 54.5;
    this.formOverall = 5;
    this.formFatigue = 4;
    this.formSleep = 6;
    this.formPain = 5;
    this.formAppetite = 7;
    this.formSymptomTags = ['だるさ・疲労', '関節・筋肉の違和感', '通院・採血日'];
    this.formConditionNote = 'ここ2週間ほど午後のだるさと軽度の関節違和感あり。鉄剤を隔日服用中。';
    this.formItems = sample.items;
    this.ocrRawText = sample.items.map((i) => `${i.item_code} ${i.value} ${i.unit}`).join('\n');
    this.ocrStatusMessage = 'サンプル採血結果（10項目）と体調スコアを読み込みました。';
    this.showToast('サンプル結果を読み込みました', 'success');
  }

  addPresetItem(code?: string): void {
    const target = code || this.presetToAdd;
    const { standard, refLow, refHigh } = lookupStandard(target, this.profile.sex);
    const defaultVal =
      refLow !== null && refHigh !== null ? Number(((refLow + refHigh) / 2).toFixed(1)) : 0;
    this.formItems.push({
      category: standard?.category ?? 'その他',
      item_code: standard?.code ?? target,
      item_name: standard?.name ?? target,
      value: defaultVal,
      unit: standard?.unit ?? '',
      ref_low: refLow,
      ref_high: refHigh,
      flag: computeFlag(defaultVal, refLow, refHigh),
    });
  }

  addCustomItem(): void {
    this.formItems.push({
      category: 'その他',
      item_code: 'CUSTOM',
      item_name: '自由項目',
      value: 0,
      unit: '',
      ref_low: null,
      ref_high: null,
      flag: 'N',
    });
  }

  removeFormItem(index: number): void {
    this.formItems.splice(index, 1);
  }

  recomputeItemFlag(item: LabItem): void {
    const val = Number(item.value);
    const low = item.ref_low === null || (item.ref_low as unknown) === '' ? null : Number(item.ref_low);
    const high = item.ref_high === null || (item.ref_high as unknown) === '' ? null : Number(item.ref_high);
    item.ref_low = Number.isFinite(low as number) ? low : null;
    item.ref_high = Number.isFinite(high as number) ? high : null;
    item.flag = Number.isFinite(val) ? computeFlag(val, item.ref_low, item.ref_high) : 'N';
  }

  resetForm(): void {
    this.formTestedAt = new Date().toISOString().slice(0, 10);
    this.formFacilityName = '';
    this.formOverall = 7;
    this.formFatigue = 7;
    this.formSleep = 7;
    this.formPain = 7;
    this.formAppetite = 7;
    this.formSymptomTags = [];
    this.formConditionNote = '';
    this.ocrRawText = '';
    this.ocrFileName = '';
    this.ocrPreviewUrl = null;
    this.ocrStatusMessage = '';
    this.initDefaultFormItems();
  }

  async saveRecordAndAnalyze(): Promise<void> {
    if (!this.formTestedAt) {
      this.showToast('日付を入力してください', 'error');
      return;
    }

    const isDaily = this.formRecordType === 'daily';
    const validItems = isDaily
      ? []
      : this.formItems.filter((it) => it.item_name.trim() !== '' && Number.isFinite(Number(it.value)));

    if (!isDaily && validItems.length === 0) {
      this.showToast('採血項目を1つ以上入力するか、「今日の体調日記だけつける」に切り替えてください', 'error');
      return;
    }

    this.saving = true;
    try {
      const payload: LabRecord = {
        record_type: this.formRecordType,
        symptom_tags: this.formSymptomTags.join(', '),
        tested_at: this.formTestedAt,
        facility_name: isDaily ? '' : this.formFacilityName.trim() || 'かかりつけ医療機関',
        weight_kg: this.formWeightKg !== null && Number.isFinite(Number(this.formWeightKg)) ? Number(this.formWeightKg) : null,
        overall_score: Number(this.formOverall),
        fatigue_score: Number(this.formFatigue),
        sleep_score: Number(this.formSleep),
        pain_score: Number(this.formPain),
        appetite_score: Number(this.formAppetite),
        condition_note: this.formConditionNote.trim(),
        items: validItems.map((it) => {
          const val = Number(it.value);
          const low = it.ref_low === null ? null : Number(it.ref_low);
          const high = it.ref_high === null ? null : Number(it.ref_high);
          return {
            ...it,
            value: val,
            ref_low: low,
            ref_high: high,
            flag: computeFlag(val, low, high),
          };
        }),
      };

      const saved = await this.api.createRecord(payload, this.records, this.profile, this.aiConfig);
      this.records = this.sortRecordsDesc([saved, ...this.records.filter((r) => r.id !== saved.id)]);
      this.selectedRecordId = saved.id ?? null;
      this.formSymptomTags = [];
      this.formConditionNote = '';
      this.selectTab('detail');
      this.showToast(isDaily ? '体調日記を保存しました' : '採血結果と体調を保存しました', 'success');
    } catch (err) {
      if (!this.isServicePaused) {
        this.showToast(this.api.getErrorMessage(err, 'write'), 'error');
      }
    } finally {
      this.saving = false;
    }
  }

  // ===== タブ3: 詳細 & AI 相関診断 =====

  get selectedRecord(): LabRecord | null {
    if (this.records.length === 0) return null;
    if (this.selectedRecordId !== null) {
      const found = this.records.find((r) => r.id === this.selectedRecordId);
      if (found) return found;
    }
    return this.records[0];
  }

  get previousRecord(): LabRecord | null {
    const current = this.selectedRecord;
    if (!current) return null;
    const idx = this.records.findIndex((r) => r.id === current.id);
    if (idx < 0 || idx + 1 >= this.records.length) return null;
    // 採血項目がある場合は直前の採血ありレコードと比較
    if (current.items.length > 0) {
      for (let i = idx + 1; i < this.records.length; i++) {
        if (this.records[i].items.length > 0) return this.records[i];
      }
    }
    return this.records[idx + 1];
  }

  get groupedDetailItems(): Array<{ category: string; items: DetailItemView[] }> {
    const rec = this.selectedRecord;
    if (!rec) return [];
    const prev = this.previousRecord;
    const groups = new Map<string, DetailItemView[]>();

    for (const item of rec.items) {
      const cat = item.category || 'その他';
      const prevItem = prev?.items.find((p) => p.item_code === item.item_code);
      const delta = prevItem ? Number((item.value - prevItem.value).toFixed(2)) : null;

      // ゲージバー座標計算（基準値幅の前後50%を余白として可視化）
      let refStartPct = 25;
      let refWidthPct = 50;
      let gaugePercent = 50;

      if (item.ref_low !== null && item.ref_high !== null && item.ref_high > item.ref_low) {
        const span = item.ref_high - item.ref_low;
        const minDisplay = Math.max(0, item.ref_low - span * 0.55);
        const maxDisplay = item.ref_high + span * 0.55;
        const total = maxDisplay - minDisplay || 1;
        refStartPct = ((item.ref_low - minDisplay) / total) * 100;
        refWidthPct = ((item.ref_high - item.ref_low) / total) * 100;
        gaugePercent = Math.max(2, Math.min(98, ((item.value - minDisplay) / total) * 100));
      } else if (item.flag === 'L') {
        gaugePercent = 15;
      } else if (item.flag === 'H') {
        gaugePercent = 85;
      }

      const list = groups.get(cat) ?? [];
      list.push({ item, gaugePercent, refStartPct, refWidthPct, delta });
      groups.set(cat, list);
    }

    return Array.from(groups.entries()).map(([category, items]) => ({ category, items }));
  }

  async reanalyzeWith(provider: AiProviderName): Promise<void> {
    const rec = this.selectedRecord;
    if (!rec) return;
    this.analyzing = true;
    const model =
      provider === this.aiConfig.provider
        ? this.aiConfig.model
        : PROVIDER_META[provider].defaultModel;
    const apiKey = this.aiConfig.apiKeys[provider];

    try {
      const result = await this.api.reanalyze({
        record: rec,
        history: this.records,
        profile: this.profile,
        provider,
        model,
        apiKey,
      });

      rec.ai_summary = result.ai_summary;
      rec.ai_correlation = result.ai_correlation;
      rec.ai_advice = result.ai_advice;
      rec.ai_provider = result.provider_used || provider;
      rec.ai_model = result.model_used || model;
      if (result.item_comments) {
        for (const it of rec.items) {
          if (result.item_comments[it.item_code]) {
            it.ai_comment = result.item_comments[it.item_code];
          }
        }
      }

      this.showToast('ふりかえりコメントを更新しました', 'success');
    } catch (err) {
      if (!this.isServicePaused) {
        this.showToast(this.api.getErrorMessage(err, 'read'), 'error');
      }
    } finally {
      this.analyzing = false;
    }
  }

  // ===== タブ4: プロフィール & 設定 & CSV書き出し =====

  async saveProfile(): Promise<void> {
    this.saving = true;
    try {
      const updated = await this.api.updateProfile({
        ...this.profileForm,
        preferred_provider: this.aiConfig.provider,
        preferred_model: this.aiConfig.model,
      });
      this.profile = updated;
      this.profileForm = { ...updated };

      // 性別変更に合わせて登録フォームの基準値も再適用
      for (const it of this.formItems) {
        const { refLow, refHigh } = lookupStandard(it.item_code, this.profile.sex);
        if (refLow !== null && refHigh !== null) {
          it.ref_low = refLow;
          it.ref_high = refHigh;
          it.flag = computeFlag(it.value, refLow, refHigh);
        }
      }

      this.showToast('プロフィールと持病設定を保存しました（基準値マスタ連動済み）', 'success');
    } catch (err) {
      if (!this.isServicePaused) {
        this.showToast(this.api.getErrorMessage(err, 'write'), 'error');
      }
    } finally {
      this.saving = false;
    }
  }

  exportRecordsCsv(): void {
    if (this.records.length === 0) {
      this.showToast('書き出す記録がまだありません', 'info');
      return;
    }

    const majorCodes = ['WBC', 'Hb', 'Ferritin', 'CRP', 'AST', 'ALT', 'eGFR', 'HbA1c', 'LDL', 'TSH'];
    const headers = [
      '日付',
      '記録種別',
      '医療機関',
      '体重(kg)',
      '全体の調子',
      '元気さ・だるさのなさ',
      'からだの快適さ(不調のなさ)',
      '睡眠・休養',
      '食事・日常生活',
      '症状タグ',
      'ひとことメモ',
      ...majorCodes,
    ];

    const escapeCsv = (val: string | number | null | undefined): string => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (/[",\r\n]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const sortedAsc = [...this.records].sort((a, b) => a.tested_at.localeCompare(b.tested_at));
    const rows = sortedAsc.map((rec) => {
      const typeLabel = this.getRecordType(rec) === 'daily' ? '体調日記' : '採血あり';
      const labValues = majorCodes.map((code) => {
        const found = rec.items.find((it) => it.item_code === code);
        return found ? found.value : '';
      });
      return [
        rec.tested_at,
        typeLabel,
        rec.facility_name || '',
        rec.weight_kg ?? '',
        rec.overall_score,
        rec.fatigue_score,
        rec.pain_score,
        rec.sleep_score,
        rec.appetite_score,
        rec.symptom_tags || '',
        rec.condition_note || '',
        ...labValues,
      ]
        .map(escapeCsv)
        .join(',');
    });

    const csvContent = '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    a.href = url;
    a.download = `karada-note-records-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.showToast(`${this.records.length} 件の記録を CSV で書き出しました`, 'success');
  }

  selectProvider(provider: AiProviderName): void {
    this.aiConfig.provider = provider;
    this.aiConfig.model = PROVIDER_META[provider].defaultModel;
    this.api.saveAiConfig(this.aiConfig);
  }

  selectModel(model: string): void {
    this.aiConfig.model = model;
    this.api.saveAiConfig(this.aiConfig);
  }

  saveAiSettings(): void {
    this.api.saveAiConfig(this.aiConfig);
    this.showToast(
      `AI設定（${PROVIDER_META[this.aiConfig.provider].label} / ${this.aiConfig.model}）をブラウザに保存しました`,
      'success'
    );
  }

  clearCurrentApiKey(): void {
    this.aiConfig.apiKeys[this.aiConfig.provider] = '';
    this.api.saveAiConfig(this.aiConfig);
    this.showToast(`${PROVIDER_META[this.aiConfig.provider].label} の API キーを消去しました`, 'info');
  }

  getStandardRangeForSex(std: ReferenceStandard, sex: BiologicalSex): [number, number] {
    return std[sex] || std.other;
  }

  // ===== 認証・SNS後追い連携・家族招待・アカウント削除 =====

  get linkedIdentities(): LinkedIdentity[] {
    return this.account.linked_identities ?? [];
  }

  getLinkedIdentity(provider: AuthProviderId): LinkedIdentity | undefined {
    return this.linkedIdentities.find((id) => id.provider === provider);
  }

  get canUnlinkIdentity(): boolean {
    return this.linkedIdentities.length > 1;
  }

  get isOwnerAdmin(): boolean {
    return this.account.service_role === 'admin';
  }

  get invitations(): InvitationSummary[] {
    return this.account.invitations ?? [];
  }

  getAuthModeLabel(): string {
    return this.account.auth_mode === 'production' ? '本番認証' : 'デモ';
  }

  getInviteStatusLabel(status: InvitationSummary['status']): string {
    switch (status) {
      case 'pending':
        return '待っています';
      case 'used':
        return '使いました';
      case 'expired':
        return '期限切れ';
      case 'revoked':
        return '取り消し';
      default:
        return status;
    }
  }

  formatDateShort(iso: string | undefined): string {
    if (!iso) return '';
    return iso.slice(0, 10);
  }

  startGoogleLogin(inviteToken?: string): void {
    if (typeof window === 'undefined') return;
    const url = this.api.getGoogleLoginUrl(inviteToken);
    if (this.api.isOffline) {
      this.account = {
        ...this.account,
        authenticated: true,
        email: this.account.email || 'owner@example.com',
      };
      this.dismissInviteBanner();
      this.showToast('デモ環境で Google ログインを実行しました', 'success');
      return;
    }
    window.location.href = url;
  }

  async linkProvider(provider: AuthProviderMeta): Promise<void> {
    if (this.linkingProvider) return;
    this.linkingProvider = provider.id;
    try {
      const updated = await this.api.linkIdentity({
        provider: provider.id,
        email: this.account.email ?? undefined,
        display_name: this.profile.name || this.account.display_name,
      });
      this.account = {
        ...this.account,
        linked_identities: updated,
      };
      this.showToast(`${provider.label} アカウントを連携しました`, 'success');
    } catch (err) {
      if (!this.isServicePaused) {
        this.showToast(this.api.getErrorMessage(err, 'write'), 'error');
      }
    } finally {
      this.linkingProvider = null;
    }
  }

  async unlinkProvider(provider: AuthProviderMeta): Promise<void> {
    if (this.linkingProvider || !this.canUnlinkIdentity) return;
    if (!confirm(`${provider.label} のログイン連携を解除しますか？`)) {
      return;
    }
    this.linkingProvider = provider.id;
    try {
      const updated = await this.api.unlinkIdentity(provider.id);
      this.account = {
        ...this.account,
        linked_identities: updated,
      };
      this.showToast(`${provider.label} の連携を解除しました`, 'info');
    } catch (err) {
      if (!this.isServicePaused) {
        this.showToast(this.api.getErrorMessage(err, 'delete'), 'error');
      }
    } finally {
      this.linkingProvider = null;
    }
  }

  async createInvitation(): Promise<void> {
    const email = this.inviteEmailInput.trim();
    if (!email || !email.includes('@')) {
      this.showToast('招待する相手の Google メールアドレスを入力してください', 'error');
      return;
    }
    this.creatingInvite = true;
    try {
      const res = await this.api.createInvitation({
        email,
        note: this.inviteNoteInput.trim() || undefined,
      });
      this.latestCreatedInviteUrl = res.invite_url || res.invitation.invite_url || '';
      this.latestCreatedInviteEmail = res.invitation.email_display || email;
      const existing = this.account.invitations ?? [];
      this.account = {
        ...this.account,
        invitations: [res.invitation, ...existing.filter((x) => x.token_preview !== res.invitation.token_preview)],
      };
      this.inviteEmailInput = '';
      this.inviteNoteInput = '';
      this.showToast('招待リンクを作成しました。相手に共有してください', 'success');
    } catch (err) {
      if (!this.isServicePaused) {
        this.showToast(this.api.getErrorMessage(err, 'write'), 'error');
      }
    } finally {
      this.creatingInvite = false;
    }
  }

  async copyInviteUrl(): Promise<void> {
    if (!this.latestCreatedInviteUrl) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(this.latestCreatedInviteUrl);
      } else if (typeof document !== 'undefined') {
        const ta = document.createElement('textarea');
        ta.value = this.latestCreatedInviteUrl;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      this.showToast('招待 URL をクリップボードにコピーしました', 'success');
    } catch {
      this.showToast('コピーに失敗しました。URLを選択して手動でコピーしてください', 'error');
    }
  }

  dismissCreatedInviteUrl(): void {
    this.latestCreatedInviteUrl = '';
    this.latestCreatedInviteEmail = '';
  }

  async revokeInvitation(inv: InvitationSummary): Promise<void> {
    if (this.revokingTokenPreview) return;
    if (!confirm(`${inv.email_display} 宛の招待リンクを取り消しますか？`)) {
      return;
    }
    this.revokingTokenPreview = inv.token_preview;
    try {
      await this.api.revokeInvitation(inv.token_preview);
      this.account = {
        ...this.account,
        invitations: (this.account.invitations ?? []).map((item) =>
          item.token_preview === inv.token_preview ? { ...item, status: 'revoked' as const } : item
        ),
      };
      this.showToast('招待リンクを取り消しました', 'info');
    } catch (err) {
      if (!this.isServicePaused) {
        this.showToast(this.api.getErrorMessage(err, 'delete'), 'error');
      }
    } finally {
      this.revokingTokenPreview = null;
    }
  }

  async logout(allDevices = false): Promise<void> {
    if (this.authBusy) return;
    const msg = allDevices
      ? 'すべての端末（スマホ・PC など）からログアウトしますか？'
      : 'この端末からログアウトしますか？';
    if (!confirm(msg)) return;
    this.authBusy = true;
    try {
      await this.api.logout(allDevices);
      const nextSession = await this.api.getSession();
      this.account = nextSession;
      this.showToast(
        allDevices ? 'すべての端末からログアウトしました' : 'この端末からログアウトしました',
        'info'
      );
    } catch (err) {
      if (!this.isServicePaused) {
        this.showToast(this.api.getErrorMessage(err, 'write'), 'error');
      }
    } finally {
      this.authBusy = false;
    }
  }

  async deleteAccount(): Promise<void> {
    if (this.deletingAccount) return;
    const ok = confirm(
      '自分の記録データとアカウント情報をすべて初期化（削除）しますか？\n※ この操作は取り消せません。必要な場合は先に CSV で書き出してください。'
    );
    if (!ok) return;
    this.deletingAccount = true;
    try {
      const res = await this.api.deleteAccount();
      this.dismissCreatedInviteUrl();
      await this.loadInitialData();
      this.showToast(
        res.reset_demo
          ? 'デモデータを初期状態にリセットしました'
          : 'アカウントと記録データを初期化しました',
        'info'
      );
    } catch (err) {
      if (!this.isServicePaused) {
        this.showToast(this.api.getErrorMessage(err, 'delete'), 'error');
      }
    } finally {
      this.deletingAccount = false;
    }
  }
}
