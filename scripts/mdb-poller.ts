/**
 * MDB 자동차감 백그라운드 폴러.
 *
 * 실행: npm run mdb:start
 *   (내부적으로 `tsx --env-file=.env scripts/mdb-poller.ts` 실행)
 * 중단: Ctrl+C
 *
 * MDB_POLL_INTERVAL_MS 환경변수로 폴링 간격 설정 (기본 10초).
 */

import { prisma } from "../lib/prisma";
import { ensureSyncState, syncMdb } from "../lib/services/mdbSyncService";

const INTERVAL_MS = parseInt(process.env.MDB_POLL_INTERVAL_MS ?? "10000", 10);

async function poll(hospitalId: string): Promise<void> {
  const result = await syncMdb(hospitalId);
  if (result.newRows > 0) {
    const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
    console.log(
      `[MDB ${ts}] 신규 ${result.newRows}건 (처리대상 ${result.processed}) ` +
        `→ 차감 ${result.matched}, 미매칭 ${result.skipped}, lastIndex=${result.lastIndex}`
    );
  }
}

async function main(): Promise<void> {
  const hospital = await prisma.hospital.findFirst();
  if (!hospital) throw new Error("병원 데이터가 없습니다. DB를 확인하세요.");

  console.log(`[MDB Poller] 병원: ${hospital.name} (${hospital.id})`);
  console.log(`[MDB Poller] MDB_PATH: ${process.env.MDB_PATH}`);
  console.log(`[MDB Poller] MDB_START_DATE: ${process.env.MDB_START_DATE}`);
  console.log(`[MDB Poller] 폴링 간격: ${INTERVAL_MS / 1000}초`);

  await ensureSyncState(hospital.id);
  console.log("[MDB Poller] 준비 완료. 폴링 시작...\n");

  while (true) {
    try {
      await poll(hospital.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[MDB] 오류: ${msg}`);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main()
  .catch((e) => {
    console.error("[MDB Poller] 치명적 오류:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
