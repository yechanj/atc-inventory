export interface Cassette {
  id: string;
  machineId: string;
  cassetteNumber: number;
  drugCode: string | null;
  drugName: string;
  currentInventory: number;
  packageSize: number;
  refillThreshold: number;
  recommendedPackages: number | null;
  fullCapacity: number | null;
  trackingStatus: boolean;
  needsReview: boolean;
  lastAdjustedAt: string | null;
  updatedAt: string;
  machine: { name: string };
}

export interface Machine {
  id: string;
  name: string;
  _count?: { cassettes: number };
}

export interface DashboardData {
  total: number;
  refillNeeded: number;
  reviewNeeded: number;
  appliedToday: boolean;
  lastAppliedAt: string | null;
  lastAppliedFile: string | null;
  lastStocktakeAt: string | null;
  pendingCount: number;
}

export interface PreviewLine {
  cassetteNumber: number | null;
  drugCode: string | null;
  drugName: string;
  cumulativeUsage: number;
  count: number | null;
  matchStatus: "MATCHED" | "UNMATCHED" | "NO_CASSETTE";
  matchNote?: string;
  cassetteId: string | null;
  currentInventory: number | null;
  previousUsage: number | null;
  newUsage: number | null;
  decreaseFlag: boolean;
  projectedInventory: number | null;
}

export interface Preview {
  snapshotId: string;
  originalFilename: string;
  status?: string;
  isBaseline: boolean;
  queryPeriodStart?: string | null;
  queryPeriodEnd?: string | null;
  matchedCount: number;
  applicableCount: number;
  decreaseCount: number;
  unmatchedCount: number;
  nonCassetteCount: number;
  totalNewUsage: number;
  warnings: string[];
  lines: PreviewLine[];
}

export interface UploadLogEntry {
  id: string;
  originalFilename: string;
  appliedAt: string | null;
  queryPeriodStart: string | null;
  uploadedAt: string;
}

export interface HistoryRow {
  id: string;
  type: string;
  quantityBefore: number;
  changeQuantity: number;
  quantityAfter: number;
  memo: string | null;
  createdAt: string;
  cassette: {
    cassetteNumber: number;
    drugName: string;
    machine: { name: string };
  };
}
