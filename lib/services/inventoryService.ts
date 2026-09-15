import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

/**
 * 재고 변경 도메인 서비스. 모든 변경은 트랜잭션 + InventoryHistory 기록.
 */

/** 보충: 포장 개수 또는 직접 수량. 실제 추가된 수량만큼 현재고 증가. */
export async function refillCassette(params: {
  cassetteId: string;
  quantity: number; // 실제 추가 수량 (packages * packageSize 또는 직접 입력)
  memo?: string;
  recommendedPackages?: number | null; // 제공 시 카세트 권장 보충량 업데이트
}): Promise<{ before: number; after: number }> {
  const { cassetteId, quantity, memo, recommendedPackages } = params;
  if (!(quantity > 0)) throw new Error("보충 수량은 0보다 커야 합니다.");

  return prisma.$transaction(async (tx) => {
    const cassette = await tx.cassette.findUnique({ where: { id: cassetteId } });
    if (!cassette) throw new Error("카세트를 찾을 수 없습니다.");

    const before = cassette.currentInventory;
    const after = before + quantity;

    await tx.cassette.update({
      where: { id: cassetteId },
      data: {
        currentInventory: after,
        ...(recommendedPackages !== undefined && { recommendedPackages }),
      },
    });
    await tx.inventoryHistory.create({
      data: {
        cassetteId,
        type: "REFILL",
        quantityBefore: before,
        changeQuantity: quantity,
        quantityAfter: after,
        memo,
      },
    });
    return { before, after };
  });
}

/** 소모: STS 등 낱개 사용. 현재고 감소 + CONSUMPTION 이력 기록. */
export async function consumeCassette(params: {
  cassetteId: string;
  quantity: number; // 양수; 내부에서 음수로 저장
  memo?: string;
}): Promise<{ before: number; after: number }> {
  const { cassetteId, quantity, memo } = params;
  if (!(quantity > 0)) throw new Error("소모 수량은 0보다 커야 합니다.");

  return prisma.$transaction(async (tx) => {
    const cassette = await tx.cassette.findUnique({ where: { id: cassetteId } });
    if (!cassette) throw new Error("카세트를 찾을 수 없습니다.");

    const before = cassette.currentInventory;
    const after = before - quantity;

    await tx.cassette.update({
      where: { id: cassetteId },
      data: { currentInventory: after },
    });
    await tx.inventoryHistory.create({
      data: {
        cassetteId,
        type: "CONSUMPTION",
        quantityBefore: before,
        changeQuantity: -quantity,
        quantityAfter: after,
        memo,
      },
    });
    return { before, after };
  });
}

/** 실재고 보정: 현재고를 직접 센 실제 수량으로 설정. */
export async function adjustCassette(params: {
  cassetteId: string;
  actualQuantity: number;
  memo?: string;
  type?: "MANUAL_ADJUSTMENT" | "STOCKTAKE";
}): Promise<{ before: number; after: number; diff: number }> {
  const { cassetteId, actualQuantity, memo, type = "MANUAL_ADJUSTMENT" } = params;
  if (actualQuantity < 0) throw new Error("실재고는 0 이상이어야 합니다.");

  return prisma.$transaction(async (tx) => {
    const cassette = await tx.cassette.findUnique({ where: { id: cassetteId } });
    if (!cassette) throw new Error("카세트를 찾을 수 없습니다.");

    const before = cassette.currentInventory;
    const after = actualQuantity;
    const diff = after - before;

    await tx.cassette.update({
      where: { id: cassetteId },
      data: {
        currentInventory: after,
        lastAdjustedAt: new Date(),
        needsReview: false, // 보정으로 확인필요 해제
      },
    });
    await tx.inventoryHistory.create({
      data: {
        cassetteId,
        type,
        quantityBefore: before,
        changeQuantity: diff,
        quantityAfter: after,
        memo,
      },
    });
    return { before, after, diff };
  });
}

