export type BiologicalSex = 'male' | 'female' | 'other';
export type AiProviderName = 'gemini' | 'openai' | 'claude';
export type LabFlag = 'L' | 'N' | 'H';
export type RecordType = 'daily' | 'lab';
export type PlanTier = 'free' | 'plus' | 'pro';
export type RegistrationMode = 'demo' | 'invite_only' | 'open';
export type ServiceRole = 'admin' | 'user';
export type AuthProviderId = 'google' | 'apple' | 'line' | 'yahoo_japan' | 'facebook' | 'amazon';

export interface AuthProviderMeta {
  id: AuthProviderId;
  label: string;
  icon: string;
  primary?: boolean;
}

export const AUTH_PROVIDERS: ReadonlyArray<AuthProviderMeta> = [
  { id: 'google', label: 'Google', icon: 'G', primary: true },
  { id: 'line', label: 'LINE', icon: 'L' },
  { id: 'apple', label: 'Apple ID', icon: '' },
  { id: 'yahoo_japan', label: 'Yahoo! JAPAN', icon: 'Y!' },
  { id: 'facebook', label: 'Facebook', icon: 'f' },
  { id: 'amazon', label: 'Amazon', icon: 'a' },
];

export interface LinkedIdentity {
  id?: number;
  provider: AuthProviderId;
  provider_subject: string;
  email_snapshot: string | null;
  display_name_snapshot?: string | null;
  linked_at: string;
  last_used_at?: string;
}

export interface InvitationSummary {
  token_preview: string;
  email_display: string;
  note: string;
  status: 'pending' | 'used' | 'expired' | 'revoked';
  created_at: string;
  expires_at: string;
  invite_url?: string; // 作成直後の1回のみ返却
}

export interface AccountSummary {
  registration_mode: RegistrationMode;
  auth_mode?: 'demo' | 'production';
  authenticated: boolean;
  user_id?: number;
  service_role?: ServiceRole;
  email: string | null;
  display_name: string;
  plan_tier: PlanTier;
  monthly_ocr_used: number;
  monthly_ocr_limit: number;
  terms_accepted: boolean;
  csrf_token?: string;
  enabled_auth_providers?: AuthProviderId[];
  linked_identities?: LinkedIdentity[];
  invitations?: InvitationSummary[];
}

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
  visible_item_codes?: string[];
  updated_at?: string;
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

export interface ConditionItemRule {
  id?: number;
  label: string;
  keywords: string[];
  codes: string[];
  source?: 'default' | 'manual' | 'auto_suggested';
  created_at?: string;
}

export interface ConditionRuleSuggestion {
  term: string;
  suggested_codes: string[];
  reason: string;
}

export const DEFAULT_QUICK_ITEM_CODES: ReadonlyArray<string> = [
  'Hb',
  'CRP',
  'Ferritin',
  'ALT',
  'eGFR',
  'UA',
  'HbA1c',
  'WBC',
  'TSH',
  'LDL',
];

