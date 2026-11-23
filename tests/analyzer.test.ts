import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CONDITION_ITEM_RULES,
  REFERENCE_STANDARDS,
  computeFlag,
  findUnmatchedConditionTerms,
  lookupStandard,
  recommendItemCodesForConditions,
  resolveVisibleItemCodes,
  suggestItemCodesForUnknownCondition,
  type AccountSummary,
  type LabRecord,
} from '../src/shared/types.ts';
import { REQUEST_ID_HEADER } from '../src/shared/error-codes.ts';
import {
  analyzeLabAndWellness,
  computePearsonCorrelation,
  extractLabFromOcr,
  parseLabText,
} from '../worker/ai-providers.ts';
import {
  CIRCUIT_ERROR_THRESHOLD,
  getCircuitState,
  getRecentSecurityLogs,
  resetSecurityState,
  tripCircuitBreaker,
} from '../worker/security.ts';
import worker, {
  createDefaultProfile,
  resetMemoryStore,
  type D1DatabaseLike,
} from '../worker/index.ts';

describe('基準値マスタ・H/N/L 判定ロジック (src/shared/types.ts)', () => {
  it('性別に応じた基準値を取得し、L / N / H フラグを正しく判定できる', () => {
    const maleHb = lookupStandard('Hb', 'male');
    const femaleHb = lookupStandard('Hb', 'female');

    assert.equal(maleHb.refLow, 13.7);
    assert.equal(maleHb.refHigh, 16.8);
    assert.equal(femaleHb.refLow, 11.6);
    assert.equal(femaleHb.refHigh, 14.8);

    // 12.5 g/dL は男性では L（貧血）、女性では N（正常）
    assert.equal(computeFlag(12.5, maleHb.refLow, maleHb.refHigh), 'L');
    assert.equal(computeFlag(12.5, femaleHb.refLow, femaleHb.refHigh), 'N');
    assert.equal(computeFlag(17.5, maleHb.refLow, maleHb.refHigh), 'H');
  });

  it('日本語項目名やコード部分一致でも基準値マスタを検索できる', () => {
    const ferritin = lookupStandard('フェリチン', 'female');
    assert.ok(ferritin.standard);
    assert.equal(ferritin.standard?.code, 'Ferritin');
    assert.equal(ferritin.refLow, 12);
    assert.equal(ferritin.refHigh, 120);
  });

  it('持病メモ（高尿酸血症・痛風など）から関連検査項目（UA 等）を優先抽出し、表示項目カスタマイズと合成できる', () => {
    assert.ok(DEFAULT_CONDITION_ITEM_RULES.length >= 25);

    const goutRec = recommendItemCodesForConditions('高尿酸血症（痛風）');
    assert.equal(goutRec[0], 'UA');
    assert.ok(goutRec.includes('Cr'));
    assert.ok(goutRec.includes('eGFR'));

    // IBD（潰瘍性大腸炎）・IBS・脊柱管狭窄症・坐骨神経痛も標準搭載されている
    const ucRec = recommendItemCodesForConditions('潰瘍性大腸炎');
    assert.ok(ucRec.includes('CRP'));
    assert.ok(ucRec.includes('Alb'));
    const ibsRec = recommendItemCodesForConditions('過敏性腸症候群 (IBS)');
    assert.ok(ibsRec.includes('CRP'));
    const spineRec = recommendItemCodesForConditions('脊柱管狭窄症・坐骨神経痛');
    assert.ok(spineRec.includes('CRP'));
    assert.ok(spineRec.includes('Cr'));

    // 未登録の病名を自動検出し、採血関連項目を提案できる
    const unmatched = findUnmatchedConditionTerms('潰瘍性大腸炎、サルコイドーシス病');
    assert.deepEqual(unmatched, ['サルコイドーシス病']);
    const sug = suggestItemCodesForUnknownCondition('サルコイドーシス病');
    assert.ok(sug);
    assert.ok(sug!.suggested_codes.includes('CRP'));

    // 未設定時は持病おすすめ (UA) が最上位に来る
    const autoVisible = resolveVisibleItemCodes('高尿酸血症（痛風）', []);
    assert.equal(autoVisible[0], 'UA');

    // ユーザーがトグルで絞った場合、その設定を尊重しつつ持病おすすめを上位に並べる
    const customVisible = resolveVisibleItemCodes('高尿酸血症（痛風）', ['HbA1c', 'UA', 'ALT']);
    assert.deepEqual(customVisible, ['UA', 'HbA1c', 'ALT']);
  });
});

describe('OCR テキスト抽出 & プリセットフォールバック (worker/ai-providers.ts)', () => {
  it('検査結果テキストから採血日・医療機関名・各検査項目・H/L判定を抽出できる', () => {
    const sampleText = `
      採血日: 2026/10/25
      医療機関: 青山ライフクリニック
      WBC 6100 /μL
      Hb 11.4 g/dL
      フェリチン 10.2 ng/mL
      ALT (GPT) 52 U/L
      CRP 0.45 mg/dL
      eGFR 78.0 mL/min/1.73m²
      HbA1c 5.6 %
    `;

    const parsed = parseLabText(sampleText, 'male');
    assert.equal(parsed.tested_at, '2026-10-25');
    assert.equal(parsed.facility_name, '青山ライフクリニック');
    assert.equal(parsed.items.length, 7);

    const hb = parsed.items.find((i) => i.item_code === 'Hb');
    assert.ok(hb);
    assert.equal(hb.value, 11.4);
    assert.equal(hb.flag, 'L');

    const alt = parsed.items.find((i) => i.item_code === 'ALT');
    assert.ok(alt);
    assert.equal(alt.value, 52);
    assert.equal(alt.flag, 'H');

    const crp = parsed.items.find((i) => i.item_code === 'CRP');
    assert.ok(crp);
    assert.equal(crp.value, 0.45);
    assert.equal(crp.flag, 'H');
  });

  it('APIキー未設定かつテキスト無しの場合は持病管理向けプリセットOCR結果を返す', async () => {
    const ocrRes = await extractLabFromOcr({
      sex: 'female',
      provider: 'claude',
    });

    assert.equal(ocrRes.source, 'preset');
    assert.equal(ocrRes.provider_used, 'claude');
    assert.ok(ocrRes.items.length >= 10);
    const hb = ocrRes.items.find((i) => i.item_code === 'Hb');
    assert.ok(hb);
    // 女性基準 (11.6 - 14.8) で 12.1 は N
    assert.equal(hb.flag, 'N');
  });
});

