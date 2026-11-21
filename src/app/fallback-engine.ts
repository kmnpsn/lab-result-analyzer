import {
  AccountSummary,
  AiProviderName,
  BiologicalSex,
  LabItem,
  LabRecord,
  REFERENCE_STANDARDS,
  UserProfile,
  computeFlag,
  lookupStandard,
} from '../shared/types';

export const PROVIDER_META: Record<
  AiProviderName,
  { label: string; defaultModel: string; models: string[]; color: string; description: string }
> = {
  gemini: {
    label: 'Gemini',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    color: '#38bdf8',
    description: 'Google Gemini（画像OCR・長文相関分析に強い）',
  },
  openai: {
    label: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'o4-mini'],
    color: '#34d399',
    description: 'OpenAI GPT（構造化抽出・バランスの良い医療要約）',
  },
  claude: {
    label: 'Claude',
    defaultModel: 'claude-sonnet-4-20250514',
    models: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'],
    color: '#a78bfa',
    description: 'Anthropic Claude（丁寧な経過考察・相談ポイント整理）',
  },
};

export interface WellnessMetricDef {
  key: 'overall_score' | 'fatigue_score' | 'sleep_score' | 'pain_score' | 'appetite_score';
  label: string;
  shortLabel: string;
  lowText: string;
  highText: string;
  color: string;
}

export const WELLNESS_METRICS: WellnessMetricDef[] = [
  {
    key: 'overall_score',
    label: '全体の調子',
    shortLabel: '全体',
    lowText: '1: とてもつらい',
    highText: '10: とても良い',
    color: '#fbbf24',
  },
  {
    key: 'fatigue_score',
    label: '元気さ・だるさのなさ',
    shortLabel: '元気さ',
    lowText: '1: 強いだるさ',
    highText: '10: すっきり元気',
    color: '#a78bfa',
  },
  {
    key: 'pain_score',
    label: 'からだの快適さ（不調のなさ）',
    shortLabel: '不調なし',
    lowText: '1: 不調・違和感が強い',
    highText: '10: 気にならない',
    color: '#fb7185',
  },
  {
    key: 'sleep_score',
    label: '睡眠・休養',
    shortLabel: '睡眠',
    lowText: '1: 眠れない・浅い',
    highText: '10: ぐっすり休めた',
    color: '#60a5fa',
  },
  {
    key: 'appetite_score',
    label: '食事・日常生活のしやすさ',
    shortLabel: '食事・生活',
    lowText: '1: ほとんど無理',
    highText: '10: 普段どおり',
    color: '#34d399',
  },
];

function makeItem(code: string, value: number, sex: BiologicalSex, ai_comment?: string): LabItem {
  const { standard, refLow, refHigh } = lookupStandard(code, sex);
  return {
    category: standard?.category ?? 'その他',
    item_code: standard?.code ?? code,
    item_name: standard?.name ?? code,
    value,
    unit: standard?.unit ?? '',
    ref_low: refLow,
    ref_high: refHigh,
    flag: computeFlag(value, refLow, refHigh),
    ai_comment,
  };
}

export function createFallbackProfile(): UserProfile {
  return {
    id: 1,
    name: '佐藤 陽子',
    age: 42,
    sex: 'female',
    height_cm: 160,
    chronic_conditions: '鉄欠乏性貧血, 関節リウマチ（経過観察）, 脂質異常症',
    medications: 'フェロミア 50mg（夕食後）, 葉酸, ロキソプロフェン頓用',
    preferred_provider: 'gemini',
    preferred_model: 'gemini-2.5-flash',
    updated_at: '2026-11-10T09:00:00Z',
  };
}

export function createFallbackAccountSummary(displayName = '佐藤 陽子'): AccountSummary {
  const now = new Date().toISOString();
  return {
    registration_mode: 'demo',
    auth_mode: 'demo',
    authenticated: true,
    user_id: 1,
    service_role: 'admin',
    email: 'owner@example.com',
    display_name: displayName || '佐藤 陽子',
    plan_tier: 'free',
    monthly_ocr_used: 0,
    monthly_ocr_limit: 10,
    terms_accepted: true,
    linked_identities: [
      {
        id: 1,
        provider: 'google',
        provider_subject: 'demo-google-owner',
        email_snapshot: 'owner@example.com',
        display_name_snapshot: displayName || '佐藤 陽子',
        linked_at: now,
        last_used_at: now,
      },
    ],
    invitations: [],
  };
}

