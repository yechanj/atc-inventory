import fs from "fs";
import path from "path";
import { prisma } from "../lib/prisma";
import { getCurrentHospitalId } from "../lib/hospital";
import { bootstrapFromBuffers } from "../lib/services/bootstrapService";

/**
 * 초기 시드: sample-data의 모든 PamPro 파일에서 카세트 마스터를 생성(현재고 1000).
 * 실제 재고조사 전 테스트용 데이터.
 */
async function main() {
  const hospitalId = await getCurrentHospitalId();

  const dir = path.join(process.cwd(), "sample-data");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".xls"))
    .sort();

  if (files.length === 0) {
    console.log("sample-data에 .xls 파일이 없습니다.");
    return;
  }

  const buffers = files.map((f) => fs.readFileSync(path.join(dir, f)));
  console.log(`부트스트랩 대상 파일: ${files.join(", ")}`);

  // 현재는 1호기만 운영. (2호기 등 다른 장비는 제외 — 향후 필요 시 배열에 추가)
  const result = await bootstrapFromBuffers({
    hospitalId,
    buffers,
    includeMachines: ["1호기"],
  });
  console.log(
    `완료 — 장비 ${result.machinesCreated}개 생성, 카세트 ${result.cassettesCreated}개 생성, ${result.cassettesSkipped}개 건너뜀`
  );

  const total = await prisma.cassette.count();
  console.log(`총 카세트 수: ${total}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
