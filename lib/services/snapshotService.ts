import { prisma } from "@/lib/prisma";
import { parseUsageFile, ParseError } from "@/lib/pampro/parseUsageFile";
import { bootstrapFromBuffers } from "@/lib/services/bootstrapService";
import { Prisma } from "@prisma/client";

/**
 * 스냅샷(사용량 반영) 도메인 서비스.
 * - 파싱 → 해시 중복검사 → 카세트 매칭 → 직전 APPLIED 스냅샷과 diff → PENDING 스냅샷 생성
 * - 반영(apply)은 단일 트랜잭션으로 재고 차감 + history 기록 (전체 성공/전체 롤백)
 */

export class ExistingPendingError extends Error {
  constructor(public existingId: string) {
    super("이미 대기 중인 파일이 있습니다. 먼저 반영하거나 취소하세요.");
    this.name = "ExistingPendingError";
  }
}

export interface PreparedLine {
  cassetteNumber: number | null;
  drugCode: string | null;
  drugName: string;
  cumulativeUsage: number;
  count: number | null;
  matchStatus: "MATCHED" | "UNMATCHED" | "NO_CASSETTE";
  matchNote?: string;
  cassetteId: string | null;
  currentInventory: number | null;
  previousUsage: number | null;
  newUsage: number | null;
  decreaseFlag: boolean;
  projectedInventory: number | null;
}

export interface PreparedSnapshot {
  snapshotId: string;
  originalFilename: string;
  isBaseline: boolean;
  queryPeriodStart?: Date | null;
  queryPeriodEnd?: Date | null;
  matchedCount: number;
  applicableCount: number; // 실제 차감될 라인 수
  decreaseCount: number;
  unmatchedCount: number;
  nonCassetteCount: number;
  totalNewUsage: number;
  warnings: string[];
  lines: PreparedLine[];
}

function toDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * 업로드된 파일을 파싱하여 PENDING 스냅샷과 라인을 생성하고 미리보기 데이터를 반환한다.
 * 실제 재고는 아직 건드리지 않는다.
 */
