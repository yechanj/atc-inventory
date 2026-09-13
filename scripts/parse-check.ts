import fs from "fs";
import path from "path";
import { parseUsageFile } from "../lib/pampro/parseUsageFile";

const dir = path.join(process.cwd(), "sample-data");
const files = fs
  .readdirSync(dir)
  .filter((f) => f.toLowerCase().endsWith(".xls"))
  .sort();

console.log(`\n=== PamPro 파서 검증: ${files.length}개 파일 ===\n`);

for (const f of files) {
  const buf = fs.readFileSync(path.join(dir, f));
  try {
    const r = parseUsageFile(buf);
    const totalUsage = r.aggregated.reduce((s, a) => s + a.cumulativeUsage, 0);
    const decimals = r.aggregated.filter((a) => !Number.isInteger(a.cumulativeUsage));
    const merged = r.aggregated.filter((a) => a.rowCount > 1);
    console.log(
      `${f}  hash=${r.fileHash.slice(0, 8)}  rows=${r.rawRowCount}  ` +
        `cassettes=${r.aggregated.length}  nonCassette=${r.nonCassette.length}  ` +
        `합산카세트=${merged.length}  소수사용=${decimals.length}  총사용량=${totalUsage}`
    );
    if (decimals.length) {
      console.log(
        `   소수 예: ` +
          decimals
            .slice(0, 3)
            .map((d) => `#${d.cassetteNumber} ${d.drugName}=${d.cumulativeUsage}`)
            .join(", ")
      );
    }
    if (merged.length) {
      console.log(
        `   합산 예: ` +
          merged
            .slice(0, 3)
            .map((m) => `#${m.cassetteNumber} ${m.drugName}=${m.cumulativeUsage}(${m.rowCount}행)`)
            .join(", ")
      );
    }
  } catch (e) {
    console.error(`${f}  ERROR: ${(e as Error).message}`);
  }
}

console.log("\n=== 완료 ===\n");
