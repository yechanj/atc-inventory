#!/usr/bin/env python3
"""
Used_Medicine_History.mdb 쿼리 헬퍼.

모드:
  init <db_path> <password> <start_date>
      → stdout: {"lastIndex": N}
      start_date 이전의 MAX(history_index) 반환.
      첫 실행 시 자동차감 시작 기준점(lastIndex) 계산용.

  sync <db_path> <password> <last_index>
      → stdout: [{historyIndex, fillDate, canister, mnemonic, totalUsedQty}, ...]
      history_index > last_index AND canister > 0 인 신규 row 반환.
      날짜 필터는 TypeScript 쪽에서 처리 (lastIndex 전진을 위해 모든 row 반환).

연결은 Mode=Read; 로 읽기 전용 — LDB 락 파일 생성 없음.
"""

import sys
import json
import pyodbc


def connect(db_path: str, password: str):
    return pyodbc.connect(
        f"DRIVER={{Microsoft Access Driver (*.mdb, *.accdb)}};"
        f"DBQ={db_path};"
        f"PWD={password};"
        f"Mode=Read;",
        autocommit=True,
    )


def main():
    if len(sys.argv) < 4:
        print(json.dumps({"error": "insufficient arguments"}), file=sys.stderr)
        sys.exit(1)

    mode = sys.argv[1]
    db_path = sys.argv[2]
    password = sys.argv[3]

    try:
        conn = connect(db_path, password)
        cursor = conn.cursor()

        if mode == "init":
            if len(sys.argv) < 5:
                print(json.dumps({"error": "init requires start_date"}), file=sys.stderr)
                sys.exit(1)
            start_date = sys.argv[4]
            # start_date 형식 검증 (YYYY-MM-DD)
            if len(start_date) != 10 or start_date[4] != "-" or start_date[7] != "-":
                print(json.dumps({"error": f"invalid date format: {start_date}"}), file=sys.stderr)
                sys.exit(1)
            cursor.execute(
                "SELECT MAX(history_index) FROM used_medicine_history "
                f"WHERE fill_date < #{start_date}#"
            )
            row = cursor.fetchone()
            last_index = int(row[0]) if row[0] is not None else 0
            print(json.dumps({"lastIndex": last_index}))

        elif mode == "sync":
            if len(sys.argv) < 5:
                print(json.dumps({"error": "sync requires last_index"}), file=sys.stderr)
                sys.exit(1)
            last_index = int(sys.argv[4])
            cursor.execute(
                "SELECT history_index, fill_date, canister, mnemonic, commercial_name, total_used_qty "
                "FROM used_medicine_history "
                "WHERE history_index > ? AND canister > 0 "
                "ORDER BY history_index ASC",
                (last_index,),
            )
            rows = []
            for r in cursor.fetchall():
                fill_date = r[1]
                fill_date_str = fill_date.strftime("%Y-%m-%d") if fill_date else None
                rows.append(
                    {
                        "historyIndex": int(r[0]),
                        "fillDate": fill_date_str,
                        "canister": int(r[2]),
                        "drugCode": str(r[3] or ""),
                        "drugName": str(r[4] or ""),
                        "totalUsedQty": float(r[5] or 0),
                    }
                )
            print(json.dumps(rows))

        else:
            print(json.dumps({"error": f"unknown mode: {mode}"}), file=sys.stderr)
            sys.exit(1)

        conn.close()

    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