/** 재고조사 일괄 반영: 벌크 쿼리로 한 트랜잭션에서 처리. */
export async function applyStocktake(params: {
  entries: { cassetteId: string; actualQuantity: number }[];
  memo?: string;
}): Promise<{ updated: number }> {
  const { entries, memo } = params;
  const valid = entries.filter((e) => e.actualQuantity != null && e.actualQuantity >= 0);
  if (valid.length === 0) throw new Error("반영할 실재고 값이 없습니다.");

  return prisma.$transaction(async (tx) => {
    // 1) 카세트 한 번에 조회
    const cassettes = await tx.cassette.findMany({
      where: { id: { in: valid.map((e) => e.cassetteId) } },
    });
    const cassetteMap = new Map(cassettes.map((c) => [c.id, c]));

    // 2) 변경값 메모리 계산
    const updates: { id: string; after: number }[] = [];
    const historyData: Prisma.InventoryHistoryCreateManyInput[] = [];
    const now = new Date();

    for (const e of valid) {
      const cassette = cassetteMap.get(e.cassetteId);
      if (!cassette) continue;
      const before = cassette.currentInventory;
      const after = e.actualQuantity;
      if (before === after) continue;
      updates.push({ id: cassette.id, after });
      historyData.push({
        cassetteId: cassette.id,
        type: "STOCKTAKE",
        quantityBefore: before,
        changeQuantity: after - before,
        quantityAfter: after,
        memo: memo ?? "재고조사 반영",
      });
    }

    if (updates.length === 0) return { updated: 0 };

    // 3) 벌크 UPDATE (쿼리 1개)
    const values = updates.map(({ id, after }) =>
      Prisma.sql`(${id}::text, ${after}::float8, ${now}::timestamptz)`
    );
    await tx.$executeRaw`
      UPDATE "Cassette" AS c
      SET "currentInventory" = v.after,
          "lastAdjustedAt"   = v.adj_at,
          "needsReview"      = false,
          "updatedAt"        = now()
      FROM (VALUES ${Prisma.join(values)}) AS v(id, after, adj_at)
      WHERE c.id = v.id
    `;

    // 4) 이력 일괄 생성 (쿼리 1개)
    await tx.inventoryHistory.createMany({ data: historyData });

    return { updated: updates.length };
  }, { timeout: 30000 });
}

const EDITABLE_FIELDS = [
  "drugCode",
  "drugName",
  "packageSize",
  "refillThreshold",
  "recommendedPackages",
  "fullCapacity",
  "trackingStatus",
] as const;

/**
 * 카세트 설정 수정. 현재고(currentInventory)를 직접 바꾸는 경우
 * 일반 설정 수정이 아니라 MANUAL_ADJUSTMENT history를 남긴다.
 */
export async function updateCassetteSettings(params: {
  cassetteId: string;
  data: Record<string, unknown>;
}): Promise<void> {
  const { cassetteId, data } = params;

  await prisma.$transaction(async (tx) => {
    const cassette = await tx.cassette.findUnique({ where: { id: cassetteId } });
    if (!cassette) throw new Error("카세트를 찾을 수 없습니다.");

    const settingUpdate: Record<string, unknown> = {};
    for (const f of EDITABLE_FIELDS) {
      if (f in data && data[f] !== undefined) settingUpdate[f] = data[f];
    }
    if (Object.keys(settingUpdate).length > 0) {
      await tx.cassette.update({ where: { id: cassetteId }, data: settingUpdate });
    }

    // 현재고 직접 수정 → 실재고 보정으로 기록
    if (
      "currentInventory" in data &&
      data.currentInventory != null &&
      Number(data.currentInventory) !== cassette.currentInventory
    ) {
      const before = cassette.currentInventory;
      const after = Number(data.currentInventory);
      await tx.cassette.update({
        where: { id: cassetteId },
        data: { currentInventory: after, lastAdjustedAt: new Date(), needsReview: false },
      });
      await tx.inventoryHistory.create({
        data: {
          cassetteId,
          type: "MANUAL_ADJUSTMENT",
          quantityBefore: before,
          changeQuantity: after - before,
          quantityAfter: after,
          memo: "설정 화면에서 현재고 직접 수정",
        },
      });
    }
  });
}
