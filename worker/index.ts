import {
  REFERENCE_STANDARDS,
  computeFlag,
  lookupStandard,
  type AiProviderName,
  type BiologicalSex,
  type LabItem,
  type LabRecord,
  type UserProfile,
} from '../src/shared/types.ts';
import {
  SUPPORTED_PROVIDERS,
  analyzeLabAndWellness,
  buildLocalAnalysis,
  extractLabFromOcr,
  findStandardSafe,
  normalizeLabItem,
  type AiEnv,
} from './ai-providers.ts';

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run(): Promise<{ meta?: { last_row_id?: number; changes?: number } }>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch?(statements: D1PreparedStatementLike[]): Promise<unknown[]>;
  exec?(query: string): Promise<unknown>;
}

export interface WorkerEnv extends AiEnv {
  DB?: D1DatabaseLike;
  ASSETS?: {
    fetch(request: Request): Promise<Response>;
  };
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
    },
  });
}

export function createDefaultProfile(): UserProfile {
  return {
    id: 1,
    name: 'サンプル患者',
    birth_year: 1988,
    age: 38,
    sex: 'male',
    height_cm: 170.0,
    chronic_conditions: '慢性疲労・鉄欠乏性貧血傾向・肝機能経過観察',
    medications: '鉄剤（フェロミア）・ウルソデオキシコール酸',
    preferred_provider: 'gemini',
    preferred_model: 'gemini-2.5-flash',
    updated_at: '2026-11-10T09:00:00Z',
  };
}