export function createFallbackRecords(sex: BiologicalSex = 'female'): LabRecord[] {
  return [
    {
      id: 1,
      record_type: 'lab',
      symptom_tags: 'だるさ・疲労, 関節・筋肉の違和感, 通院・採血日',
      tested_at: '2026-02-12',
      facility_name: 'さくら内科クリニック',
      weight_kg: 54.8,
      overall_score: 4,
      fatigue_score: 3,
      sleep_score: 5,
      pain_score: 4,
      appetite_score: 6,
      condition_note: '冬場で朝の関節こわばりと強いだるさあり。階段で息切れしやすい。鉄剤再開前。',
      ai_provider: 'gemini',
      ai_model: 'gemini-2.5-flash',
      ai_summary:
        'Hb 10.6 g/dL (L)・Ferritin 9 ng/mL (L) と明らかな鉄欠乏性貧血を認め、CRP 0.48 mg/dL (H) と軽度炎症上昇も見られます。LDL 146 mg/dL (H) も基準上限をやや超過しています。',
      ai_correlation:
        'Hb・フェリチンの低下と元気さ（3/10）・全体の調子（4/10）の低さが強く一致しています。CRP上昇は朝のこわばりや不調感（不調なし 4/10）と関連している可能性が高いです。',
      ai_advice:
        '鉄剤内服の再開可否と胃腸への負担対策、CRP軽度上昇と朝のこわばりの経過を主治医へ共有してください。無理な有酸素運動は避け、十分な休息を優先しましょう。',
      items: [
        makeItem('WBC', 7400, sex, '基準範囲内です。'),
        makeItem('Hb', 10.6, sex, '基準下限を下回り、息切れ・だるさの主因と考えられます。'),
        makeItem('Ferritin', 9, sex, '貯蔵鉄が枯渇傾向です。鉄補充の継続が重要です。'),
        makeItem('CRP', 0.48, sex, '軽度の炎症反応あり。自覚症状との関連を確認しましょう。'),
        makeItem('ALT', 19, sex, '肝機能は良好です。'),
        makeItem('eGFR', 84, sex, '腎機能は正常範囲です。'),
        makeItem('HbA1c', 5.5, sex, '血糖コントロールは良好です。'),
        makeItem('LDL', 146, sex, '基準上限をやや超過。食事の脂質バランスに留意を。'),
        makeItem('TSH', 2.4, sex, '甲状腺機能は正常範囲です。'),
      ],
    },
    {
      id: 2,
      record_type: 'daily',
      symptom_tags: 'お薬の変更, だるさ・疲労',
      tested_at: '2026-03-28',
      facility_name: '',
      weight_kg: 54.5,
      overall_score: 5,
      fatigue_score: 4,
      sleep_score: 6,
      pain_score: 5,
      appetite_score: 6,
      condition_note: '鉄剤を再開して1か月半。朝の起きづらさは少し軽くなってきた。',
      ai_provider: 'gemini',
      ai_model: 'gemini-2.5-flash',
      ai_summary: 'この日は体調日記のみの記録です。全体の調子 5/10 と緩やかな回復途上の様子がうかがえます。',
      ai_correlation: '前回の採血時点（全体の調子 4/10・元気さ 3/10）と比べて、だるさが少しずつ和らいでいます。',
      ai_advice: 'お薬の変更後の体調変化を続けてメモしておくと、次回の採血結果と照らし合わせやすくなります。',
      items: [],
    },
    {
      id: 3,
      record_type: 'lab',
      symptom_tags: '通院・採血日, だるさ・疲労',
      tested_at: '2026-05-14',
      facility_name: 'さくら内科クリニック',
      weight_kg: 54.2,
      overall_score: 6,
      fatigue_score: 5,
      sleep_score: 6,
      pain_score: 6,
      appetite_score: 7,
      condition_note: '鉄剤を3か月継続。息切れは少し軽減したが午後の眠気は残る。関節の違和感は減少。',
      ai_provider: 'gemini',
      ai_model: 'gemini-2.5-flash',
      ai_summary:
        'Hb 11.4 g/dL (L) は前回比 +0.8 g/dL と改善傾向ですが基準下限まであと一歩です。Ferritin 18 ng/mL (N) は基準内へ回復、CRP 0.24 mg/dL (H) も半減しました。',
      ai_correlation:
        'Hbとフェリチンの回復に伴い、全体の調子（4→6）・元気さ（3→5）が順調に上向いています。CRPの低下とからだの快適さ改善（4→6）にも明確な連動が見られます。',
      ai_advice:
        '鉄剤の効果が数値・自覚症状ともに現れています。貯蔵鉄を安定させるための継続期間と、LDL 141 mg/dL の経過観察方針を次回診察で確認するとよいでしょう。',
      items: [
        makeItem('WBC', 6600, sex, '基準範囲内で安定しています。'),
        makeItem('Hb', 11.4, sex, '前回より上昇し改善傾向ですが、まだ軽度低値です。'),
        makeItem('Ferritin', 18, sex, '基準下限を超えました。さらなる回復を目指したい段階です。'),
        makeItem('CRP', 0.24, sex, '前回より低下していますが、ごく軽度の高値が残っています。'),
        makeItem('ALT', 21, sex, '基準範囲内です。'),
        makeItem('eGFR', 86, sex, '腎機能は安定しています。'),
        makeItem('HbA1c', 5.4, sex, '良好に維持されています。'),
        makeItem('LDL', 141, sex, 'わずかに高値。前回より微減傾向です。'),
        makeItem('TSH', 2.1, sex, '基準範囲内です。'),
      ],
    },
    {
      id: 4,
      record_type: 'daily',
      symptom_tags: '体調安定',
      tested_at: '2026-07-05',
      facility_name: '',
      weight_kg: 53.9,
      overall_score: 7,
      fatigue_score: 7,
      sleep_score: 8,
      pain_score: 7,
      appetite_score: 8,
      condition_note: 'よく眠れて朝からすっきり。散歩を20分ほど続けられている。',
      ai_provider: 'gemini',
      ai_model: 'gemini-2.5-flash',
      ai_summary: '体調日記のみの記録です。全体の調子 7/10・睡眠 8/10 と安定した良いペースが続いています。',
      ai_correlation: '5月の採血以降、元気さ・睡眠・食事/生活のしやすさが揃って上向きです。',
      ai_advice: '無理のない運動と休息のリズムをこのまま大切に続けてみてください。',
      items: [],
    },
    {
      id: 5,
      record_type: 'lab',
      symptom_tags: '体調安定, 通院・採血日',
      tested_at: '2026-08-19',
      facility_name: '中央総合病院 内科',
      weight_kg: 53.6,
      overall_score: 8,
      fatigue_score: 8,
      sleep_score: 8,
      pain_score: 8,
      appetite_score: 8,
      condition_note: '体調かなり安定。週2回の軽いウォーキングを継続できており、睡眠・休養も良い。',
      ai_provider: 'gemini',
      ai_model: 'gemini-2.5-flash',
      ai_summary:
        'Hb 12.6 g/dL (N)・Ferritin 36 ng/mL (N)・CRP 0.08 mg/dL (N) と主要項目がすべて基準範囲内に正常化しました。LDL 132 mg/dL (N) も基準内へ改善しています。',
      ai_correlation:
        'Hbが12 g/dL台・CRPが0.10未満に達したタイミングで、全体の調子・元気さ・快適さ・睡眠・食事/生活の全スコアが 8/10 まで向上。ご自身にとっての「好調ゾーン」の指標として非常に有用です。',
      ai_advice:
        '現在の服薬とウォーキング習慣が好循環を生んでいます。フェリチンが十分量に達した後の鉄剤減量・維持療法のタイミングを主治医と相談してみてください。',
      items: [
        makeItem('WBC', 5800, sex, '基準範囲内で良好です。'),
        makeItem('Hb', 12.6, sex, '基準範囲内へ完全回復しました。'),
        makeItem('Ferritin', 36, sex, '貯蔵鉄も順調に蓄積されています。'),
        makeItem('CRP', 0.08, sex, '炎症反応は陰性化しており良好です。'),
        makeItem('ALT', 17, sex, '肝機能は良好です。'),
        makeItem('eGFR', 88, sex, '腎機能は良好です。'),
        makeItem('HbA1c', 5.3, sex, '非常に良好な血糖水準です。'),
        makeItem('LDL', 132, sex, '運動習慣の効果もあり基準範囲内へ改善。'),
        makeItem('TSH', 1.9, sex, '甲状腺機能は安定しています。'),
      ],
    },
    {
      id: 6,
      record_type: 'lab',
      symptom_tags: 'だるさ・疲労, お薬の変更, 通院・採血日',
      tested_at: '2026-11-10',
      facility_name: 'さくら内科クリニック',
      weight_kg: 54.0,
      overall_score: 7,
      fatigue_score: 6,
      sleep_score: 7,
      pain_score: 7,
      appetite_score: 8,
      condition_note: '季節の変わり目で少し疲れやすく、鉄剤を隔日投与にしてからややだるさあり。',
      ai_provider: 'gemini',
      ai_model: 'gemini-2.5-flash',
      ai_summary:
        '全項目おおむね基準範囲内ですが、Hb 12.1 g/dL (N)・Ferritin 28 ng/mL (N) が前回よりやや低下し、CRP 0.16 mg/dL (H) がごくわずかに基準上限を超えました。',
      ai_correlation:
        '基準値内であっても、Hbが 12.6→12.1、Ferritinが 36→28 へ下がると元気さスコアが 8→6 に低下する傾向が見られます。ご本人の最適レンジは基準値よりやや高め（Hb 12.5以上）の可能性があります。',
      ai_advice:
        '隔日投与へ変更後のフェリチン推移と、季節の変わり目の軽度CRP上昇を主治医に伝え、冬場に向けた鉄補充ペースと体調管理の方針を確認しましょう。',
      items: [
        makeItem('WBC', 6100, sex, '基準範囲内です。'),
        makeItem('Hb', 12.1, sex, '基準範囲内ですが前回（12.6）よりやや低下しています。'),
        makeItem('Ferritin', 28, sex, '基準範囲内ですが緩やかな減少傾向に注意。'),
        makeItem('CRP', 0.16, sex, '基準上限（0.14）をわずかに超過。寒暖差・疲労の影響か経過観察を。'),
        makeItem('ALT', 18, sex, '肝機能は正常です。'),
        makeItem('eGFR', 85, sex, '腎機能は正常です。'),
        makeItem('HbA1c', 5.4, sex, '良好に推移しています。'),
        makeItem('LDL', 136, sex, '基準範囲内を維持しています。'),
        makeItem('TSH', 2.2, sex, '基準範囲内です。'),
      ],
    },
    {
      id: 7,
      record_type: 'daily',
      symptom_tags: '睡眠不足, だるさ・疲労',
      tested_at: '2026-11-18',
      facility_name: '',
      weight_kg: 54.1,
      overall_score: 6,
      fatigue_score: 6,
      sleep_score: 5,
      pain_score: 7,
      appetite_score: 8,
      condition_note: '少し夜更かしが続き眠りが浅め。からだの不調や食事面は問題なし。',
      ai_provider: 'gemini',
      ai_model: 'gemini-2.5-flash',
      ai_summary: '体調日記のみの記録です。全体の調子 6/10、食事・生活は 8/10 と保たれていますが、睡眠・休養が 5/10 とやや低めです。',
      ai_correlation: '直近の採血（11/10）から体調の大きな崩れはなく、睡眠不足がだるさにつながっている可能性があります。',
      ai_advice: '今夜は早めに休養をとり、数日間の元気さ・睡眠スコアの推移を見守ってみましょう。',
      items: [],
    },
  ];
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
  const den = Math.sqrt(denX * denY);
  if (den === 0) return null;
  return Math.max(-1, Math.min(1, num / den));
}

