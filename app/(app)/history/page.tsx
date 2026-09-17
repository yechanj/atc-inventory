import { prisma } from "@/lib/prisma";
import { getCurrentHospitalId } from "@/lib/hospital";
import { HistoryClient } from "./HistoryClient";
import type { HistoryRow } from "@/lib/types";

export default async function HistoryPage() {
  const hospitalId = await getCurrentHospitalId();

  const history = await prisma.inventoryHistory.findMany({
    where: { cassette: { machine: { hospitalId } } },
    orderBy: { createdAt: "desc" },
    take: 300,
    include: {
      cassette: {
        select: {
          cassetteNumber: true,
          drugName: true,
          drugCode: true,
          machine: { select: { name: true } },
        },
      },
    },
  });

  return <HistoryClient initialRows={history as unknown as HistoryRow[]} />;
}
