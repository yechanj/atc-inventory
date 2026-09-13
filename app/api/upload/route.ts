import { getCurrentHospitalId } from "@/lib/hospital";
import { ok, fail, handle } from "@/lib/api";
import {
  prepareSnapshot,
  DuplicateSnapshotError,
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
      if (e instanceof DuplicateSnapshotError) {
        return fail("동일한 파일이 이미 업로드/반영되었습니다. 중복 반영이 차단되었습니다.", 409, {
          code: "DUPLICATE",
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
