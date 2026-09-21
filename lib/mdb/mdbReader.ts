import { execFile } from "child_process";
import path from "path";

const SCRIPT_PATH = path.join(process.cwd(), "scripts", "query_mdb.py");
export const MDB_START_DATE = process.env.MDB_START_DATE ?? "2026-09-22";

export interface MdbRow {
  historyIndex: number;
  fillDate: string | null; // 'YYYY-MM-DD'
  canister: number;
  mnemonic: string;
  totalUsedQty: number;
}

function runPython(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "python",
      [SCRIPT_PATH, ...args],
      { timeout: 20000 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr.trim() || err.message));
        } else {
          resolve(stdout.trim());
        }
      }
    );
  });
}

/** start_date 이전의 MAX(history_index) 반환. MdbSyncState 초기화 시 사용. */
export async function getInitialLastIndex(mdbPath: string, mdbPassword: string): Promise<number> {
  const out = await runPython(["init", mdbPath, mdbPassword, MDB_START_DATE]);
  const parsed = JSON.parse(out) as { lastIndex: number };
  return parsed.lastIndex;
}

/**
 * history_index > lastIndex AND canister > 0 인 신규 row 반환.
 * 날짜 필터는 mdbSyncService에서 처리.
 */
export async function fetchNewRows(lastIndex: number, mdbPath: string, mdbPassword: string): Promise<MdbRow[]> {
  const out = await runPython(["sync", mdbPath, mdbPassword, String(lastIndex)]);
  return JSON.parse(out) as MdbRow[];
}