export function createSeedRecords(profile: UserProfile): LabRecord[] {
  const sex = profile.sex;
  const rawSeeds: Array<
    Omit<LabRecord, 'items'> & {
      rawItems: Array<{ item_code: string; value: number }>;
    }
  > = [
    {
      id: 1,
      tested_at: '2026-02-15',
      facility_name: '東京ベイ総合内科クリニック',
      weight_kg: 68.4,
      overall_score: 4,
      fatigue_score: 3,
      sleep_score: 4,
      pain_score: 5,
      appetite_score: 5,
      condition_note: '階段昇降時の息切れと午後の強い倦怠感あり。睡眠が浅く関節の重だるさも続く。鉄剤内服開始。',
      ai_provider: 'gemini',
      ai_model: 'gemini-2.5-flash',
      created_at: '2026-02-15T10:30:00Z',
      rawItems: [
        { item_code: 'WBC', value: 7200 },
        { item_code: 'RBC', value: 410 },
        { item_code: 'Hb', value: 11.2 },
        { item_code: 'Ferritin', value: 11.5 },
        { item_code: 'PLT', value: 24.5 },
        { item_code: 'AST', value: 34 },
        { item_code: 'ALT', value: 54 },
        { item_code: 'gGTP', value: 68 },
        { item_code: 'Cr', value: 0.86 },
        { item_code: 'eGFR', value: 74.2 },
        { item_code: 'CRP', value: 0.32 },
        { item_code: 'HbA1c', value: 5.8 },
        { item_code: 'LDL', value: 144 },
        { item_code: 'TSH', value: 2.8 },
      ],
    },
    {
      id: 2,
      tested_at: '2026-05-18',
      facility_name: '東京ベイ総合内科クリニック',
      weight_kg: 67.2,
      overall_score: 6,
      fatigue_score: 5,
      sleep_score: 5,
      pain_score: 6,
      appetite_score: 7,
      condition_note: '鉄剤継続で立ちくらみは減ったが、繁忙期で睡眠不足気味。ウルソデオキシコール酸併用開始。',
      ai_provider: 'gemini',
      ai_model: 'gemini-2.5-flash',
      created_at: '2026-05-18T10:15:00Z',
      rawItems: [
        { item_code: 'WBC', value: 6400 },
        { item_code: 'RBC', value: 438 },
        { item_code: 'Hb', value: 12.4 },
        { item_code: 'Ferritin', value: 22.0 },
        { item_code: 'PLT', value: 23.1 },
        { item_code: 'AST', value: 28 },
        { item_code: 'ALT', value: 45 },
        { item_code: 'gGTP', value: 56 },
        { item_code: 'Cr', value: 0.84 },
        { item_code: 'eGFR', value: 76.8 },
        { item_code: 'CRP', value: 0.18 },
        { item_code: 'HbA1c', value: 5.7 },
        { item_code: 'LDL', value: 136 },
        { item_code: 'TSH', value: 2.35 },
      ],
    },
    {
      id: 3,
      tested_at: '2026-08-20',
      facility_name: '東京ベイ総合内科クリニック',
      weight_kg: 66.0,
      overall_score: 7,
      fatigue_score: 7,
      sleep_score: 7,
      pain_score: 8,
      appetite_score: 8,
      condition_note: '日中のだるさが大幅に軽減し、6時間半以上の熟睡感あり。軽いウォーキングを週3回再開。',
      ai_provider: 'gemini',
      ai_model: 'gemini-2.5-flash',
      created_at: '2026-08-20T11:00:00Z',
      rawItems: [
        { item_code: 'WBC', value: 5600 },
        { item_code: 'RBC', value: 458 },
        { item_code: 'Hb', value: 13.5 },
        { item_code: 'Ferritin', value: 38.4 },
        { item_code: 'PLT', value: 22.0 },
        { item_code: 'AST', value: 23 },
        { item_code: 'ALT', value: 34 },
        { item_code: 'gGTP', value: 42 },
        { item_code: 'Cr', value: 0.81 },
        { item_code: 'eGFR', value: 79.5 },
        { item_code: 'CRP', value: 0.09 },
        { item_code: 'HbA1c', value: 5.6 },
        { item_code: 'LDL', value: 128 },
        { item_code: 'TSH', value: 1.98 },
      ],
    },
    {
      id: 4,
      tested_at: '2026-11-10',
      facility_name: '東京ベイ総合内科クリニック',
      weight_kg: 65.2,
      overall_score: 9,
      fatigue_score: 8,
      sleep_score: 8,
      pain_score: 9,
      appetite_score: 9,
      condition_note: '朝の目覚めが良く、夕方の倦怠感もほぼ消失。鉄剤は隔日維持量へ減量相談予定。',
      ai_provider: 'gemini',
      ai_model: 'gemini-2.5-flash',
      created_at: '2026-11-10T09:45:00Z',
      rawItems: [
        { item_code: 'WBC', value: 5300 },
        { item_code: 'RBC', value: 476 },
        { item_code: 'Hb', value: 14.3 },
        { item_code: 'Ferritin', value: 54.0 },
        { item_code: 'PLT', value: 21.8 },
        { item_code: 'AST', value: 20 },
        { item_code: 'ALT', value: 26 },
        { item_code: 'gGTP', value: 35 },
        { item_code: 'Cr', value: 0.79 },
        { item_code: 'eGFR', value: 82.1 },
        { item_code: 'CRP', value: 0.05 },
        { item_code: 'HbA1c', value: 5.5 },
        { item_code: 'LDL', value: 121 },
        { item_code: 'TSH', value: 1.85 },
      ],
    },
  ];

  const built: LabRecord[] = [];
  let nextItemId = 1;

  for (const seed of rawSeeds) {
    const items: LabItem[] = seed.rawItems.map((ri) => {
      const normalized = normalizeLabItem(ri, sex);
      return {
        ...normalized,
        id: nextItemId++,
        record_id: seed.id,
      };
    });

    const draftRecord: LabRecord = {
      id: seed.id,
      tested_at: seed.tested_at,
      facility_name: seed.facility_name,
      weight_kg: seed.weight_kg,
      overall_score: seed.overall_score,
      fatigue_score: seed.fatigue_score,
      sleep_score: seed.sleep_score,
      pain_score: seed.pain_score,
      appetite_score: seed.appetite_score,
      condition_note: seed.condition_note,
      ai_provider: seed.ai_provider,
      ai_model: seed.ai_model,
      created_at: seed.created_at,
      items,
    };

    const analysis = buildLocalAnalysis(
      draftRecord,
      built,
      profile,
      (seed.ai_provider as AiProviderName) || 'gemini',
      seed.ai_model || 'gemini-2.5-flash'
    );

    draftRecord.ai_summary = analysis.ai_summary;
    draftRecord.ai_correlation = analysis.ai_correlation;
    draftRecord.ai_advice = analysis.ai_advice;
    draftRecord.items = draftRecord.items.map((it) => ({
      ...it,
      ai_comment: analysis.item_comments[it.item_code] || it.ai_comment || '',
    }));

    built.push(draftRecord);
  }

  // Return newest first (DESC by tested_at)
  return built.sort((a, b) => b.tested_at.localeCompare(a.tested_at));
}

