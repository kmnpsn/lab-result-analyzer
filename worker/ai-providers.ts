import {
  REFERENCE_STANDARDS,
  computeFlag,
  lookupStandard,
  type AiProviderName,
  type BiologicalSex,
  type LabItem,
  type LabRecord,
  type ReferenceStandard,
  type UserProfile,
} from '../src/shared/types.ts';

export interface AiEnv {
  DEFAULT_AI_PROVIDER?: string;
  DEFAULT_GEMINI_MODEL?: string;
  DEFAULT_OPENAI_MODEL?: string;
  DEFAULT_CLAUDE_MODEL?: string;
  GEMINI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
}

export interface AnalysisRequest {
  record: LabRecord;
  history?: LabRecord[];
  profile?: UserProfile;
  provider?: AiProviderName;
  model?: string;
  apiKey?: string;
  env?: AiEnv;
}

export interface AnalysisResponse {
  ai_summary: string;
  ai_correlation: string;
  ai_advice: string;
  item_comments: Record<string, string>;
  provider_used: AiProviderName;
  model_used: string;
}

export interface OcrRequest {
  imageBase64?: string;
  mimeType?: string;
  rawText?: string;
  provider?: AiProviderName;
  model?: string;
  apiKey?: string;
  sex?: BiologicalSex;
  env?: AiEnv;
}

export interface OcrResponse {
  tested_at: string;
  facility_name: string;
  items: LabItem[];
  provider_used: AiProviderName;
  model_used: string;
  source: 'ai_vision' | 'text_parser' | 'preset';
}

export const SUPPORTED_PROVIDERS: AiProviderName[] = ['gemini', 'openai', 'claude'];

export function resolveProviderAndModel(
  requestedProvider?: AiProviderName | string,
  requestedModel?: string,
  env?: AiEnv,
  profile?: UserProfile
): { provider: AiProviderName; model: string } {
  const rawProvider = (
    requestedProvider ||
    profile?.preferred_provider ||
    env?.DEFAULT_AI_PROVIDER ||
    'gemini'
  ).toLowerCase();

  const provider: AiProviderName =
    rawProvider === 'openai' || rawProvider === 'claude' || rawProvider === 'gemini'
      ? rawProvider
      : 'gemini';

  const trimmedModel = requestedModel?.trim() || profile?.preferred_model?.trim();
  if (trimmedModel) {
    return { provider, model: trimmedModel };
  }

  switch (provider) {
    case 'openai':
      return { provider, model: env?.DEFAULT_OPENAI_MODEL || 'gpt-4o-mini' };
    case 'claude':
      return { provider, model: env?.DEFAULT_CLAUDE_MODEL || 'claude-sonnet-4-5' };
    case 'gemini':
    default:
      return { provider, model: env?.DEFAULT_GEMINI_MODEL || 'gemini-2.5-flash' };
  }
}

function resolveApiKey(provider: AiProviderName, explicitKey?: string, env?: AiEnv): string {
  if (explicitKey && explicitKey.trim().length > 0) {
    return explicitKey.trim();
  }
  if (!env) return '';
  switch (provider) {
    case 'gemini':
      return env.GEMINI_API_KEY?.trim() || '';
    case 'openai':
      return env.OPENAI_API_KEY?.trim() || '';
    case 'claude':
      return env.ANTHROPIC_API_KEY?.trim() || '';
  }
}

export function findStandardSafe(
  codeOrName: string,
  sex: BiologicalSex = 'male'
): {
  standard: ReferenceStandard | undefined;
  refLow: number | null;
  refHigh: number | null;
} {
  const key = codeOrName.trim().toLowerCase();
  if (!key) {
    return { standard: undefined, refLow: null, refHigh: null };
  }

  // 1. Exact code match first (prevents 'CRP' from matching 'Cr' or 'HbA1c' from matching 'Hb')
  const exact = REFERENCE_STANDARDS.find(
    (s) => s.code.toLowerCase() === key || s.name.toLowerCase() === key
  );
  if (exact) {
    const range = exact[sex] || exact.other;
    return { standard: exact, refLow: range[0], refHigh: range[1] };
  }

  // 2. Alias match (check longer codes first)
  const sortedStandards = [...REFERENCE_STANDARDS].sort((a, b) => b.code.length - a.code.length);
  for (const std of sortedStandards) {
    const aliases = ITEM_ALIASES[std.code] || [];
    if (aliases.some((a) => a === key || key.includes(a))) {
      const range = std[sex] || std.other;
      return { standard: std, refLow: range[0], refHigh: range[1] };
    }
  }

  // 3. Fallback to shared lookupStandard
  return lookupStandard(codeOrName, sex);
}

