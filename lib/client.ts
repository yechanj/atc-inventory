"use client";

/** 공통 fetch — { ok, data } 규약 처리 및 에러 메시지 throw */
export async function apiFetch<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers:
      init?.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json", ...(init?.headers ?? {}) }
        : init?.headers,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    throw new Error(`서버 응답 오류 (${res.status})`);
  }
  if (!res.ok || !json?.ok) {
    const err = new Error(json?.error ?? `요청 실패 (${res.status})`);
    (err as any).code = json?.code;
    (err as any).status = res.status;
    (err as any).payload = json;
    throw err;
  }
  return json.data as T;
}

export function fmt(n: number | null | undefined): string {
  if (n == null) return "-";
  const r = Math.round(n * 100) / 100;
  return r.toLocaleString("ko-KR");
}

export function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "-";
  const d = new Date(s);
  return d.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return "-";
  return new Date(s).toLocaleDateString("ko-KR");
}
