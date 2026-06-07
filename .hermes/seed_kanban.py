"""
Initialize the InboxPilot kanban board at:
    ~/.hermes/kanban/boards/inboxpilot/kanban.db

Creates the same schema the PageVault board uses, writes the seed spec
(see seed_spec.py), and verifies the result. Safe to re-run (drops and
recreates the seed each time, but the file itself is fresh each invocation).

Run from anywhere:
    python3 /home/azureuser/workspace/InboxPilot/.hermes/seed_kanban.py
"""
from __future__ import annotations
import importlib.util
import os
import shutil
import sqlite3
import sys
import time
from collections import Counter

# ---------- paths ----------
HERMES_HOME = os.path.expanduser("~/.hermes")
BOARD_DIR = os.path.join(HERMES_HOME, "kanban", "boards", "inboxpilot")
DB_PATH = os.path.join(BOARD_DIR, "kanban.db")
LOG_DIR = os.path.join(BOARD_DIR, "logs")
SEED_SPEC = os.path.expanduser(
    "/home/azureuser/workspace/InboxPilot/.hermes/seed_spec.py"
)
NOW = int(time.time())


# ---------- load seed spec ----------
spec = importlib.util.spec_from_file_location("inboxpilot_seed_spec", SEED_SPEC)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
TASKS = mod.TASKS
LINKS = mod.LINKS
print(f"loaded {len(TASKS)} tasks and {len(LINKS)} links from {SEED_SPEC}")


# ---------- ensure dirs ----------
os.makedirs(BOARD_DIR, exist_ok=True)
os.makedirs(LOG_DIR, exist_ok=True)


# ---------- write the "current" pointer file ----------
# (mirrors what PageVault has at ~/.hermes/kanban/current)
# this is per-profile-scoped preference; only write if this profile uses kanban
# the default profile is the one this script is writing for; leave alone otherwise
# so we just set the inboxpilot board as the active one.
current_path = os.path.join(HERMES_HOME, "kanban", "current")
try:
    if os.path.exists(current_path):
        with open(current_path) as f:
            current_val = f.read().strip()
        if current_val != "inboxpilot":
            print(
                f"NOTE: ~/.hermes/kanban/current is '{current_val}', "
                f"leaving as-is (inboxpilot board still usable via `hermes kanban -b inboxpilot ...`)"
            )
    else:
        with open(current_path, "w") as f:
            f.write("inboxpilot\n")
        print(f"wrote {current_path} -> inboxpilot")
except PermissionError as e:
    print(f"could not update {current_path}: {e}")


# ---------- create / overwrite DB ----------
if os.path.exists(DB_PATH):
    print(f"removing existing {DB_PATH}")
    os.remove(DB_PATH)

# also clear any leftover -wal / -shm files from previous interrupted runs
for ext in ("-wal", "-shm"):
    p = DB_PATH + ext
    if os.path.exists(p):
        os.remove(p)

conn = sqlite3.connect(DB_PATH)
conn.execute("PRAGMA journal_mode=WAL")
conn.execute("PRAGMA foreign_keys=ON")
conn.row_factory = sqlite3.Row
cur = conn.cursor()


# ---------- schema (verbatim from PageVault board) ----------
SCHEMA = """
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT,
  assignee TEXT,
  status TEXT NOT NULL CHECK (status IN ('todo','ready','running','blocked','done','archived')),
  priority INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  workspace_kind TEXT,
  workspace_path TEXT,
  branch_name TEXT,
  claim_lock TEXT,
  claim_expires INTEGER,
  tenant TEXT,
  result TEXT,
  idempotency_key TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  worker_pid INTEGER,
  last_failure_error TEXT,
  max_runtime_seconds INTEGER,
  last_heartbeat_at INTEGER,
  current_run_id INTEGER,
  workflow_template_id TEXT,
  current_step_key TEXT,
  skills TEXT,
  model_override TEXT,
  max_retries INTEGER,
  session_id TEXT,
  goal_mode INTEGER,
  goal_max_turns INTEGER
);

CREATE TABLE task_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  profile TEXT,
  step_key TEXT,
  status TEXT,
  claim_lock TEXT,
  claim_expires INTEGER,
  worker_pid INTEGER,
  max_runtime_seconds INTEGER,
  last_heartbeat_at INTEGER,
  started_at INTEGER,
  ended_at INTEGER,
  outcome TEXT,
  summary TEXT,
  metadata TEXT,
  error TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  run_id INTEGER,
  kind TEXT NOT NULL,
  payload TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE task_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE task_links (
  parent_id TEXT NOT NULL,
  child_id TEXT NOT NULL,
  PRIMARY KEY (parent_id, child_id),
  FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (child_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE task_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  content_type TEXT,
  size INTEGER,
  uploaded_by TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE kanban_notify_subs (
  task_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  thread_id TEXT,
  user_id TEXT,
  notifier_profile TEXT,
  created_at INTEGER NOT NULL,
  last_event_id INTEGER,
  PRIMARY KEY (task_id, platform, chat_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX idx_tasks_status        ON tasks(status);
CREATE INDEX idx_tasks_assignee      ON tasks(assignee);
CREATE INDEX idx_tasks_priority      ON tasks(priority);
CREATE INDEX idx_tasks_created_by    ON tasks(created_by);
CREATE INDEX idx_runs_task           ON task_runs(task_id);
CREATE INDEX idx_events_task         ON task_events(task_id);
CREATE INDEX idx_events_kind         ON task_events(kind);
CREATE INDEX idx_comments_task       ON task_comments(task_id);
"""

