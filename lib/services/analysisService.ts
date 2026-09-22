export interface AnalysisItem {
  cassetteId: string | null;
  machineName: string;
  cassetteNumber: number;
  drugName: string;
  drugCode: string | null;
  dailyAvg30: number;
  dailyAvg30Wd: number;
  daysInWindow: number;
  weekdaysInWindow: number;
  currentThreshold: number;
  lowSample: boolean;
  dayOfWeekUsage: number[]; // [월, 화, 수, 목, 금, 토, 일]
}

export interface AnalysisGetResponse {
  items: AnalysisItem[];
  snapshotCount: number;
}

export type TimelineMap = Map<string, { date: Date; usage: number }[]>;

type CassetteInfo = {
  id: string;
  cassetteNumber: number;
  refillThreshold: number;
  drugCode: string | null;
  machine: { name: string };
};

export function computeAnalysisItems(
  timeline: TimelineMap,
  drugNameMap: Map<string, string>,
  cassettes: CassetteInfo[]
): AnalysisItem[] {
  const cassetteMap = new Map(cassettes.map((c) => [`${c.machine.name}::${c.cassetteNumber}`, c]));

  const shortKeyMap = new Map<
    string,
    { domPoints: { date: Date; usage: number }[]; domDrugName: string; dowValues: number[][] }
  >();

  for (const [key, points] of timeline) {
    const parts = key.split("::");
    const shortKey = `${parts[0]}::${parts[1]}`;
    const drugName = drugNameMap.get(key) ?? "";

    const dowArrays: number[][] = Array.from({ length: 7 }, () => []);
    for (const point of points) {
      if (point.usage > 0) {
        const rawDay = point.date.getUTCDay();
        const monFirst = rawDay === 0 ? 6 : rawDay - 1;
        dowArrays[monFirst].push(point.usage);
      }
    }

    const ex = shortKeyMap.get(shortKey);
    if (!ex) {
      shortKeyMap.set(shortKey, { domPoints: points, domDrugName: drugName, dowValues: dowArrays });
    } else {
      for (let d = 0; d < 7; d++) ex.dowValues[d].push(...dowArrays[d]);
      if (points.length > ex.domPoints.length) {
        ex.domPoints = points;
        ex.domDrugName = drugName;
      }
    }
  }

  const results: AnalysisItem[] = [];

  for (const [shortKey, { domPoints, domDrugName, dowValues }] of shortKeyMap) {
    const hasData = domPoints.some((p) => p.usage > 0);
    if (!hasData) continue;

    const [machineName, cassetteNumberStr] = shortKey.split("::");
    const cassetteNumber = Number(cassetteNumberStr);

    const endDate = domPoints[domPoints.length - 1].date;
    const cutoff = new Date(endDate.getTime() - 30 * 86400000);
    const windowPoints = domPoints.filter((p) => p.date >= cutoff && p.usage > 0);

    const daysInWindow = windowPoints.length;
    const totalUsage = windowPoints.reduce((s, p) => s + p.usage, 0);
    const dailyAvg30 =
      daysInWindow > 0 ? Math.round((totalUsage / daysInWindow) * 10) / 10 : 0;
    const lowSample = daysInWindow < 3;

    const weekdayPoints = windowPoints.filter((p) => {
      const d = p.date.getUTCDay();
      return d !== 0 && d !== 6;
    });
    const weekdaysInWindow = weekdayPoints.length;
    const weekdayUsage = weekdayPoints.reduce((s, p) => s + p.usage, 0);
    const dailyAvg30Wd =
      weekdaysInWindow > 0
        ? Math.round((weekdayUsage / weekdaysInWindow) * 10) / 10
        : dailyAvg30;

    const avg = (arr: number[]) =>
      arr.length === 0 ? 0 : Math.round((arr.reduce((s: number, v: number) => s + v, 0) / arr.length) * 10) / 10;

    const dayOfWeekUsage = dowValues.map(avg);
    const cassette = cassetteMap.get(shortKey) ?? null;

    results.push({
      cassetteId: cassette?.id ?? null,
      machineName,
      cassetteNumber,
      drugName: domDrugName,
      drugCode: cassette?.drugCode ?? null,
      dailyAvg30,
      dailyAvg30Wd,
      daysInWindow: Math.round(daysInWindow),
      weekdaysInWindow,
      currentThreshold: cassette?.refillThreshold ?? 0,
      lowSample,
      dayOfWeekUsage,
    });
  }

  results.sort((a, b) => {
    if ((a.cassetteId === null) !== (b.cassetteId === null))
      return a.cassetteId === null ? 1 : -1;
    if (a.machineName !== b.machineName) return a.machineName.localeCompare(b.machineName);
    return a.cassetteNumber - b.cassetteNumber;
  });

  return results;
}