export async function prepareSnapshot(params: {
  hospitalId: string;
  originalFilename: string;
  buffer: Buffer;
  note?: string;
  /** PamPro 조회기간 시작일. 제공 시 같은 기간의 직전 APPLIED 스냅샷과 diff. */
  queryPeriodStart?: Date;
  /** PamPro 조회기간 종료일. */
  queryPeriodEnd?: Date;
}): Promise<PreparedSnapshot> {
  const { hospitalId, originalFilename, buffer, note, queryPeriodStart, queryPeriodEnd } = params;

  const parsed = parseUsageFile(buffer);

  // 1) 대기 중인 스냅샷이 있으면 먼저 처리하도록 차단
  const existingPending = await prisma.usageSnapshot.findFirst({
    where: { hospitalId, status: "PENDING" },
  });
  if (existingPending) throw new ExistingPendingError(existingPending.id);

  // 2) 파일에 있는 신규 카세트를 마스터에 자동 추가 (기존 카세트는 건너뜀 — idempotent)
  await bootstrapFromBuffers({ hospitalId, buffers: [buffer] });

  // 2) 직전 APPLIED 스냅샷 조회 — 같은 조회기간이 있으면 diff, 없으면(새 날짜) 전체 차감
  type SnapshotWithLines = Prisma.PromiseReturnType<
    typeof prisma.usageSnapshot.findFirst<{ include: { lines: true } }>
  >;
  let prevSnapshot: SnapshotWithLines = null;

  if (queryPeriodStart && queryPeriodEnd) {
    const startDay = toDateOnly(queryPeriodStart);
    const endDay = toDateOnly(queryPeriodEnd);
    prevSnapshot = await prisma.usageSnapshot.findFirst({
      where: {
        hospitalId,
        status: "APPLIED",
        queryPeriodStart: { gte: startDay, lt: new Date(startDay.getTime() + 86400000) },
        queryPeriodEnd: { gte: endDay, lt: new Date(endDay.getTime() + 86400000) },
      },
      orderBy: { appliedAt: "desc" },
      include: { lines: true },
    });
  } else {
    // 조회기간 미입력 시 가장 최근 APPLIED와 비교 (하위호환)
    prevSnapshot = await prisma.usageSnapshot.findFirst({
      where: { hospitalId, status: "APPLIED" },
      orderBy: { appliedAt: "desc" },
      include: { lines: true },
    });
  }
  const isBaseline = !prevSnapshot;
  const prevByCassette = new Map<string, number>();
  if (prevSnapshot) {
    for (const l of prevSnapshot.lines) {
      if (l.cassetteId) prevByCassette.set(l.cassetteId, l.cumulativeUsage);
    }
  }

  // 3) 머신/카세트 로드
  const machines = await prisma.machine.findMany({ where: { hospitalId } });
  const machineByName = new Map(machines.map((m) => [m.name, m]));
  const cassettes = await prisma.cassette.findMany({
    where: { machine: { hospitalId } },
  });
  const cassetteByKey = new Map<string, (typeof cassettes)[number]>();
  for (const c of cassettes) {
    cassetteByKey.set(`${c.machineId}::${c.cassetteNumber}`, c);
  }

  const lines: PreparedLine[] = [];

  // 3a) 카세트 배정 사용량
  for (const a of parsed.aggregated) {
    const machine = machineByName.get(a.machineName);
    const cassette = machine
      ? cassetteByKey.get(`${machine.id}::${a.cassetteNumber}`)
      : undefined;

    let matchStatus: PreparedLine["matchStatus"] = "UNMATCHED";
    let matchNote: string | undefined;
    let cassetteId: string | null = null;
    let currentInventory: number | null = null;
    let previousUsage: number | null = null;
    let newUsage: number | null = null;
    let decreaseFlag = false;
    let projectedInventory: number | null = null;

    if (!machine) {
      matchNote = `'${a.machineName}' 장비가 등록되어 있지 않습니다.`;
    } else if (!cassette) {
      matchNote = `카세트 #${a.cassetteNumber}가 마스터에 없습니다.`;
    } else if (
      cassette.drugCode &&
      a.drugCode &&
      cassette.drugCode !== a.drugCode
    ) {
      // 캐니스터번호는 맞지만 마스터와 다른 약품 → 재고 반영 제외(확인 필요)
      matchNote = `마스터 약품(${cassette.drugCode})과 다른 약품(${a.drugCode})이 조제되었습니다.`;
    } else {
      matchStatus = "MATCHED";
      cassetteId = cassette.id;
      currentInventory = cassette.currentInventory;
      if (isBaseline) {
        previousUsage = null;
        newUsage = a.cumulativeUsage; // 새 조회기간: 전체 사용량 차감
      } else {
        previousUsage = prevByCassette.get(cassette.id) ?? 0;
        newUsage = a.cumulativeUsage - previousUsage;
        if (newUsage < 0) decreaseFlag = true;
      }
      projectedInventory =
        newUsage != null && !decreaseFlag
          ? cassette.currentInventory - newUsage
          : cassette.currentInventory;
    }

    lines.push({
      cassetteNumber: a.cassetteNumber,
      drugCode: a.drugCode,
      drugName: a.drugName,
      cumulativeUsage: a.cumulativeUsage,
      count: a.count,
      matchStatus,
      matchNote,
      cassetteId,
      currentInventory,
      previousUsage,
      newUsage,
      decreaseFlag,
      projectedInventory,
    });
  }

  // 3b) 비카세트(수동조제) 약품 — 추적 대상 아님
  for (const n of parsed.nonCassette) {
    lines.push({
      cassetteNumber: null,
      drugCode: n.drugCode,
      drugName: n.drugName,
      cumulativeUsage: n.cumulativeUsage,
      count: n.count,
      matchStatus: "NO_CASSETTE",
      cassetteId: null,
      currentInventory: null,
      previousUsage: null,
      newUsage: null,
      decreaseFlag: false,
      projectedInventory: null,
    });
  }

  // 4) PENDING 스냅샷 + 라인 저장
  const snapshot = await prisma.usageSnapshot.create({
    data: {
      hospitalId,
      originalFilename,
      fileHash: parsed.fileHash,
      status: "PENDING",
      note,
      queryPeriodStart: queryPeriodStart ? toDateOnly(queryPeriodStart) : null,
      queryPeriodEnd: queryPeriodEnd ? toDateOnly(queryPeriodEnd) : null,
      lines: {
        create: lines.map((l) => ({
          cassetteId: l.cassetteId,
          machineName:
            parsed.aggregated.find((a) => a.cassetteNumber === l.cassetteNumber)
              ?.machineName ?? "미상",
          cassetteNumber: l.cassetteNumber,
          drugCode: l.drugCode,
          drugName: l.drugName,
          cumulativeUsage: l.cumulativeUsage,
          count: l.count,
          matchStatus: l.matchStatus,
          previousUsage: l.previousUsage,
          newUsage: l.newUsage,
          decreaseFlag: l.decreaseFlag,
        })),
      },
    },
  });

  const applicable = lines.filter(
    (l) => l.matchStatus === "MATCHED" && !l.decreaseFlag && (l.newUsage ?? 0) > 0
  );

  return {
    snapshotId: snapshot.id,
    originalFilename,
    isBaseline,
    queryPeriodStart: snapshot.queryPeriodStart,
    queryPeriodEnd: snapshot.queryPeriodEnd,
    matchedCount: lines.filter((l) => l.matchStatus === "MATCHED").length,
    applicableCount: applicable.length,
    decreaseCount: lines.filter((l) => l.decreaseFlag).length,
    unmatchedCount: lines.filter((l) => l.matchStatus === "UNMATCHED").length,
    nonCassetteCount: lines.filter((l) => l.matchStatus === "NO_CASSETTE").length,
    totalNewUsage: applicable.reduce((s, l) => s + (l.newUsage ?? 0), 0),
    warnings: parsed.warnings,
    lines,
  };
}

