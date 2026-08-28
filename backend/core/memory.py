"""
JARVIS - HIERARCHICAL PERSISTENT MEMORY
SQLite-backed durable memory: short-term sessions, episodic task logs,
long-term facts/preferences, and device states.
"""

import sqlite3
import json
import os
from datetime import datetime
from typing import List, Dict, Any, Optional

DB_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
DB_PATH = os.path.join(DB_DIR, "jarvis.db")


def get_db_connection():
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_memory_db():
    conn = get_db_connection()
    cursor = conn.cursor()

    # Chat history
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS chat_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # Episodic tasks (multi-step executions)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS episodic_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        goal TEXT NOT NULL,
        plan TEXT,
        status TEXT DEFAULT 'completed',
        steps TEXT,
        result TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # Long-term facts, preferences, user knowledge
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS facts_and_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        fact_key TEXT NOT NULL,
        fact_value TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(category, fact_key)
    )
    """)

    # Hardware & registered peripherals
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS hardware_devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_name TEXT NOT NULL UNIQUE,
        port TEXT,
        protocol TEXT,
        capabilities TEXT,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # Pre-seed default core directives if empty
    cursor.execute("SELECT COUNT(*) FROM facts_and_preferences")
    if cursor.fetchone()[0] == 0:
        seed_facts = [
            ("assistant_identity", "name", "JARVIS"),
            ("assistant_identity", "role", "Personal AI Systems Architect & Assistant"),
            ("user_preferences", "communication_style", "Concise, witty, polished, technically precise, calm under pressure"),
            ("user_preferences", "preferred_os", "Windows 11"),
            ("system_rules", "execution_policy", "Always verify actions after execution and report genuine status.")
        ]
        cursor.executemany(
            "INSERT INTO facts_and_preferences (category, fact_key, fact_value) VALUES (?, ?, ?)",
            seed_facts
        )

    conn.commit()
    conn.close()


def save_chat_turn(role: str, content: str, session_id: str = "default", tool_calls: Optional[List[Dict]] = None):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO chat_history (session_id, role, content, tool_calls) VALUES (?, ?, ?, ?)",
        (session_id, role, content, json.dumps(tool_calls) if tool_calls else None)
    )
    conn.commit()
    conn.close()


def get_recent_history(limit: int = 24, session_id: str = "default") -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT role, content, tool_calls, created_at FROM chat_history WHERE session_id = ? ORDER BY id DESC LIMIT ?",
        (session_id, limit)
    )
    rows = cursor.fetchall()
    conn.close()

    history = []
    for r in reversed(rows):
        history.append({
            "role": r["role"],
            "content": r["content"],
            "tool_calls": json.loads(r["tool_calls"]) if r["tool_calls"] else None,
            "timestamp": r["created_at"]
        })
    return history


def clear_history(session_id: str = "default"):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM chat_history WHERE session_id = ?", (session_id,))
    conn.commit()
    conn.close()


def store_fact(category: str, fact_key: str, fact_value: str, confidence: float = 1.0):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO facts_and_preferences (category, fact_key, fact_value, confidence, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(category, fact_key) DO UPDATE SET
        fact_value = excluded.fact_value,
        confidence = excluded.confidence,
        updated_at = CURRENT_TIMESTAMP
    """, (category, fact_key, fact_value, confidence))
    conn.commit()
    conn.close()


def get_all_facts() -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, category, fact_key, fact_value, confidence, updated_at FROM facts_and_preferences ORDER BY category, fact_key")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def search_facts(query: str) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    pattern = f"%{query}%"
    cursor.execute(
        "SELECT id, category, fact_key, fact_value FROM facts_and_preferences WHERE fact_key LIKE ? OR fact_value LIKE ? OR category LIKE ?",
        (pattern, pattern, pattern)
    )
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def delete_fact(fact_id: int) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM facts_and_preferences WHERE id = ?", (fact_id,))
    deleted = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return deleted


def record_task_execution(goal: str, plan: str, steps: List[Dict], result: str, status: str = "completed"):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO episodic_tasks (goal, plan, steps, result, status) VALUES (?, ?, ?, ?, ?)",
        (goal, plan, json.dumps(steps), result, status)
    )
    conn.commit()
    conn.close()


def get_recent_tasks(limit: int = 5) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, goal, plan, status, result, created_at FROM episodic_tasks ORDER BY id DESC LIMIT ?", (limit,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def build_system_context() -> str:
    """Builds dynamic memory context to inject into JARVIS's system prompt."""
    facts = get_all_facts()
    now_str = datetime.now().strftime("%A, %B %d, %Y - %I:%M %p")

    context_lines = [
        f"CURRENT DATE/TIME: {now_str}",
        "LONG-TERM MEMORY & RECORDED KNOWLEDGE:"
    ]

    for f in facts:
        context_lines.append(f"- [{f['category']}] {f['fact_key']}: {f['fact_value']}")

    recent_tasks = get_recent_tasks(3)
    if recent_tasks:
        context_lines.append("\nRECENTLY COMPLETED OBJECTIVES:")
        for t in recent_tasks:
            context_lines.append(f"- Goal: \"{t['goal']}\" -> Status: {t['status']}")

    return "\n".join(context_lines)


# Initialize DB upon import
init_memory_db()
