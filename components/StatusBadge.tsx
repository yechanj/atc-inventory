import { getCassetteStatus, STATUS_LABEL, STATUS_BADGE, CassetteLike } from "@/lib/status";

export function StatusBadge({ cassette }: { cassette: CassetteLike }) {
  const status = getCassetteStatus(cassette);
  return (
    <span
      className={
        "inline-block rounded-full px-2 py-0.5 text-xs font-medium " +
        STATUS_BADGE[status]
      }
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
