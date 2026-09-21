import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { MDB_START_DATE, type MdbRow } from "@/lib/mdb/mdbReader";
import { randomBytes } from "crypto";

export interface MdbSyncResult {
  newRows: number;
  processed: number;
  matched: number;
  skipped: number;
  lastIndex: number;
}

function generateKey(): string {
  return randomBytes(24).toString("hex");
}

/** MdbSyncState가 없으면 agentKey를 자동 생성해 만든다. 이미 있으면 agentKey만 채운다. */
export async function ensureSyncState(hospitalId: string): Promise<void> {
  const existing = await prisma.mdbSyncState.findUnique({ where: { hospitalId } });
  if (existing) {
    if (!existing.agentKey) {
      await prisma.mdbSyncState.update({
        where: { hospitalId },
        data: { agentKey: generateKey() },
      });
    }
    return;
  }
  await prisma.mdbSyncState.create({ data: { hospitalId, agentKey: generateKey() } });
}

/** agentKey를 새로 발급하고 반환한다. */
export async function rotateAgentKey(hospitalId: string): Promise<string> {
  const newKey = generateKey();
  await prisma.mdbSyncState.upsert({
    where: { hospitalId },
    create: { hospitalId, agentKey: newKey },
    update: { agentKey: newKey },
  });
  return newKey;
}

/**
 * 에이전트(.exe)에서 전송한 rows를 받아 재고 차감 + lastIndex 갱신.
 * MDB를 직접 읽지 않음 — 에이전트가 읽어서 보내준 데이터를 처리.
 */
export async function applyMdbRows(
  hospitalId: string,
  rows: MdbRow[]
): Promise<MdbSyncResult> {
  if (rows.length === 0) {
    const state = await prisma.mdbSyncState.findUnique({ where: { hospitalId } });
    return { newRows: 0, processed: 0, matched: 0, skipped: 0, lastIndex: state?.lastIndex ?? 0 };
  }

  const processableRows = rows.filter((r) => r.fillDate != null && r.fillDate >= MDB_START_DATE);
  const newLastIndex = rows[rows.length - 1].historyIndex;

  let matched = 0;
  let skipped = 0;

  if (processableRows.length === 0) {
    await prisma.mdbSyncState.upsert({
      where: { hospitalId },
      create: { hospitalId, lastIndex: newLastIndex, lastSyncedAt: new Date() },
      update: { lastIndex: newLastIndex, lastSyncedAt: new Date() },
    });
    return { newRows: rows.length, processed: 0, matched: 0, skipped: 0, lastIndex: newLastIndex };
  }

  const cassettes = await prisma.cassette.findMany({
    where: { machine: { hospitalId }, trackingStatus: true },
    select: { id: true, cassetteNumber: true, currentInventory: true },
  });
  const cassetteMap = new Map(cassettes.map((c) => [c.cassetteNumber, c]));

  const deductMap = new Map<number, number>();
  for (const row of processableRows) {
    deductMap.set(row.canister, (deductMap.get(row.canister) ?? 0) + row.totalUsedQty);
  }

  const cassetteUpdates: { id: string; after: number }[] = [];
  const historyData: Prisma.InventoryHistoryCreateManyInput[] = [];

  for (const [cassetteNumber, deduct] of deductMap) {
    const cassette = cassetteMap.get(cassetteNumber);
    if (!cassette) { skipped++; continue; }
    const before = cassette.currentInventory;
    const after = before - deduct;
    cassetteUpdates.push({ id: cassette.id, after });
    historyData.push({
      cassetteId: cassette.id,
      type: "MDB_AUTO",
      quantityBefore: before,
      changeQuantity: after - before,
      quantityAfter: after,
    });
    matched++;
  }

  await prisma.$transaction(async (tx) => {
    if (cassetteUpdates.length > 0) {
      const values = cassetteUpdates.map(({ id, after }) =>
        Prisma.sql`(${id}::text, ${after}::float8)`
      );
      await tx.$executeRaw`
        UPDATE "Cassette" AS c
        SET "currentInventory" = v.after, "updatedAt" = now()
        FROM (VALUES ${Prisma.join(values)}) AS v(id, after)
        WHERE c.id = v.id
      `;
      await tx.inventoryHistory.createMany({ data: historyData });
    }
    await tx.mdbSyncState.upsert({
      where: { hospitalId },
      create: { hospitalId, lastIndex: newLastIndex, lastSyncedAt: new Date() },
      update: { lastIndex: newLastIndex, lastSyncedAt: new Date() },
    });
  }, { timeout: 15000 });

  return { newRows: rows.length, processed: processableRows.length, matched, skipped, lastIndex: newLastIndex };
}
