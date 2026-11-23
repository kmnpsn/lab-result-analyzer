import {
  REFERENCE_STANDARDS,
  computeFlag,
  parseVisibleItemCodes,
  type AccountSummary,
  type AiProviderName,
  type BiologicalSex,
  type LabItem,
  type LabRecord,
  type PlanTier,
  type RecordType,
  type RegistrationMode,
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
import {
  createErrorResponse,
  evaluateSecurityGate,
  finalizeResponse,
  generateRequestId,
  recordServerFailure,
  resetSecurityState,
  type SecurityEnv,
} from './security.ts';
import {
  handleAuthAndInviteRoutes,
  resetAuthMemoryStore,
  resolveAuthMode,
  resolveCurrentSessionContext,
  verifyMutationSecurityHeaders,
  type AuthEnv,
} from './auth.ts';

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

export interface WorkerEnv extends AiEnv, SecurityEnv, AuthEnv {
  DB?: D1DatabaseLike;
  REGISTRATION_MODE?: RegistrationMode;
  ASSETS?: {
    fetch(request: Request): Promise<Response>;
  };
}

const MAX_JSON_BODY_BYTES = 5 * 1024 * 1024; // 5MB

function jsonResponse(data: unknown, requestId: string, status = 200): Response {
  const raw = new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
  return finalizeResponse(raw, requestId);
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

export function createBlankProfileForUser(displayName = '利用者', userId = 0): UserProfile {
  return {
    id: userId || 1,
    name: displayName || '利用者',
    birth_year: null,
    age: 35,
    sex: 'male',
    height_cm: 170.0,
    chronic_conditions: '',
    medications: '',
    preferred_provider: 'gemini',
    preferred_model: 'gemini-2.5-flash',
    updated_at: new Date().toISOString(),
  };
}

export function createDefaultAccount(profile?: UserProfile, env?: WorkerEnv): AccountSummary {
  const regMode: RegistrationMode =
    env?.REGISTRATION_MODE === 'open' || env?.REGISTRATION_MODE === 'demo'
      ? env.REGISTRATION_MODE
      : 'invite_only';
  return {
    registration_mode: regMode,
    auth_mode: env?.AUTH_MODE === 'production' ? 'production' : 'demo',
    authenticated: true,
    user_id: 1,
    service_role: 'admin',
    email: 'owner@example.com',
    display_name: profile?.name || 'サンプル利用者',
    plan_tier: 'free',
    monthly_ocr_used: 1,
    monthly_ocr_limit: 10,
    terms_accepted: true,
    csrf_token: 'csrf_demo_default_token_001',
    linked_identities: [
      {
        id: 1,
        provider: 'google',
        provider_subject: 'demo-google-sub-001',
        email_snapshot: 'owner@example.com',
        display_name_snapshot: 'サンプル利用者 (Google)',
        linked_at: '2026-11-10T09:00:00Z',
        last_used_at: '2026-11-10T09:00:00Z',
      },
    ],
    invitations: [],
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
      record_type: 'lab',
      symptom_tags: 'だるさ・疲労, 睡眠不足, 通院・採血日',
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
      record_type: 'daily',
      symptom_tags: 'おなかの不調, だるさ・疲労',
      tested_at: '2026-04-02',
      facility_name: '日々の体調日記',
      weight_kg: 67.8,
      overall_score: 5,
      fatigue_score: 4,
      sleep_score: 5,
      pain_score: 5,
      appetite_score: 6,
      condition_note: '季節の変わり目で少しおなかの張りと午後のだるさがあるが、鉄剤は毎日継続できている。',
      ai_provider: 'gemini',
      ai_model: 'gemini-2.5-flash',
      created_at: '2026-04-02T20:00:00Z',
      rawItems: [],
    },
    {
      id: 3,
      record_type: 'lab',
      symptom_tags: 'お薬の変更, 睡眠不足, 通院・採血日',
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
      id: 4,
      record_type: 'daily',
      symptom_tags: 'お薬の変更, 体調安定',
      tested_at: '2026-07-05',
      facility_name: '日々の体調日記',
      weight_kg: 66.5,
      overall_score: 7,
      fatigue_score: 6,
      sleep_score: 6,
      pain_score: 7,
      appetite_score: 8,
      condition_note: 'お薬の併用開始から1か月半が経過し、おなかの違和感や立ちくらみが落ち着いてきた。',
      ai_provider: 'gemini',
      ai_model: 'gemini-2.5-flash',
      created_at: '2026-07-05T20:15:00Z',
      rawItems: [],
    },
    {
      id: 5,
      record_type: 'lab',
      symptom_tags: '体調安定, 通院・採血日',
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
      id: 6,
      record_type: 'daily',
      symptom_tags: '体調安定',
      tested_at: '2026-10-04',
      facility_name: '日々の体調日記',
      weight_kg: 65.5,
      overall_score: 8,
      fatigue_score: 8,
      sleep_score: 8,
      pain_score: 8,
      appetite_score: 9,
      condition_note: '朝すっきり起きられる日が増え、食事も普段どおり美味しく摂れている。',
      ai_provider: 'gemini',
      ai_model: 'gemini-2.5-flash',
      created_at: '2026-10-04T20:30:00Z',
      rawItems: [],
    },
    {
      id: 7,
      record_type: 'lab',
      symptom_tags: '体調安定, 通院・採血日',
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

    const recordType: RecordType = items.length === 0 ? 'daily' : seed.record_type || 'lab';

    const draftRecord: LabRecord = {
      id: seed.id,
      record_type: recordType,
      symptom_tags: seed.symptom_tags || '',
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

type StoredLabRecord = LabRecord & { user_id?: number };

interface MemoryStoreState {
  profile: UserProfile;
  profilesByUserId: Map<number, UserProfile>;
  account: AccountSummary;
  records: StoredLabRecord[];
  nextRecordId: number;
  nextItemId: number;
}

function createInitialMemoryState(): MemoryStoreState {
  const profile = createDefaultProfile();
  const account = createDefaultAccount(profile);
  const records: StoredLabRecord[] = createSeedRecords(profile).map((r) => ({ ...r, user_id: 1 }));
  const maxRecordId = records.reduce((max, r) => Math.max(max, r.id || 0), 0);
  const maxItemId = records.reduce(
    (max, r) => Math.max(max, ...r.items.map((i) => i.id || 0)),
    0
  );
  const profilesByUserId = new Map<number, UserProfile>();
  profilesByUserId.set(1, { ...profile });
  return {
    profile,
    profilesByUserId,
    account,
    records,
    nextRecordId: maxRecordId + 1,
    nextItemId: maxItemId + 1,
  };
}

let memoryStore: MemoryStoreState = createInitialMemoryState();

export function resetMemoryStore(): void {
  memoryStore = createInitialMemoryState();
  resetAuthMemoryStore();
  resetSecurityState();
}

function clampScore(val: unknown, fallback = 5): number {
  const n = Number(val);
  if (Number.isNaN(n)) return fallback;
  return Math.min(10, Math.max(1, Math.round(n)));
}

function normalizeSymptomTags(raw: unknown): string {
  if (Array.isArray(raw)) {
    return raw
      .map((s) => String(s ?? '').trim())
      .filter(Boolean)
      .join(', ');
  }
  if (typeof raw === 'string') {
    return raw.trim();
  }
  return '';
}

export async function ensureD1Schema(db: D1DatabaseLike): Promise<void> {
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
        record_type TEXT NOT NULL DEFAULT 'lab' CHECK (record_type IN ('daily', 'lab')),
        symptom_tags TEXT NOT NULL DEFAULT '',
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

  // 既存の lab_records に record_type / symptom_tags が無い場合は ALTER TABLE で安全に追加
  try {
    await db
      .prepare(`ALTER TABLE lab_records ADD COLUMN record_type TEXT NOT NULL DEFAULT 'lab'`)
      .run();
  } catch {
    // 既に存在する場合は無視
  }
  try {
    await db
      .prepare(`ALTER TABLE lab_records ADD COLUMN symptom_tags TEXT NOT NULL DEFAULT ''`)
      .run();
  } catch {
    // 既に存在する場合は無視
  }
  try {
    await db
      .prepare(`ALTER TABLE lab_records ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1`)
      .run();
  } catch {
    // 既に存在する場合は無視
  }

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS user_profiles (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL DEFAULT '利用者',
        birth_year INTEGER,
        age INTEGER DEFAULT 35,
        sex TEXT NOT NULL DEFAULT 'male',
        height_cm REAL DEFAULT 170.0,
        chronic_conditions TEXT NOT NULL DEFAULT '',
        medications TEXT NOT NULL DEFAULT '',
        preferred_provider TEXT NOT NULL DEFAULT 'gemini',
        preferred_model TEXT NOT NULL DEFAULT '',
        visible_item_codes TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    )
    .run();

  try {
    await db
      .prepare(`ALTER TABLE user_profiles ADD COLUMN visible_item_codes TEXT NOT NULL DEFAULT ''`)
      .run();
  } catch {
    // 既に存在する場合は無視
  }

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

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        public_id TEXT UNIQUE,
        email TEXT UNIQUE,
        display_name TEXT NOT NULL DEFAULT 'ゲスト',
        role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'member')),
        service_role TEXT NOT NULL DEFAULT 'admin' CHECK (service_role IN ('admin', 'user')),
        plan_tier TEXT NOT NULL DEFAULT 'free' CHECK (plan_tier IN ('free', 'plus', 'pro')),
        monthly_ocr_used INTEGER NOT NULL DEFAULT 0,
        monthly_ocr_limit INTEGER NOT NULL DEFAULT 10,
        terms_accepted_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    )
    .run();

  try {
    await db.prepare(`ALTER TABLE users ADD COLUMN public_id TEXT`).run();
  } catch {
    // 既に存在する場合は無視
  }
  try {
    await db
      .prepare(
        `ALTER TABLE users ADD COLUMN service_role TEXT NOT NULL DEFAULT 'admin' CHECK (service_role IN ('admin', 'user'))`
      )
      .run();
  } catch {
    // 既に存在する場合は無視
  }

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS auth_identities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_subject TEXT NOT NULL,
        email_snapshot TEXT,
        display_name_snapshot TEXT,
        linked_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(provider, provider_subject)
      )`
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        csrf_token TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        absolute_expires_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    )
    .run();

  try {
    await db.prepare(`ALTER TABLE auth_sessions ADD COLUMN revoked_at TEXT`).run();
  } catch {
    // 既に存在する場合は無視
  }

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS invitations (
        token TEXT PRIMARY KEY,
        email_normalized TEXT NOT NULL DEFAULT '',
        email_display TEXT NOT NULL DEFAULT '',
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        note TEXT NOT NULL DEFAULT '',
        consumed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        consumed_at TEXT,
        revoked_at TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    )
    .run();

  try {
    await db.prepare(`ALTER TABLE invitations ADD COLUMN email_normalized TEXT NOT NULL DEFAULT ''`).run();
  } catch {
    // ignore
  }
  try {
    await db.prepare(`ALTER TABLE invitations ADD COLUMN email_display TEXT NOT NULL DEFAULT ''`).run();
  } catch {
    // ignore
  }
  try {
    await db.prepare(`ALTER TABLE invitations ADD COLUMN consumed_at TEXT`).run();
  } catch {
    // ignore
  }
  try {
    await db.prepare(`ALTER TABLE invitations ADD COLUMN revoked_at TEXT`).run();
  } catch {
    // ignore
  }
}

async function ensureD1Ready(db: D1DatabaseLike, env: WorkerEnv): Promise<void> {
  await ensureD1Schema(db);

  // 本番モード (AUTH_MODE=production) ではデモユーザーやサンプルデータを自動シードしない
  if (resolveAuthMode(env) !== 'demo') {
    return;
  }

  const existingDemoUser = await db
    .prepare(`SELECT id FROM users WHERE id = 1`)
    .first<{ id: number }>();

  if (!existingDemoUser) {
    const defaultProfile = createDefaultProfile();
    await db
      .prepare(
        `INSERT OR IGNORE INTO users (id, public_id, email, display_name, role, service_role, plan_tier, monthly_ocr_used, monthly_ocr_limit)
         VALUES (1, 'u_owner_default', 'owner@example.com', ?, 'owner', 'admin', 'free', 1, 10)`
      )
      .bind(defaultProfile.name)
      .run();

    await db
      .prepare(
        `INSERT OR IGNORE INTO user_profiles
         (user_id, name, birth_year, age, sex, height_cm, chronic_conditions, medications, preferred_provider, preferred_model, updated_at)
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

    await db
      .prepare(
        `INSERT OR IGNORE INTO auth_identities (user_id, provider, provider_subject, email_snapshot, display_name_snapshot)
         VALUES (1, 'google', 'demo-google-sub-001', 'owner@example.com', 'サンプル利用者 (Google)')`
      )
      .run();

    const countRow = await db
      .prepare('SELECT COUNT(*) as cnt FROM lab_records WHERE user_id = 1')
      .first<{ cnt: number }>();
    if (Number(countRow?.cnt ?? 0) === 0) {
      const seeds = createSeedRecords(defaultProfile).slice().reverse();
      for (const rec of seeds) {
        await insertRecordIntoD1(db, rec, 1);
      }
    }
  }
}

