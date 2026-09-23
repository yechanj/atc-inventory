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
  const hospital = await prisma.hospital.findUnique({ where: { id: hospitalId } });
  if (!hospital) return;

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

  // canister 0 = STS, 차감 제외
  const processableRows = rows.filter(
    (r) => r.canister !== 0 && r.fillDate != null && r.fillDate >= MDB_START_DATE
  );
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

  // 카세트번호별 누적 차감량 + 약품코드/약품명
  const deductMap = new Map<number, number>();
  const drugCodeMap = new Map<number, string>();
  const drugNameMap = new Map<number, string>();
  for (const row of processableRows) {
    deductMap.set(row.canister, (deductMap.get(row.canister) ?? 0) + row.totalUsedQty);
    drugCodeMap.set(row.canister, row.drugCode);
    drugNameMap.set(row.canister, row.drugName);
  }

  const cassetteUpdates: { id: string; after: number }[] = [];
  const historyData: Prisma.InventoryHistoryCreateManyInput[] = [];
  const toCreate: { cassetteNumber: number; deduct: number; drugCode: string; drugName: string }[] = [];

  for (const [cassetteNumber, deduct] of deductMap) {
    const cassette = cassetteMap.get(cassetteNumber);
    if (!cassette) {
      toCreate.push({
        cassetteNumber,
        deduct,
        drugCode: drugCodeMap.get(cassetteNumber) ?? "",
        drugName: drugNameMap.get(cassetteNumber) ?? `카세트 ${cassetteNumber}`,
      });
      continue;
    }
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

  // 자동생성할 카세트가 있으면 machine 조회 (없으면 자동생성)
  let machineId: string | null = null;
  if (toCreate.length > 0) {
    const machine = await prisma.machine.findFirst({ where: { hospitalId } })
      ?? await prisma.machine.create({ data: { hospitalId, name: "ATC" } });
    machineId = machine.id;
  }

  const INITIAL_INV = 1000;

  await prisma.$transaction(async (tx) => {
    // MDB raw 데이터 로깅 (분석용)
    await tx.mdbUsageLog.createMany({
      data: processableRows.map((r) => ({
        hospitalId,
        historyIndex: r.historyIndex,
        fillDate: r.fillDate!,
        canister: r.canister,
        drugCode: r.drugCode,
        drugName: r.drugName,
        qty: r.totalUsedQty,
      })),
      skipDuplicates: true,
    });

    // 신규 카세트 자동생성 (초기재고 1000에서 차감 시작)
    for (const { cassetteNumber, deduct, drugCode, drugName } of toCreate) {
      const created = await tx.cassette.create({
        data: { machineId: machineId!, cassetteNumber, drugCode: drugCode || null, drugName, currentInventory: INITIAL_INV - deduct },
      });
      historyData.push({
        cassetteId: created.id,
        type: "MDB_AUTO",
        quantityBefore: INITIAL_INV,
        changeQuantity: -deduct,
        quantityAfter: INITIAL_INV - deduct,
      });
      matched++;
    }

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
    }
    if (historyData.length > 0) {
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

/**
 * 백필 전용: MdbUsageLog에만 기록. 카세트 차감·lastIndex 업데이트 없음.
 */
export async function backfillMdbRows(
  hospitalId: string,
  rows: MdbRow[]
): Promise<{ logged: number }> {
  const processable = rows.filter((r) => r.canister !== 0 && r.fillDate != null);
  if (processable.length === 0) return { logged: 0 };

  await prisma.mdbUsageLog.createMany({
    data: processable.map((r) => ({
      hospitalId,
      historyIndex: r.historyIndex,
      fillDate: r.fillDate!,
      canister: r.canister,
      drugCode: r.drugCode,
      drugName: r.drugName,
      qty: r.totalUsedQty,
    })),
    skipDuplicates: true,
  });

  return { logged: processable.length };
}
