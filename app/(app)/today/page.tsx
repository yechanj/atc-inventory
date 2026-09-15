import { prisma } from "@/lib/prisma";
import { getCurrentHospitalId } from "@/lib/hospital";
import { getCassetteStatus } from "@/lib/status";
import { TodayClient } from "./TodayClient";
import type { Cassette } from "@/lib/types";

export default async function TodayPage() {
  const hospitalId = await getCurrentHospitalId();

  const cassettes = await prisma.cassette.findMany({
    where: { machine: { hospitalId } },
    include: { machine: { select: { name: true } } },
    orderBy: [{ machine: { name: "asc" } }, { cassetteNumber: "asc" }],
  });

  const rows = cassettes.filter((c) => {
    const s = getCassetteStatus(c as any);
    return s === "REFILL" || (s === "REVIEW" && c.currentInventory <= c.refillThreshold);
  });

  return <TodayClient initialRows={rows as unknown as Cassette[]} />;
}