async function getProfileFromD1(
  db: D1DatabaseLike,
  userId: number,
  fallbackDisplayName = '利用者'
): Promise<UserProfile> {
  const row = await db
    .prepare('SELECT * FROM user_profiles WHERE user_id = ?')
    .bind(userId)
    .first<Record<string, unknown>>();
  if (row) {
    return {
      id: userId,
      name: String(row.name || fallbackDisplayName || '利用者'),
      birth_year: row.birth_year !== null && row.birth_year !== undefined ? Number(row.birth_year) : null,
      age: Number(row.age || 35),
      sex: (row.sex as BiologicalSex) || 'male',
      height_cm: Number(row.height_cm || 170),
      chronic_conditions: String(row.chronic_conditions || ''),
      medications: String(row.medications || ''),
      preferred_provider: (row.preferred_provider as AiProviderName) || 'gemini',
      preferred_model: String(row.preferred_model || 'gemini-2.5-flash'),
      visible_item_codes: parseVisibleItemCodes(row.visible_item_codes),
      updated_at: String(row.updated_at || ''),
    };
  }
  // デモユーザー (id=1) のみ旧 user_profile テーブルを参照
  if (userId === 1) {
    const legacy = await db
      .prepare('SELECT * FROM user_profile WHERE id = 1')
      .first<Record<string, unknown>>();
    if (legacy) {
      return {
        id: 1,
        name: String(legacy.name || 'サンプル患者'),
        birth_year:
          legacy.birth_year !== null && legacy.birth_year !== undefined ? Number(legacy.birth_year) : null,
        age: Number(legacy.age || 38),
        sex: (legacy.sex as BiologicalSex) || 'male',
        height_cm: Number(legacy.height_cm || 170),
        chronic_conditions: String(legacy.chronic_conditions || ''),
        medications: String(legacy.medications || ''),
        preferred_provider: (legacy.preferred_provider as AiProviderName) || 'gemini',
        preferred_model: String(legacy.preferred_model || 'gemini-2.5-flash'),
        updated_at: String(legacy.updated_at || ''),
      };
    }
    return createDefaultProfile();
  }
  // 新規アカウントはデモデータを含まないクリーンなプロフィールから開始
  return createBlankProfileForUser(fallbackDisplayName, userId);
}

