export type BiologicalSex = 'male' | 'female' | 'other';
export type AiProviderName = 'gemini' | 'openai' | 'claude';
export type LabFlag = 'L' | 'N' | 'H';
export type RecordType = 'daily' | 'lab';
export type PlanTier = 'free' | 'plus' | 'pro';
export type RegistrationMode = 'demo' | 'invite_only' | 'open';

export interface UserProfile {
  id: number;
  name: string;
  birth_year?: number | null;
  age: number;
  sex: BiologicalSex;
  height_cm: number;
  chronic_conditions: string;
  medications: string;
  preferred_provider: AiProviderName;
  preferred_model: string;
  updated_at?: string;
}

export interface AccountSummary {
  registration_mode: RegistrationMode;
  authenticated: boolean;
  email: string | null;
  display_name: string;
  plan_tier: PlanTier;
  monthly_ocr_used: number;
  monthly_ocr_limit: number;
  terms_accepted: boolean;
}

/**
 * どんな持病・指定難病（クローン病・自己免疫疾患・腎/肝疾患・貧血等）でも
 * 毎日の体調日記として自然に記録できる汎用5軸スコア（1〜10）
 */
export interface WellnessScores {
  overall_score: number;   // 1. 全体の調子 (1: とてもつらい 〜 10: とても良い)
  fatigue_score: number;   // 2. 元気さ・だるさのなさ (1: 強いだるさ 〜 10: すっきり元気)
  pain_score: number;      // 3. からだの快適さ・不調のなさ (1: 不調・違和感が強い 〜 10: 気にならない)
  sleep_score: number;     // 4. 睡眠・休養 (1: 眠れない・浅い 〜 10: ぐっすり休めた)
  appetite_score: number;  // 5. 食事・日常生活のしやすさ (1: ほとんど無理 〜 10: 普段どおり)
  condition_note: string;  // ひとこと日記・症状・服薬変更メモ
}

export interface LabItem {
  id?: number;
  record_id?: number;
  category: string;
  item_code: string;
  item_name: string;
  value: number;
  unit: string;
  ref_low: number | null;
  ref_high: number | null;
  flag: LabFlag;
  ai_comment?: string;
}

export interface LabRecord extends WellnessScores {
  id?: number;
  record_type?: RecordType; // 'daily' (体調日記のみ) | 'lab' (採血結果あり)
  symptom_tags?: string;    // カンマ区切りの症状・出来事タグ
  tested_at: string;        // YYYY-MM-DD (記録日 / 採血日)
  facility_name: string;
  weight_kg: number | null;
  ai_provider?: string;
  ai_model?: string;
  ai_summary?: string;
  ai_correlation?: string;
  ai_advice?: string;
  created_at?: string;
  items: LabItem[];
}

export const SYMPTOM_TAG_PRESETS: ReadonlyArray<string> = [
  '体調安定',
  'だるさ・疲労',
  'おなかの不調',
  '微熱・熱っぽさ',
  '関節・筋肉の違和感',
  '頭痛・めまい',
  '睡眠不足',
  'お薬の変更',
  '通院・採血日',
];

export interface ReferenceStandard {
  code: string;
  name: string;
  category: string;
  unit: string;
  male: [number, number];
  female: [number, number];
  other: [number, number];
  description: string;
}