interface MemoryStoreState {
  profile: UserProfile;
  records: LabRecord[];
  nextRecordId: number;
  nextItemId: number;
}

function createInitialMemoryState(): MemoryStoreState {
  const profile = createDefaultProfile();
  const records = createSeedRecords(profile);
  const maxRecordId = records.reduce((max, r) => Math.max(max, r.id || 0), 0);
  const maxItemId = records.reduce(
    (max, r) => Math.max(max, ...r.items.map((i) => i.id || 0)),
    0
  );
  return {
    profile,
    records,
    nextRecordId: maxRecordId + 1,
    nextItemId: maxItemId + 1,
  };
}

let memoryStore: MemoryStoreState = createInitialMemoryState();

export function resetMemoryStore(): void {
  memoryStore = createInitialMemoryState();
}

function clampScore(val: unknown, fallback = 5): number {
  const n = Number(val);
  if (Number.isNaN(n)) return fallback;
  return Math.min(10, Math.max(1, Math.round(n)));
}

async function ensureD1Seeded(db: D1DatabaseLike): Promise<void> {
  // Ensure tables exist
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS user_profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        name TEXT NOT NULL DEFAULT 'ユーザー',
        birth_year INTEGER,
        age INTEGER DEFAULT 35,
        sex TEXT NOT NULL DEFAULT 'male',
        height_cm REAL DEFAULT 170.0,
        chronic_conditions TEXT NOT NULL DEFAULT '',
        medications TEXT NOT NULL DEFAULT '',
        preferred_provider TEXT NOT NULL DEFAULT 'gemini',
        preferred_model TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS lab_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tested_at TEXT NOT NULL,
        facility_name TEXT NOT NULL DEFAULT '',
        weight_kg REAL,
        overall_score INTEGER NOT NULL DEFAULT 5,
        fatigue_score INTEGER NOT NULL DEFAULT 5,
        sleep_score INTEGER NOT NULL DEFAULT 5,
        pain_score INTEGER NOT NULL DEFAULT 5,
        appetite_score INTEGER NOT NULL DEFAULT 5,
        condition_note TEXT NOT NULL DEFAULT '',
        ai_provider TEXT NOT NULL DEFAULT '',
        ai_model TEXT NOT NULL DEFAULT '',
        ai_summary TEXT NOT NULL DEFAULT '',
        ai_correlation TEXT NOT NULL DEFAULT '',
        ai_advice TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS lab_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        record_id INTEGER NOT NULL REFERENCES lab_records(id) ON DELETE CASCADE,
        category TEXT NOT NULL DEFAULT 'その他',
        item_code TEXT NOT NULL,
        item_name TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT NOT NULL DEFAULT '',
        ref_low REAL,
        ref_high REAL,
        flag TEXT NOT NULL DEFAULT 'N',
        ai_comment TEXT NOT NULL DEFAULT ''
      )`
    )
    .run();

  const defaultProfile = createDefaultProfile();
  await db
    .prepare(
      `INSERT OR IGNORE INTO user_profile
       (id, name, birth_year, age, sex, height_cm, chronic_conditions, medications, preferred_provider, preferred_model, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      defaultProfile.name,
      defaultProfile.birth_year ?? null,
      defaultProfile.age,
      defaultProfile.sex,
      defaultProfile.height_cm,
      defaultProfile.chronic_conditions,
      defaultProfile.medications,
      defaultProfile.preferred_provider,
      defaultProfile.preferred_model,
      defaultProfile.updated_at || new Date().toISOString()
    )
    .run();

  const countRow = await db.prepare('SELECT COUNT(*) as cnt FROM lab_records').first<{ cnt: number }>();
  const cnt = Number(countRow?.cnt ?? 0);
  if (cnt === 0) {
    const profileRow = await getProfileFromD1(db);
    const seeds = createSeedRecords(profileRow).slice().reverse(); // Insert chronologically
    for (const rec of seeds) {
      await insertRecordIntoD1(db, rec);
    }
  }
}

