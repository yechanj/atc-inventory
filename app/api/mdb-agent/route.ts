import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api";
import { applyMdbRows, backfillMdbRows } from "@/lib/services/mdbSyncService";
import type { MdbRow } from "@/lib/mdb/mdbReader";

export const dynamic = "force-dynamic";

async function findStateByKey(req: Request) {
  const key = req.headers.get("x-agent-key") ?? "";
  if (!key) return null;
  return prisma.mdbSyncState.findUnique({ where: { agentKey: key } });
}

/** 에이전트가 현재 lastIndex를 조회 (heartbeat 겸용) */
export async function GET(req: Request) {
  const state = await findStateByKey(req);
  if (!state) return fail("인증 실패", 401);
  const [, logCount] = await Promise.all([
    prisma.mdbSyncState.update({ where: { id: state.id }, data: { lastSyncedAt: new Date() } }),
    prisma.mdbUsageLog.count({ where: { hospitalId: state.hospitalId } }),
  ]);
  return ok({
    lastIndex: state.lastIndex,
    startDate: process.env.MDB_START_DATE ?? "2026-09-22",
    needsBackfill: logCount === 0,
  });
}

/** 에이전트가 초기 lastIndex를 서버에 저장 */
export async function PATCH(req: Request) {
  const state = await findStateByKey(req);
  if (!state) return fail("인증 실패", 401);
  const body = await req.json() as { lastIndex: number };
  if (typeof body.lastIndex !== "number") return fail("lastIndex 필드가 없습니다", 400);
  await prisma.mdbSyncState.update({
    where: { id: state.id },
    data: { lastIndex: body.lastIndex },
  });
  return ok({ lastIndex: body.lastIndex });
}

/** 에이전트가 새 rows를 전송 → 재고 차감. backfill:true 시 로그만 기록 */
export async function POST(req: Request) {
  const state = await findStateByKey(req);
  if (!state) return fail("인증 실패", 401);

  const body = await req.json() as { rows: MdbRow[]; backfill?: boolean };
  if (!Array.isArray(body.rows)) return fail("rows 필드가 없습니다", 400);

  if (body.backfill) {
    const result = await backfillMdbRows(state.hospitalId, body.rows);
    return ok(result);
  }
  const result = await applyMdbRows(state.hospitalId, body.rows);
  return ok(result);
}
