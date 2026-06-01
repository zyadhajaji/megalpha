"""
MEGALPHA Journal — SQLite persistence for trade journal entries.
DB file: server/journal.db  (gitignored)
Schema : entries(id, date, title, body, created_at, updated_at)
"""
import json as _json
import sqlite3
import time
from pathlib import Path

DB_PATH = Path(__file__).parent / "journal.db"


def _conn() -> sqlite3.Connection:  # type: ignore[return]
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _conn() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS entries (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                date       TEXT    NOT NULL DEFAULT '',
                title      TEXT    NOT NULL DEFAULT 'Untitled',
                body       TEXT    NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS signals (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                coin       TEXT    NOT NULL,
                interval   TEXT    NOT NULL,
                time       INTEGER NOT NULL,
                signal     TEXT    NOT NULL,
                confidence INTEGER NOT NULL,
                reasoning  TEXT    NOT NULL DEFAULT '',
                price      REAL    NOT NULL,
                support    REAL    NOT NULL DEFAULT 0,
                resistance REAL    NOT NULL DEFAULT 0,
                summary    TEXT    NOT NULL DEFAULT '{}',
                created_at INTEGER NOT NULL
            )
        """)
        # Non-destructive migration: add summary column if it doesn't exist yet
        try:
            db.execute("ALTER TABLE signals ADD COLUMN summary TEXT NOT NULL DEFAULT '{}'")
        except Exception:
            pass   # column already exists
        for col_sql in [
            "ALTER TABLE signals ADD COLUMN outcome    TEXT    NOT NULL DEFAULT 'PENDING'",
            "ALTER TABLE signals ADD COLUMN exit_price REAL    NOT NULL DEFAULT 0",
            "ALTER TABLE signals ADD COLUMN exit_time  INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE signals ADD COLUMN pnl_pct    REAL    NOT NULL DEFAULT 0",
        ]:
            try:
                db.execute(col_sql)
            except Exception:
                pass   # column already exists


# ─── CRUD ─────────────────────────────────────────────────────────────────────

def list_entries() -> list[dict]:
    with _conn() as db:
        rows = db.execute(
            "SELECT id, date, title, created_at, updated_at "
            "FROM entries ORDER BY created_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def get_entry(entry_id: int) -> dict | None:
    with _conn() as db:
        row = db.execute(
            "SELECT * FROM entries WHERE id = ?", (entry_id,)
        ).fetchone()
    return dict(row) if row else None


def create_entry(date: str, title: str, body: str) -> dict:
    now = int(time.time())
    with _conn() as db:
        cur = db.execute(
            "INSERT INTO entries (date, title, body, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (date, title, body, now, now),
        )
        entry_id = cur.lastrowid
    return get_entry(entry_id)  # type: ignore[return-value]


def update_entry(entry_id: int, date: str, title: str, body: str) -> dict | None:
    now = int(time.time())
    with _conn() as db:
        db.execute(
            "UPDATE entries SET date=?, title=?, body=?, updated_at=? WHERE id=?",
            (date, title, body, now, entry_id),
        )
    return get_entry(entry_id)


def delete_entry(entry_id: int) -> bool:
    with _conn() as db:
        cur = db.execute("DELETE FROM entries WHERE id = ?", (entry_id,))
    return cur.rowcount > 0


# ── Signal CRUD ────────────────────────────────────────────────────────────────

def save_signal(sig: dict) -> dict:
    summary_json = _json.dumps(sig.get("summary") or {})
    with _conn() as db:
        cur = db.execute(
            "INSERT INTO signals (coin, interval, time, signal, confidence, reasoning, "
            "price, support, resistance, summary, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                sig["coin"], sig["interval"], sig["time"], sig["signal"],
                sig["confidence"], sig["reasoning"], sig["price"],
                sig["support"], sig["resistance"], summary_json, sig["created_at"],
            ),
        )
        sig_id = cur.lastrowid
    return {**sig, "id": sig_id}


def _row_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    raw = d.get("summary", "{}")
    try:
        d["summary"] = _json.loads(raw) if raw else {}
    except Exception:
        d["summary"] = {}
    return d


def get_signals(coin: str, interval: str, limit: int = 100) -> list[dict]:
    """Only returns LONG/SHORT signals — HOLD is never shown on charts."""
    with _conn() as db:
        rows = db.execute(
            "SELECT * FROM signals WHERE coin=? AND interval=? "
            "AND signal IN ('LONG','SHORT') "
            "ORDER BY time DESC LIMIT ?",
            (coin, interval, limit),
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_latest_signal(coin: str, interval: str) -> dict | None:
    rows = get_signals(coin, interval, limit=1)
    return rows[0] if rows else None


def get_all_latest_signals(interval: str = "1h", limit: int = 200) -> list[dict]:
    """Return the most recent LONG/SHORT signal per coin — HOLD excluded."""
    with _conn() as db:
        rows = db.execute(
            """
            SELECT * FROM signals
            WHERE interval=? AND signal IN ('LONG','SHORT')
            AND id IN (
                SELECT MAX(id) FROM signals
                WHERE interval=? AND signal IN ('LONG','SHORT')
                GROUP BY coin
            )
            ORDER BY confidence DESC LIMIT ?
            """,
            (interval, interval, limit),
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def update_signal_outcome(
    signal_id: int,
    outcome: str,      # "WIN" | "LOSS" | "EXPIRED"
    exit_price: float,
    exit_time: int,
    pnl_pct: float,
) -> None:
    with _conn() as db:
        db.execute(
            "UPDATE signals SET outcome=?, exit_price=?, exit_time=?, pnl_pct=? WHERE id=?",
            (outcome, exit_price, exit_time, pnl_pct, signal_id),
        )


def get_pending_signals() -> list[dict]:
    """Return all LONG/SHORT signals still awaiting outcome."""
    with _conn() as db:
        rows = db.execute(
            "SELECT * FROM signals WHERE signal IN ('LONG','SHORT') AND outcome='PENDING'"
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_signal_stats() -> dict:
    """Aggregate performance stats across all resolved signals."""
    with _conn() as db:
        total = db.execute(
            "SELECT COUNT(*) FROM signals WHERE signal IN ('LONG','SHORT')"
        ).fetchone()[0]
        wins = db.execute(
            "SELECT COUNT(*) FROM signals WHERE outcome='WIN' AND signal IN ('LONG','SHORT')"
        ).fetchone()[0]
        losses = db.execute(
            "SELECT COUNT(*) FROM signals WHERE outcome='LOSS' AND signal IN ('LONG','SHORT')"
        ).fetchone()[0]
        pending = db.execute(
            "SELECT COUNT(*) FROM signals WHERE outcome='PENDING' AND signal IN ('LONG','SHORT')"
        ).fetchone()[0]
        avg_win_row = db.execute(
            "SELECT AVG(pnl_pct) FROM signals WHERE outcome='WIN'"
        ).fetchone()
        avg_loss_row = db.execute(
            "SELECT AVG(pnl_pct) FROM signals WHERE outcome='LOSS'"
        ).fetchone()
        best_row = db.execute(
            "SELECT coin, interval, pnl_pct, created_at FROM signals "
            "WHERE outcome='WIN' ORDER BY pnl_pct DESC LIMIT 1"
        ).fetchone()
        worst_row = db.execute(
            "SELECT coin, interval, pnl_pct, created_at FROM signals "
            "WHERE outcome='LOSS' ORDER BY pnl_pct ASC LIMIT 1"
        ).fetchone()
    win_rate = wins / (wins + losses) if (wins + losses) > 0 else 0
    return {
        "total": total, "wins": wins, "losses": losses, "pending": pending,
        "win_rate": round(win_rate * 100, 1),
        "avg_win_pct":  round(avg_win_row[0]  or 0, 2),
        "avg_loss_pct": round(avg_loss_row[0] or 0, 2),
        "best":  dict(best_row)  if best_row  else None,
        "worst": dict(worst_row) if worst_row else None,
    }
