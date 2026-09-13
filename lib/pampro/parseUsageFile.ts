import crypto from "crypto";
import iconv from "iconv-lite";
import * as xlsx from "xlsx";

/**
 * PamPro "일자별 사용량" Excel(실제로는 CP949 탭 구분 텍스트) 파서.
 *
 * 실제 파일 구조 (sample-data/*.xls 분석 결과):
 *   1행: "[ ATDPS 전송 약품 보고서 ]"  (제목)
 *   2행: "No.\t제품ID\t캐니스터번호\t약품코드\t약품명\t총 사용량\t횟수\t"  (헤더)
 *   3행~: 데이터 (각 줄 끝에 trailing tab)
 *
 * 파서가 처리하는 실제 특성:
 *  - CP949/EUC-KR 인코딩
 *  - 캐니스터번호가 비어있는 행 존재(수동조제) → NO_CASSETTE
 *  - 같은 캐니스터번호가 여러 행에 등장 → 카세트별 합산
 *  - 총 사용량이 소수 가능(159.5)
 *  - 약품코드가 유일하지 않음 → 카세트번호가 매칭 키
 *
 * 다른 export 포맷/진짜 binary xls가 들어오면 이 모듈만 교체하면 된다.
 */

/** 파일에서 읽어낸 원본 한 행. */
export interface RawUsageRow {
  machineName: string;
  cassetteNumber: number | null;
  drugCode: string | null;
  drugName: string;
  cumulativeUsage: number;
  count: number | null;
}

/**
 * (카세트번호 + 약품코드) 기준으로 합산된 사용량.
 * 주의: 같은 캐니스터번호라도 약품코드가 다르면 별도 항목이다.
 * (실제 데이터에서 한 캐니스터가 여러 약품을 조제한 날이 있음 → 병합 금지)
 * 반대로 같은 (번호,코드)에 제조사 표기만 다른 행은 정상 합산된다.
 */
export interface AggregatedUsage {
  machineName: string;
  cassetteNumber: number;
  drugCode: string | null;
  drugName: string;
  cumulativeUsage: number; // 합산값
  count: number | null; // 합산값
  rowCount: number; // 합산에 사용된 원본 행 수
}

/** 카세트번호가 없는(수동조제) 약품 — 카세트 재고 추적에서 제외. */
export interface NonCassetteUsage {
  machineName: string;
  drugCode: string | null;
  drugName: string;
  cumulativeUsage: number;
  count: number | null;
}

export interface ParseResult {
  fileHash: string;
  rawRowCount: number;
  aggregated: AggregatedUsage[];
  nonCassette: NonCassetteUsage[];
  warnings: string[];
}

const HEADER_TOKENS = ["캐니스터번호", "총 사용량"];

/** "1,680" / "159.5" / "" 같은 값을 안전하게 숫자로. 파싱 불가면 null. */
function parseNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/,/g, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseInteger(raw: string | undefined): number | null {
  const n = parseNumber(raw);
  if (n == null) return null;
  return Math.trunc(n);
}

/**
 * 원본 버퍼(파일 바이트)를 파싱한다.
 * fileHash는 항상 "디코딩 전 원본 바이트"로 계산 → 인코딩 판단과 무관하게 동일 파일 식별.
 */
/** OLE2 바이너리 XLS 여부 판별 (매직 바이트 D0 CF 11 E0) */
function isBinaryXls(buf: Buffer): boolean {
  return (
    buf.length >= 4 &&
    buf[0] === 0xd0 &&
    buf[1] === 0xcf &&
    buf[2] === 0x11 &&
    buf[3] === 0xe0
  );
}

/** 바이너리 XLS → 탭 구분 텍스트 라인 배열로 변환 */
function binaryXlsToLines(buf: Buffer): string[] {
  const wb = xlsx.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const aoa: (string | number | null | undefined)[][] = xlsx.utils.sheet_to_json(
    sheet,
    { header: 1, raw: false, defval: "" }
  );
  return aoa.map((row) => row.map((c) => (c == null ? "" : String(c))).join("\t"));
}