export const DEFAULT_CONDITION_ITEM_RULES: ReadonlyArray<ConditionItemRule> = [
  {
    label: '高尿酸血症・痛風',
    keywords: ['痛風', '高尿酸', '尿酸', 'gout', 'uric'],
    codes: ['UA', 'Cr', 'eGFR', 'BUN', 'CRP'],
    source: 'default',
  },
  {
    label: 'IBD（クローン病・潰瘍性大腸炎）',
    keywords: ['クローン', '潰瘍性大腸炎', '潰瘍性', 'ibd', '炎症性腸疾患', 'crohn', 'uc'],
    codes: ['CRP', 'WBC', 'Alb', 'Hb', 'Ferritin', 'PLT'],
    source: 'default',
  },
  {
    label: 'IBS（過敏性腸症候群）・胃腸過敏',
    keywords: ['過敏性腸', 'ibs', '機能性ディスペプシア', '下痢型', '便秘型', '腸過敏'],
    codes: ['CRP', 'Hb', 'Alb', 'WBC', 'Ferritin'],
    source: 'default',
  },
  {
    label: '脊柱管狭窄症・坐骨神経痛・椎間板ヘルニア',
    keywords: ['脊柱管狭窄', '狭窄症', '坐骨神経痛', '椎間板ヘルニア', 'ヘルニア', '腰痛症', 'すべり症'],
    codes: ['CRP', 'Cr', 'eGFR', 'AST', 'ALT', 'HbA1c'],
    source: 'default',
  },
  {
    label: '関節リウマチ・膠原病・自己免疫疾患',
    keywords: ['リウマチ', '膠原病', '自己免疫', 'sle', 'シェーグレン', 'ベーチェット', '血管炎'],
    codes: ['CRP', 'WBC', 'PLT', 'Hb', 'Cr', 'eGFR', 'AST', 'ALT'],
    source: 'default',
  },
  {
    label: '変形性関節症・骨粗鬆症・筋骨格痛',
    keywords: ['変形性関節', '関節症', '骨粗鬆症', '骨粗しょう症', '線維筋痛症', '腱鞘炎', '関節痛'],
    codes: ['CRP', 'Alb', 'Cr', 'eGFR', 'AST', 'ALT'],
    source: 'default',
  },
  {
    label: '貧血・鉄欠乏性貧血',
    keywords: ['貧血', '鉄欠乏', 'フェリチン', 'anemia', '立ちくらみ'],
    codes: ['Hb', 'Ferritin', 'RBC', 'Ht'],
    source: 'default',
  },
  {
    label: '糖尿病・高血糖・耐糖能異常',
    keywords: ['糖尿', '血糖', '高血糖', 'インスリン', 'diabetes', '境界型'],
    codes: ['HbA1c', 'Glu', 'TG', 'LDL', 'Cr', 'eGFR'],
    source: 'default',
  },
  {
    label: '脂質異常症・高コレステロール血症',
    keywords: ['脂質異常', '脂質', 'コレステロール', '中性脂肪', '高脂血', 'dyslipidemia'],
    codes: ['LDL', 'HDL', 'TG', 'AST', 'ALT'],
    source: 'default',
  },
  {
    label: '高血圧・動脈硬化・心疾患',
    keywords: ['高血圧', '心疾患', '動脈硬化', '狭心症', '不整脈', '心不全'],
    codes: ['LDL', 'HDL', 'TG', 'Cr', 'eGFR', 'UA', 'HbA1c'],
    source: 'default',
  },
  {
    label: '慢性腎臓病（CKD）・腎機能低下',
    keywords: ['腎臓', '腎機能', 'ckd', '腎不全', 'ネフローゼ', '透析', '蛋白尿', 'kidney'],
    codes: ['Cr', 'eGFR', 'BUN', 'UA', 'Alb', 'Hb'],
    source: 'default',
  },
  {
    label: '脂肪肝・肝炎・肝機能障害',
    keywords: ['肝機能', '脂肪肝', '肝炎', '肝硬変', '肝障害', 'アルコール性', 'liver'],
    codes: ['AST', 'ALT', 'gGTP', 'Alb', 'PLT', 'TG'],
    source: 'default',
  },
  {
    label: '胆石・胆道系疾患・膵炎',
    keywords: ['胆石', '胆嚢', '胆道', '膵炎', 'すい炎'],
    codes: ['gGTP', 'AST', 'ALT', 'CRP', 'WBC', 'TG'],
    source: 'default',
  },
  {
    label: '甲状腺疾患（バセドウ病・橋本病）',
    keywords: ['甲状腺', 'バセドウ', '橋本病', 'thyroid'],
    codes: ['TSH', 'LDL', 'AST', 'ALT', 'Hb'],
    source: 'default',
  },
  {
    label: 'ぜんそく・COPD・呼吸器疾患',
    keywords: ['喘息', 'ぜんそく', 'copd', '気管支炎', '間質性肺炎', '呼吸器'],
    codes: ['WBC', 'CRP', 'Hb', 'Ht'],
    source: 'default',
  },
  {
    label: 'アレルギー・アトピー性皮膚炎',
    keywords: ['アレルギー', 'アトピー', '花粉症', '蕁麻疹', 'じんましん'],
    codes: ['WBC', 'CRP', 'AST', 'ALT'],
    source: 'default',
  },
  {
    label: '胃炎・逆流性食道炎・胃潰瘍',
    keywords: ['胃炎', '逆流性食道炎', '胃潰瘍', '十二指腸潰瘍', 'ピロリ'],
    codes: ['Hb', 'Ferritin', 'RBC', 'Alb', 'CRP'],
    source: 'default',
  },
  {
    label: '片頭痛・自律神経失調症・めまい',
    keywords: ['片頭痛', '偏頭痛', '自律神経', 'めまい', 'メニエール', '起立性調節障害'],
    codes: ['Hb', 'Ferritin', 'TSH', 'Glu', 'Cr'],
    source: 'default',
  },
  {
    label: '睡眠障害・睡眠時無呼吸症候群（SAS）',
    keywords: ['睡眠時無呼吸', 'sas', '不眠', '睡眠障害', 'いびき'],
    codes: ['HbA1c', 'TG', 'LDL', 'UA', 'Hb', 'Ht'],
    source: 'default',
  },
  {
    label: 'うつ・不安障害・メンタル不調',
    keywords: ['うつ', '鬱', '不安障害', 'パニック', '適応障害', '双極性'],
    codes: ['TSH', 'Hb', 'Ferritin', 'AST', 'ALT', 'gGTP'],
    source: 'default',
  },
  {
    label: '婦人科系（子宮筋腫・内膜症・更年期）',
    keywords: ['子宮筋腫', '子宮内膜症', '月経過多', '更年期', 'pms'],
    codes: ['Hb', 'Ferritin', 'RBC', 'Ht', 'TSH', 'LDL'],
    source: 'default',
  },
  {
    label: '乾癬・自己炎症・慢性皮膚疾患',
    keywords: ['乾癬', '掌蹠膿疱症', '自己炎症', '皮膚炎'],
    codes: ['CRP', 'WBC', 'UA', 'AST', 'ALT', 'LDL'],
    source: 'default',
  },
  {
    label: '血栓症・凝固異常・抗凝固療法',
    keywords: ['血栓', '深部静脈', '凝固', 'ワーファリン', '血小板'],
    codes: ['PLT', 'Hb', 'Cr', 'eGFR', 'AST', 'ALT'],
    source: 'default',
  },
  {
    label: '慢性疲労・倦怠感・だるさ',
    keywords: ['慢性疲労', '疲労', '倦怠', 'だるさ'],
    codes: ['Hb', 'Ferritin', 'TSH', 'CRP', 'ALT', 'Alb'],
    source: 'default',
  },
  {
    label: 'むくみ（浮腫）・低栄養',
    keywords: ['むくみ', '浮腫', '低栄養', '低アルブミン'],
    codes: ['Alb', 'Cr', 'eGFR', 'BUN', 'TSH', 'Hb'],
    source: 'default',
  },
  {
    label: '肥満・メタボリックシンドローム',
    keywords: ['肥満', 'メタボ', '内臓脂肪', '減量中'],
    codes: ['HbA1c', 'Glu', 'LDL', 'HDL', 'TG', 'ALT', 'gGTP', 'UA'],
    source: 'default',
  },
  {
    label: '感染症・微熱・不明熱',
    keywords: ['感染', '微熱', '発熱', '不明熱', '炎症'],
    codes: ['WBC', 'CRP', 'PLT', 'AST', 'ALT'],
    source: 'default',
  },
  {
    label: 'お薬の長期服用・副作用フォロー',
    keywords: ['ステロイド', 'nsaids', '痛み止め', '鎮痛薬', '免疫抑制', '生物学的製剤', '長期服用'],
    codes: ['AST', 'ALT', 'gGTP', 'Cr', 'eGFR', 'HbA1c', 'WBC'],
    source: 'default',
  },
];

