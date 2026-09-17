import { prisma } from "@/lib/prisma";
import { getCurrentHospitalId } from "@/lib/hospital";
import { RefillClient } from "./RefillClient";
import type { HistoryRow } from "@/lib/types";

export default async function RefillPage() {
  const hospitalId = await getCurrentHospitalId();

  const where = { cassette: { machine: { hospitalId } } };
  const include = {
    cassette: {
      select: {
        cassetteNumber: true,
        drugName: true,
        drugCode: true,
        machine: { select: { name: true } },
      },
    },
  };
  const orderBy = { createdAt: "desc" as const };
  const take = 50;

  const [refillHistory, consumeHistory] = await Promise.all([
    prisma.inventoryHistory.findMany({
      where: { ...where, type: "REFILL" },
      include,
      orderBy,
      take,
    }),
    prisma.inventoryHistory.findMany({
      where: { ...where, type: "CONSUMPTION" },
      include,
      orderBy,
      take,
    }),
  ]);

  return (
    <RefillClient
      initialRefillHistory={refillHistory as unknown as HistoryRow[]}
      initialConsumeHistory={consumeHistory as unknown as HistoryRow[]}
    />
  );
}
