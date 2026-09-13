import fs from "fs";
import path from "path";
import { prisma } from "../lib/prisma";
import { getCurrentHospitalId } from "../lib/hospital";
import {
  prepareSnapshot,
  applySnapshot,
  DuplicateSnapshotError,
} from "../lib/services/snapshotService";

const read = (f: string) =>
  fs.readFileSync(path.join(process.cwd(), "sample-data", f));

async function main() {
  const hospitalId = await getCurrentHospitalId();

  // 1) baseline: 0825 준비 → 반영 (newUsage 0, 차감 없음)
  const p1 = await prepareSnapshot({
    hospitalId,
    originalFilename: "0825.xls",
    buffer: read("0825.xls"),
  });
  console.log(
    `[0825] baseline=${p1.isBaseline} matched=${p1.matchedCount} applicable=${p1.applicableCount} unmatched=${p1.unmatchedCount} nonCassette=${p1.nonCassetteCount}`
  );
  const a1 = await applySnapshot(p1.snapshotId);
  console.log(`  → applied lines=${a1.appliedLines} deducted=${a1.totalDeducted}`);

  // 2) 중복 반영 차단 확인 (동일 0825 재업로드)
  try {
    await prepareSnapshot({
      hospitalId,
      originalFilename: "0825-again.xls",
      buffer: read("0825.xls"),
    });
    console.log("  ✗ 중복 차단 실패!");
  } catch (e) {
    if (e instanceof DuplicateSnapshotError) console.log("  ✓ 동일 파일 중복 차단 OK");
    else throw e;
  }

  // 3) 0901 준비 → diff (0901 총사용량이 커서 상당수 양수, 일부 감소)
  const p2 = await prepareSnapshot({
    hospitalId,
    originalFilename: "0901.xls",
    buffer: read("0901.xls"),
  });
  console.log(
    `[0901] baseline=${p2.isBaseline} matched=${p2.matchedCount} applicable=${p2.applicableCount} decrease=${p2.decreaseCount} unmatched=${p2.unmatchedCount} totalNewUsage=${p2.totalNewUsage}`
  );
  // 샘플 라인 몇 개
  const sample = p2.lines
    .filter((l) => l.matchStatus === "MATCHED" && l.newUsage !== 0)
    .slice(0, 5);
  for (const l of sample) {
    console.log(
      `  #${l.cassetteNumber} ${l.drugName}: prev=${l.previousUsage} now=${l.cumulativeUsage} new=${l.newUsage}${l.decreaseFlag ? " (감소!)" : ` → ${l.currentInventory}→${l.projectedInventory}`}`
    );
  }
  const before = await prisma.cassette.findFirst({
    where: { cassetteNumber: 320 },
  });
  const a2 = await applySnapshot(p2.snapshotId);
  console.log(
    `  → applied lines=${a2.appliedLines} deducted=${a2.totalDeducted} clamped=${a2.clampedCassettes}`
  );
  const after = await prisma.cassette.findFirst({
    where: { cassetteNumber: 320 },
  });
  console.log(
    `  카세트#320 현재고: ${before?.currentInventory} → ${after?.currentInventory}`
  );

  // history 확인
  const usageHist = await prisma.inventoryHistory.count({ where: { type: "USAGE" } });
  console.log(`USAGE history 건수: ${usageHist}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
