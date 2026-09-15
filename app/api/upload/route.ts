import { getCurrentHospitalId } from "@/lib/hospital";
import { ok, fail, handle } from "@/lib/api";
import {
  prepareSnapshot,
  ExistingPendingError,
  ParseError,
} from "@/lib/services/snapshotService";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return fail("파일이 없습니다.");
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const hospitalId = await getCurrentHospitalId();

    const parseDate = (s: FormDataEntryValue | null) =>
      typeof s === "string" && s ? new Date(s + "T00:00:00Z") : undefined;

    try {
      const preview = await prepareSnapshot({
        hospitalId,
        originalFilename: file.name,
        buffer,
        queryPeriodStart: parseDate(form.get("queryPeriodStart")),
        queryPeriodEnd: parseDate(form.get("queryPeriodEnd")),
      });
      return ok(preview);
    } catch (e) {
      if (e instanceof ExistingPendingError) {
        return fail("대기 중인 파일이 있습니다. 먼저 반영하거나 취소하세요.", 409, {
          code: "EXISTING_PENDING",
          existingId: e.existingId,
        });
      }
      if (e instanceof ParseError) {
        return fail(`파일을 읽을 수 없습니다: ${e.message}`, 422, { code: "PARSE_ERROR" });
      }
      throw e;
    }
  });
}