async function getProfileFromD1(db: D1DatabaseLike): Promise<UserProfile> {
  const row = await db.prepare('SELECT * FROM user_profile WHERE id = 1').first<Record<string, unknown>>();
  if (!row) return createDefaultProfile();
  return {
    id: 1,
    name: String(row.name || 'サンプル患者'),
    birth_year: row.birth_year !== null && row.birth_year !== undefined ? Number(row.birth_year) : null,
    age: Number(row.age || 38),
    sex: (row.sex as BiologicalSex) || 'male',
    height_cm: Number(row.height_cm || 170),
    chronic_conditions: String(row.chronic_conditions || ''),
    medications: String(row.medications || ''),
    preferred_provider: ((row.preferred_provider as AiProviderName) || 'gemini'),
    preferred_model: String(row.preferred_model || 'gemini-2.5-flash'),
    updated_at: String(row.updated_at || ''),
  };
}

async function getRecordsFromD1(db: D1DatabaseLike): Promise<LabRecord[]> {
  const recRes = await db
    .prepare('SELECT * FROM lab_records ORDER BY tested_at DESC, id DESC')
    .all<Record<string, unknown>>();
  const itemRes = await db
    .prepare('SELECT * FROM lab_items ORDER BY id ASC')
    .all<Record<string, unknown>>();

  const itemsByRecordId = new Map<number, LabItem[]>();
  for (const row of itemRes.results || []) {
    const recordId = Number(row.record_id);
    const item: LabItem = {
      id: Number(row.id),
      record_id: recordId,
      category: String(row.category || 'その他'),
      item_code: String(row.item_code || ''),
      item_name: String(row.item_name || ''),
      value: Number(row.value),
      unit: String(row.unit || ''),
      ref_low: row.ref_low !== null && row.ref_low !== undefined ? Number(row.ref_low) : null,
      ref_high: row.ref_high !== null && row.ref_high !== undefined ? Number(row.ref_high) : null,
      flag: (row.flag as LabItem['flag']) || 'N',
      ai_comment: String(row.ai_comment || ''),
    };
    const list = itemsByRecordId.get(recordId) || [];
    list.push(item);
    itemsByRecordId.set(recordId, list);
  }

  return (recRes.results || []).map((r) => {
    const id = Number(r.id);
    return {
      id,
      tested_at: String(r.tested_at || ''),
      facility_name: String(r.facility_name || ''),
      weight_kg: r.weight_kg !== null && r.weight_kg !== undefined ? Number(r.weight_kg) : null,
      overall_score: Number(r.overall_score || 5),
      fatigue_score: Number(r.fatigue_score || 5),
      sleep_score: Number(r.sleep_score || 5),
      pain_score: Number(r.pain_score || 5),
      appetite_score: Number(r.appetite_score || 5),
      condition_note: String(r.condition_note || ''),
      ai_provider: String(r.ai_provider || ''),
      ai_model: String(r.ai_model || ''),
      ai_summary: String(r.ai_summary || ''),
      ai_correlation: String(r.ai_correlation || ''),
      ai_advice: String(r.ai_advice || ''),
      created_at: String(r.created_at || ''),
      items: itemsByRecordId.get(id) || [],
    };
  });
}

async function insertRecordIntoD1(db: D1DatabaseLike, record: LabRecord): Promise<LabRecord> {
  const res = await db
    .prepare(
      `INSERT INTO lab_records
       (tested_at, facility_name, weight_kg, overall_score, fatigue_score, sleep_score, pain_score, appetite_score, condition_note, ai_provider, ai_model, ai_summary, ai_correlation, ai_advice, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      record.tested_at,
      record.facility_name || '',
      record.weight_kg ?? null,
      record.overall_score,
      record.fatigue_score,
      record.sleep_score,
      record.pain_score,
      record.appetite_score,
      record.condition_note || '',
      record.ai_provider || '',
      record.ai_model || '',
      record.ai_summary || '',
      record.ai_correlation || '',
      record.ai_advice || '',
      record.created_at || new Date().toISOString()
    )
    .run();

  const recordId = Number(res.meta?.last_row_id || Date.now());
  const savedItems: LabItem[] = [];

  for (const item of record.items || []) {
    const itemRes = await db
      .prepare(
        `INSERT INTO lab_items
         (record_id, category, item_code, item_name, value, unit, ref_low, ref_high, flag, ai_comment)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        recordId,
        item.category || 'その他',
        item.item_code,
        item.item_name,
        item.value,
        item.unit || '',
        item.ref_low ?? null,
        item.ref_high ?? null,
        item.flag,
        item.ai_comment || ''
      )
      .run();

    savedItems.push({
      ...item,
      id: Number(itemRes.meta?.last_row_id || 0),
      record_id: recordId,
    });
  }

  return {
    ...record,
    id: recordId,
    items: savedItems,
  };
}