/**
 * 持病メモ（chronic_conditions）から優先的に確認したい検査項目コードを抽出する
 * （デフォルト28カテゴリ＋ユーザー登録済みカスタムルールを統合評価）
 */
export function recommendItemCodesForConditions(
  chronicConditions: string,
  customRules: ReadonlyArray<ConditionItemRule> = []
): string[] {
  const normalized = (chronicConditions || '').toLowerCase();
  if (!normalized.trim()) return [];
  const validCodes = new Set(REFERENCE_STANDARDS.map((s) => s.code));
  const result: string[] = [];

  // ユーザーが後追い登録したカスタムルールを先に優先評価し、続いてデフォルトマスタを評価
  const allRules: ReadonlyArray<ConditionItemRule> = [...customRules, ...DEFAULT_CONDITION_ITEM_RULES];
  for (const rule of allRules) {
    if (rule.keywords.some((kw) => kw.trim() && normalized.includes(kw.trim().toLowerCase()))) {
      for (const code of rule.codes) {
        if (validCodes.has(code) && !result.includes(code)) {
          result.push(code);
        }
      }
    }
  }
  return result;
}

/**
 * 持病メモに記載された語句のうち、既存マスタ（デフォルト＋カスタム）にヒットしない未登録語句を抽出する
 */
