export type CassetteStatus = "NORMAL" | "REFILL" | "UNTRACKED" | "REVIEW";

export interface CassetteLike {
  currentInventory: number;
  refillThreshold: number;
  targetInventory: number;
  packageSize: number;
  trackingStatus: boolean;
  needsReview: boolean;
}

/** 상태 우선순위: 미추적 > 확인필요 > 보충필요 > 정상 */
export function getCassetteStatus(c: CassetteLike): CassetteStatus {
  if (!c.trackingStatus) return "UNTRACKED";
  if (c.needsReview) return "REVIEW";
  if (c.currentInventory <= c.refillThreshold) return "REFILL";
  return "NORMAL";
}

export const STATUS_LABEL: Record<CassetteStatus, string> = {
  NORMAL: "정상",
  REFILL: "보충 필요",
  UNTRACKED: "미추적",
  REVIEW: "확인 필요",
};

/** Tailwind badge 클래스 */
export const STATUS_BADGE: Record<CassetteStatus, string> = {
  NORMAL: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  REFILL: "bg-amber-50 text-amber-800 ring-1 ring-amber-300",
  UNTRACKED: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
  REVIEW: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
};

export interface Recommendation {
  needsRefill: boolean;
  shortage: number; // target - current (>0면 부족)
  packages: number; // ceil(shortage / packageSize)
  /** 사람이 읽는 권장 보충 텍스트 (예: "5포장", "59정", "-") */
  text: string;
}

/** MIN/MAX 방식 권장 보충량 계산. 강제하지 않고 표시만. */
export function getRecommendation(c: CassetteLike): Recommendation {
  const needsRefill = c.trackingStatus && c.currentInventory <= c.refillThreshold;
  const shortage = Math.max(0, c.targetInventory - c.currentInventory);
  const packages =
    c.packageSize > 0 ? Math.ceil(shortage / c.packageSize) : 0;

  let text = "-";
  if (needsRefill && shortage > 0) {
    text = c.packageSize > 1 ? `${packages}포장` : `${round(shortage)}정`;
  }
  return { needsRefill, shortage, packages, text };
}

/** 소수 사용량 대응: 불필요한 .0 제거 */
export function round(n: number): number {
  return Math.round(n * 100) / 100;
}