async function getRepositoryData(env: WorkerEnv): Promise<{
  useD1: boolean;
  profile: UserProfile;
  records: LabRecord[];
}> {
  if (env.DB) {
    try {
      await ensureD1Seeded(env.DB);
      const profile = await getProfileFromD1(env.DB);
      const records = await getRecordsFromD1(env.DB);
      return { useD1: true, profile, records };
    } catch {
      // Fallback to in-memory store if D1 binding throws
    }
  }
  return {
    useD1: false,
    profile: { ...memoryStore.profile },
    records: memoryStore.records.map((r) => ({ ...r, items: r.items.map((i) => ({ ...i })) })),
  };
}

function recalculateRecordsForSex(records: LabRecord[], sex: BiologicalSex): LabRecord[] {
  return records.map((rec) => ({
    ...rec,
    items: rec.items.map((it) => {
      const { standard, refLow, refHigh } = findStandardSafe(it.item_code || it.item_name, sex);
      const newLow = standard ? refLow : it.ref_low;
      const newHigh = standard ? refHigh : it.ref_high;
      return {
        ...it,
        ref_low: newLow,
        ref_high: newHigh,
        flag: computeFlag(it.value, newLow, newHigh),
      };
    }),
  }));
}

export default {
  async fetch(request: Request, env: WorkerEnv = {}): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // 1. GET /api/bootstrap
      if (path === '/api/bootstrap' && request.method === 'GET') {
        const { profile, records } = await getRepositoryData(env);
        return jsonResponse({
          profile,
          records,
          standards: REFERENCE_STANDARDS,
          providers: SUPPORTED_PROVIDERS,
        });
      }

      // 2. PUT /api/profile (also accept POST /api/profile)
      if (path === '/api/profile' && (request.method === 'PUT' || request.method === 'POST')) {
        const body = (await request.json()) as Partial<UserProfile>;
        const { useD1, profile: currentProfile } = await getRepositoryData(env);

        const validSex: BiologicalSex =
          body.sex === 'female' || body.sex === 'other' || body.sex === 'male'
            ? body.sex
            : currentProfile.sex;

        const validProvider: AiProviderName =
          body.preferred_provider === 'openai' ||
          body.preferred_provider === 'claude' ||
          body.preferred_provider === 'gemini'
            ? body.preferred_provider
            : currentProfile.preferred_provider;

        const updated: UserProfile = {
          ...currentProfile,
          name: body.name !== undefined ? String(body.name).trim() || currentProfile.name : currentProfile.name,
          birth_year: body.birth_year !== undefined ? (body.birth_year ? Number(body.birth_year) : null) : currentProfile.birth_year,
          age: body.age !== undefined ? Number(body.age) : currentProfile.age,
          sex: validSex,
          height_cm: body.height_cm !== undefined ? Number(body.height_cm) : currentProfile.height_cm,
          chronic_conditions:
            body.chronic_conditions !== undefined ? String(body.chronic_conditions) : currentProfile.chronic_conditions,
          medications: body.medications !== undefined ? String(body.medications) : currentProfile.medications,
          preferred_provider: validProvider,
          preferred_model:
            body.preferred_model !== undefined ? String(body.preferred_model) : currentProfile.preferred_model,
          updated_at: new Date().toISOString(),
        };

        if (useD1 && env.DB) {
          await env.DB.prepare(
            `UPDATE user_profile
             SET name = ?, birth_year = ?, age = ?, sex = ?, height_cm = ?,
                 chronic_conditions = ?, medications = ?, preferred_provider = ?, preferred_model = ?, updated_at = ?
             WHERE id = 1`
          )
            .bind(
              updated.name,
              updated.birth_year ?? null,
              updated.age,
              updated.sex,
              updated.height_cm,
              updated.chronic_conditions,
              updated.medications,
              updated.preferred_provider,
              updated.preferred_model,
              updated.updated_at
            )
            .run();
        } else {
          const sexChanged = memoryStore.profile.sex !== updated.sex;
          memoryStore.profile = updated;
          if (sexChanged) {
            memoryStore.records = recalculateRecordsForSex(memoryStore.records, updated.sex);
          }
        }

        return jsonResponse(updated);
      }

      // 3. POST /api/records
      if (path === '/api/records' && request.method === 'POST') {
        const rawBody = (await request.json()) as Record<string, unknown>;
        const recordPayload = (rawBody.record ? rawBody.record : rawBody) as Partial<LabRecord> & {
          provider?: AiProviderName;
          model?: string;
          apiKey?: string;
        };

        const provider = (rawBody.provider || recordPayload.provider || recordPayload.ai_provider) as
          | AiProviderName
          | undefined;
        const model = (rawBody.model || recordPayload.model || recordPayload.ai_model) as string | undefined;
        const apiKey = (rawBody.apiKey || recordPayload.apiKey) as string | undefined;

        const { useD1, profile, records: existingRecords } = await getRepositoryData(env);

        const rawItems = Array.isArray(recordPayload.items) ? recordPayload.items : [];
        const normalizedItems: LabItem[] = rawItems
          .map((item) =>
            normalizeLabItem(
              {
                category: item.category,
                item_code: item.item_code,
                item_name: item.item_name,
                value: Number(item.value),
                unit: item.unit,
                ref_low: item.ref_low,
                ref_high: item.ref_high,
                ai_comment: item.ai_comment,
              },
              profile.sex
            )
          )
          .filter((it) => !Number.isNaN(it.value));

        const draftRecord: LabRecord = {
          tested_at:
            typeof recordPayload.tested_at === 'string' && recordPayload.tested_at.trim()
              ? recordPayload.tested_at.trim()
              : new Date().toISOString().slice(0, 10),
          facility_name:
            typeof recordPayload.facility_name === 'string' ? recordPayload.facility_name.trim() : '',
          weight_kg:
            recordPayload.weight_kg !== undefined && recordPayload.weight_kg !== null && String(recordPayload.weight_kg) !== ''
              ? Number(recordPayload.weight_kg)
              : null,
          overall_score: clampScore(recordPayload.overall_score, 5),
          fatigue_score: clampScore(recordPayload.fatigue_score, 5),
          sleep_score: clampScore(recordPayload.sleep_score, 5),
          pain_score: clampScore(recordPayload.pain_score, 5),
          appetite_score: clampScore(recordPayload.appetite_score, 5),
          condition_note:
            typeof recordPayload.condition_note === 'string' ? recordPayload.condition_note.trim() : '',
          created_at: new Date().toISOString(),
          items: normalizedItems,
        };

        const analysis = await analyzeLabAndWellness({
          record: draftRecord,
          history: existingRecords,
          profile,
          provider,
          model,
          apiKey,
          env,
        });

        draftRecord.ai_provider = analysis.provider_used;
        draftRecord.ai_model = analysis.model_used;
        draftRecord.ai_summary = analysis.ai_summary;
        draftRecord.ai_correlation = analysis.ai_correlation;
        draftRecord.ai_advice = analysis.ai_advice;
        draftRecord.items = draftRecord.items.map((it) => ({
          ...it,
          ai_comment: analysis.item_comments[it.item_code] || it.ai_comment || '',
        }));

        if (useD1 && env.DB) {
          const saved = await insertRecordIntoD1(env.DB, draftRecord);
          return jsonResponse(saved, 201);
        }

        const recordId = memoryStore.nextRecordId++;
        const savedRecord: LabRecord = {
          ...draftRecord,
          id: recordId,
          items: draftRecord.items.map((it) => ({
            ...it,
            id: memoryStore.nextItemId++,
            record_id: recordId,
          })),
        };
        memoryStore.records.push(savedRecord);
        memoryStore.records.sort((a, b) => b.tested_at.localeCompare(a.tested_at) || (b.id || 0) - (a.id || 0));
        return jsonResponse(savedRecord, 201);
      }

      // 4. DELETE /api/records/:id
      const deleteMatch = path.match(/^\/api\/records\/(\d+)$/);
      if (deleteMatch && request.method === 'DELETE') {
        const targetId = Number(deleteMatch[1]);
        const { useD1 } = await getRepositoryData(env);

        if (useD1 && env.DB) {
          await env.DB.prepare('DELETE FROM lab_items WHERE record_id = ?').bind(targetId).run();
          await env.DB.prepare('DELETE FROM lab_records WHERE id = ?').bind(targetId).run();
        } else {
          memoryStore.records = memoryStore.records.filter((r) => r.id !== targetId);
        }

        return jsonResponse({ deleted: true, id: targetId });
      }

      // 5. POST /api/ocr
      if (path === '/api/ocr' && request.method === 'POST') {
        const body = (await request.json()) as {
          imageBase64?: string;
          mimeType?: string;
          rawText?: string;
          provider?: AiProviderName;
          model?: string;
          apiKey?: string;
          sex?: BiologicalSex;
        };
        const { profile } = await getRepositoryData(env);
        const ocrResult = await extractLabFromOcr({
          imageBase64: body.imageBase64,
          mimeType: body.mimeType,
          rawText: body.rawText,
          provider: body.provider || profile.preferred_provider,
          model: body.model || profile.preferred_model,
          apiKey: body.apiKey,
          sex: body.sex || profile.sex,
          env,
        });
        return jsonResponse(ocrResult);
      }

      // 6. POST /api/analyze
      if (path === '/api/analyze' && request.method === 'POST') {
        const body = (await request.json()) as {
          record: LabRecord;
          history?: LabRecord[];
          profile?: UserProfile;
          provider?: AiProviderName;
          model?: string;
          apiKey?: string;
        };

        const repo = await getRepositoryData(env);
        const targetProfile = body.profile || repo.profile;
        const targetHistory = body.history || repo.records;

        const normalizedRecord: LabRecord = {
          ...body.record,
          items: (body.record?.items || []).map((it) => normalizeLabItem(it, targetProfile.sex)),
        };

        const result = await analyzeLabAndWellness({
          record: normalizedRecord,
          history: targetHistory,
          profile: targetProfile,
          provider: body.provider,
          model: body.model,
          apiKey: body.apiKey,
          env,
        });

        // Update persisted record if it exists in store
        if (normalizedRecord.id) {
          if (repo.useD1 && env.DB) {
            await env.DB.prepare(
              `UPDATE lab_records
               SET ai_provider = ?, ai_model = ?, ai_summary = ?, ai_correlation = ?, ai_advice = ?
               WHERE id = ?`
            )
              .bind(
                result.provider_used,
                result.model_used,
                result.ai_summary,
                result.ai_correlation,
                result.ai_advice,
                normalizedRecord.id
              )
              .run();
          } else {
            const idx = memoryStore.records.findIndex((r) => r.id === normalizedRecord.id);
            if (idx !== -1) {
              memoryStore.records[idx] = {
                ...memoryStore.records[idx],
                ai_provider: result.provider_used,
                ai_model: result.model_used,
                ai_summary: result.ai_summary,
                ai_correlation: result.ai_correlation,
                ai_advice: result.ai_advice,
                items: memoryStore.records[idx].items.map((it) => ({
                  ...it,
                  ai_comment: result.item_comments[it.item_code] || it.ai_comment || '',
                })),
              };
            }
          }
        }

        return jsonResponse(result);
      }

      if (path.startsWith('/api/')) {
        return jsonResponse({ error: `Not Found: ${request.method} ${path}` }, 404);
      }

      // 7. Delegate non-API requests to Cloudflare static assets binding
      if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
        return env.ASSETS.fetch(request);
      }

      return new Response('Lab Result Analyzer Worker is running.', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal Server Error';
      return jsonResponse({ error: message }, 500);
    }
  },
};