export function normalizeLabItem(
  partial: Partial<LabItem> & { item_code?: string; item_name?: string; value: number },
  sex: BiologicalSex = 'male'
): LabItem {
  const query = partial.item_code || partial.item_name || '';
  const { standard, refLow, refHigh } = findStandardSafe(query, sex);

  const item_code = partial.item_code?.trim() || standard?.code || query.trim() || 'UNKNOWN';
  const item_name = partial.item_name?.trim() || standard?.name || item_code;
  const category = partial.category?.trim() || standard?.category || 'その他';
  const unit = partial.unit?.trim() || standard?.unit || '';
  const finalRefLow = partial.ref_low !== undefined && partial.ref_low !== null ? Number(partial.ref_low) : refLow;
  const finalRefHigh = partial.ref_high !== undefined && partial.ref_high !== null ? Number(partial.ref_high) : refHigh;
  const numericValue = Number(partial.value);
  const flag = computeFlag(numericValue, finalRefLow, finalRefHigh);

  return {
    ...(partial.id !== undefined ? { id: partial.id } : {}),
    ...(partial.record_id !== undefined ? { record_id: partial.record_id } : {}),
    category,
    item_code,
    item_name,
    value: numericValue,
    unit,
    ref_low: finalRefLow,
    ref_high: finalRefHigh,
    flag,
    ai_comment: partial.ai_comment || '',
  };
}

export function computePearsonCorrelation(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const denom = Math.sqrt(denX * denY);
  if (denom === 0) return null;
  return Math.round((num / denom) * 100) / 100;
}

const ITEM_ALIASES: Record<string, string[]> = {
  WBC: ['wbc', '白血球数', '白血球'],
  RBC: ['rbc', '赤血球数', '赤血球'],
  Hb: ['hb', 'hgb', 'ヘモグロビン', '血色素量', '血色素'],
  Ht: ['ht', 'hct', 'ヘマトクリット'],
  PLT: ['plt', '血小板数', '血小板'],
  Ferritin: ['ferritin', 'フェリチン', '貯蔵鉄'],
  AST: ['ast', 'got', 'ast(got)', 'ast (got)'],
  ALT: ['alt', 'gpt', 'alt(gpt)', 'alt (gpt)'],
  gGTP: ['ggtp', 'γ-gtp', 'γgtp', 'ガンマgtp', 'gamma-gtp'],
  Alb: ['alb', 'アルブミン'],
  Cr: ['cr', 'cre', 'クレアチニン'],
  eGFR: ['egfr', '推算糸球体濾過量', '糸球体濾過量'],
  BUN: ['bun', 'un', '尿素窒素'],
  UA: ['ua', '尿酸'],
  CRP: ['crp', 'c反応性蛋白', 'c反応性タンパク'],
  HbA1c: ['hba1c', 'ヘモグロビンa1c', 'a1c'],
  Glu: ['glu', 'fbs', 'bs', '空腹時血糖', '血糖値', '血糖'],
  LDL: ['ldl', 'ldl-c', 'ldlコレステロール', '悪玉コレステロール'],
  HDL: ['hdl', 'hdl-c', 'hdlコレステロール', '善玉コレステロール'],
  TG: ['tg', '中性脂肪', 'トリグリセリド', 'トリグリセライド'],
  TSH: ['tsh', '甲状腺刺激ホルモン'],
};

function matchStandardFromLine(line: string): ReferenceStandard | undefined {
  const lower = line.toLowerCase();
  // Check longer codes first (e.g., HbA1c before Hb, CRP before Cr, Ferritin before Fe)
  const sortedStandards = [...REFERENCE_STANDARDS].sort((a, b) => b.code.length - a.code.length);
  for (const std of sortedStandards) {
    const codeLower = std.code.toLowerCase();
    const codeRegex = new RegExp(`(^|[^a-z0-9])${codeLower}([^a-z0-9]|$)`, 'i');
    if (codeRegex.test(line)) {
      return std;
    }
    const aliases = ITEM_ALIASES[std.code] || [];
    for (const alias of aliases) {
      if (alias.length <= 3) {
        const aliasRegex = new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
        if (aliasRegex.test(line)) return std;
      } else if (lower.includes(alias)) {
        return std;
      }
    }
  }
  return undefined;
}

