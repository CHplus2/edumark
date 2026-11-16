import os
import sqlite3
from pathlib import Path

DB_PATH = Path(os.getenv("EDUMARK_DB", Path(__file__).resolve().parents[2] / "data" / "edumark.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'essay',
  total_marks REAL NOT NULL DEFAULT 100,
  instructions TEXT NOT NULL DEFAULT '',
  reference_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student TEXT NOT NULL,
  filename TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | marking | marked | error
  error TEXT,
  ai_score REAL,
  ai_feedback TEXT,
  criteria_json TEXT,
  confidence TEXT,
  score REAL,                               -- lecturer's score (editable)
  feedback TEXT,                            -- lecturer's feedback (editable)
  final INTEGER NOT NULL DEFAULT 0
);
"""


def conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=30)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    return c


def init() -> None:
    with conn() as c:
        c.executescript(SCHEMA)