for stmt in SCHEMA.strip().split(";"):
    s = stmt.strip()
    if s:
        cur.execute(s)
print("schema created")


# ---------- seed tasks ----------
WORKSPACE = "/home/azureuser/workspace/InboxPilot"

inserted = 0
for t in TASKS:
    # Derive per-status timestamps to match PageVault convention:
    #   done     -> completed_at set
    #   running  -> started_at set
    #   ready/todo/blocked -> neither (created_at only)
    status = t["status"]
    completed_at = NOW if status in ("done", "archived") else None
    started_at = NOW if status in ("running", "done", "archived") else None

    cur.execute(
        """INSERT INTO tasks
           (id, title, body, assignee, status, priority, created_by,
            created_at, started_at, completed_at,
            workspace_kind, workspace_path, max_runtime_seconds, max_retries)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            t["id"],
            t["title"],
            t["body"],
            t["assignee"],
            t["status"],
            t["priority"],
            t["created_by"],
            NOW,
            started_at,
            completed_at,
            "dir",
            WORKSPACE,
            1800,  # 30 min default, matching PageVault convention
            2,     # failure_limit default
        ),
    )
    inserted += 1

print(f"inserted {inserted} tasks")


# ---------- seed task_links ----------
linked = 0
for parent, child in LINKS:
    cur.execute(
        "INSERT OR IGNORE INTO task_links (parent_id, child_id) VALUES (?, ?)",
        (parent, child),
    )
    linked += 1

print(f"inserted {linked} task_links")


# ---------- seed a creation event per task (for the activity log) ----------
# Same pattern PageVault uses: each task gets a `created` event so the
# events table isn't empty.
events = 0
for t in TASKS:
    cur.execute(
        "INSERT INTO task_events (task_id, run_id, kind, payload, created_at) VALUES (?, NULL, ?, ?, ?)",
        (
            t["id"],
            "created",
            f'{{"by":"{t["created_by"]}","status":"{t["status"]}","priority":{t["priority"]}}}',
            NOW,
        ),
    )
    events += 1
print(f"inserted {events} task_events")


# ---------- commit ----------
conn.commit()


# ---------- verify ----------
print("\n=== verification ===")
cur.execute("SELECT COUNT(*) FROM tasks")
print(f"  tasks: {cur.fetchone()[0]}")
cur.execute("SELECT COUNT(*) FROM task_links")
print(f"  task_links: {cur.fetchone()[0]}")
cur.execute("SELECT COUNT(*) FROM task_events")
print(f"  task_events: {cur.fetchone()[0]}")

print("\n  status counts:")
for r in cur.execute("SELECT status, COUNT(*) c FROM tasks GROUP BY status ORDER BY c DESC").fetchall():
    print(f"    {r['status']:9s} {r['c']}")

print("\n  priority counts:")
for r in cur.execute("SELECT priority, COUNT(*) c FROM tasks GROUP BY priority ORDER BY priority").fetchall():
    print(f"    P{r['priority']}  {r['c']}")

print("\n  assignee counts:")
for r in cur.execute("SELECT assignee, COUNT(*) c FROM tasks GROUP BY assignee ORDER BY c DESC").fetchall():
    print(f"    {r['assignee']:13s} {r['c']}")

print("\n  created_by counts:")
for r in cur.execute("SELECT created_by, COUNT(*) c FROM tasks GROUP BY created_by ORDER BY c DESC").fetchall():
    print(f"    {r['created_by']:9s} {r['c']}")

# orphan check
cur.execute("""
  SELECT COUNT(*) FROM task_links tl
  WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE id = tl.parent_id)
     OR NOT EXISTS (SELECT 1 FROM tasks WHERE id = tl.child_id)
""")
print(f"\n  orphan links: {cur.fetchone()[0]}")

# Fan-out check (top 5 parents)
print("\n  top parents by fan-out:")
for r in cur.execute("""
  SELECT tl.parent_id, p.title, p.status, p.assignee, COUNT(*) children
  FROM task_links tl JOIN tasks p ON p.id = tl.parent_id
  GROUP BY tl.parent_id ORDER BY children DESC LIMIT 5
""").fetchall():
    print(f"    {r['parent_id']:25s} ({r['status']:>8}/{r['assignee']:>12}) fan-out={r['children']}  {r['title'][:60]}")

# Sample a body
print("\n  sample body (PM-authored epic):")
row = cur.execute("SELECT title, body FROM tasks WHERE id = 't_pm_launch_checklist'").fetchone()
print(f"    {row['title']}")
print(f"    body: {len(row['body'])} chars, first 200:")
print("    | " + row['body'][:200].replace("\n", "\n    | "))

conn.close()
print(f"\ndone. board at: {DB_PATH}")
print(f"size: {os.path.getsize(DB_PATH)} bytes")