export function parseLabText(
  rawText: string,
  sex: BiologicalSex = 'male'
): { tested_at: string; facility_name: string; items: LabItem[] } {
  const today = new Date().toISOString().slice(0, 10);
  let tested_at = today;
  let facility_name = '検査結果テキスト読取';

  // Extract date if present (YYYY-MM-DD, YYYY/MM/DD, YYYY年M月D日)
  const dateMatch = rawText.match(/(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
  if (dateMatch) {
    const yyyy = dateMatch[1];
    const mm = dateMatch[2].padStart(2, '0');
    const dd = dateMatch[3].padStart(2, '0');
    tested_at = `${yyyy}-${mm}-${dd}`;
  }

  // Extract facility name if present
  const facilityMatch = rawText.match(/(?:医療機関|施設名|病院名|クリニック)[：:\s]*([^\n\r]+)/) ||
    rawText.match(/([^\s\n\r]+(?:病院|クリニック|医院|診療所|医療センター|健診センター))/);
  if (facilityMatch && facilityMatch[1]) {
    facility_name = facilityMatch[1].trim();
  }

  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const items: LabItem[] = [];
  const seenCodes = new Set<string>();

  for (const line of lines) {
    // Skip pure header lines like dates
    if (/^(採血日|検査日|医療機関|施設名)[：:]/.test(line)) continue;

    const std = matchStandardFromLine(line);
    if (std && !seenCodes.has(std.code)) {
      // Remove the matched item code/name and known tokens like HbA1c or 1.73m2 so we extract the test value
      let cleaned = line
        .replace(/HbA1c/gi, ' ')
        .replace(/1\.73\s*m[²2]/gi, ' ')
        .replace(new RegExp(std.code, 'gi'), ' ');

      // Check for explicit reference range like (13.7-16.8) or [10.0〜42.0]
      let customRefLow: number | null = null;
      let customRefHigh: number | null = null;
      const rangeMatch = cleaned.match(/[\(\[（](?:\s*基準値?[：:\s]*)?(\d+(?:\.\d+)?)\s*[-〜~～]\s*(\d+(?:\.\d+)?)[\)\]）]/);
      if (rangeMatch) {
        customRefLow = Number(rangeMatch[1]);
        customRefHigh = Number(rangeMatch[2]);
        cleaned = cleaned.replace(rangeMatch[0], ' ');
      }

      const numMatch = cleaned.match(/[-+]?\d+(?:\.\d+)?/);
      if (numMatch) {
        const value = Number(numMatch[0]);
        if (!Number.isNaN(value)) {
          seenCodes.add(std.code);
          items.push(
            normalizeLabItem(
              {
                category: std.category,
                item_code: std.code,
                item_name: std.name,
                value,
                unit: std.unit,
                ref_low: customRefLow,
                ref_high: customRefHigh,
              },
              sex
            )
          );
        }
      }
    }
  }

  return { tested_at, facility_name, items };
}

export function getPresetOcrResult(sex: BiologicalSex = 'male'): {
  tested_at: string;
  facility_name: string;
  items: LabItem[];
} {
  const today = new Date().toISOString().slice(0, 10);
  const rawItems: Array<{ item_code: string; value: number }> = [
    { item_code: 'WBC', value: 5800 },
    { item_code: 'Hb', value: 12.1 },
    { item_code: 'Ferritin', value: 16.5 },
    { item_code: 'PLT', value: 22.4 },
    { item_code: 'AST', value: 26 },
    { item_code: 'ALT', value: 38 },
    { item_code: 'gGTP', value: 44 },
    { item_code: 'Cr', value: 0.82 },
    { item_code: 'eGFR', value: 78.5 },
    { item_code: 'CRP', value: 0.24 },
    { item_code: 'HbA1c', value: 5.7 },
    { item_code: 'LDL', value: 132 },
    { item_code: 'TSH', value: 2.45 },
  ];

  return {
    tested_at: today,
    facility_name: 'みなとみらい内科・血液クリニック（OCRプリセット）',
    items: rawItems.map((it) => normalizeLabItem(it, sex)),
  };
}

function buildItemComment(
  item: LabItem,
  prevItem: LabItem | undefined,
  record: LabRecord,
  sex: BiologicalSex
): string {
  const { standard } = findStandardSafe(item.item_code || item.item_name, sex);
  const desc = standard?.description ? `（${standard.description}）` : '';

  let deltaStr = '';
  if (prevItem !== undefined) {
    const diff = Math.round((item.value - prevItem.value) * 100) / 100;
    if (diff > 0) deltaStr = ` 前回比 +${diff}${item.unit}。`;
    else if (diff < 0) deltaStr = ` 前回比 ${diff}${item.unit}。`;
    else deltaStr = ' 前回と同値。';
  }

  const rangeStr =
    item.ref_low !== null && item.ref_high !== null
      ? `基準値 ${item.ref_low}〜${item.ref_high}${item.unit}`
      : '基準値未設定';

  if (item.flag === 'L') {
    let extra = '';
    if (item.item_code === 'Hb' || item.item_code === 'Ferritin' || item.item_code === 'RBC') {
      extra =
        record.fatigue_score <= 5
          ? ` 倦怠感スコア(${record.fatigue_score}/10)の低下と整合する貧血・鉄欠乏所見です。`
          : ' 貯蔵鉄・酸素運搬能の推移に注意してください。';
    } else if (item.item_code === 'eGFR') {
      extra = ' 腎機能濾過量の低下傾向があるため水分摂取や腎負担薬剤に注意が必要です。';
    }
    return `基準下限を下回っています（${rangeStr}）${desc}。${deltaStr}${extra}`.trim();
  }

  if (item.flag === 'H') {
    let extra = '';
    if (item.item_code === 'CRP' || item.item_code === 'WBC') {
      extra =
        record.pain_score <= 6 || record.overall_score <= 6
          ? ` 痛みスコア(${record.pain_score}/10)・総合体調(${record.overall_score}/10)の低下と関連する炎症反応の可能性があります。`
          : ' 軽度の炎症反応がみられます。';
    } else if (item.item_code === 'ALT' || item.item_code === 'AST' || item.item_code === 'gGTP') {
      extra = ' 肝細胞や胆道系への負担が示唆されます。服薬・食事・休養との関連を確認してください。';
    } else if (item.item_code === 'HbA1c' || item.item_code === 'Glu') {
      extra = ' 糖代謝の上昇がみられます。食事内容や睡眠リズムとの関連を確認しましょう。';
    }
    return `基準上限を超えています（${rangeStr}）${desc}。${deltaStr}${extra}`.trim();
  }

  return `基準範囲内です（${rangeStr}）${desc}。${deltaStr}`.trim();
}

export function buildLocalAnalysis(
  record: LabRecord,
  history: LabRecord[] = [],
  profile?: UserProfile,
  provider: AiProviderName = 'gemini',
  model: string = 'gemini-2.5-flash'
): AnalysisResponse {
  const sex: BiologicalSex = profile?.sex || 'male';
  const normalizedItems = (record.items || []).map((it) => normalizeLabItem(it, sex));

  // Combine history + current record, deduplicated by tested_at + id, sorted chronologically (ASC)
  const allRecordsMap = new Map<string, LabRecord>();
  for (const r of history) {
    const key = `${r.tested_at}_${r.id ?? ''}`;
    allRecordsMap.set(key, r);
  }
  const currentKey = `${record.tested_at}_${record.id ?? 'current'}`;
  allRecordsMap.set(currentKey, { ...record, items: normalizedItems });

  const chronological = Array.from(allRecordsMap.values()).sort((a, b) =>
    a.tested_at.localeCompare(b.tested_at)
  );

  // Find immediate previous record before current
  const currentIndex = chronological.findIndex((r) => r.tested_at === record.tested_at && r.items === normalizedItems);
  const prevRecord =
    currentIndex > 0
      ? chronological[currentIndex - 1]
      : chronological.filter((r) => r.tested_at < record.tested_at).at(-1);

  const highItems = normalizedItems.filter((i) => i.flag === 'H');
  const lowItems = normalizedItems.filter((i) => i.flag === 'L');
  const normalItems = normalizedItems.filter((i) => i.flag === 'N');

  const sexLabel = sex === 'male' ? '男性' : sex === 'female' ? '女性' : '共通';

  // 1. ai_summary
  const summaryParts: string[] = [];
  summaryParts.push(
    `【検査結果サマリー（${record.tested_at} / ${sexLabel}基準）】全 ${normalizedItems.length} 項目中、基準範囲内(N) ${normalItems.length} 項目、高値(H) ${highItems.length} 項目、低値(L) ${lowItems.length} 項目です。`
  );

  if (highItems.length === 0 && lowItems.length === 0) {
    summaryParts.push(
      'すべての測定項目が基準範囲内に収まっており、客観的な血液検査上の大きな異常所見は認められません。'
    );
  } else {
    if (lowItems.length > 0) {
      const lowDesc = lowItems
        .map((i) => `${i.item_name}(${i.item_code}): ${i.value}${i.unit} [基準 ${i.ref_low}〜${i.ref_high}]`)
        .join('、');
      summaryParts.push(`▼ 低値(L)項目: ${lowDesc}。`);
    }
    if (highItems.length > 0) {
      const highDesc = highItems
        .map((i) => `${i.item_name}(${i.item_code}): ${i.value}${i.unit} [基準 ${i.ref_low}〜${i.ref_high}]`)
        .join('、');
      summaryParts.push(`▲ 高値(H)項目: ${highDesc}。`);
    }
  }

  // 2. ai_correlation (subjective 10-scale wellness scores + weight + chronic conditions + longitudinal correlation)
  const corrParts: string[] = [];
  const bmi =
    profile?.height_cm && record.weight_kg
      ? Math.round((record.weight_kg / Math.pow(profile.height_cm / 100, 2)) * 10) / 10
      : null;

  corrParts.push(
    `【体調10段階スコア・身体状況】総合体調 ${record.overall_score}/10、倦怠感の少なさ(活力) ${record.fatigue_score}/10、睡眠の質 ${record.sleep_score}/10、痛みの少なさ ${record.pain_score}/10、食欲・胃腸 ${record.appetite_score}/10` +
      (record.weight_kg ? `、体重 ${record.weight_kg}kg` : '') +
      (bmi ? `（BMI ${bmi}）` : '') +
      '。'
  );

  if (profile?.chronic_conditions) {
    corrParts.push(
      `【持病・服薬との関連】登録されている基礎疾患「${profile.chronic_conditions}」${
        profile.medications ? `（服薬: ${profile.medications}）` : ''
      }の観点から評価すると、`
    );
  }

  // Immediate cross-check between current lab items & current subjective scores
  const hbItem = normalizedItems.find((i) => i.item_code === 'Hb');
  const ferItem = normalizedItems.find((i) => i.item_code === 'Ferritin');
  const crpItem = normalizedItems.find((i) => i.item_code === 'CRP');
  const altItem = normalizedItems.find((i) => i.item_code === 'ALT');
  const egfrItem = normalizedItems.find((i) => i.item_code === 'eGFR');

  const crossInsights: string[] = [];
  if (hbItem || ferItem) {
    const hbText = hbItem ? `Hb ${hbItem.value}g/dL(${hbItem.flag})` : '';
    const ferText = ferItem ? `フェリチン ${ferItem.value}ng/mL(${ferItem.flag})` : '';
    const joined = [hbText, ferText].filter(Boolean).join('・');
    if ((hbItem?.flag === 'L' || ferItem?.flag === 'L') && record.fatigue_score <= 5) {
      crossInsights.push(
        `貧血・貯蔵鉄指標（${joined}）の低下と、本人の強い倦怠感（活力スコア ${record.fatigue_score}/10・総合体調 ${record.overall_score}/10）が明確に一致しています`
      );
    } else if (hbItem?.flag === 'N' && ( !ferItem || ferItem.flag === 'N') && record.fatigue_score >= 7) {
      crossInsights.push(
        `貧血・貯蔵鉄指標（${joined}）が基準範囲内に維持されており、活力スコア（${record.fatigue_score}/10）の良好さとよく相関しています`
      );
    } else {
      crossInsights.push(`酸素運搬・貯蔵鉄指標（${joined}）と活力スコア（${record.fatigue_score}/10）の推移を継続観察中です`);
    }
  }

  if (crpItem) {
    if (crpItem.flag === 'H' && (record.pain_score <= 6 || record.overall_score <= 6)) {
      crossInsights.push(
        `炎症マーカー CRP(${crpItem.value}mg/dL: 高値)の上昇が、痛み・不快感スコア(${record.pain_score}/10)や総合体調(${record.overall_score}/10)の低下と連動しています`
      );
    } else if (crpItem.flag === 'N' && record.pain_score >= 7) {
      crossInsights.push(
        `CRP(${crpItem.value}mg/dL)が鎮静化しており、痛み・不快感の少なさ(${record.pain_score}/10)の安定を裏付けています`
      );
    }
  }

  if (altItem && altItem.flag === 'H') {
    crossInsights.push(
      `肝機能 ALT(${altItem.value}U/L: 高値)が上昇しており、睡眠スコア(${record.sleep_score}/10)や服薬・疲労負荷との関連に留意が必要です`
    );
  }

  if (egfrItem && egfrItem.flag === 'L') {
    crossInsights.push(`腎機能 eGFR(${egfrItem.value}mL/min/1.73m²)が基準下限未満のため、脱水や体調変動時の腎負担に注意が必要です`);
  }

  if (crossInsights.length > 0) {
    corrParts.push(crossInsights.join('。また、') + '。');
  }

  // Longitudinal correlation across multiple records
  if (chronological.length >= 2) {
    const keyCodes = ['Hb', 'Ferritin', 'CRP', 'ALT', 'eGFR', 'HbA1c', 'TSH', 'WBC'];
    const longitudinalNotes: string[] = [];

    for (const code of keyCodes) {
      const pairs = chronological
        .map((r) => {
          const found = (r.items || []).find((it) => it.item_code === code);
          return found ? { val: found.value, overall: r.overall_score, fatigue: r.fatigue_score, pain: r.pain_score, date: r.tested_at, unit: found.unit } : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      if (pairs.length >= 2) {
        const vals = pairs.map((p) => p.val);
        const overalls = pairs.map((p) => p.overall);
        const fatigues = pairs.map((p) => p.fatigue);
        const rOverall = computePearsonCorrelation(vals, overalls);
        const rFatigue = computePearsonCorrelation(vals, fatigues);
        const first = pairs[0];
        const last = pairs[pairs.length - 1];

        if (code === 'Hb' || code === 'Ferritin') {
          const rVal = rFatigue ?? rOverall;
          const rText = rVal !== null ? `（活力スコアとの相関係数 r=${rVal}）` : '';
          longitudinalNotes.push(
            `${code}: ${first.val}→${last.val}${last.unit}（同時期の総合体調 ${first.overall}→${last.overall}/10、活力 ${first.fatigue}→${last.fatigue}/10）${rText}`
          );
        } else if (code === 'CRP' || code === 'ALT') {
          const rText = rOverall !== null ? `（総合体調との相関係数 r=${rOverall}）` : '';
          longitudinalNotes.push(
            `${code}: ${first.val}→${last.val}${last.unit}${rText}`
          );
        }
      }
    }

    if (longitudinalNotes.length > 0) {
      corrParts.push(
        `【過去${chronological.length}回の時系列相関分析】${longitudinalNotes.join(' / ')}。個人の採血データ推移と主観的な体調10段階スコアの間に明確な連動性が確認できます。`
      );
    }
  }

  if (record.condition_note && record.condition_note.trim().length > 0) {
    corrParts.push(`【本人メモとの照合】「${record.condition_note.trim()}」の記録は今回の検査値変動の背景要因として重要です。`);
  }

  // 3. ai_advice
  const adviceParts: string[] = [];
  adviceParts.push('【主治医への確認ポイント】');
  if (lowItems.some((i) => i.item_code === 'Hb' || i.item_code === 'Ferritin')) {
    adviceParts.push(
      '・ヘモグロビンまたはフェリチン（貯蔵鉄）が基準値を下回っています。鉄剤補充の継続・用量調整と、倦怠感スコアの変化について主治医にご相談ください。'
    );
  }
  if (highItems.some((i) => i.item_code === 'AST' || i.item_code === 'ALT' || i.item_code === 'gGTP')) {
    adviceParts.push(
      '・肝機能酵素（AST/ALT/γ-GTP）に基準値超過がみられます。現在の内服薬やサプリメント、食事・体重変化との関連を主治医に確認してください。'
    );
  }
  if (highItems.some((i) => i.item_code === 'CRP' || i.item_code === 'WBC')) {
    adviceParts.push(
      '・炎症指標（CRP/WBC）の上昇がみられます。関節痛・発熱・局所の違和感など自覚症状の推移を主治医にお伝えください。'
    );
  }
  if (lowItems.length === 0 && highItems.length === 0) {
    adviceParts.push(
      '・今回の検査値はすべて基準範囲内で安定しています。現在の治療・服薬方針の継続可否と、次回採血の目安時期を主治医にご確認ください。'
    );
  }

  adviceParts.push('【日常生活・セルフケアの工夫】');
  if (record.sleep_score <= 6 || record.fatigue_score <= 6) {
    adviceParts.push(
      `・睡眠スコア(${record.sleep_score}/10)・活力スコア(${record.fatigue_score}/10)がやや低めのため、採血数値が改善途上にある期間は無理な運動を控え、睡眠時間の確保とヘム鉄・良質なタンパク質の摂取を心がけてください。`
    );
  } else {
    adviceParts.push(
      '・体調スコアも良好に推移しています。こまめな水分補給とバランスの良い食事・規則正しい睡眠リズムを維持し、次回採血時も同じ条件で体調10段階スコアを記録して比較できるようにしましょう。'
    );
  }

  // 4. item_comments
  const item_comments: Record<string, string> = {};
  for (const item of normalizedItems) {
    const prevItem = prevRecord?.items?.find((pi) => pi.item_code === item.item_code);
    item_comments[item.item_code] = buildItemComment(item, prevItem, record, sex);
  }

  return {
    ai_summary: summaryParts.join(' '),
    ai_correlation: corrParts.join(' '),
    ai_advice: adviceParts.join('\n'),
    item_comments,
    provider_used: provider,
    model_used: model,
  };
}

function buildAnalysisPrompt(record: LabRecord, history: LabRecord[], profile?: UserProfile): string {
  const sex = profile?.sex || 'male';
  const profileDesc = profile
    ? `年齢:${profile.age}歳, 性別:${sex}, 身長:${profile.height_cm}cm, 持病:${profile.chronic_conditions}, 服薬:${profile.medications}`
    : 'プロフィール未設定';

  const currentItemsDesc = (record.items || [])
    .map((i) => `${i.item_code}(${i.item_name}): ${i.value}${i.unit} [基準:${i.ref_low}〜${i.ref_high}, 判定:${i.flag}]`)
    .join(', ');

  const historyDesc = (history || [])
    .slice(-4)
    .map(
      (h) =>
        `${h.tested_at}: 総合体調=${h.overall_score}/10, 活力=${h.fatigue_score}/10, 睡眠=${h.sleep_score}/10, 痛み=${h.pain_score}/10, 食欲=${h.appetite_score}/10, 体重=${h.weight_kg ?? '-'}kg | ` +
        (h.items || []).map((i) => `${i.item_code}=${i.value}`).join(', ')
    )
    .join('\n');

  return `あなたは血液検査と慢性疾患・体調管理の専門AIアシスタントです。以下の採血結果と本人の10段階体調スコア・過去推移を分析し、必ずJSON形式のみで出力してください。

【患者プロフィール】
${profileDesc}

【今回の採血記録 (${record.tested_at} / ${record.facility_name})】
体重: ${record.weight_kg ?? '未計測'}kg
10段階体調スコア: 総合体調=${record.overall_score}/10, 倦怠感の少なさ(活力)=${record.fatigue_score}/10, 睡眠=${record.sleep_score}/10, 痛みの少なさ=${record.pain_score}/10, 食欲=${record.appetite_score}/10
本人メモ: ${record.condition_note || 'なし'}
検査項目: ${currentItemsDesc}

【過去の採血・体調履歴】
${historyDesc || '過去履歴なし'}

以下のJSONスキーマで日本語で回答してください（マークダウンのコードブロックは不要）:
{
  "ai_summary": "基準値に基づく客観的な検査結果評価サマリー",
  "ai_correlation": "過去の採血推移と10段階体調スコア・体重・持病との個人内相関分析",
  "ai_advice": "主治医への確認ポイントと日常生活の工夫",
  "item_comments": {
    "項目コード(Hb等)": "その項目の個別評価と体調との関連コメント"
  }
}`;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function callProviderJson(
  provider: AiProviderName,
  model: string,
  apiKey: string,
  prompt: string,
  imageBase64?: string,
  mimeType?: string
): Promise<Record<string, unknown> | null> {
  if (!apiKey) return null;

  try {
    if (provider === 'gemini') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const parts: Array<Record<string, unknown>> = [{ text: prompt }];
      if (imageBase64) {
        const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
        parts.push({
          inline_data: {
            mime_type: mimeType || 'image/jpeg',
            data: cleanBase64,
          },
        });
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
        }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return extractJsonObject(text);
    }

    if (provider === 'openai') {
      const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }];
      if (imageBase64) {
        const dataUrl = imageBase64.startsWith('data:')
          ? imageBase64
          : `data:${mimeType || 'image/jpeg'};base64,${imageBase64}`;
        content.push({
          type: 'image_url',
          image_url: { url: dataUrl },
        });
      }
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content }],
          response_format: { type: 'json_object' },
          temperature: 0.2,
        }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content || '';
      return extractJsonObject(text);
    }

    if (provider === 'claude') {
      const content: Array<Record<string, unknown>> = [];
      if (imageBase64) {
        const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mimeType || 'image/jpeg',
            data: cleanBase64,
          },
        });
      }
      content.push({ type: 'text', text: prompt });
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          messages: [{ role: 'user', content }],
        }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const text = data.content?.find((c) => c.type === 'text')?.text || '';
      return extractJsonObject(text);
    }
  } catch {
    return null;
  }

  return null;
}

