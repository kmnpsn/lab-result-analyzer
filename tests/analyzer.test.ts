import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  REFERENCE_STANDARDS,
  computeFlag,
  lookupStandard,
  type LabRecord,
} from '../src/shared/types.ts';
import {
  analyzeLabAndWellness,
  computePearsonCorrelation,
  extractLabFromOcr,
  parseLabText,
} from '../worker/ai-providers.ts';
import worker, { createDefaultProfile, resetMemoryStore } from '../worker/index.ts';

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
  it('ピアソン相関係数を正確に算出し、Hb回復と10段階体調スコア改善の相関レポートを生成できる', async () => {
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
    assert.ok(analysis.ai_correlation.includes('相関係数 r='));
    assert.ok(analysis.ai_advice.includes('主治医への確認ポイント'));
    assert.ok(analysis.item_comments.Hb.includes('前回比'));
  });
});

describe('Worker REST API ルーター動作検証 (worker/index.ts)', () => {
  beforeEach(() => {
    resetMemoryStore();
  });

  it('GET /api/bootstrap で初期プロフィール・4回分の採血履歴・基準値マスタ・プロバイダ一覧を返す', async () => {
    const req = new Request('http://localhost/api/bootstrap', { method: 'GET' });
    const res = await worker.fetch(req, {});
    assert.equal(res.status, 200);

    const data = (await res.json()) as {
      profile: { name: string; sex: string };
      records: LabRecord[];
      standards: typeof REFERENCE_STANDARDS;
      providers: string[];
    };

    assert.equal(data.profile.sex, 'male');
    assert.equal(data.records.length, 4);
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
