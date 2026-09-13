import { prisma } from "@/lib/prisma";
import { ok, handle } from "@/lib/api";
import { updateCassetteSettings } from "@/lib/services/inventoryService";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const cassette = await prisma.cassette.findUnique({
      where: { id: params.id },
      include: { machine: { select: { name: true } } },
    });
    return ok(cassette);
  });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return handle(async () => {
    const body = await req.json();
    await updateCassetteSettings({ cassetteId: params.id, data: body });
    const updated = await prisma.cassette.findUnique({
      where: { id: params.id },
      include: { machine: { select: { name: true } } },
    });
    return ok(updated);
  });
}