export async function analyzeLabAndWellness(req: AnalysisRequest): Promise<AnalysisResponse> {
  const { provider, model } = resolveProviderAndModel(req.provider, req.model, req.env, req.profile);
  const fallback = buildLocalAnalysis(req.record, req.history || [], req.profile, provider, model);
  const apiKey = resolveApiKey(provider, req.apiKey, req.env);

  if (!apiKey) {
    return fallback;
  }

  const prompt = buildAnalysisPrompt(req.record, req.history || [], req.profile);
  const aiJson = await callProviderJson(provider, model, apiKey, prompt);
  if (!aiJson) {
    return fallback;
  }

  const ai_summary =
    typeof aiJson.ai_summary === 'string' && aiJson.ai_summary.trim()
      ? aiJson.ai_summary.trim()
      : fallback.ai_summary;
  const ai_correlation =
    typeof aiJson.ai_correlation === 'string' && aiJson.ai_correlation.trim()
      ? aiJson.ai_correlation.trim()
      : fallback.ai_correlation;
  const ai_advice =
    typeof aiJson.ai_advice === 'string' && aiJson.ai_advice.trim()
      ? aiJson.ai_advice.trim()
      : fallback.ai_advice;

  const mergedComments: Record<string, string> = { ...fallback.item_comments };
  if (aiJson.item_comments && typeof aiJson.item_comments === 'object') {
    for (const [k, v] of Object.entries(aiJson.item_comments as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) {
        mergedComments[k] = v.trim();
      }
    }
  }

  return {
    ai_summary,
    ai_correlation,
    ai_advice,
    item_comments: mergedComments,
    provider_used: provider,
    model_used: model,
  };
}

