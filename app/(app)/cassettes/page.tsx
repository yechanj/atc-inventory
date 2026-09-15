import { prisma } from "@/lib/prisma";
import { getCurrentHospitalId } from "@/lib/hospital";
import { CassettesClient } from "./CassettesClient";
import type { Cassette, Machine } from "@/lib/types";

export default async function CassettesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const [hospitalId, sp] = await Promise.all([
    getCurrentHospitalId(),
    searchParams,
  ]);

  const [cassettes, machines] = await Promise.all([
    prisma.cassette.findMany({
      where: { machine: { hospitalId } },
      include: { machine: { select: { name: true } } },
      orderBy: [{ machine: { name: "asc" } }, { cassetteNumber: "asc" }],
    }),
    prisma.machine.findMany({
      where: { hospitalId },
      include: { _count: { select: { cassettes: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <CassettesClient
      initialRows={cassettes as unknown as Cassette[]}
      initialMachines={machines as unknown as Machine[]}
      initialStatus={sp?.status ?? "ALL"}
    />
  );
}
