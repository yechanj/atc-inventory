export type CassetteStatus = "NORMAL" | "REFILL" | "UNTRACKED" | "REVIEW";

export interface CassetteLike {
  currentInventory: number;
  refillThreshold: number;
  recommendedPackages: number | null;
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
  recommendedPackages: number | null;
  text: string;
}

export function getRecommendation(c: CassetteLike): Recommendation {
  const needsRefill = c.trackingStatus && c.currentInventory <= c.refillThreshold;
  const recommended = c.recommendedPackages ?? null;

  let text = "-";
  if (needsRefill) {
    text = recommended != null ? `${recommended}통` : "미설정";
  }
  return { needsRefill, recommendedPackages: recommended, text };
}

/** 소수 사용량 대응: 불필요한 .0 제거 */
export function round(n: number): number {
  return Math.round(n * 100) / 100;
}