export const REFERENCE_STANDARDS: ReferenceStandard[] = [
  { code: 'WBC', name: '白血球数 (WBC)', category: '血球・炎症', unit: '/μL', male: [3300, 8600], female: [3300, 8600], other: [3300, 8600], description: '感染や炎症・免疫状態の目安' },
  { code: 'RBC', name: '赤血球数 (RBC)', category: '血球・貧血', unit: '万/μL', male: [435, 555], female: [386, 492], other: [400, 530], description: '酸素を運ぶ赤血球の数' },
  { code: 'Hb', name: 'ヘモグロビン (Hb)', category: '血球・貧血', unit: 'g/dL', male: [13.7, 16.8], female: [11.6, 14.8], other: [12.0, 16.0], description: '貧血の目安（だるさや息切れと関わりが深い項目）' },
  { code: 'Ht', name: 'ヘマトクリット (Ht)', category: '血球・貧血', unit: '%', male: [40.7, 50.1], female: [35.1, 44.4], other: [37.0, 48.0], description: '血液中の赤血球の割合' },
  { code: 'PLT', name: '血小板数 (PLT)', category: '血球・凝固', unit: '万/μL', male: [15.8, 34.8], female: [15.8, 34.8], other: [15.8, 34.8], description: '血を止める働きや炎症反応の目安' },
  { code: 'Ferritin', name: 'フェリチン (貯蔵鉄)', category: '血球・貧血', unit: 'ng/mL', male: [20, 250], female: [12, 120], other: [15, 200], description: '体内に蓄えられた鉄分（隠れ貧血や疲れやすさと関連）' },
  { code: 'AST', name: 'AST (GOT)', category: '肝機能', unit: 'U/L', male: [13, 30], female: [13, 30], other: [13, 30], description: '肝臓や筋肉の負担の目安' },
  { code: 'ALT', name: 'ALT (GPT)', category: '肝機能', unit: 'U/L', male: [10, 42], female: [7, 23], other: [8, 35], description: '肝臓の負担の目安' },
  { code: 'gGTP', name: 'γ-GTP', category: '肝機能', unit: 'U/L', male: [13, 64], female: [9, 32], other: [10, 50], description: '胆道系やお薬・食事による肝臓への負担の目安' },
  { code: 'Alb', name: 'アルブミン (Alb)', category: '栄養・肝機能', unit: 'g/dL', male: [4.1, 5.1], female: [4.1, 5.1], other: [4.1, 5.1], description: '全身の栄養状態や吸収状態の目安' },
  { code: 'Cr', name: 'クレアチニン (Cr)', category: '腎機能', unit: 'mg/dL', male: [0.65, 1.07], female: [0.46, 0.79], other: [0.50, 1.00], description: '腎臓のろ過働きの目安' },
  { code: 'eGFR', name: '推算糸球体濾過量 (eGFR)', category: '腎機能', unit: 'mL/min/1.73m²', male: [60, 120], female: [60, 120], other: [60, 120], description: '腎臓の働きの総合目安' },
  { code: 'BUN', name: '尿素窒素 (BUN)', category: '腎機能', unit: 'mg/dL', male: [8.0, 20.0], female: [8.0, 20.0], other: [8.0, 20.0], description: '腎機能や水分不足（脱水）の目安' },
  { code: 'UA', name: '尿酸 (UA)', category: '腎機能・痛風', unit: 'mg/dL', male: [3.7, 7.0], female: [2.6, 5.5], other: [3.0, 6.5], description: '尿酸バランスの目安' },
  { code: 'CRP', name: 'C反応性蛋白 (CRP)', category: '血球・炎症', unit: 'mg/dL', male: [0.0, 0.14], female: [0.0, 0.14], other: [0.0, 0.14], description: '体内の炎症の目安（持病の活動性や体調変化と強く連動）' },
  { code: 'HbA1c', name: 'ヘモグロビンA1c (NGSP)', category: '糖代謝', unit: '%', male: [4.9, 6.0], female: [4.9, 6.0], other: [4.9, 6.0], description: '過去1〜2か月の平均的な血糖の目安' },
  { code: 'Glu', name: '空腹時血糖 (Glu)', category: '糖代謝', unit: 'mg/dL', male: [73, 109], female: [73, 109], other: [73, 109], description: '検査時点の血糖の目安' },
  { code: 'LDL', name: 'LDLコレステロール', category: '脂質', unit: 'mg/dL', male: [65, 139], female: [65, 139], other: [65, 139], description: '悪玉コレステロールの目安' },
  { code: 'HDL', name: 'HDLコレステロール', category: '脂質', unit: 'mg/dL', male: [40, 99], female: [40, 99], other: [40, 99], description: '善玉コレステロールの目安' },
  { code: 'TG', name: '中性脂肪 (TG)', category: '脂質', unit: 'mg/dL', male: [40, 149], female: [30, 149], other: [35, 149], description: 'エネルギー貯蔵脂質の目安' },
  { code: 'TSH', name: '甲状腺刺激ホルモン (TSH)', category: '内分泌', unit: 'μIU/mL', male: [0.50, 5.00], female: [0.50, 5.00], other: [0.50, 5.00], description: '甲状腺ホルモンの目安（だるさ・体重・眠りと関連）' },
];

export function computeFlag(value: number, refLow: number | null, refHigh: number | null): LabFlag {
  if (refLow !== null && value < refLow) return 'L';
  if (refHigh !== null && value > refHigh) return 'H';
  return 'N';
}

export function lookupStandard(codeOrName: string, sex: BiologicalSex = 'male'): {
  standard: ReferenceStandard | undefined;
  refLow: number | null;
  refHigh: number | null;
} {
  const key = codeOrName.trim().toLowerCase();
  const found = REFERENCE_STANDARDS.find(
    (s) =>
      s.code.toLowerCase() === key ||
      s.name.toLowerCase().includes(key) ||
      key.includes(s.code.toLowerCase())
  );
  if (!found) {
    return { standard: undefined, refLow: null, refHigh: null };
  }
  const range = found[sex] || found.other;
  return { standard: found, refLow: range[0], refHigh: range[1] };
}