describe('主観10段階スコアと採血推移の相関分析エンジン (worker/ai-providers.ts)', () => {
  it('ピアソン相関係数を正確に算出し、Hb回復と汎用5軸体調スコア改善の相関レポートを生成できる', async () => {
    const r = computePearsonCorrelation([11.0, 12.2, 13.5, 14.2], [3, 5, 7, 9]);
    assert.ok(r !== null && r > 0.95);

    const profile = createDefaultProfile();
    const history: LabRecord[] = [
      {
        id: 1,
        tested_at: '2026-04-01',
        facility_name: 'テスト医院',
        weight_kg: 67.0,
        overall_score: 3,
        fatigue_score: 2,
        sleep_score: 4,
        pain_score: 4,
        appetite_score: 5,
        condition_note: '強いだるさ',
        items: [
          { category: '血球・貧血', item_code: 'Hb', item_name: 'ヘモグロビン (Hb)', value: 10.8, unit: 'g/dL', ref_low: 13.7, ref_high: 16.8, flag: 'L' },
          { category: '血球・貧血', item_code: 'Ferritin', item_name: 'フェリチン', value: 9.0, unit: 'ng/mL', ref_low: 20, ref_high: 250, flag: 'L' },
          { category: '血球・炎症', item_code: 'CRP', item_name: 'CRP', value: 0.48, unit: 'mg/dL', ref_low: 0.0, ref_high: 0.14, flag: 'H' },
        ],
      },
      {
        id: 2,
        tested_at: '2026-07-01',
        facility_name: 'テスト医院',
        weight_kg: 66.2,
        overall_score: 6,
        fatigue_score: 6,
        sleep_score: 6,
        pain_score: 7,
        appetite_score: 7,
        condition_note: '鉄剤で改善傾向',
        items: [
          { category: '血球・貧血', item_code: 'Hb', item_name: 'ヘモグロビン (Hb)', value: 12.6, unit: 'g/dL', ref_low: 13.7, ref_high: 16.8, flag: 'L' },
          { category: '血球・貧血', item_code: 'Ferritin', item_name: 'フェリチン', value: 25.0, unit: 'ng/mL', ref_low: 20, ref_high: 250, flag: 'N' },
          { category: '血球・炎症', item_code: 'CRP', item_name: 'CRP', value: 0.16, unit: 'mg/dL', ref_low: 0.0, ref_high: 0.14, flag: 'H' },
        ],
      },
    ];

    const currentRecord: LabRecord = {
      id: 3,
      tested_at: '2026-10-01',
      facility_name: 'テスト医院',
      weight_kg: 65.5,
      overall_score: 9,
      fatigue_score: 9,
      sleep_score: 8,
      pain_score: 9,
      appetite_score: 9,
      condition_note: '快調',
      items: [
        { category: '血球・貧血', item_code: 'Hb', item_name: 'ヘモグロビン (Hb)', value: 14.2, unit: 'g/dL', ref_low: 13.7, ref_high: 16.8, flag: 'N' },
        { category: '血球・貧血', item_code: 'Ferritin', item_name: 'フェリチン', value: 48.0, unit: 'ng/mL', ref_low: 20, ref_high: 250, flag: 'N' },
        { category: '血球・炎症', item_code: 'CRP', item_name: 'CRP', value: 0.04, unit: 'mg/dL', ref_low: 0.0, ref_high: 0.14, flag: 'N' },
      ],
    };

    const analysis = await analyzeLabAndWellness({
      record: currentRecord,
      history,
      profile,
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    assert.equal(analysis.provider_used, 'openai');
    assert.equal(analysis.model_used, 'gpt-4o-mini');
    assert.ok(analysis.ai_summary.includes('全 3 項目'));
    assert.ok(analysis.ai_correlation.includes('全体の調子'));
    assert.ok(analysis.ai_correlation.includes('からだの快適さ（不調のなさ）'));
    assert.ok(analysis.ai_correlation.includes('相関係数 r='));
    assert.ok(analysis.ai_advice.includes('主治医への確認ポイント'));
    assert.ok(analysis.item_comments.Hb.includes('前回比'));
  });
});

describe('Worker REST API ルーター動作検証 (worker/index.ts)', () => {
  beforeEach(() => {
    resetMemoryStore();
  });

  it('GET /api/bootstrap で初期プロフィール・アカウント枠・採血4回＋体調日記3回の計7件・基準値マスタ・プロバイダ一覧を返す', async () => {
    const req = new Request('http://localhost/api/bootstrap', { method: 'GET' });
    const res = await worker.fetch(req, {});
    assert.equal(res.status, 200);

    const data = (await res.json()) as {
      profile: { name: string; sex: string };
      account: AccountSummary;
      records: LabRecord[];
      standards: typeof REFERENCE_STANDARDS;
      providers: string[];
    };

    assert.equal(data.profile.sex, 'male');
    assert.ok(data.account);
    assert.equal(data.account.plan_tier, 'free');
    assert.equal(data.records.length, 7);

    const labRecords = data.records.filter((r) => r.record_type === 'lab');
    const dailyRecords = data.records.filter((r) => r.record_type === 'daily');
    assert.equal(labRecords.length, 4);
    assert.equal(dailyRecords.length, 3);
    assert.ok(dailyRecords.every((r) => r.items.length === 0));
    assert.ok(dailyRecords.some((r) => (r.symptom_tags || '').includes('おなかの不調')));

    assert.equal(data.standards.length, REFERENCE_STANDARDS.length);
    assert.deepEqual(data.providers, ['gemini', 'openai', 'claude']);
  });

  it('PUT /api/profile で性別や持病を更新し、POST /api/records で採血記録の追加とAI相関分析が保存される', async () => {
    const putReq = new Request('http://localhost/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '山田花子',
        age: 42,
        sex: 'female',
        height_cm: 160,
        chronic_conditions: '橋本病・鉄欠乏性貧血',
        preferred_provider: 'claude',
      }),
    });
    const putRes = await worker.fetch(putReq, {});
    assert.equal(putRes.status, 200);
    const updatedProfile = (await putRes.json()) as { name: string; sex: string; preferred_provider: string };
    assert.equal(updatedProfile.name, '山田花子');
    assert.equal(updatedProfile.sex, 'female');
    assert.equal(updatedProfile.preferred_provider, 'claude');

    // 新規採血レコードを POST（ref_low / ref_high 未指定で女性基準値が自動適用されるか検証）
    const postReq = new Request('http://localhost/api/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tested_at: '2026-11-20',
        facility_name: '渋谷内分泌クリニック',
        weight_kg: 52.4,
        overall_score: 4,
        fatigue_score: 3,
        sleep_score: 5,
        pain_score: 6,
        appetite_score: 6,
        symptom_tags: 'だるさ・疲労, 通院・採血日',
        condition_note: '寒気と午後の眠気が強い',
        provider: 'claude',
        items: [
          { item_code: 'Hb', item_name: 'ヘモグロビン', value: 10.9, unit: 'g/dL', ref_low: null, ref_high: null },
          { item_code: 'TSH', item_name: 'TSH', value: 6.8, unit: 'μIU/mL', ref_low: null, ref_high: null },
        ],
      }),
    });

    const postRes = await worker.fetch(postReq, {});
    assert.equal(postRes.status, 201);
    const saved = (await postRes.json()) as LabRecord;
    assert.ok(saved.id);
    assert.equal(saved.record_type, 'lab');
    assert.equal(saved.symptom_tags, 'だるさ・疲労, 通院・採血日');
    assert.equal(saved.ai_provider, 'claude');
    assert.ok(saved.ai_summary && saved.ai_summary.length > 10);
    assert.ok(saved.ai_correlation && saved.ai_correlation.includes('橋本病'));

    const hbItem = saved.items.find((i) => i.item_code === 'Hb');
    assert.ok(hbItem);
    assert.equal(hbItem.ref_low, 11.6); // 女性基準下限
    assert.equal(hbItem.flag, 'L');

    const tshItem = saved.items.find((i) => i.item_code === 'TSH');
    assert.ok(tshItem);
    assert.equal(tshItem.flag, 'H');

    // DELETE /api/records/:id で削除できることを確認
    const delReq = new Request(`http://localhost/api/records/${saved.id}`, { method: 'DELETE' });
    const delRes = await worker.fetch(delReq, {});
    assert.equal(delRes.status, 200);
    const delData = (await delRes.json()) as { deleted: boolean };
    assert.equal(delData.deleted, true);
  });

  it('POST /api/records で採血項目が0件（items: []）の日々の体調日記（record_type: "daily"）を登録・取得・CSV出力できる', async () => {
    const dailyReq = new Request('http://localhost/api/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        record_type: 'daily',
        tested_at: '2026-11-18',
        weight_kg: 65.0,
        overall_score: 6,
        fatigue_score: 5,
        pain_score: 4,
        sleep_score: 7,
        appetite_score: 6,
        symptom_tags: 'おなかの不調, お薬の変更',
        condition_note: '朝から少しおなかの張りがあったが、夕方には落ち着いた。',
        items: [],
      }),
    });

    const dailyRes = await worker.fetch(dailyReq, {});
    assert.equal(dailyRes.status, 201);
    const savedDaily = (await dailyRes.json()) as LabRecord;
    assert.ok(savedDaily.id);
    assert.equal(savedDaily.record_type, 'daily');
    assert.equal(savedDaily.items.length, 0);
    assert.equal(savedDaily.symptom_tags, 'おなかの不調, お薬の変更');
    assert.equal(savedDaily.facility_name, '日々の体調日記');
    assert.ok(savedDaily.ai_summary?.includes('日々の体調日記'));
    assert.ok(savedDaily.ai_correlation?.includes('からだの快適さ（不調のなさ）'));
    assert.ok(savedDaily.ai_advice?.includes('主治医への確認ポイント'));

    // GET /api/export/csv で UTF-8 BOM 付き CSV が出力されることを確認
    const csvReq = new Request('http://localhost/api/export/csv', { method: 'GET' });
    const csvRes = await worker.fetch(csvReq, {});
    assert.equal(csvRes.status, 200);
    const csvBytes = new Uint8Array(await csvRes.clone().arrayBuffer());
    assert.deepEqual(Array.from(csvBytes.slice(0, 3)), [0xef, 0xbb, 0xbf]);
    const csvText = await csvRes.text();
    assert.ok(csvText.includes('日付,記録種別'));
    assert.ok(csvText.includes('体調日記'));
    assert.ok(csvText.includes('おなかの不調, お薬の変更'));
  });

  it('POST /api/ocr と POST /api/analyze が正常に構造化データと再分析結果を返す', async () => {
    const ocrReq = new Request('http://localhost/api/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rawText: '採血日: 2026-11-15\n施設名: 品川メディカルクリニック\nHb 11.8 g/dL\nCRP 0.35 mg/dL',
        sex: 'male',
        provider: 'gemini',
      }),
    });
    const ocrRes = await worker.fetch(ocrReq, {});
    assert.equal(ocrRes.status, 200);
    const ocrJson = (await ocrRes.json()) as {
      tested_at: string;
      facility_name: string;
      items: Array<{ item_code: string; flag: string }>;
    };
    assert.equal(ocrJson.tested_at, '2026-11-15');
    assert.equal(ocrJson.facility_name, '品川メディカルクリニック');
    assert.equal(ocrJson.items.length, 2);

    const analyzeReq = new Request('http://localhost/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        model: 'gpt-4o-mini',
        record: {
          tested_at: '2026-11-15',
          facility_name: '品川メディカルクリニック',
          weight_kg: 66.0,
          overall_score: 5,
          fatigue_score: 4,
          sleep_score: 6,
          pain_score: 5,
          appetite_score: 7,
          condition_note: '軽度だるさあり',
          items: ocrJson.items,
        },
      }),
    });
    const analyzeRes = await worker.fetch(analyzeReq, {});
    assert.equal(analyzeRes.status, 200);
    const analyzeJson = (await analyzeRes.json()) as {
      ai_summary: string;
      ai_correlation: string;
      ai_advice: string;
      item_comments: Record<string, string>;
      provider_used: string;
    };
    assert.equal(analyzeJson.provider_used, 'openai');
    assert.ok(analyzeJson.ai_summary.includes('高値(H) 1 項目'));
    assert.ok(analyzeJson.ai_summary.includes('低値(L) 1 項目'));
    assert.ok(analyzeJson.item_comments.Hb);
    assert.ok(analyzeJson.item_comments.CRP);
  });
});