/**
 * 저장된 스냅샷의 미리보기(라인 포함)를 다시 구성한다. (미리보기 화면 새로고침 대응)
 * projectedInventory는 현재 카세트 재고 기준으로 재계산한다.
 */
export async function getSnapshotPreview(
  snapshotId: string
): Promise<(PreparedSnapshot & { status: string }) | null> {
  const snapshot = await prisma.usageSnapshot.findUnique({
    where: { id: snapshotId },
    include: {
      lines: {
        include: { cassette: { select: { currentInventory: true } } },
      },
    },
  });
  if (!snapshot) return null;

  const isBaseline = snapshot.lines.every(
    (l) => l.matchStatus !== "MATCHED" || l.previousUsage == null
  );

  const lines: PreparedLine[] = snapshot.lines.map((l) => {
    const currentInventory = l.cassette?.currentInventory ?? null;
    const projectedInventory =
      currentInventory != null && l.newUsage != null && !l.decreaseFlag
        ? currentInventory - l.newUsage
        : currentInventory;
    return {
      cassetteNumber: l.cassetteNumber,
      drugCode: l.drugCode,
      drugName: l.drugName,
      cumulativeUsage: l.cumulativeUsage,
      count: l.count,
      matchStatus: l.matchStatus as PreparedLine["matchStatus"],
      cassetteId: l.cassetteId,
      currentInventory,
      previousUsage: l.previousUsage,
      newUsage: l.newUsage,
      decreaseFlag: l.decreaseFlag,
      projectedInventory,
    };
  });

  const applicable = lines.filter(
    (l) => l.matchStatus === "MATCHED" && !l.decreaseFlag && (l.newUsage ?? 0) > 0
  );

  return {
    snapshotId: snapshot.id,
    originalFilename: snapshot.originalFilename,
    status: snapshot.status,
    isBaseline,
    queryPeriodStart: snapshot.queryPeriodStart,
    queryPeriodEnd: snapshot.queryPeriodEnd,
    matchedCount: lines.filter((l) => l.matchStatus === "MATCHED").length,
    applicableCount: applicable.length,
    decreaseCount: lines.filter((l) => l.decreaseFlag).length,
    unmatchedCount: lines.filter((l) => l.matchStatus === "UNMATCHED").length,
    nonCassetteCount: lines.filter((l) => l.matchStatus === "NO_CASSETTE").length,
    totalNewUsage: applicable.reduce((s, l) => s + (l.newUsage ?? 0), 0),
    warnings: [],
    lines,
  };
}