export interface CorrelationInsight {
  rOverall: number | null;
  strongestMetricLabel: string | null;
  strongestR: number | null;
  strengthLabel: string;
  comment: string;
  sampleCount: number;
}

export function buildCorrelationInsight(records: LabRecord[], itemCode: string): CorrelationInsight {
  const sorted = [...records].sort((a, b) => a.tested_at.localeCompare(b.tested_at));
  const paired = sorted
    .map((rec) => {
      const item = rec.items.find((it) => it.item_code === itemCode || it.item_name === itemCode);
      return item ? { rec, value: item.value, item } : null;
    })
    .filter((x): x is { rec: LabRecord; value: number; item: LabItem } => x !== null);

  if (paired.length < 2) {
    return {
      rOverall: null,
      strongestMetricLabel: null,
      strongestR: null,
      strengthLabel: 'データ不足',
      comment: '相関分析には同じ採血項目が2回以上記録されている必要があります。',
      sampleCount: paired.length,
    };
  }

  const values = paired.map((p) => p.value);
  const overallScores = paired.map((p) => p.rec.overall_score);
  const rOverall = computePearsonCorrelation(values, overallScores);

  let strongestMetricLabel: string | null = null;
  let strongestR: number | null = null;
  for (const metric of WELLNESS_METRICS) {
    const ys = paired.map((p) => p.rec[metric.key]);
    const r = computePearsonCorrelation(values, ys);
    if (r !== null && (strongestR === null || Math.abs(r) > Math.abs(strongestR))) {
      strongestR = r;
      strongestMetricLabel = metric.label;
    }
  }

  const absR = rOverall !== null ? Math.abs(rOverall) : 0;
  let strengthLabel = '相関弱い';
  if (rOverall === null) strengthLabel = '変動なし';
  else if (absR >= 0.7) strengthLabel = rOverall > 0 ? '強い正の相関' : '強い負の相関';
  else if (absR >= 0.4) strengthLabel = rOverall > 0 ? '中程度の正の相関' : '中程度の負の相関';
  else strengthLabel = '弱い相関';

  const itemName = paired[paired.length - 1].item.item_name;
  let comment = '';
  if (rOverall === null) {
    comment = `${itemName}または全体の調子スコアの値が一定のため、相関係数を算出できません。`;
  } else if (absR >= 0.7) {
    comment =
      rOverall > 0
        ? `${itemName}が高いほど全体の調子スコアも高くなる強い正の連動（r = ${rOverall.toFixed(2)}）が見られます。好調時の数値レンジを把握する目安になります。`
        : `${itemName}が上昇するほど全体の調子スコアが低下する強い負の連動（r = ${rOverall.toFixed(2)}）が見られます。数値悪化が自覚症状に直結しやすい項目です。`;
  } else if (absR >= 0.4) {
    comment =
      rOverall > 0
        ? `${itemName}の上昇と全体の調子の改善に中程度の正の関連（r = ${rOverall.toFixed(2)}）があります。`
        : `${itemName}の上昇と全体の調子の低下に中程度の負の関連（r = ${rOverall.toFixed(2)}）があります。`;
  } else {
    comment = `${itemName}と全体の調子スコアの直接的な線形相関は弱め（r = ${rOverall.toFixed(2)}）です。他の項目や生活要因も合わせて確認してください。`;
  }

  if (strongestMetricLabel && strongestR !== null && strongestMetricLabel !== '全体の調子' && Math.abs(strongestR) >= 0.5) {
    comment += ` 特に「${strongestMetricLabel}」との連動（r = ${strongestR.toFixed(2)}）が顕著です。`;
  }

  return {
    rOverall,
    strongestMetricLabel,
    strongestR,
    strengthLabel,
    comment,
    sampleCount: paired.length,
  };
}