describe('3段構えのセキュリティ防御・サーキットブレーカー・ADR-030 構造化エラー (worker/security.ts)', () => {
  beforeEach(() => {
    resetMemoryStore();
    resetSecurityState();
  });

  it('第1段: 全レスポンスにブラウザセキュリティヘッダー（CSP, HSTS, X-Frame-Options, nosniff, Permissions-Policy）と x-karada-request-id が付与される', async () => {
    const req = new Request('http://localhost/api/bootstrap', { method: 'GET' });
    const res = await worker.fetch(req, {});
    assert.equal(res.status, 200);

    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.ok(res.headers.get('strict-transport-security')?.includes('max-age=31536000'));
    assert.ok(res.headers.get('permissions-policy')?.includes('camera=(self)'));
    assert.ok(res.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
    assert.ok(res.headers.get(REQUEST_ID_HEADER)?.startsWith('req_'));
  });

  it('第2段（手動メンテナンススイッチ）: MAINTENANCE_MODE=on のとき DB に一切触れず 503 SERVICE_PAUSED を返す', async () => {
    let dbTouched = false;
    const spyDb: D1DatabaseLike = {
      prepare() {
        dbTouched = true;
        throw new Error('DB should not be touched during maintenance mode');
      },
    };

    const req = new Request('http://localhost/api/bootstrap', { method: 'GET' });
    const res = await worker.fetch(req, {
      MAINTENANCE_MODE: 'on',
      DB: spyDb,
    });

    assert.equal(res.status, 503);
    assert.equal(dbTouched, false);
    assert.equal(res.headers.get('Retry-After'), '300');

    const body = (await res.json()) as { error: { code: string; requestId: string } };
    assert.equal(body.error.code, 'SERVICE_PAUSED');
    assert.ok(body.error.requestId.startsWith('req_'));
  });

  it('第3段（オート・サーキットブレーカー）: 短時間の連続内部エラー発生時に自動でサーキットが開き、以降の DB アクセスを遮断して 503 CIRCUIT_OPEN を返す', async () => {
    let dbCallCount = 0;
    const failingDb: D1DatabaseLike = {
      prepare() {
        dbCallCount++;
        throw new Error('D1 connection failure: secret_patient_note=クローン病再燃の疑い');
      },
    };

    // 閾値（10回）まで連続内部エラーを発生させる
    for (let i = 0; i < CIRCUIT_ERROR_THRESHOLD; i++) {
      const req = new Request('http://localhost/api/bootstrap', { method: 'GET' });
      const res = await worker.fetch(req, { DB: failingDb });
      assert.equal(res.status, 500);
      const errBody = (await res.json()) as { error: { code: string; requestId: string } };
      assert.equal(errBody.error.code, 'INTERNAL');
    }

    assert.equal(dbCallCount, CIRCUIT_ERROR_THRESHOLD);
    assert.equal(getCircuitState().open, true);
    assert.equal(getCircuitState().reason, 'error_spike');

    // 11回目のリクエストはサーキットブレーカーにより DB に一切触れず 503 CIRCUIT_OPEN になる
    const blockedReq = new Request('http://localhost/api/bootstrap', { method: 'GET' });
    const blockedRes = await worker.fetch(blockedReq, { DB: failingDb });
    assert.equal(blockedRes.status, 503);
    assert.equal(dbCallCount, CIRCUIT_ERROR_THRESHOLD); // DB 呼び出し回数が増えていないことを検証
    assert.equal(blockedRes.headers.get('Retry-After'), '60');

    const blockedBody = (await blockedRes.json()) as { error: { code: string; requestId: string } };
    assert.equal(blockedBody.error.code, 'CIRCUIT_OPEN');

    // ADR-030: 構造化ログに検査値や患者メモ等の個人情報が一切含まれていないことを検証
    const logs = getRecentSecurityLogs();
    assert.ok(logs.length > 0);
    for (const logEntry of logs) {
      const serialized = JSON.stringify(logEntry);
      assert.ok(!serialized.includes('クローン病'));
      assert.ok(!serialized.includes('secret_patient_note'));
      assert.deepEqual(Object.keys(logEntry).sort(), [
        'code',
        'level',
        'requestId',
        'route',
        'status',
        'timestamp',
      ]);
    }

    // リセット後は再び正常応答に戻ることを確認
    resetSecurityState();
    assert.equal(getCircuitState().open, false);
    const okRes = await worker.fetch(new Request('http://localhost/api/bootstrap', { method: 'GET' }), {});
    assert.equal(okRes.status, 200);
  });

  it('ADR-030 構造化エラー応答: 不正JSON・未定義ルート・メソッド不一致に対して固定エラーコードのみを返す', async () => {
    // 1. 不正JSON -> 400 REQUEST_INVALID
    const invalidRes = await worker.fetch(
      new Request('http://localhost/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ invalid json ',
      }),
      {}
    );
    assert.equal(invalidRes.status, 400);
    const invalidJson = (await invalidRes.json()) as { error: { code: string; requestId: string } };
    assert.equal(invalidJson.error.code, 'REQUEST_INVALID');

    // 2. 未定義ルート -> 404 ROUTE_NOT_FOUND
    const notFoundRes = await worker.fetch(
      new Request('http://localhost/api/unknown-endpoint', { method: 'GET' }),
      {}
    );
    assert.equal(notFoundRes.status, 404);
    const notFoundJson = (await notFoundRes.json()) as { error: { code: string; requestId: string } };
    assert.equal(notFoundJson.error.code, 'ROUTE_NOT_FOUND');

    // 3. 許可されていないメソッド -> 405 METHOD_NOT_ALLOWED
    const methodRes = await worker.fetch(
      new Request('http://localhost/api/bootstrap', { method: 'DELETE' }),
      {}
    );
    assert.equal(methodRes.status, 405);
    const methodJson = (await methodRes.json()) as { error: { code: string; requestId: string } };
    assert.equal(methodJson.error.code, 'METHOD_NOT_ALLOWED');

    // 4. 手動 tripCircuitBreaker 発火テスト
    tripCircuitBreaker('manual');
    const circuitRes = await worker.fetch(
      new Request('http://localhost/api/bootstrap', { method: 'GET' }),
      {}
    );
    assert.equal(circuitRes.status, 503);
    const circuitJson = (await circuitRes.json()) as { error: { code: string; requestId: string } };
    assert.equal(circuitJson.error.code, 'CIRCUIT_OPEN');
  });
});