/**
 * PENDING 스냅샷을 실제 재고에 반영한다. 단일 트랜잭션 — 전체 성공 또는 전체 롤백.
 * 반영 대상: MATCHED && !decreaseFlag && newUsage > 0
 */
export async function applySnapshot(snapshotId: string): Promise<{
  appliedLines: number;
  totalDeducted: number;
  clampedCassettes: number;
}> {
  return prisma.$transaction(async (tx) => {
    const snapshot = await tx.usageSnapshot.findUnique({
      where: { id: snapshotId },
      include: { lines: true },
    });
    if (!snapshot) throw new Error("스냅샷을 찾을 수 없습니다.");
    if (snapshot.status !== "PENDING") {
      throw new Error(
        `이미 처리된 스냅샷입니다. (상태: ${snapshot.status}) 중복 반영이 차단되었습니다.`
      );
    }

    const applicableLines = snapshot.lines.filter(
      (l) =>
        l.matchStatus === "MATCHED" &&
        l.cassetteId &&
        !l.decreaseFlag &&
        (l.newUsage ?? 0) > 0
    );

    // 카세트 전체를 한 번에 조회
    const cassetteIds = applicableLines.map((l) => l.cassetteId as string);
    const cassettes = await tx.cassette.findMany({
      where: { id: { in: cassetteIds } },
    });
    const cassetteMap = new Map(cassettes.map((c) => [c.id, c]));

    let appliedLines = 0;
    let totalDeducted = 0;
    let clampedCassettes = 0;

    // 메모리에서 변경값 계산
    const cassetteUpdates: { id: string; after: number; needsReview: boolean }[] = [];
    const historyData: Prisma.InventoryHistoryCreateManyInput[] = [];

    for (const line of applicableLines) {
      const cassette = cassetteMap.get(line.cassetteId as string);
      if (!cassette) continue;

      const before = cassette.currentInventory;
      const deduct = line.newUsage as number;
      let after = before - deduct;
      let needsReview = cassette.needsReview;
      let memo: string | undefined;

      if (after < 0) {
        memo = `이론재고 부족: ${before} - ${deduct} = ${after} → 0으로 보정. 실재고 확인 필요.`;
        after = 0;
        needsReview = true;
        clampedCassettes += 1;
      }

      cassetteUpdates.push({ id: cassette.id, after, needsReview });
      historyData.push({
        cassetteId: cassette.id,
        type: "USAGE",
        quantityBefore: before,
        changeQuantity: after - before,
        quantityAfter: after,
        snapshotId: snapshot.id,
        memo,
      });

      appliedLines += 1;
      totalDeducted += before - after;
    }

    // 카세트 재고를 단일 bulk UPDATE로 처리 (204개 개별 쿼리 → 쿼리 1개)
    if (cassetteUpdates.length > 0) {
      const values = cassetteUpdates.map(
        ({ id, after, needsReview }) =>
          Prisma.sql`(${id}::text, ${after}::float8, ${needsReview}::boolean)`
      );
      await tx.$executeRaw`
        UPDATE "Cassette" AS c
        SET "currentInventory" = v.after,
            "needsReview"      = v.needs_review,
            "updatedAt"        = now()
        FROM (VALUES ${Prisma.join(values)}) AS v(id, after, needs_review)
        WHERE c.id = v.id
      `;
    }

    await Promise.all([
      tx.inventoryHistory.createMany({ data: historyData }),
      tx.usageSnapshotLine.updateMany({
        where: { id: { in: applicableLines.map((l) => l.id) } },
        data: { applied: true },
      }),
    ]);

    await tx.usageSnapshot.update({
      where: { id: snapshot.id },
      data: { status: "APPLIED", appliedAt: new Date() },
    });

    return { appliedLines, totalDeducted, clampedCassettes };
  }, { timeout: 30000 });
}

