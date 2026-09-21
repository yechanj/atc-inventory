import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api";
import { applyMdbRows } from "@/lib/services/mdbSyncService";
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
  await prisma.mdbSyncState.update({
    where: { id: state.id },
    data: { lastSyncedAt: new Date() },
  });
  return ok({ lastIndex: state.lastIndex });
}

/** 에이전트가 새 rows를 전송 → 재고 차감 */
export async function POST(req: Request) {
  const state = await findStateByKey(req);
  if (!state) return fail("인증 실패", 401);

  const body = await req.json() as { rows: MdbRow[] };
  if (!Array.isArray(body.rows)) return fail("rows 필드가 없습니다", 400);

  const result = await applyMdbRows(state.hospitalId, body.rows);
  return ok(result);
}
