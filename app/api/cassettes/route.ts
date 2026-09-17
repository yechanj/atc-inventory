import { prisma } from "@/lib/prisma";
import { getCurrentHospitalId } from "@/lib/hospital";
import { ok, fail, handle } from "@/lib/api";
import { getCassetteStatus } from "@/lib/status";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const hospitalId = await getCurrentHospitalId();
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim();
    const status = searchParams.get("status") ?? "ALL";
    const sort = searchParams.get("sort") ?? "cassette";
    const machineId = searchParams.get("machineId") ?? undefined;

    const where: any = { machine: { hospitalId } };
    if (machineId) where.machineId = machineId;
    if (q) {
      const asNum = Number(q);
      where.OR = [
        { drugName: { contains: q, mode: "insensitive" } },
        { drugCode: { contains: q, mode: "insensitive" } },
        ...(Number.isFinite(asNum) ? [{ cassetteNumber: asNum }] : []),
      ];
    }

    let cassettes = await prisma.cassette.findMany({
      where,
      include: { machine: { select: { name: true } } },
    });

    // 상태 필터 (계산 상태 기준)
    // REFILL 조회 시: 순수 REFILL + "확인필요이면서 보충기준 이하"도 포함
    if (status === "REFILL") {
      cassettes = cassettes.filter((c) => {
        const s = getCassetteStatus(c as any);
        return s === "REFILL" || (s === "REVIEW" && c.currentInventory <= c.refillThreshold);
      });
    } else if (status !== "ALL") {
      cassettes = cassettes.filter((c) => getCassetteStatus(c as any) === status);
    }

    // 정렬
    cassettes.sort((a, b) => {
      switch (sort) {
        case "inventory":
          return a.currentInventory - b.currentInventory;
        case "shortage": {
          const sa = a.currentInventory - a.refillThreshold;
          const sb = b.currentInventory - b.refillThreshold;
          return sa - sb;
        }
        case "cassette_desc":
          if (a.machine.name !== b.machine.name)
            return b.machine.name.localeCompare(a.machine.name);
          return b.cassetteNumber - a.cassetteNumber;
        case "drugCode_asc":
          return (a.drugCode ?? "").localeCompare(b.drugCode ?? "");
        case "drugCode_desc":
          return (b.drugCode ?? "").localeCompare(a.drugCode ?? "");
        case "drugName_asc":
          return a.drugName.localeCompare(b.drugName);
        case "drugName_desc":
          return b.drugName.localeCompare(a.drugName);
        case "cassette":
        case "cassette_asc":
        default:
          if (a.machine.name !== b.machine.name)
            return a.machine.name.localeCompare(b.machine.name);
          return a.cassetteNumber - b.cassetteNumber;
      }
    });

    return ok(cassettes);
  });
}

/** 재고조사 중 미등록 카세트 신규 추가 */
export async function POST(req: Request) {
  return handle(async () => {
    const hospitalId = await getCurrentHospitalId();
    const body = await req.json();

    const machineId = String(body.machineId ?? "");
    const cassetteNumber = Number(body.cassetteNumber);
    const drugName = String(body.drugName ?? "").trim() || "(미등록)";
    const drugCode = String(body.drugCode ?? "").trim() || null;
    const currentInventory = Number(body.currentInventory ?? 0);

    if (!machineId) return fail("장비를 선택하세요.");
    if (!Number.isFinite(cassetteNumber) || cassetteNumber <= 0)
      return fail("유효한 카세트 번호를 입력하세요.");
    if (!Number.isFinite(currentInventory) || currentInventory < 0)
      return fail("실제재고는 0 이상이어야 합니다.");

    const machine = await prisma.machine.findFirst({ where: { id: machineId, hospitalId } });
    if (!machine) return fail("장비를 찾을 수 없습니다.", 404);

    const cassette = await prisma.$transaction(async (tx) => {
      const existing = await tx.cassette.findUnique({
        where: { machineId_cassetteNumber: { machineId, cassetteNumber } },
      });
      if (existing) throw new Error(`카세트 #${cassetteNumber}은(는) 이미 등록되어 있습니다.`);

      const c = await tx.cassette.create({
        data: { machineId, cassetteNumber, drugName, drugCode, currentInventory },
        include: { machine: { select: { name: true } } },
      });
      await tx.inventoryHistory.create({
        data: {
          cassetteId: c.id,
          type: "INITIAL_INVENTORY",
          quantityBefore: 0,
          changeQuantity: currentInventory,
          quantityAfter: currentInventory,
          memo: "재고조사 중 카세트 신규 등록",
        },
      });
      return c;
    });

    return ok(cassette);
  });
}