describe('本番ログイン・初回Owner・招待制・SNS後追い連携 (worker/auth.ts)', () => {
  beforeEach(() => {
    resetMemoryStore();
    resetSecurityState();
  });

  it('GET /api/bootstrap と GET /api/auth/session に linked_identities / invitations / service_role / csrf_token が含まれる', async () => {
    const bootRes = await worker.fetch(new Request('http://localhost/api/bootstrap'), {});
    assert.equal(bootRes.status, 200);
    const bootData = (await bootRes.json()) as { account: AccountSummary };
    assert.equal(bootData.account.authenticated, true);
    assert.equal(bootData.account.service_role, 'admin');
    assert.ok(bootData.account.csrf_token);
    assert.ok(Array.isArray(bootData.account.linked_identities));
    assert.equal(bootData.account.linked_identities?.length, 1);
    assert.equal(bootData.account.linked_identities?.[0].provider, 'google');
    assert.ok(Array.isArray(bootData.account.invitations));

    const sessionRes = await worker.fetch(new Request('http://localhost/api/auth/session'), {});
    assert.equal(sessionRes.status, 200);
    assert.equal(sessionRes.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(sessionRes.headers.get('cache-control'), 'no-store');
    const sessionData = (await sessionRes.json()) as AccountSummary;
    assert.equal(sessionData.authenticated, true);
    assert.equal(sessionData.service_role, 'admin');
    assert.equal(sessionData.linked_identities?.length, 1);
  });

  it('初回Owner登録 (BOOTSTRAP_OWNER_EMAIL): 管理者不在時に BOOTSTRAP_OWNER_EMAIL 一致で admin 登録でき、未招待の別メールは 403 で拒否される', async () => {
    const env = {
      BOOTSTRAP_OWNER_EMAIL: 'first-owner@example.com',
      REGISTRATION_MODE: 'invite_only' as const,
    };

    // 1. BOOTSTRAP_OWNER_EMAIL と異なる未招待メールは 403 で拒否
    const strangerRes = await worker.fetch(
      new Request(
        'http://localhost/api/auth/google/start?mock_email=stranger@example.com&mock_sub=sub-stranger-1'
      ),
      env
    );
    assert.equal(strangerRes.status, 403);
    const strangerBody = (await strangerRes.json()) as { authenticated: boolean; reason: string };
    assert.equal(strangerBody.authenticated, false);
    assert.equal(strangerBody.reason, 'not_invited');

    // 2. BOOTSTRAP_OWNER_EMAIL と一致するメールは招待なしで初回 Owner (service_role='admin') として登録される
    const ownerRes = await worker.fetch(
      new Request(
        'http://localhost/api/auth/google/start?mock_email=first-owner@example.com&mock_sub=sub-owner-1&mock_name=初代オーナー'
      ),
      env
    );
    assert.equal(ownerRes.status, 200);
    const setCookie = ownerRes.headers.get('set-cookie') || '';
    assert.ok(setCookie.includes('__Host-karada_session='));
    const ownerData = (await ownerRes.json()) as AccountSummary & { is_new_user: boolean };
    assert.equal(ownerData.authenticated, true);
    assert.equal(ownerData.service_role, 'admin');
    assert.equal(ownerData.email, 'first-owner@example.com');
    assert.equal(ownerData.is_new_user, true);

    // 3. 初回Owner登録後は、別の未登録ユーザーが招待なしでアクセスしても 403 で拒否される
    const secondRes = await worker.fetch(
      new Request(
        'http://localhost/api/auth/google/callback?mock_email=second@example.com&mock_sub=sub-second-1'
      ),
      env
    );
    assert.equal(secondRes.status, 403);
  });

  it('Google OIDC 本番設定時は PKCE (S256) + state + nonce + __Host-karada_oauth Cookie 付きで 302 リダイレクトする', async () => {
    const prodEnv = {
      AUTH_MODE: 'production' as const,
      GOOGLE_CLIENT_ID: 'my-google-client-id.apps.googleusercontent.com',
      GOOGLE_REDIRECT_URI: 'https://karada.example.com/api/auth/google/callback',
      OAUTH_TRANSACTION_SECRET: 'test-oauth-tx-secret',
    };

    const startRes = await worker.fetch(
      new Request('https://karada.example.com/api/auth/google/start?invite=sample_token_123'),
      prodEnv
    );
    assert.equal(startRes.status, 302);
    assert.equal(startRes.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(startRes.headers.get('cache-control'), 'no-store');

    const location = startRes.headers.get('location') || '';
    assert.ok(location.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'));
    const authUrl = new URL(location);
    assert.equal(authUrl.searchParams.get('client_id'), prodEnv.GOOGLE_CLIENT_ID);
    assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(authUrl.searchParams.get('code_challenge'));
    assert.ok(authUrl.searchParams.get('state'));
    assert.ok(authUrl.searchParams.get('nonce'));

    const oauthCookie = startRes.headers.get('set-cookie') || '';
    assert.ok(oauthCookie.includes('__Host-karada_oauth='));
  });

  it('招待リンク作成・検証・別メール拒否・受諾（原子的消費）・再利用拒否・期限切れ/取消拒否が一貫して動作する', async () => {
    // 1. Owner が招待リンクを作成
    const createInvRes = await worker.fetch(
      new Request('http://localhost/api/auth/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'Family.Member@example.com',
          note: '家族用の招待',
          expiresInDays: 7,
        }),
      }),
      {}
    );
    assert.equal(createInvRes.status, 201);
    const invPayload = (await createInvRes.json()) as {
      invitation: { token_preview: string; status: string; email_display: string };
      invite_url: string;
    };
    assert.ok(invPayload.invite_url.startsWith('http://localhost/invite/'));
    assert.equal(invPayload.invitation.status, 'pending');
    const rawToken = invPayload.invite_url.split('/invite/')[1];
    assert.ok(rawToken && rawToken.length >= 32);

    // 2. /invite/:token ページアクセス時に Referrer-Policy: no-referrer & Cache-Control: no-store が付与される
    const pageRes = await worker.fetch(
      new Request(`http://localhost/invite/${rawToken}`, { method: 'GET' }),
      {}
    );
    assert.equal(pageRes.status, 200);
    assert.equal(pageRes.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(pageRes.headers.get('cache-control'), 'no-store');

    // 3. GET /api/invite/:token/verify で有効と判定される
    const verifyRes = await worker.fetch(
      new Request(`http://localhost/api/invite/${rawToken}/verify`),
      {}
    );
    assert.equal(verifyRes.status, 200);
    assert.equal(verifyRes.headers.get('referrer-policy'), 'no-referrer');
    const verifyJson = (await verifyRes.json()) as {
      valid: boolean;
      email_hint: string;
      reason?: string;
    };
    assert.equal(verifyJson.valid, true);
    assert.ok(verifyJson.email_hint.includes('@example.com'));

    // 4. 招待されていない別メールアドレスで受諾しようとすると 403 で拒否され、招待は消費されない
    const wrongEmailRes = await worker.fetch(
      new Request(
        `http://localhost/api/auth/google/start?invite=${rawToken}&mock_email=other@example.com&mock_sub=sub-other`
      ),
      {}
    );
    assert.equal(wrongEmailRes.status, 403);
    const wrongEmailJson = (await wrongEmailRes.json()) as { reason: string };
    assert.equal(wrongEmailJson.reason, 'email_mismatch');

    // 5. 正しいメールアドレスで招待を受諾すると service_role='user' で新規作成・ログインできる
    const acceptRes = await worker.fetch(
      new Request(
        `http://localhost/api/auth/google/start?invite=${rawToken}&mock_email=family.member@example.com&mock_sub=sub-family-1&mock_name=家族メンバー`
      ),
      {}
    );
    assert.equal(acceptRes.status, 200);
    const acceptData = (await acceptRes.json()) as AccountSummary;
    assert.equal(acceptData.authenticated, true);
    assert.equal(acceptData.service_role, 'user');
    assert.equal(acceptData.email, 'family.member@example.com');

    // 6. 消費済みの招待トークンを再度 verify すると valid: false, reason: 'used' になり再利用も 403 になる
    const verifyUsedRes = await worker.fetch(
      new Request(`http://localhost/api/invite/${rawToken}/verify`),
      {}
    );
    const verifyUsedJson = (await verifyUsedRes.json()) as { valid: boolean; reason?: string };
    assert.equal(verifyUsedJson.valid, false);
    assert.equal(verifyUsedJson.reason, 'used');

    const reuseRes = await worker.fetch(
      new Request(
        `http://localhost/api/auth/google/start?invite=${rawToken}&mock_email=family.member@example.com&mock_sub=sub-family-2`
      ),
      {}
    );
    assert.equal(reuseRes.status, 403);

    // 7. 一般ユーザー (service_role='user') は招待リンクを作成できない (403 AUTH_NOT_ADMIN)
    const nonAdminInvRes = await worker.fetch(
      new Request('http://localhost/api/auth/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'another@example.com' }),
      }),
      {}
    );
    assert.equal(nonAdminInvRes.status, 403);
  });

  it('招待の取り消し (revoked) および期限切れ (expired) が正しく拒否される', async () => {
    // 1. 招待作成と取り消し
    const createRes = await worker.fetch(
      new Request('http://localhost/api/auth/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'revoke-target@example.com', note: '取消テスト' }),
      }),
      {}
    );
    const created = (await createRes.json()) as {
      invitation: { token_preview: string };
      invite_url: string;
    };
    const token = created.invite_url.split('/invite/')[1];

    const delRes = await worker.fetch(
      new Request(`http://localhost/api/auth/invitations/${created.invitation.token_preview}`, {
        method: 'DELETE',
      }),
      {}
    );
    assert.equal(delRes.status, 200);

    const verifyRevoked = await worker.fetch(
      new Request(`http://localhost/api/invite/${token}/verify`),
      {}
    );
    const verifyRevokedJson = (await verifyRevoked.json()) as { valid: boolean; reason?: string };
    assert.equal(verifyRevokedJson.valid, false);
    assert.equal(verifyRevokedJson.reason, 'revoked');

    const useRevokedRes = await worker.fetch(
      new Request(
        `http://localhost/api/auth/google/start?invite=${token}&mock_email=revoke-target@example.com&mock_sub=sub-revoked`
      ),
      {}
    );
    assert.equal(useRevokedRes.status, 403);

    // 2. 期限切れ (expired) 招待の検証と受諾拒否
    const expCreateRes = await worker.fetch(
      new Request('http://localhost/api/auth/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'expired-target@example.com',
          note: '期限切れテスト',
          expiresInDays: -1,
        }),
      }),
      {}
    );
    const expCreated = (await expCreateRes.json()) as { invite_url: string };
    const expToken = expCreated.invite_url.split('/invite/')[1];

    const verifyExpired = await worker.fetch(
      new Request(`http://localhost/api/invite/${expToken}/verify`),
      {}
    );
    const verifyExpiredJson = (await verifyExpired.json()) as { valid: boolean; reason?: string };
    assert.equal(verifyExpiredJson.valid, false);
    assert.equal(verifyExpiredJson.reason, 'expired');

    const useExpiredRes = await worker.fetch(
      new Request(
        `http://localhost/api/auth/google/start?invite=${expToken}&mock_email=expired-target@example.com&mock_sub=sub-expired`
      ),
      {}
    );
    assert.equal(useExpiredRes.status, 403);
    const useExpiredJson = (await useExpiredRes.json()) as { reason: string };
    assert.equal(useExpiredJson.reason, 'expired');
  });

  it('SNS後追い連携の追加・重複拒否 (409 STATE_CONFLICT)・最後の1件解除拒否 (409 STATE_CONFLICT) が動作する', async () => {
    // 1. 初期状態（Google 1件のみ）で唯一のログイン手段を解除しようとすると 409 STATE_CONFLICT で拒否される
    const unlinkLastRes = await worker.fetch(
      new Request('http://localhost/api/auth/identities/google', { method: 'DELETE' }),
      {}
    );
    assert.equal(unlinkLastRes.status, 409);
    const unlinkLastBody = (await unlinkLastRes.json()) as { error: { code: string; message: string } };
    assert.equal(unlinkLastBody.error.code, 'STATE_CONFLICT');
    assert.ok(unlinkLastBody.error.message.includes('最後のログイン手段は解除できません'));

    // 2. LINE と Apple ID を後追い連携追加する
    const linkLineRes = await worker.fetch(
      new Request('http://localhost/api/auth/identities/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'line',
          provider_subject: 'line-sub-owner-001',
          email: 'owner-line@example.com',
          display_name: 'LINE連携アカウント',
        }),
      }),
      {}
    );
    assert.equal(linkLineRes.status, 200);
    const linkLineData = (await linkLineRes.json()) as {
      linked_identities: Array<{ provider: string; provider_subject: string }>;
    };
    assert.equal(linkLineData.linked_identities.length, 2);
    assert.ok(linkLineData.linked_identities.some((i) => i.provider === 'line'));

    const linkAppleRes = await worker.fetch(
      new Request('http://localhost/api/auth/identities/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'apple',
          provider_subject: 'apple-sub-owner-001',
        }),
      }),
      {}
    );
    assert.equal(linkAppleRes.status, 200);
    const linkAppleData = (await linkAppleRes.json()) as {
      linked_identities: Array<{ provider: string }>;
    };
    assert.equal(linkAppleData.linked_identities.length, 3);

    // 3. 同じ provider / provider_subject を重複連携しようとすると 409 STATE_CONFLICT で拒否される
    const dupRes = await worker.fetch(
      new Request('http://localhost/api/auth/identities/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'line',
          provider_subject: 'line-sub-owner-001',
        }),
      }),
      {}
    );
    assert.equal(dupRes.status, 409);
    const dupBody = (await dupRes.json()) as { error: { code: string } };
    assert.equal(dupBody.error.code, 'STATE_CONFLICT');

    // 4. 別ユーザーが既に連携済みの (provider, provider_subject) を乗っ取り連携しようとしても 409 STATE_CONFLICT で拒否される
    const invRes = await worker.fetch(
      new Request('http://localhost/api/auth/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'user2@example.com' }),
      }),
      {}
    );
    const invData = (await invRes.json()) as { invite_url: string };
    const inviteToken = invData.invite_url.split('/invite/')[1];

    await worker.fetch(
      new Request(
        `http://localhost/api/auth/google/start?invite=${inviteToken}&mock_email=user2@example.com&mock_sub=sub-user2`
      ),
      {}
    );

    const hijackRes = await worker.fetch(
      new Request('http://localhost/api/auth/identities/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'line',
          provider_subject: 'line-sub-owner-001', // User 1 が使用中
        }),
      }),
      {}
    );
    assert.equal(hijackRes.status, 409);
    const hijackBody = (await hijackRes.json()) as { error: { code: string } };
    assert.equal(hijackBody.error.code, 'STATE_CONFLICT');

    // 5. User 1 に戻って複数連携がある状態で LINE を解除すると正常に解除できる
    await worker.fetch(
      new Request('http://localhost/api/auth/google/start?mock_email=owner@example.com&mock_sub=demo-google-sub-001'),
      {}
    );
    const unlinkLineRes = await worker.fetch(
      new Request('http://localhost/api/auth/identities/line', { method: 'DELETE' }),
      {}
    );
    assert.equal(unlinkLineRes.status, 200);
    const unlinkLineData = (await unlinkLineRes.json()) as {
      unlinked: boolean;
      linked_identities: Array<{ provider: string }>;
    };
    assert.equal(unlinkLineData.unlinked, true);
    assert.equal(unlinkLineData.linked_identities.length, 2);
  });

  it('POST /api/auth/logout・POST /api/auth/logout-all・DELETE /api/auth/account が正常に動作する', async () => {
    // 1. DELETE /api/auth/account (デモ初期ユーザー id=1 の場合は初期状態にリセット)
    const resetRes = await worker.fetch(
      new Request('http://localhost/api/auth/account', { method: 'DELETE' }),
      {}
    );
    assert.equal(resetRes.status, 200);
    const resetData = (await resetRes.json()) as { deleted: boolean; reset_demo: boolean };
    assert.equal(resetData.deleted, true);
    assert.equal(resetData.reset_demo, true);

    // 2. POST /api/auth/logout でセッション失効 & Cookie 消去
    const logoutRes = await worker.fetch(
      new Request('http://localhost/api/auth/logout', { method: 'POST' }),
      {}
    );
    assert.equal(logoutRes.status, 200);
    const logoutCookie = logoutRes.headers.get('set-cookie') || '';
    assert.ok(logoutCookie.includes('Max-Age=0'));
    const logoutData = (await logoutRes.json()) as { logged_out: boolean };
    assert.equal(logoutData.logged_out, true);

    // ログアウト直後のセッション確認では authenticated: false になる
    const afterLogoutRes = await worker.fetch(
      new Request('http://localhost/api/auth/session'),
      {}
    );
    const afterLogoutData = (await afterLogoutRes.json()) as AccountSummary;
    assert.equal(afterLogoutData.authenticated, false);

    // 3. 再ログイン後に POST /api/auth/logout-all も正常動作する
    await worker.fetch(
      new Request('http://localhost/api/auth/google/start?mock_email=owner@example.com'),
      {}
    );
    const logoutAllRes = await worker.fetch(
      new Request('http://localhost/api/auth/logout-all', { method: 'POST' }),
      {}
    );
    assert.equal(logoutAllRes.status, 200);
    const logoutAllData = (await logoutAllRes.json()) as { logged_out: boolean; scope: string };
    assert.equal(logoutAllData.logged_out, true);
    assert.equal(logoutAllData.scope, 'all');
  });

  it('本番モード (AUTH_MODE=production) では未ログイン時にデモデータへ繋がらず、新規アカウントはデモデータと完全に分離され削除も正常動作する', async () => {
    const prodEnv = {
      AUTH_MODE: 'production',
      REGISTRATION_MODE: 'invite_only' as const,
      BOOTSTRAP_OWNER_EMAIL: 'real-owner@example.com',
      SESSION_SECRET: 'test-prod-session-secret',
      OAUTH_TRANSACTION_SECRET: 'test-prod-oauth-secret',
    };

    // 1. 未ログインで /api/bootstrap を呼んでもデモアカウント・デモデータ (7件) は一切返らない
    const unauthBootRes = await worker.fetch(new Request('http://localhost/api/bootstrap'), prodEnv);
    assert.equal(unauthBootRes.status, 200);
    const unauthBoot = (await unauthBootRes.json()) as {
      account: AccountSummary;
      records: LabRecord[];
      profile: { name: string; chronic_conditions: string };
    };
    assert.equal(unauthBoot.account.authenticated, false);
    assert.equal(unauthBoot.records.length, 0);
    assert.notEqual(unauthBoot.profile.name, 'サンプル患者');

    // 未ログインでのデータ作成・削除は 401 AUTH_SESSION_REQUIRED
    const unauthPost = await worker.fetch(
      new Request('http://localhost/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tested_at: '2026-11-24', overall_score: 7, items: [] }),
      }),
      prodEnv
    );
    assert.equal(unauthPost.status, 401);

    // 2. 初回 Owner ログイン後はデモデータ 0 件・クリーンプロフィールで開始する
    const ownerLoginRes = await worker.fetch(
      new Request(
        'http://localhost/api/auth/google/start?mock_email=real-owner@example.com&mock_sub=sub-real-owner&mock_name=OwnerTarou'
      ),
      prodEnv
    );
    assert.equal(ownerLoginRes.status, 200);
    const ownerCookie = (ownerLoginRes.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(ownerCookie.startsWith('__Host-karada_session='));

    const ownerBootRes = await worker.fetch(
      new Request('http://localhost/api/bootstrap', { headers: { Cookie: ownerCookie } }),
      prodEnv
    );
    const ownerBoot = (await ownerBootRes.json()) as {
      account: AccountSummary;
      records: LabRecord[];
      profile: { name: string; chronic_conditions: string };
    };
    assert.equal(ownerBoot.account.authenticated, true);
    assert.equal(ownerBoot.account.email, 'real-owner@example.com');
    assert.equal(ownerBoot.records.length, 0);
    assert.equal(ownerBoot.profile.chronic_conditions, '');

    // Owner が体調日記を1件作成 → 削除すると 0 件に戻りデモデータは復活しない
    const ownerCreateRes = await worker.fetch(
      new Request('http://localhost/api/records', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: ownerCookie,
          'X-Karada-CSRF': ownerBoot.account.csrf_token || '',
        },
        body: JSON.stringify({ tested_at: '2026-11-24', overall_score: 8, items: [] }),
      }),
      prodEnv
    );
    assert.equal(ownerCreateRes.status, 201);
    const createdOwnerRec = (await ownerCreateRes.json()) as LabRecord;

    // 3. 招待リンクで新規アカウントを作成 → Owner の記録もデモデータも一切見えない
    const invRes = await worker.fetch(
      new Request('http://localhost/api/auth/invitations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: ownerCookie,
          'X-Karada-CSRF': ownerBoot.account.csrf_token || '',
        },
        body: JSON.stringify({ email: 'invited-member@example.com' }),
      }),
      prodEnv
    );
    const invData = (await invRes.json()) as { invite_url: string };
    const inviteToken = invData.invite_url.split('/invite/')[1];

    const memberLoginRes = await worker.fetch(
      new Request(
        `http://localhost/api/auth/google/start?invite=${inviteToken}&mock_email=invited-member@example.com&mock_sub=sub-member-1&mock_name=MemberHanako`
      ),
      prodEnv
    );
    assert.equal(memberLoginRes.status, 200);
    const memberCookie = (memberLoginRes.headers.get('set-cookie') || '').split(';')[0];

    const memberBootRes = await worker.fetch(
      new Request('http://localhost/api/bootstrap', { headers: { Cookie: memberCookie } }),
      prodEnv
    );
    const memberBoot = (await memberBootRes.json()) as {
      account: AccountSummary;
      records: LabRecord[];
    };
    assert.equal(memberBoot.account.email, 'invited-member@example.com');
    assert.equal(memberBoot.records.length, 0);

    // Member が Owner のレコードを削除しようとしても消えない
    await worker.fetch(
      new Request(`http://localhost/api/records/${createdOwnerRec.id}`, {
        method: 'DELETE',
        headers: {
          Cookie: memberCookie,
          'X-Karada-CSRF': memberBoot.account.csrf_token || '',
        },
      }),
      prodEnv
    );
    const ownerCheckRes = await worker.fetch(
      new Request('http://localhost/api/bootstrap', { headers: { Cookie: ownerCookie } }),
      prodEnv
    );
    const ownerCheck = (await ownerCheckRes.json()) as { records: LabRecord[] };
    assert.equal(ownerCheck.records.length, 1);

    // Owner 自身がレコード削除 → 0 件になりデモデータは復活しない
    const ownerDelRes = await worker.fetch(
      new Request(`http://localhost/api/records/${createdOwnerRec.id}`, {
        method: 'DELETE',
        headers: {
          Cookie: ownerCookie,
          'X-Karada-CSRF': ownerBoot.account.csrf_token || '',
        },
      }),
      prodEnv
    );
    assert.equal(ownerDelRes.status, 200);
    const ownerAfterDel = (await (
      await worker.fetch(
        new Request('http://localhost/api/bootstrap', { headers: { Cookie: ownerCookie } }),
        prodEnv
      )
    ).json()) as { records: LabRecord[] };
    assert.equal(ownerAfterDel.records.length, 0);

    // 4. Member が DELETE /api/auth/account を実行 → 未認証になりデモアカウントに戻らない
    const delAccRes = await worker.fetch(
      new Request('http://localhost/api/auth/account', {
        method: 'DELETE',
        headers: {
          Cookie: memberCookie,
          'X-Karada-CSRF': memberBoot.account.csrf_token || '',
        },
      }),
      prodEnv
    );
    assert.equal(delAccRes.status, 200);
    const delAccData = (await delAccRes.json()) as { deleted: boolean; reset_demo: boolean };
    assert.equal(delAccData.deleted, true);
    assert.equal(delAccData.reset_demo, false);

    const memberAfterDel = (await (
      await worker.fetch(
        new Request('http://localhost/api/bootstrap', { headers: { Cookie: memberCookie } }),
        prodEnv
      )
    ).json()) as { account: AccountSummary; records: LabRecord[] };
    assert.equal(memberAfterDel.account.authenticated, false);
    assert.equal(memberAfterDel.records.length, 0);
  });

  it('持病・症状カスタムマスタ API（自動提案・後追い登録・削除）が正常動作する', async () => {
    // 1. 未登録病名の自動提案
    const sugRes = await worker.fetch(
      new Request('http://localhost/api/condition-rules/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chronic_conditions: '潰瘍性大腸炎、肋間神経痛' }),
      }),
      {}
    );
    assert.equal(sugRes.status, 200);
    const sugData = (await sugRes.json()) as {
      unmatched: string[];
      suggestions: Array<{ term: string; suggested_codes: string[] }>;
    };
    assert.deepEqual(sugData.unmatched, ['肋間神経痛']);
    assert.equal(sugData.suggestions.length, 1);
    assert.ok(sugData.suggestions[0].suggested_codes.includes('CRP'));

    // 2. 後追いマスタ登録
    const createRes = await worker.fetch(
      new Request('http://localhost/api/condition-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: '肋間神経痛',
          keywords: ['肋間神経痛'],
          codes: ['CRP', 'AST', 'Cr'],
          source: 'auto_suggested',
        }),
      }),
      {}
    );
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as { rule: { id: number; label: string }; rules: unknown[] };
    assert.equal(created.rule.label, '肋間神経痛');
    assert.equal(created.rules.length, 1);

    // 3. 登録後は未登録リストから消える
    const sugRes2 = await worker.fetch(
      new Request('http://localhost/api/condition-rules/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chronic_conditions: '潰瘍性大腸炎、肋間神経痛' }),
      }),
      {}
    );
    const sugData2 = (await sugRes2.json()) as { unmatched: string[] };
    assert.equal(sugData2.unmatched.length, 0);

    // 4. 削除できる
    const delRes = await worker.fetch(
      new Request(`http://localhost/api/condition-rules/${created.rule.id}`, { method: 'DELETE' }),
      {}
    );
    assert.equal(delRes.status, 200);
    const delData = (await delRes.json()) as { deleted: boolean; rules: unknown[] };
    assert.equal(delData.deleted, true);
    assert.equal(delData.rules.length, 0);
  });
});
