"""ATC 재고 자동차감 에이전트"""

import json
import os
import sys
import time
import threading
import datetime
import urllib.request
import urllib.error
import tkinter as tk
from tkinter import ttk, filedialog, scrolledtext

BASE_DIR = os.path.dirname(sys.executable if getattr(sys, "frozen", False) else os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")

DEFAULT_CONFIG = {
    "mdb_path": "",
    "mdb_password": "JVDV",
    "api_url": "",
    "agent_key": "",
    "interval_seconds": 5,
}


def load_config() -> dict:
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, encoding="utf-8") as f:
            cfg = json.load(f)
        return {**DEFAULT_CONFIG, **cfg}
    return dict(DEFAULT_CONFIG)


def save_config(cfg: dict):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def get_server_state(api_url: str, agent_key: str) -> dict:
    req = urllib.request.Request(
        f"{api_url}/api/mdb-agent",
        headers={"x-agent-key": agent_key},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode())
        return data.get("data", {})


def query_init_index(mdb_path: str, mdb_password: str, start_date: str) -> int:
    import pyodbc
    conn = pyodbc.connect(
        f"DRIVER={{Microsoft Access Driver (*.mdb, *.accdb)}};"
        f"DBQ={mdb_path};PWD={mdb_password};Mode=Read;",
        autocommit=True,
    )
    cursor = conn.cursor()
    cursor.execute(
        f"SELECT MAX(history_index) FROM used_medicine_history WHERE fill_date < #{start_date}#"
    )
    row = cursor.fetchone()
    conn.close()
    return int(row[0]) if row[0] is not None else 0


def set_last_index(api_url: str, agent_key: str, last_index: int) -> None:
    payload = json.dumps({"lastIndex": last_index}).encode("utf-8")
    req = urllib.request.Request(
        f"{api_url}/api/mdb-agent",
        data=payload,
        headers={"x-agent-key": agent_key, "Content-Type": "application/json"},
        method="PATCH",
    )
    urllib.request.urlopen(req, timeout=15)


def query_mdb(mdb_path: str, mdb_password: str, last_index: int) -> list:
    import pyodbc
    conn = pyodbc.connect(
        f"DRIVER={{Microsoft Access Driver (*.mdb, *.accdb)}};"
        f"DBQ={mdb_path};PWD={mdb_password};Mode=Read;",
        autocommit=True,
    )
    cursor = conn.cursor()
    cursor.execute(
        "SELECT history_index, fill_date, canister, mnemonic, commercial_name, total_used_qty "
        "FROM used_medicine_history "
        "WHERE history_index > ? AND canister > 0 "
        "ORDER BY history_index ASC",
        (last_index,),
    )
    rows = []
    for r in cursor.fetchall():
        fd = r[1]
        rows.append({
            "historyIndex": int(r[0]),
            "fillDate": fd.strftime("%Y-%m-%d") if fd else None,
            "canister": int(r[2]),
            "drugCode": str(r[3] or ""),
            "drugName": str(r[4] or ""),
            "totalUsedQty": float(r[5] or 0),
        })
    conn.close()
    return rows


BATCH_SIZE = 300