export function parseLabTextLocally(rawText: string, sex: BiologicalSex): LabItem[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const items: LabItem[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9ぁ-んァ-ヶ一-龠γ\-()（）・\s]+?)[:：\s\t]+(-?\d+(?:\.\d+)?)\s*([^\s\d（(]+)?/);
    if (!match) continue;
    const rawName = match[1].trim();
    const val = Number(match[2]);
    if (!Number.isFinite(val)) continue;
    const unitRaw = match[3]?.trim() ?? '';

    const { standard, refLow, refHigh } = lookupStandard(rawName, sex);
    const code = standard?.code ?? rawName.slice(0, 12);
    if (seen.has(code)) continue;
    seen.add(code);

    items.push({
      category: standard?.category ?? 'その他',
      item_code: code,
      item_name: standard?.name ?? rawName,
      value: val,
      unit: unitRaw || standard?.unit || '',
      ref_low: refLow,
      ref_high: refHigh,
      flag: computeFlag(val, refLow, refHigh),
    });
  }

  return items;
}

export function createSampleOcrResult(sex: BiologicalSex): {
  tested_at: string;
  facility_name: string;
  items: LabItem[];
} {
  const today = new Date().toISOString().slice(0, 10);
  return {
    tested_at: today,
    facility_name: 'さくら内科クリニック（OCRサンプル）',
    items: [
      makeItem('WBC', 6400, sex),
      makeItem('Hb', sex === 'male' ? 13.1 : 11.2, sex),
      makeItem('Ferritin', sex === 'male' ? 18 : 11, sex),
      makeItem('CRP', 0.32, sex),
      makeItem('AST', 24, sex),
      makeItem('ALT', 26, sex),
      makeItem('eGFR', 82, sex),
      makeItem('HbA1c', 5.6, sex),
      makeItem('LDL', 144, sex),
      makeItem('TSH', 2.8, sex),
    ],
  };
}