async function upsertProfileToD1(
  db: D1DatabaseLike,
  userId: number,
  updated: UserProfile
): Promise<void> {
  const visibleCodesStr = parseVisibleItemCodes(updated.visible_item_codes).join(',');
  await db
    .prepare(
      `INSERT INTO user_profiles
       (user_id, name, birth_year, age, sex, height_cm, chronic_conditions, medications, preferred_provider, preferred_model, visible_item_codes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         name = excluded.name,
         birth_year = excluded.birth_year,
         age = excluded.age,
         sex = excluded.sex,
         height_cm = excluded.height_cm,
         chronic_conditions = excluded.chronic_conditions,
         medications = excluded.medications,
         preferred_provider = excluded.preferred_provider,
         preferred_model = excluded.preferred_model,
         visible_item_codes = excluded.visible_item_codes,
         updated_at = excluded.updated_at`
    )
    .bind(
      userId,
      updated.name,
      updated.birth_year ?? null,
      updated.age,
      updated.sex,
      updated.height_cm,
      updated.chronic_conditions,
      updated.medications,
      updated.preferred_provider,
      updated.preferred_model,
      visibleCodesStr,
      updated.updated_at
    )
    .run();
}

async function getRecordsFromD1(db: D1DatabaseLike, userId: number): Promise<LabRecord[]> {
  const recRes = await db
    .prepare('SELECT * FROM lab_records WHERE user_id = ? ORDER BY tested_at DESC, id DESC')
    .bind(userId)
    .all<Record<string, unknown>>();
  const itemRes = await db
    .prepare(
      `SELECT li.* FROM lab_items li
       INNER JOIN lab_records lr ON li.record_id = lr.id
       WHERE lr.user_id = ?
       ORDER BY li.id ASC`
    )
    .bind(userId)
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
    const items = itemsByRecordId.get(id) || [];
    const recordType: RecordType =
      r.record_type === 'daily' || (items.length === 0 && r.record_type !== 'lab') ? 'daily' : 'lab';
    return {
      id,
      record_type: recordType,
      symptom_tags: String(r.symptom_tags || ''),
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
      items,
    };
  });
}

