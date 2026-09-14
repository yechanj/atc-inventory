import { prisma } from "@/lib/prisma";
import { parseUsageFile } from "@/lib/pampro/parseUsageFile";

/**
 * 카세트 마스터 부트스트랩.
 * 업로드된 PamPro 파일(1개 이상)에서 캐니스터번호 목록을 뽑아 카세트를 생성한다.
 * - 여러 파일을 합쳐 캐니스터 집합의 합집합을 구성(하루 안 쓰인 카세트도 포함되도록).
 * - 한 캐니스터에 여러 약품이 있었다면 총 사용량이 가장 큰 약품을 대표로 지정.
 * - 현재고는 전부 initialInventory(기본 1000)로 설정 + INITIAL_INVENTORY history.
 * 이미 존재하는 카세트는 건너뛴다(idempotent).
 */
export interface BootstrapDefaults {
  initialInventory?: number;
  packageSize?: number;
  refillThreshold?: number;
}

interface Candidate {
  drugCode: string | null;
  drugName: string;
  usage: number;
}

export async function bootstrapFromBuffers(params: {
  hospitalId: string;
  buffers: Buffer[];
  defaults?: BootstrapDefaults;
  /** 지정 시 해당 장비(호기)만 카세트로 생성. 미지정이면 전체. */
  includeMachines?: string[];
}): Promise<{ machinesCreated: number; cassettesCreated: number; cassettesSkipped: number }> {
  const { hospitalId, buffers, defaults = {}, includeMachines } = params;
  const initialInventory = defaults.initialInventory ?? 1000;
  const packageSize = defaults.packageSize ?? 100;
  const refillThreshold = defaults.refillThreshold ?? 200;

  // machineName -> cassetteNumber -> (drugCode -> Candidate)
  const master = new Map<string, Map<number, Map<string, Candidate>>>();

  for (const buf of buffers) {
    const parsed = parseUsageFile(buf);
    for (const a of parsed.aggregated) {
      const mName = a.machineName;
      if (includeMachines && !includeMachines.includes(mName)) continue;
      if (!master.has(mName)) master.set(mName, new Map());
      const byNum = master.get(mName)!;
      if (!byNum.has(a.cassetteNumber)) byNum.set(a.cassetteNumber, new Map());
      const byCode = byNum.get(a.cassetteNumber)!;
      const codeKey = a.drugCode ?? "";
      const prev = byCode.get(codeKey);
      if (prev) {
        prev.usage += a.cumulativeUsage;
      } else {
        byCode.set(codeKey, {
          drugCode: a.drugCode,
          drugName: a.drugName,
          usage: a.cumulativeUsage,
        });
      }
    }
  }

  let machinesCreated = 0;
  let cassettesCreated = 0;
  let cassettesSkipped = 0;

  for (const [machineName, byNum] of master) {
    // 머신 upsert
    let machine = await prisma.machine.findUnique({
      where: { hospitalId_name: { hospitalId, name: machineName } },
    });
    if (!machine) {
      machine = await prisma.machine.create({
        data: { hospitalId, name: machineName },
      });
      machinesCreated += 1;
    }

    for (const [cassetteNumber, byCode] of byNum) {
      const existing = await prisma.cassette.findUnique({
        where: {
          machineId_cassetteNumber: { machineId: machine.id, cassetteNumber },
        },
      });
      if (existing) {
        cassettesSkipped += 1;
        continue;
      }
      // 대표 약품 = 총 사용량 최대
      const rep = Array.from(byCode.values()).sort((a, b) => b.usage - a.usage)[0];

      await prisma.$transaction(async (tx) => {
        const cassette = await tx.cassette.create({
          data: {
            machineId: machine!.id,
            cassetteNumber,
            drugCode: rep.drugCode,
            drugName: rep.drugName,
            currentInventory: initialInventory,
            packageSize,
            refillThreshold,
          },
        });
        await tx.inventoryHistory.create({
          data: {
            cassetteId: cassette.id,
            type: "INITIAL_INVENTORY",
            quantityBefore: 0,
            changeQuantity: initialInventory,
            quantityAfter: initialInventory,
            memo: "초기 재고 부트스트랩 (임시 1000정)",
          },
        });
      });
      cassettesCreated += 1;
    }
  }

  return { machinesCreated, cassettesCreated, cassettesSkipped };
}
