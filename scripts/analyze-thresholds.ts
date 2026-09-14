/**
 * 기준재고(refillThreshold) 분석 스크립트.
 * 사용: npx tsx scripts/analyze-thresholds.ts
 *
 * sample-data/*.xls 파일들을 파싱해 카세트별 일별 사용량을 계산하고
 * 통계 기반 기준재고 추천값을 출력한다.
 */

import * as fs from "fs";
import * as path from "path";
import { parseUsageFile } from "../lib/pampro/parseUsageFile";

const SAMPLE_DIR = path.join(__dirname, "../sample-data");

// 날짜 파일 우선 정렬 (0801, 0803, ... 형식)
function fileOrder(name: string): number {
  const m = name.match(/^(\d{4})\./);
  if (m) return parseInt(m[1], 10);
  return 9999; // d1, d2 등 날짜 불명 파일은 뒤로
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}


function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── 파일 로드 & 파싱 ──────────────────────────────────────────────
const files = fs
  .readdirSync(SAMPLE_DIR)
  .filter((f) => f.endsWith(".xls"))
  .sort((a, b) => fileOrder(a) - fileOrder(b));

console.log(`\n📂 로드된 파일 ${files.length}개: ${files.join(", ")}\n`);

interface DayData {
  file: string;
  // key: "machineName::cassetteNumber::drugCode"
  cumulative: Map<string, { drugName: string; value: number }>;
}

const days: DayData[] = [];

for (const file of files) {
  const buf = fs.readFileSync(path.join(SAMPLE_DIR, file));
  try {
    const parsed = parseUsageFile(buf);
    const cumulative = new Map<string, { drugName: string; value: number }>();
    for (const a of parsed.aggregated) {
      const key = `${a.machineName}::${a.cassetteNumber}::${a.drugCode ?? ""}`;
      const existing = cumulative.get(key);
      if (!existing || a.cumulativeUsage > existing.value) {
        cumulative.set(key, { drugName: a.drugName, value: a.cumulativeUsage });
      }
    }
    days.push({ file, cumulative });
  } catch (e) {
    console.warn(`⚠️  ${file} 파싱 실패: ${(e as Error).message}`);
  }
}

// ── 일별 사용량 계산 (연속된 날 diff) ────────────────────────────
// key → 일별 사용량 배열
const dailyUsage = new Map<string, { drugName: string; values: number[] }>();

for (let i = 1; i < days.length; i++) {
  const prev = days[i - 1];
  const curr = days[i];

  for (const [key, currData] of curr.cumulative) {
    const prevData = prev.cumulative.get(key);
    if (!prevData) continue; // 전날에 없으면 신규 → skip

    const diff = currData.value - prevData.value;
    if (diff < 0) continue; // 누적값 리셋(월 전환 등) → skip
    if (diff === 0) continue; // 사용 없음 → 0 포함 여부는 아래에서 결정

    const entry = dailyUsage.get(key) ?? { drugName: currData.drugName, values: [] };
    entry.values.push(diff);
    dailyUsage.set(key, entry);
  }
}

// ── 통계 계산 & 출력 ─────────────────────────────────────────────
const CAP_MULTIPLIER = 2.5; // p95 > 평균 × 이 배수이면 캡 적용

interface StatRow {
  key: string;
  drugName: string;
  n: number;
  mean: number;
  p95: number;
  max: number;
  threshold: number;
  capped: boolean; // 캡 적용 여부
}

const rows: StatRow[] = [];

for (const [key, { drugName, values }] of dailyUsage) {
  if (values.length < 3) continue;

  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const p95val = percentile(sorted, 95);

  const cap = mean * CAP_MULTIPLIER;
  const capped = p95val > cap;
  const raw = capped ? cap : p95val;

  // 10단위 올림
  const threshold = Math.ceil(raw / 10) * 10;

  rows.push({
    key,
    drugName,
    n: values.length,
    mean: round1(mean),
    p95: round1(p95val),
    max: sorted[sorted.length - 1],
    threshold,
    capped,
  });
}

rows.sort((a, b) => b.threshold - a.threshold);

const cappedRows = rows.filter((r) => r.capped);

// 헤더
console.log("=".repeat(100));
console.log(
  "카세트 키".padEnd(32) +
  "약품명".padEnd(22) +
  "N".padStart(4) +
  "일평균".padStart(8) +
  "p95".padStart(8) +
  "최대".padStart(7) +
  " │ " +
  "기준재고".padStart(8) +
  "  비고"
);
console.log("=".repeat(100));

for (const r of rows) {
  console.log(
    r.key.padEnd(32) +
    r.drugName.slice(0, 20).padEnd(22) +
    String(r.n).padStart(4) +
    String(r.mean).padStart(8) +
    String(r.p95).padStart(8) +
    String(r.max).padStart(7) +
    " │ " +
    String(r.threshold).padStart(8) +
    (r.capped ? "  ⚠️ 변동 큼 (p95 캡)" : "")
  );
}

console.log("=".repeat(100));
console.log(`\n총 ${rows.length}개 카세트 분석 완료`);
console.log(`\n📊 공식:`);
console.log(`  기준재고 = p95(일사용량) → 10단위 올림`);
console.log(`  단, p95 > 평균 × ${CAP_MULTIPLIER} 이면 평균 × ${CAP_MULTIPLIER}로 캡 (⚠️ 표시)`);
console.log(`  ⚠️ 항목은 변동이 크거나 데이터 부족 → 직접 확인 후 조정 권장`);

if (cappedRows.length > 0) {
  console.log(`\n⚠️  캡 적용 항목 (${cappedRows.length}개) — 직접 확인 권장:`);
  for (const r of cappedRows) {
    console.log(`  ${r.drugName.padEnd(22)} 평균 ${String(r.mean).padStart(6)}, p95 ${String(r.p95).padStart(7)}, 적용 기준재고 ${r.threshold}`);
  }
}
console.log();