def post_rows(api_url: str, agent_key: str, rows: list) -> dict:
    last_result = {}
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        payload = json.dumps({"rows": batch}).encode("utf-8")
        req = urllib.request.Request(
            f"{api_url}/api/mdb-agent",
            data=payload,
            headers={"x-agent-key": agent_key, "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            last_result = json.loads(resp.read().decode())
    return last_result


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("ATC 재고 에이전트")
        self.resizable(False, False)
        self.protocol("WM_DELETE_WINDOW", self._on_close)

        self.cfg = load_config()
        self._running = False
        self._thread: threading.Thread | None = None
        self._last_index = 0

        self._build_ui()
        self._load_fields()

        # 설정이 다 채워져 있으면 자동 시작
        if self.cfg["mdb_path"] and self.cfg["api_url"] and self.cfg["agent_key"]:
            self.after(500, self._start)

    # ── UI 구성 ──────────────────────────────────────────
    def _build_ui(self):
        pad = {"padx": 10, "pady": 5}

        # 설정 프레임
        frm = ttk.LabelFrame(self, text="설정", padding=10)
        frm.grid(row=0, column=0, sticky="ew", **pad)
        frm.columnconfigure(1, weight=1)

        ttk.Label(frm, text="MDB 파일").grid(row=0, column=0, sticky="w")
        self.var_path = tk.StringVar()
        ttk.Entry(frm, textvariable=self.var_path, width=48).grid(row=0, column=1, sticky="ew", padx=(4, 2))
        ttk.Button(frm, text="찾아보기", command=self._browse).grid(row=0, column=2)

        ttk.Label(frm, text="비밀번호").grid(row=1, column=0, sticky="w", pady=(4, 0))
        self.var_pw = tk.StringVar()
        ttk.Entry(frm, textvariable=self.var_pw, show="*", width=24).grid(row=1, column=1, sticky="w", padx=(4, 0), pady=(4, 0))

        ttk.Label(frm, text="서버 주소").grid(row=2, column=0, sticky="w", pady=(4, 0))
        self.var_url = tk.StringVar()
        ttk.Entry(frm, textvariable=self.var_url, width=48).grid(row=2, column=1, columnspan=2, sticky="ew", padx=(4, 0), pady=(4, 0))

        ttk.Label(frm, text="API 키").grid(row=3, column=0, sticky="w", pady=(4, 0))
        self.var_key = tk.StringVar()
        ttk.Entry(frm, textvariable=self.var_key, width=48).grid(row=3, column=1, columnspan=2, sticky="ew", padx=(4, 0), pady=(4, 0))

        btn_row = ttk.Frame(frm)
        btn_row.grid(row=4, column=0, columnspan=3, sticky="e", pady=(8, 0))
        ttk.Button(btn_row, text="저장", command=self._save).pack(side="left", padx=4)
        self.btn_toggle = ttk.Button(btn_row, text="시작", command=self._toggle)
        self.btn_toggle.pack(side="left")

        # 상태 바
        status_frm = ttk.Frame(self, padding=(10, 2))
        status_frm.grid(row=1, column=0, sticky="ew")
        self.lbl_status = ttk.Label(status_frm, text="● 대기 중", foreground="gray")
        self.lbl_status.pack(side="left")
        self.lbl_last = ttk.Label(status_frm, text="", foreground="gray")
        self.lbl_last.pack(side="right")

        # 로그
        log_frm = ttk.LabelFrame(self, text="로그", padding=6)
        log_frm.grid(row=2, column=0, sticky="nsew", padx=10, pady=(0, 10))
        self.log_box = scrolledtext.ScrolledText(log_frm, height=12, width=70, state="disabled", font=("Consolas", 9))
        self.log_box.pack(fill="both", expand=True)

    def _browse(self):
        path = filedialog.askopenfilename(
            title="Used_Medicine_History.mdb 선택",
            filetypes=[("Access DB", "*.mdb *.accdb"), ("모든 파일", "*.*")],
        )
        if path:
            self.var_path.set(path)

    def _load_fields(self):
        self.var_path.set(self.cfg.get("mdb_path", ""))
        self.var_pw.set(self.cfg.get("mdb_password", ""))
        self.var_url.set(self.cfg.get("api_url", ""))
        self.var_key.set(self.cfg.get("agent_key", ""))

    def _save(self):
        self.cfg.update({
            "mdb_path": self.var_path.get().strip(),
            "mdb_password": self.var_pw.get().strip(),
            "api_url": self.var_url.get().strip().rstrip("/"),
            "agent_key": self.var_key.get().strip(),
        })
        save_config(self.cfg)
        self._log("설정 저장 완료")

    # ── 동기화 루프 ──────────────────────────────────────
    def _toggle(self):
        if self._running:
            self._stop()
        else:
            self._save()
            self._start()

    def _start(self):
        if self._running:
            return
        cfg = self.cfg
        if not cfg["mdb_path"] or not cfg["api_url"] or not cfg["agent_key"]:
            self._log("설정을 먼저 입력하세요 (MDB 파일 / 서버 주소 / API 키)")
            return

        self._running = True
        self.btn_toggle.config(text="중지")
        self.lbl_status.config(text="● 실행 중", foreground="#16a34a")

        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def _stop(self):
        self._running = False
        self.btn_toggle.config(text="시작")
        self.lbl_status.config(text="● 중지됨", foreground="gray")

    def _loop(self):
        cfg = self.cfg
        try:
            state = get_server_state(cfg["api_url"], cfg["agent_key"])
            self._last_index = state.get("lastIndex", 0)
            start_date = state.get("startDate", "2026-09-22")
            self._log(f"서버 연결 완료 — lastIndex: {self._last_index:,}")

            if self._last_index == 0:
                self._log(f"초기 lastIndex 계산 중 (기준일: {start_date})…")
                init_index = query_init_index(cfg["mdb_path"], cfg["mdb_password"], start_date)
                set_last_index(cfg["api_url"], cfg["agent_key"], init_index)
                self._last_index = init_index
                self._log(f"초기 lastIndex 설정 완료: {init_index:,}")
        except Exception as e:
            self._log(f"서버 연결 실패: {e}")

        while self._running:
            try:
                rows = query_mdb(cfg["mdb_path"], cfg["mdb_password"], self._last_index)
                if rows:
                    result = post_rows(cfg["api_url"], cfg["agent_key"], rows)
                    data = result.get("data", {})
                    self._last_index = data.get("lastIndex", self._last_index)
                    self._log(
                        f"+{len(rows)}건 → 처리 {data.get('processed', 0)}, "
                        f"차감 {data.get('matched', 0)}, 미매칭 {data.get('skipped', 0)}"
                    )
                    self.after(0, self._update_last_sync)
            except urllib.error.HTTPError as e:
                self._log(f"서버 오류 {e.code}: {e.reason}")
            except urllib.error.URLError as e:
                self._log(f"연결 오류: {e.reason}")
            except Exception as e:
                self._log(f"오류: {e}")

            interval = int(self.cfg.get("interval_seconds", 10))
            for _ in range(interval * 10):
                if not self._running:
                    break
                time.sleep(0.1)

    def _update_last_sync(self):
        ts = datetime.datetime.now().strftime("%H:%M:%S")
        self.lbl_last.config(text=f"마지막 동기화: {ts}")

    def _log(self, msg: str):
        ts = datetime.datetime.now().strftime("%H:%M:%S")
        line = f"[{ts}] {msg}\n"
        self.after(0, lambda: self._append_log(line))

    def _append_log(self, line: str):
        self.log_box.config(state="normal")
        self.log_box.insert("end", line)
        self.log_box.see("end")
        self.log_box.config(state="disabled")

    def _on_close(self):
        self._running = False
        self.destroy()


if __name__ == "__main__":
    app = App()
    app.mainloop()