export function generateLocalAnalysis(
  record: LabRecord,
  history: LabRecord[],
  profile: UserProfile,
  provider: AiProviderName,
  model: string
): {
  ai_summary: string;
  ai_correlation: string;
  ai_advice: string;
  item_comments: Record<string, string>;
  provider_used: string;
  model_used: string;
} {
  const avgScore = (
    (record.overall_score +
      record.fatigue_score +
      record.sleep_score +
      record.pain_score +
      record.appetite_score) /
    5
  ).toFixed(1);

  const isDailyOnly = record.record_type === 'daily' || record.items.length === 0;
  if (isDailyOnly) {
    const tagsPart = record.symptom_tags ? `（気になるタグ: ${record.symptom_tags}）` : '';
    const summaryText = `この日は体調日記のみの記録です。全体の調子は ${record.overall_score}/10（5項目平均 ${avgScore}/10）でした${tagsPart}。`;
    const correlationText = [
      `元気さ ${record.fatigue_score}・不調なし ${record.pain_score}・睡眠 ${record.sleep_score}・食事/生活 ${record.appetite_score} として記録されました。`,
      record.condition_note ? `メモ「${record.condition_note}」も日々の推移と合わせて振り返りに役立ちます。` : '日々の体調を続けて残すことで、採血日の数値とのつながりが見えやすくなります。',
    ].join(' ');
    const adviceParts: string[] = [];
    if (record.overall_score <= 4 || record.fatigue_score <= 4 || record.pain_score <= 4) {
      adviceParts.push('つらさや不調が強めの日です。無理をせず休養を優先し、続くようであれば次回の診察で経過を共有してください。');
    } else if (record.sleep_score <= 5) {
      adviceParts.push('睡眠・休養がやや低めでした。体調リズムを整えるため、今日は早めに体を休めることを意識してみてください。');
    } else {
      adviceParts.push('おおむね落ち着いたペースで過ごせています。引き続きご自身のペースで記録を続けてみてください。');
    }
    adviceParts.push('※ 本メモは日々の振り返り支援のための参考情報です。診断や治療の判断は必ず主治医にご相談ください。');
    return {
      ai_summary: summaryText,
      ai_correlation: correlationText,
      ai_advice: adviceParts.join(' '),
      item_comments: {},
      provider_used: `${provider} (local-fallback)`,
      model_used: model,
    };
  }

  const highs = record.items.filter((i) => i.flag === 'H');
  const lows = record.items.filter((i) => i.flag === 'L');
  const normals = record.items.filter((i) => i.flag === 'N');

  const summaryParts: string[] = [];
  if (highs.length === 0 && lows.length === 0) {
    summaryParts.push(`登録された全 ${record.items.length} 項目はすべて基準範囲内（正常）です。`);
  } else {
    if (highs.length > 0) {
      summaryParts.push(
        `基準上限超過（H）: ${highs.map((i) => `${i.item_name} ${i.value}${i.unit}`).join('、')}。`
      );
    }
    if (lows.length > 0) {
      summaryParts.push(
        `基準下限未満（L）: ${lows.map((i) => `${i.item_name} ${i.value}${i.unit}`).join('、')}。`
      );
    }
    summaryParts.push(`その他 ${normals.length} 項目は基準範囲内です。`);
  }

  const combined = [...history.filter((h) => h.id !== record.id), record].sort((a, b) =>
    a.tested_at.localeCompare(b.tested_at)
  );
  const corrFindings: string[] = [];
  for (const item of record.items) {
    const insight = buildCorrelationInsight(combined, item.item_code);
    if (insight.rOverall !== null && Math.abs(insight.rOverall) >= 0.5) {
      corrFindings.push(
        `${item.item_code}（全体の調子との相関 r=${insight.rOverall.toFixed(2)}）`
      );
    }
  }

  const correlationText = [
    `今回の主観体調は全体の調子 ${record.overall_score}/10（5項目平均 ${avgScore}/10、元気さ ${record.fatigue_score}・不調なし ${record.pain_score}・睡眠 ${record.sleep_score}・食事/生活 ${record.appetite_score}）でした。`,
    profile.chronic_conditions ? `持病（${profile.chronic_conditions}）を踏まえると、` : '',
    corrFindings.length > 0
      ? `過去推移では ${corrFindings.slice(0, 3).join('、')} が体調スコアと連動する傾向が確認されています。`
      : '今後の記録が増えるにつれて、ご自身特有の採血値と体調の相関傾向がより鮮明になります。',
    record.symptom_tags ? `症状タグ「${record.symptom_tags}」` : '',
    record.condition_note ? `メモ「${record.condition_note}」の経過も合わせて評価対象となります。` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const adviceLines: string[] = [];
  if (highs.length > 0 || lows.length > 0) {
    adviceLines.push(
      `基準外項目（${[...highs, ...lows].map((i) => i.item_code).join(', ')}）について、現在の服薬（${profile.medications || '未登録'}）の調整要否と次回再検時期を主治医にご確認ください。`
    );
  } else {
    adviceLines.push('現在の良好な数値と生活リズムを維持しつつ、定期フォローを継続してください。');
  }
  if (record.fatigue_score <= 5 || record.sleep_score <= 5) {
    adviceLines.push('だるさや睡眠・休養スコアが低下傾向のため、鉄分・炎症指標の推移と合わせて休息計画の見直しをおすすめします。');
  }
  adviceLines.push('※ 本レポートはローカル相関分析エンジンによる参考情報です。最終判断は必ず主治医にご相談ください。');

  const item_comments: Record<string, string> = {};
  for (const item of record.items) {
    if (item.flag === 'H') {
      item_comments[item.item_code] = `基準上限（${item.ref_high ?? '-'}）を上回っています。症状や過去推移と合わせて確認してください。`;
    } else if (item.flag === 'L') {
      item_comments[item.item_code] = `基準下限（${item.ref_low ?? '-'}）を下回っています。体調スコアとの連動に留意してください。`;
    } else {
      item_comments[item.item_code] = '基準範囲内です。';
    }
  }

  return {
    ai_summary: summaryParts.join(' '),
    ai_correlation: correlationText,
    ai_advice: adviceLines.join(' '),
    item_comments,
    provider_used: `${provider} (local-fallback)`,
    model_used: model,
  };
}