export function findUnmatchedConditionTerms(
  chronicConditions: string,
  customRules: ReadonlyArray<ConditionItemRule> = []
): string[] {
  const rawTerms = (chronicConditions || '')
    .split(/[,、・/\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  if (rawTerms.length === 0) return [];

  const allRules: ReadonlyArray<ConditionItemRule> = [...customRules, ...DEFAULT_CONDITION_ITEM_RULES];
  const unmatched: string[] = [];

  for (const term of rawTerms) {
    const lower = term.toLowerCase();
    const matched = allRules.some((rule) =>
      rule.keywords.some((kw) => kw.trim() && lower.includes(kw.trim().toLowerCase()))
    );
    if (!matched && !unmatched.includes(term)) {
      unmatched.push(term);
    }
  }
  return unmatched;
}

/**
 * 未登録の病名・症状に対して、語幹や臓器・症状の傾向から採血関連項目候補を推定する
 */
export function suggestItemCodesForUnknownCondition(term: string): ConditionRuleSuggestion | null {
  const lower = term.trim().toLowerCase();
  if (!lower || lower.length < 2) return null;

  const heuristics: Array<{ pattern: RegExp; codes: string[]; reason: string }> = [
    {
      pattern: /炎|腫|熱|膿|痛|リウマチ|膠原|免疫/,
      codes: ['CRP', 'WBC', 'PLT', 'AST', 'ALT'],
      reason: '炎症や痛み止め等の服薬に伴う指標（CRP・白血球・肝機能）を確認するため',
    },
    {
      pattern: /腸|胃|腹|消化|食道|便|下痢|吸収/,
      codes: ['CRP', 'Alb', 'Hb', 'Ferritin', 'WBC'],
      reason: '消化器系の炎症・栄養吸収・貧血傾向を確認するため',
    },
    {
      pattern: /腎|尿|膀胱|結石|むくみ|浮腫/,
      codes: ['Cr', 'eGFR', 'BUN', 'UA', 'Alb'],
      reason: '腎機能や尿酸・水分バランスを確認するため',
    },
    {
      pattern: /肝|胆|膵|酒|飲酒/,
      codes: ['AST', 'ALT', 'gGTP', 'Alb', 'PLT'],
      reason: '肝胆道系の負担を確認するため',
    },
    {
      pattern: /血|貧血|めまい|ふらつき|息切れ|だる|疲/,
      codes: ['Hb', 'Ferritin', 'RBC', 'Ht', 'TSH'],
      reason: '貧血・貯蔵鉄・甲状腺バランスを確認するため',
    },
    {
      pattern: /糖|肥満|体重|代謝|コレステロール|脂|圧|心|脳|血管/,
      codes: ['HbA1c', 'Glu', 'LDL', 'HDL', 'TG', 'UA', 'Cr'],
      reason: '糖・脂質代謝および血管・腎臓への影響を確認するため',
    },
    {
      pattern: /神経|腰|首|肩|膝|関節|骨|筋|しびれ|狭窄|ヘルニア/,
      codes: ['CRP', 'Cr', 'eGFR', 'AST', 'ALT', 'HbA1c'],
      reason: '炎症の有無や鎮痛薬長期使用時の肝腎フォロー、神経障害の背景確認のため',
    },
    {
      pattern: /皮膚|湿疹|かゆみ|アレルギー|喘息|鼻/,
      codes: ['WBC', 'CRP', 'AST', 'ALT'],
      reason: '炎症反応や治療薬の肝機能フォローのため',
    },
    {
      pattern: /ホルモン|更年期|生理|月経|眠|自律|メンタル/,
      codes: ['TSH', 'Hb', 'Ferritin', 'Alb', 'AST', 'ALT'],
      reason: 'ホルモン・鉄分・全身状態のバランスを確認するため',
    },
    {
      pattern: /病|症|障害|疾患|フォロー|経過観察/,
      codes: ['CRP', 'WBC', 'Hb', 'AST', 'ALT', 'Cr', 'eGFR'],
      reason: '一般的な経過観察として炎症・貧血・肝腎の基本項目を確認するため',
    },
  ];

  for (const h of heuristics) {
    if (h.pattern.test(lower)) {
      return {
        term: term.trim(),
        suggested_codes: h.codes,
        reason: h.reason,
      };
    }
  }
  return null;
}

export function parseVisibleItemCodes(raw: unknown): string[] {
  const validCodes = new Set(REFERENCE_STANDARDS.map((s) => s.code));
  let list: string[] = [];
  if (Array.isArray(raw)) {
    list = raw.map((v) => String(v ?? '').trim());
  } else if (typeof raw === 'string' && raw.trim()) {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          list = parsed.map((v) => String(v ?? '').trim());
        }
      } catch {
        list = trimmed.split(/[,、\s]+/);
      }
    } else {
      list = trimmed.split(/[,、\s]+/);
    }
  }
  const deduped: string[] = [];
  for (const code of list) {
    if (validCodes.has(code) && !deduped.includes(code)) {
      deduped.push(code);
    }
  }
  return deduped;
}

/**
 * 持病おすすめとユーザーの表示ON/OFF設定を合成して、優先順に並んだ表示対象コード一覧を返す
 */
export function resolveVisibleItemCodes(
  chronicConditions: string,
  savedVisibleCodes?: string[] | null,
  customRules: ReadonlyArray<ConditionItemRule> = []
): string[] {
  const recommended = recommendItemCodesForConditions(chronicConditions, customRules);
  const cleanedSaved = parseVisibleItemCodes(savedVisibleCodes);
  if (cleanedSaved.length > 0) {
    const savedSet = new Set(cleanedSaved);
    const prioritized = recommended.filter((c) => savedSet.has(c));
    const rest = cleanedSaved.filter((c) => !prioritized.includes(c));
    return [...prioritized, ...rest];
  }
  const merged = [...recommended];
  for (const code of DEFAULT_QUICK_ITEM_CODES) {
    if (!merged.includes(code)) {
      merged.push(code);
    }
  }
  return merged;
}