async function insertRecordIntoD1(
  db: D1DatabaseLike,
  record: LabRecord,
  userId: number
): Promise<LabRecord> {
  const recordType: RecordType =
    record.record_type === 'daily' || (record.items || []).length === 0 ? 'daily' : 'lab';
  const symptomTags = record.symptom_tags || '';

  const res = await db
    .prepare(
      `INSERT INTO lab_records
       (user_id, record_type, symptom_tags, tested_at, facility_name, weight_kg, overall_score, fatigue_score, sleep_score, pain_score, appetite_score, condition_note, ai_provider, ai_model, ai_summary, ai_correlation, ai_advice, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      userId,
      recordType,
      symptomTags,
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
    record_type: recordType,
    symptom_tags: symptomTags,
    items: savedItems,
  };
}

async function getRepositoryData(
  env: WorkerEnv,
  request?: Request
): Promise<{
  useD1: boolean;
  authenticated: boolean;
  userId: number | null;
  profile: UserProfile;
  account: AccountSummary;
  records: LabRecord[];
}> {
  if (env.DB) {
    await ensureD1Ready(env.DB, env);
    const sessionCtx = await resolveCurrentSessionContext(request, env);
    if (!sessionCtx.authenticated || !sessionCtx.user) {
      return {
        useD1: true,
        authenticated: false,
        userId: null,
        profile: createBlankProfileForUser('ゲスト', 0),
        account: sessionCtx.account,
        records: [],
      };
    }
    const userId = sessionCtx.user.id;
    const profile = await getProfileFromD1(env.DB, userId, sessionCtx.user.display_name);
    const records = await getRecordsFromD1(env.DB, userId);
    return {
      useD1: true,
      authenticated: true,
      userId,
      profile,
      account: sessionCtx.account,
      records,
    };
  }

  const sessionCtx = await resolveCurrentSessionContext(request, env, memoryStore.profile);
  if (!sessionCtx.authenticated || !sessionCtx.user) {
    return {
      useD1: false,
      authenticated: false,
      userId: null,
      profile: createBlankProfileForUser('ゲスト', 0),
      account: sessionCtx.account,
      records: [],
    };
  }

  const userId = sessionCtx.user.id;
  let profile = memoryStore.profilesByUserId.get(userId);
  if (!profile) {
    profile =
      userId === 1
        ? { ...memoryStore.profile }
        : createBlankProfileForUser(sessionCtx.user.display_name, userId);
    memoryStore.profilesByUserId.set(userId, profile);
  }
  const userRecords = memoryStore.records
    .filter((r) => (r.user_id ?? 1) === userId)
    .map(({ user_id: _uid, ...rest }) => ({
      ...rest,
      items: rest.items.map((i) => ({ ...i })),
    }));
  return {
    useD1: false,
    authenticated: true,
    userId,
    profile: { ...profile },
    account: sessionCtx.account,
    records: userRecords,
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

function escapeCsvCell(val: unknown): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildRecordsCsv(records: LabRecord[]): string {
  const headers = [
    '日付',
    '記録種別',
    '医療機関・記録タイトル',
    '体重(kg)',
    '全体の調子(1-10)',
    '元気さ(1-10)',
    'からだの快適さ(1-10)',
    '睡眠・休養(1-10)',
    '食事・日常生活(1-10)',
    '症状・出来事タグ',
    'ひとこと日記',
    '採血項目一覧',
  ];

  const rows = records.map((r) => {
    const typeLabel = r.record_type === 'daily' || (r.items || []).length === 0 ? '体調日記' : '採血＋体調';
    const itemsSummary = (r.items || [])
      .map((i) => `${i.item_code}:${i.value}${i.unit}(${i.flag})`)
      .join(' / ');
    return [
      r.tested_at,
      typeLabel,
      r.facility_name || (typeLabel === '体調日記' ? '日々の体調日記' : ''),
      r.weight_kg ?? '',
      r.overall_score,
      r.fatigue_score,
      r.pain_score,
      r.sleep_score,
      r.appetite_score,
      r.symptom_tags || '',
      r.condition_note || '',
      itemsSummary,
    ]
      .map(escapeCsvCell)
      .join(',');
  });

  return `\uFEFF${[headers.join(','), ...rows].join('\r\n')}\r\n`;
}

async function parseJsonBody<T>(
  request: Request,
  requestId: string,
  route: string
): Promise<{ data?: T; errorResponse?: Response }> {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_JSON_BODY_BYTES) {
    return {
      errorResponse: createErrorResponse('PAYLOAD_TOO_LARGE', requestId, { route }),
    };
  }
  try {
    const rawText = await request.text();
    if (rawText.length > MAX_JSON_BODY_BYTES) {
      return {
        errorResponse: createErrorResponse('PAYLOAD_TOO_LARGE', requestId, { route }),
      };
    }
    if (!rawText.trim()) {
      return {
        errorResponse: createErrorResponse('REQUEST_INVALID', requestId, { route }),
      };
    }
    const parsed = JSON.parse(rawText) as T;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {
        errorResponse: createErrorResponse('REQUEST_INVALID', requestId, { route }),
      };
    }
    return { data: parsed };
  } catch {
    return {
      errorResponse: createErrorResponse('REQUEST_INVALID', requestId, { route }),
    };
  }
}

export default {
  async fetch(request: Request, env: WorkerEnv = {}): Promise<Response> {
    const requestId = request.headers.get('x-karada-request-id')?.trim() || generateRequestId();

    if (request.method === 'OPTIONS') {
      return finalizeResponse(new Response(null, { status: 204 }), requestId);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // 3段構え防御ゲート（/api/* へのアクセス時に手動メンテナンススイッチ・オートサーキットブレーカー・レート制限を評価）
    if (path.startsWith('/api/')) {
      const blocked = evaluateSecurityGate(request, env, requestId);
      if (blocked) {
        return blocked;
      }
    }

    try {
      // 0. Auth & Invite API routes (/api/auth/* and /api/invite/*/verify)
      if (path.startsWith('/api/auth/') || path.startsWith('/api/invite/')) {
        if (env.DB) {
          await ensureD1Ready(env.DB, env);
        }
        const authRes = await handleAuthAndInviteRoutes({
          request,
          env,
          requestId,
          fallbackProfile: memoryStore.profile,
          onResetAccountRecords: async (targetUserId, isDemoReset) => {
            if (env.DB) {
              if (isDemoReset) {
                await env.DB.prepare(
                  `DELETE FROM lab_items WHERE record_id IN (SELECT id FROM lab_records WHERE user_id = 1)`
                ).run();
                await env.DB.prepare(`DELETE FROM lab_records WHERE user_id = 1`).run();
                const defaultProfile = createDefaultProfile();
                await upsertProfileToD1(env.DB, 1, defaultProfile);
                const seeds = createSeedRecords(defaultProfile).slice().reverse();
                for (const rec of seeds) {
                  await insertRecordIntoD1(env.DB, rec, 1);
                }
              }
              return;
            }
            if (isDemoReset) {
              const initial = createInitialMemoryState();
              memoryStore.profile = initial.profile;
              memoryStore.profilesByUserId.set(1, { ...initial.profile });
              memoryStore.account = initial.account;
              memoryStore.records = [
                ...memoryStore.records.filter((r) => (r.user_id ?? 1) !== 1),
                ...initial.records,
              ];
              memoryStore.nextRecordId = Math.max(memoryStore.nextRecordId, initial.nextRecordId);
              memoryStore.nextItemId = Math.max(memoryStore.nextItemId, initial.nextItemId);
            } else {
              memoryStore.profilesByUserId.delete(targetUserId);
              memoryStore.records = memoryStore.records.filter((r) => (r.user_id ?? 1) !== targetUserId);
            }
          },
        });
        if (authRes) {
          return authRes;
        }
      }

      // 1. GET /api/bootstrap
      if (path === '/api/bootstrap') {
        if (request.method !== 'GET') {
          return createErrorResponse('METHOD_NOT_ALLOWED', requestId, { route: path });
        }
        const { profile, account, records } = await getRepositoryData(env, request);
        return jsonResponse(
          {
            profile,
            account,
            records,
            standards: REFERENCE_STANDARDS,
            providers: SUPPORTED_PROVIDERS,
          },
          requestId
        );
      }

      // 2. PUT /api/profile (also accept POST /api/profile)
      if (path === '/api/profile') {
        if (request.method !== 'PUT' && request.method !== 'POST') {
          return createErrorResponse('METHOD_NOT_ALLOWED', requestId, { route: path });
        }
        const parsed = await parseJsonBody<Partial<UserProfile>>(request, requestId, path);
        if (parsed.errorResponse) return parsed.errorResponse;
        const body = parsed.data!;

        const repo = await getRepositoryData(env, request);
        if (!repo.authenticated || repo.userId === null) {
          return createErrorResponse('AUTH_SESSION_REQUIRED', requestId, { route: path });
        }
        const secErr = verifyMutationSecurityHeaders(request, repo.account.csrf_token, requestId, path);
        if (secErr) return secErr;

        const { useD1, userId, profile: currentProfile } = repo;

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
          id: userId,
          name: body.name !== undefined ? String(body.name).trim() || currentProfile.name : currentProfile.name,
          birth_year:
            body.birth_year !== undefined
              ? body.birth_year
                ? Number(body.birth_year)
                : null
              : currentProfile.birth_year,
          age: body.age !== undefined ? Number(body.age) : currentProfile.age,
          sex: validSex,
          height_cm: body.height_cm !== undefined ? Number(body.height_cm) : currentProfile.height_cm,
          chronic_conditions:
            body.chronic_conditions !== undefined ? String(body.chronic_conditions) : currentProfile.chronic_conditions,
          medications: body.medications !== undefined ? String(body.medications) : currentProfile.medications,
          preferred_provider: validProvider,
          preferred_model:
            body.preferred_model !== undefined ? String(body.preferred_model) : currentProfile.preferred_model,
          visible_item_codes:
            body.visible_item_codes !== undefined
              ? parseVisibleItemCodes(body.visible_item_codes)
              : currentProfile.visible_item_codes || [],
          updated_at: new Date().toISOString(),
        };

        if (useD1 && env.DB) {
          await upsertProfileToD1(env.DB, userId, updated);
          await env.DB.prepare(`UPDATE users SET display_name = ? WHERE id = ?`)
            .bind(updated.name, userId)
            .run();
        } else {
          const prevProfile = memoryStore.profilesByUserId.get(userId) || currentProfile;
          const sexChanged = prevProfile.sex !== updated.sex;
          memoryStore.profilesByUserId.set(userId, updated);
          if (userId === 1) {
            memoryStore.profile = updated;
            memoryStore.account.display_name = updated.name;
          }
          if (sexChanged) {
            memoryStore.records = memoryStore.records.map((rec) =>
              (rec.user_id ?? 1) === userId ? recalculateRecordsForSex([rec], updated.sex)[0] : rec
            );
          }
        }

        return jsonResponse(updated, requestId);
      }

      // 3. POST /api/records (supports both 'daily' wellness-only and 'lab' records)
      if (path === '/api/records') {
        if (request.method !== 'POST') {
          return createErrorResponse('METHOD_NOT_ALLOWED', requestId, { route: path });
        }
        const parsed = await parseJsonBody<Record<string, unknown>>(request, requestId, path);
        if (parsed.errorResponse) return parsed.errorResponse;
        const rawBody = parsed.data!;

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

        const repo = await getRepositoryData(env, request);
        if (!repo.authenticated || repo.userId === null) {
          return createErrorResponse('AUTH_SESSION_REQUIRED', requestId, { route: path });
        }
        const secErr = verifyMutationSecurityHeaders(request, repo.account.csrf_token, requestId, path);
        if (secErr) return secErr;

        const { useD1, userId, profile, records: existingRecords } = repo;

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

        const resolvedRecordType: RecordType =
          normalizedItems.length === 0
            ? 'daily'
            : recordPayload.record_type === 'daily'
              ? 'daily'
              : 'lab';

        const symptomTags = normalizeSymptomTags(recordPayload.symptom_tags);
        const defaultFacility = resolvedRecordType === 'daily' ? '日々の体調日記' : '';

        const draftRecord: LabRecord = {
          record_type: resolvedRecordType,
          symptom_tags: symptomTags,
          tested_at:
            typeof recordPayload.tested_at === 'string' && recordPayload.tested_at.trim()
              ? recordPayload.tested_at.trim()
              : new Date().toISOString().slice(0, 10),
          facility_name:
            typeof recordPayload.facility_name === 'string' && recordPayload.facility_name.trim()
              ? recordPayload.facility_name.trim()
              : defaultFacility,
          weight_kg:
            recordPayload.weight_kg !== undefined &&
            recordPayload.weight_kg !== null &&
            String(recordPayload.weight_kg) !== ''
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
          const saved = await insertRecordIntoD1(env.DB, draftRecord, userId);
          return jsonResponse(saved, requestId, 201);
        }

        const recordId = memoryStore.nextRecordId++;
        const savedRecord: StoredLabRecord = {
          ...draftRecord,
          id: recordId,
          user_id: userId,
          items: draftRecord.items.map((it) => ({
            ...it,
            id: memoryStore.nextItemId++,
            record_id: recordId,
          })),
        };
        memoryStore.records.push(savedRecord);
        memoryStore.records.sort((a, b) => b.tested_at.localeCompare(a.tested_at) || (b.id || 0) - (a.id || 0));
        const { user_id: _uid, ...publicSaved } = savedRecord;
        return jsonResponse(publicSaved, requestId, 201);
      }

      // 4. DELETE /api/records/:id
      const deleteMatch = path.match(/^\/api\/records\/(\d+)$/);
      if (deleteMatch) {
        if (request.method !== 'DELETE') {
          return createErrorResponse('METHOD_NOT_ALLOWED', requestId, { route: path });
        }
        const targetId = Number(deleteMatch[1]);
        const repo = await getRepositoryData(env, request);
        if (!repo.authenticated || repo.userId === null) {
          return createErrorResponse('AUTH_SESSION_REQUIRED', requestId, { route: path });
        }
        const secErr = verifyMutationSecurityHeaders(request, repo.account.csrf_token, requestId, path);
        if (secErr) return secErr;

        if (repo.useD1 && env.DB) {
          await env.DB.prepare(
            `DELETE FROM lab_items WHERE record_id = ? AND record_id IN (SELECT id FROM lab_records WHERE id = ? AND user_id = ?)`
          )
            .bind(targetId, targetId, repo.userId)
            .run();
          await env.DB.prepare('DELETE FROM lab_records WHERE id = ? AND user_id = ?')
            .bind(targetId, repo.userId)
            .run();
        } else {
          memoryStore.records = memoryStore.records.filter(
            (r) => !(r.id === targetId && (r.user_id ?? 1) === repo.userId)
          );
        }

        return jsonResponse({ deleted: true, id: targetId }, requestId);
      }

      // 5. POST /api/ocr
      if (path === '/api/ocr') {
        if (request.method !== 'POST') {
          return createErrorResponse('METHOD_NOT_ALLOWED', requestId, { route: path });
        }
        const parsed = await parseJsonBody<{
          imageBase64?: string;
          mimeType?: string;
          rawText?: string;
          provider?: AiProviderName;
          model?: string;
          apiKey?: string;
          sex?: BiologicalSex;
        }>(request, requestId, path);
        if (parsed.errorResponse) return parsed.errorResponse;
        const body = parsed.data!;

        const repo = await getRepositoryData(env, request);
        if (!repo.authenticated || repo.userId === null) {
          return createErrorResponse('AUTH_SESSION_REQUIRED', requestId, { route: path });
        }
        const { profile } = repo;
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
        return jsonResponse(ocrResult, requestId);
      }

      // 6. POST /api/analyze
      if (path === '/api/analyze') {
        if (request.method !== 'POST') {
          return createErrorResponse('METHOD_NOT_ALLOWED', requestId, { route: path });
        }
        const parsed = await parseJsonBody<{
          record: LabRecord;
          history?: LabRecord[];
          profile?: UserProfile;
          provider?: AiProviderName;
          model?: string;
          apiKey?: string;
        }>(request, requestId, path);
        if (parsed.errorResponse) return parsed.errorResponse;
        const body = parsed.data!;

        if (!body.record || typeof body.record !== 'object') {
          return createErrorResponse('REQUEST_INVALID', requestId, { route: path });
        }

        const repo = await getRepositoryData(env, request);
        if (!repo.authenticated || repo.userId === null) {
          return createErrorResponse('AUTH_SESSION_REQUIRED', requestId, { route: path });
        }
        const targetProfile = body.profile || repo.profile;
        const targetHistory = body.history || repo.records;

        const normalizedItems = (body.record?.items || []).map((it) => normalizeLabItem(it, targetProfile.sex));
        const normalizedRecord: LabRecord = {
          ...body.record,
          record_type: normalizedItems.length === 0 ? 'daily' : body.record.record_type || 'lab',
          symptom_tags: normalizeSymptomTags(body.record.symptom_tags),
          items: normalizedItems,
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

        // Update persisted record if it exists in store (owner boundary enforced)
        if (normalizedRecord.id) {
          if (repo.useD1 && env.DB) {
            await env.DB.prepare(
              `UPDATE lab_records
               SET ai_provider = ?, ai_model = ?, ai_summary = ?, ai_correlation = ?, ai_advice = ?
               WHERE id = ? AND user_id = ?`
            )
              .bind(
                result.provider_used,
                result.model_used,
                result.ai_summary,
                result.ai_correlation,
                result.ai_advice,
                normalizedRecord.id,
                repo.userId
              )
              .run();
          } else {
            const idx = memoryStore.records.findIndex(
              (r) => r.id === normalizedRecord.id && (r.user_id ?? 1) === repo.userId
            );
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

        return jsonResponse(result, requestId);
      }

      // 7. GET /api/export/csv and GET /api/export/json
      if (path === '/api/export/csv') {
        if (request.method !== 'GET') {
          return createErrorResponse('METHOD_NOT_ALLOWED', requestId, { route: path });
        }
        const repo = await getRepositoryData(env, request);
        if (!repo.authenticated || repo.userId === null) {
          return createErrorResponse('AUTH_SESSION_REQUIRED', requestId, { route: path });
        }
        const csvContent = buildRecordsCsv(repo.records);
        const raw = new Response(csvContent, {
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="karada-note-records.csv"',
          },
        });
        return finalizeResponse(raw, requestId);
      }

      if (path === '/api/export/json') {
        if (request.method !== 'GET') {
          return createErrorResponse('METHOD_NOT_ALLOWED', requestId, { route: path });
        }
        const repo = await getRepositoryData(env, request);
        if (!repo.authenticated || repo.userId === null) {
          return createErrorResponse('AUTH_SESSION_REQUIRED', requestId, { route: path });
        }
        return jsonResponse(
          {
            exported_at: new Date().toISOString(),
            profile: repo.profile,
            account: repo.account,
            records: repo.records,
          },
          requestId
        );
      }

      if (path.startsWith('/api/')) {
        return createErrorResponse('ROUTE_NOT_FOUND', requestId, { route: path });
      }

      // /invite/:token アクセス時は Referrer-Policy: no-referrer かつ Cache-Control: no-store で SPA ASSETS を返す
      const isInvitePage = path.startsWith('/invite/');
      const extraSpaHeaders: Record<string, string> | undefined = isInvitePage
        ? {
            'Referrer-Policy': 'no-referrer',
            'Cache-Control': 'no-store',
          }
        : undefined;

      // 8. Delegate non-API requests to Cloudflare static assets binding
      if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
        let assetRes = await env.ASSETS.fetch(request);
        if (isInvitePage && assetRes.status === 404) {
          const indexUrl = new URL('/', request.url);
          assetRes = await env.ASSETS.fetch(new Request(indexUrl.toString(), request));
        }
        return finalizeResponse(assetRes, requestId, extraSpaHeaders);
      }

      const rootRes = new Response('からだノート Worker is running.', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
      return finalizeResponse(rootRes, requestId, extraSpaHeaders);
    } catch {
      // 内部エラー（DB例外等）発生時はサーキットブレーカーの失敗カウンタを進め、
      // 生のエラーメッセージや患者データは一切出力せず ADR-030 固定エラーコードを返す
      recordServerFailure();
      return createErrorResponse('INTERNAL', requestId, { route: path });
    }
  },
};