export function parseUsageFile(buffer: Buffer): ParseResult {
  const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");
  const warnings: string[] = [];

  let lines: string[];
  if (isBinaryXls(buffer)) {
    lines = binaryXlsToLines(buffer);
  } else {
    // CP949 우선 디코드. (한글이 깨지면 UTF-8도 시도)
    let text = iconv.decode(buffer, "cp949");
    if (text.includes("â") && !text.includes("캐니스터")) {
      text = buffer.toString("utf8");
    }
    lines = text.split(/\r\n|\n|\r/);
  }

  // 헤더 행 탐지 (제목/빈 줄 스킵)
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (HEADER_TOKENS.every((t) => lines[i].includes(t))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new ParseError(
      "PamPro 사용량 파일 형식을 인식하지 못했습니다. (헤더 행을 찾을 수 없음)"
    );
  }

  const header = splitTsv(lines[headerIdx]);
  const col = mapColumns(header);

  const rows: RawUsageRow[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const cells = splitTsv(line);
    // 최소한 약품명 또는 사용량이 있어야 유효 행으로 취급
    const drugName = (cells[col.drugName] ?? "").trim();
    const usage = parseNumber(cells[col.usage]);
    if (drugName === "" && usage == null) continue;

    rows.push({
      machineName: (cells[col.machine] ?? "").trim() || "미상",
      cassetteNumber: parseInteger(cells[col.cassette]),
      drugCode: (cells[col.drugCode] ?? "").trim() || null,
      drugName,
      cumulativeUsage: usage ?? 0,
      count: col.count >= 0 ? parseInteger(cells[col.count]) : null,
    });
  }

  if (rows.length === 0) {
    throw new ParseError("사용량 데이터 행이 없습니다.");
  }

  // 카세트번호 기준 합산 / 비카세트 분리
  const aggMap = new Map<string, AggregatedUsage>();
  const nonCassette: NonCassetteUsage[] = [];

  for (const r of rows) {
    if (r.cassetteNumber == null) {
      nonCassette.push({
        machineName: r.machineName,
        drugCode: r.drugCode,
        drugName: r.drugName,
        cumulativeUsage: r.cumulativeUsage,
        count: r.count,
      });
      continue;
    }
    // 같은 캐니스터라도 약품코드가 다르면 별도 집계(다른 약).
    const key = `${r.machineName}::${r.cassetteNumber}::${r.drugCode ?? ""}`;
    const existing = aggMap.get(key);
    if (existing) {
      existing.cumulativeUsage += r.cumulativeUsage;
      existing.count =
        existing.count == null && r.count == null
          ? null
          : (existing.count ?? 0) + (r.count ?? 0);
      existing.rowCount += 1;
    } else {
      aggMap.set(key, {
        machineName: r.machineName,
        cassetteNumber: r.cassetteNumber,
        drugCode: r.drugCode,
        drugName: r.drugName,
        cumulativeUsage: r.cumulativeUsage,
        count: r.count,
        rowCount: 1,
      });
    }
  }

  const aggregated = Array.from(aggMap.values()).sort(
    (a, b) => a.cassetteNumber - b.cassetteNumber
  );

  const mergedCount = aggregated.filter((a) => a.rowCount > 1).length;
  if (mergedCount > 0) {
    warnings.push(`${mergedCount}개 항목은 제조사 표기가 다른 행이 합산되었습니다.`);
  }
  if (nonCassette.length > 0) {
    warnings.push(
      `${nonCassette.length}개 약품은 캐니스터번호가 없어(수동조제) 재고 추적에서 제외됩니다.`
    );
  }

  // 한 캐니스터번호에 여러 약품코드가 나타난 경우 → 임시 적재/재배정 가능성. 경고.
  const byNumber = new Map<number, Set<string>>();
  for (const a of aggregated) {
    const set = byNumber.get(a.cassetteNumber) ?? new Set<string>();
    set.add(a.drugCode ?? "(없음)");
    byNumber.set(a.cassetteNumber, set);
  }
  const conflicts = Array.from(byNumber.entries()).filter(([, s]) => s.size > 1);
  if (conflicts.length > 0) {
    warnings.push(
      `${conflicts.length}개 캐니스터번호에 서로 다른 약품이 조제되었습니다. ` +
        `마스터 약품과 일치하는 것만 재고에 반영됩니다. ` +
        `(예: #${conflicts
          .slice(0, 3)
          .map(([n]) => n)
          .join(", #")})`
    );
  }

  return {
    fileHash,
    rawRowCount: rows.length,
    aggregated,
    nonCassette,
    warnings,
  };
}

/** 탭 분리. trailing 탭으로 생기는 빈 셀은 그대로 두되 앞뒤 공백만 제거. */
function splitTsv(line: string): string[] {
  return line.split("\t");
}

interface ColumnMap {
  machine: number;
  cassette: number;
  drugCode: number;
  drugName: number;
  usage: number;
  count: number;
}

/** 헤더 텍스트로 컬럼 인덱스를 매핑. 위치가 바뀌어도 이름으로 찾는다. */
function mapColumns(header: string[]): ColumnMap {
  const find = (...names: string[]) =>
    header.findIndex((h) => {
      const t = h.trim();
      return names.some((n) => t === n || t.includes(n));
    });

  const map: ColumnMap = {
    machine: find("제품ID", "호기", "제품"),
    cassette: find("캐니스터번호", "캐니스터", "카세트"),
    drugCode: find("약품코드", "코드"),
    drugName: find("약품명"),
    usage: find("총 사용량", "사용량"),
    count: find("횟수"),
  };

  if (map.cassette === -1 || map.usage === -1 || map.drugName === -1) {
    throw new ParseError(
      "필수 컬럼(캐니스터번호/약품명/총 사용량)을 찾을 수 없습니다."
    );
  }
  return map;
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}