export async function extractLabFromOcr(req: OcrRequest): Promise<OcrResponse> {
  const sex: BiologicalSex = req.sex || 'male';
  const { provider, model } = resolveProviderAndModel(req.provider, req.model, req.env);
  const apiKey = resolveApiKey(provider, req.apiKey, req.env);

  // 1. Try Vision/LLM extraction if API key is provided and image or rawText exists
  if (apiKey && (req.imageBase64 || req.rawText)) {
    const ocrPrompt = `以下の血液検査結果（画像またはテキスト）から、採血日(YYYY-MM-DD)、医療機関名、および各検査項目を抽出し、JSONのみで返してください。
${req.rawText ? `テキスト:\n${req.rawText}\n` : ''}
JSON形式:
{
  "tested_at": "YYYY-MM-DD",
  "facility_name": "医療機関名",
  "items": [
    { "item_code": "Hb", "item_name": "ヘモグロビン (Hb)", "value": 12.3, "unit": "g/dL", "ref_low": 13.7, "ref_high": 16.8 }
  ]
}`;
    const aiJson = await callProviderJson(provider, model, apiKey, ocrPrompt, req.imageBase64, req.mimeType);
    if (aiJson && Array.isArray(aiJson.items) && aiJson.items.length > 0) {
      const items = (aiJson.items as Array<Record<string, unknown>>)
        .map((raw) =>
          normalizeLabItem(
            {
              item_code: typeof raw.item_code === 'string' ? raw.item_code : undefined,
              item_name: typeof raw.item_name === 'string' ? raw.item_name : undefined,
              value: Number(raw.value),
              unit: typeof raw.unit === 'string' ? raw.unit : undefined,
              ref_low: raw.ref_low !== undefined && raw.ref_low !== null ? Number(raw.ref_low) : null,
              ref_high: raw.ref_high !== undefined && raw.ref_high !== null ? Number(raw.ref_high) : null,
            },
            sex
          )
        )
        .filter((it) => !Number.isNaN(it.value));

      if (items.length > 0) {
        return {
          tested_at:
            typeof aiJson.tested_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(aiJson.tested_at)
              ? aiJson.tested_at
              : new Date().toISOString().slice(0, 10),
          facility_name:
            typeof aiJson.facility_name === 'string' && aiJson.facility_name.trim()
              ? aiJson.facility_name.trim()
              : 'AI Vision OCR読取',
          items,
          provider_used: provider,
          model_used: model,
          source: 'ai_vision',
        };
      }
    }
  }

  // 2. If rawText is provided, parse it deterministically
  if (req.rawText && req.rawText.trim().length > 0) {
    const parsed = parseLabText(req.rawText, sex);
    if (parsed.items.length > 0) {
      return {
        ...parsed,
        provider_used: provider,
        model_used: model,
        source: 'text_parser',
      };
    }
  }

  // 3. Fallback preset so users without an API key can immediately test OCR -> manual adjustment flow
  const preset = getPresetOcrResult(sex);
  return {
    ...preset,
    provider_used: provider,
    model_used: model,
    source: 'preset',
  };
}