/**
 * APPLIED 스냅샷을 되돌린다. 해당 스냅샷으로 차감된 재고를 복원하고 이력을 삭제한다.
 * 이후에 다른 작업(보충·재고조사 등)이 있었다면 재고는 복원되지만 이력 맥락이 달라질 수 있다.
 */
export async function rollbackSnapshot(
  snapshotId: string,
  hospitalId: string
): Promise<{ reversedLines: number; totalRestored: number; hasSubsequentOps: boolean }> {
  return prisma.$transaction(async (tx) => {
    const snapshot = await tx.usageSnapshot.findUnique({ where: { id: snapshotId } });
    if (!snapshot) throw new Error("스냅샷을 찾을 수 없습니다.");
    if (snapshot.hospitalId !== hospitalId) throw new Error("권한이 없습니다.");
    if (snapshot.status !== "APPLIED") throw new Error("반영된 스냅샷만 되돌릴 수 있습니다.");

    const historyEntries = await tx.inventoryHistory.findMany({ where: { snapshotId } });

    // 이 스냅샷 이후에 다른 작업이 있는지 확인
    const cassetteIds = [...new Set(historyEntries.map((h) => h.cassetteId))];
    const appliedAt = snapshot.appliedAt ?? snapshot.uploadedAt;
    const subsequentOp = cassetteIds.length > 0
      ? await tx.inventoryHistory.findFirst({
          where: { cassetteId: { in: cassetteIds }, createdAt: { gt: appliedAt }, snapshotId: { not: snapshotId } },
        })
      : null;
    const hasSubsequentOps = !!subsequentOp;

    // 카세트별 복원량 집계 (changeQuantity가 음수이므로 -를 더함)
    const restoreMap = new Map<string, number>();
    for (const h of historyEntries) {
      restoreMap.set(h.cassetteId, (restoreMap.get(h.cassetteId) ?? 0) + (-h.changeQuantity));
    }

    if (restoreMap.size > 0) {
      const values = [...restoreMap.entries()].map(
        ([id, restore]) => Prisma.sql`(${id}::text, ${restore}::float8)`
      );
      await tx.$executeRaw`
        UPDATE "Cassette" AS c
        SET "currentInventory" = c."currentInventory" + v.restore,
            "updatedAt" = now()
        FROM (VALUES ${Prisma.join(values)}) AS v(id, restore)
        WHERE c.id = v.id
      `;
    }

    await tx.inventoryHistory.deleteMany({ where: { snapshotId } });
    await tx.usageSnapshotLine.updateMany({ where: { snapshotId }, data: { applied: false } });
    await tx.usageSnapshot.update({ where: { id: snapshotId }, data: { status: "ROLLED_BACK" } });

    const totalRestored = [...restoreMap.values()].reduce((s, v) => s + Math.max(0, v), 0);
    return { reversedLines: historyEntries.length, totalRestored, hasSubsequentOps };
  }, { timeout: 30000 });
}

/** PENDING 스냅샷 취소 (잘못 올린 파일 되돌리기). 레코드를 삭제해 fileHash 제약을 해제한다. */
export async function cancelSnapshot(snapshotId: string): Promise<void> {
  const snapshot = await prisma.usageSnapshot.findUnique({
    where: { id: snapshotId },
  });
  if (!snapshot) throw new Error("스냅샷을 찾을 수 없습니다.");
  if (snapshot.status !== "PENDING") {
    throw new Error("이미 처리된 스냅샷은 취소할 수 없습니다.");
  }
  // 삭제 시 UsageSnapshotLine은 onDelete: Cascade로 자동 정리됨
  await prisma.usageSnapshot.delete({ where: { id: snapshotId } });
}

export { ParseError };
export type { Prisma };
