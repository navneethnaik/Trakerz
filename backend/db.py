"""SQLite storage layer for Trakerz.

Everything lives in a single local file: ../data/sow_tracker.db
No external database server needed.
"""
import sqlite3
from pathlib import Path
from contextlib import contextmanager

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "sow_tracker.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_code TEXT NOT NULL UNIQUE,
    customer_name TEXT NOT NULL,
    client_partner TEXT,
    delivery_director TEXT,
    industry TEXT,
    headquarters TEXT,
    geo TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS billing_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS operating_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS statuses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS employee_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER REFERENCES customers(id),
    title TEXT NOT NULL,
    project_title TEXT,
    project_code TEXT,
    contract_code TEXT,
    opportunity_id TEXT,
    po_number TEXT,
    start_date TEXT,
    end_date TEXT,
    total_value REAL NOT NULL DEFAULT 0,
    billing_model_id INTEGER REFERENCES billing_models(id),
    operating_model_id INTEGER REFERENCES operating_models(id),
    status TEXT NOT NULL DEFAULT 'draft',
    notes TEXT,
    doc_link TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS milestones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sow_id INTEGER NOT NULL REFERENCES sows(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    billed_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_name TEXT,
    project_name TEXT,
    wbs_id TEXT,
    employee_code TEXT,
    employee_name TEXT NOT NULL,
    location_id INTEGER REFERENCES locations(id),
    employee_type_id INTEGER REFERENCES employee_types(id),
    band_id INTEGER REFERENCES bands(id),
    allocation_start_date TEXT,
    allocation_end_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Revenue Management (Management > Revenue Management) tracks monthly
-- projections/invoiced at the SOW level; the Account-level summary is a
-- read-only rollup computed by joining these rows up through sows.customer_id
-- (see /api/revenue/summary), not a separately-stored table. fiscal_year is
-- the calendar year the fiscal year STARTS in (e.g. fiscal_year=2026 covers
-- Apr 2026 - Mar 2027). fiscal_month is the 1-12 position within that fiscal
-- year, not the calendar month: 1=Apr, 2=May, ... 9=Dec, 10=Jan, 11=Feb,
-- 12=Mar. One row per SOW per fiscal month.
CREATE TABLE IF NOT EXISTS revenue_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sow_id INTEGER NOT NULL REFERENCES sows(id) ON DELETE CASCADE,
    fiscal_year INTEGER NOT NULL,
    fiscal_month INTEGER NOT NULL,
    projection REAL NOT NULL DEFAULT 0,
    invoiced REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(sow_id, fiscal_year, fiscal_month)
);

-- Which (SOW, fiscal year) rows are explicitly tracked on the SOW-level
-- Revenue Management grid - like SOWs/Resources, rows must be added on
-- purpose and can be removed, rather than every SOW auto-appearing.
CREATE TABLE IF NOT EXISTS revenue_sow_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sow_id INTEGER NOT NULL REFERENCES sows(id) ON DELETE CASCADE,
    fiscal_year INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(sow_id, fiscal_year)
);

CREATE INDEX IF NOT EXISTS idx_milestones_sow_id ON milestones(sow_id);
CREATE INDEX IF NOT EXISTS idx_customers_code ON customers(customer_code);
CREATE INDEX IF NOT EXISTS idx_sows_customer_id ON sows(customer_id);
CREATE INDEX IF NOT EXISTS idx_resources_employee_code ON resources(employee_code);
CREATE INDEX IF NOT EXISTS idx_revenue_entries_sow_fy ON revenue_entries(sow_id, fiscal_year);
CREATE INDEX IF NOT EXISTS idx_revenue_sow_accounts_fy ON revenue_sow_accounts(fiscal_year);
"""


def get_connection():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def get_db():
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _column_exists(conn, table: str, column: str) -> bool:
    cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    return column in cols


def _table_exists(conn, table: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()
    return row is not None


def _migrate(conn):
    """Apply small, additive schema fixes to databases created by earlier
    versions of the app. Safe to run on every startup, and runs BEFORE the
    CREATE TABLE IF NOT EXISTS statements so renames/drops land on the old
    table instead of colliding with a freshly created empty one."""
    if _table_exists(conn, "engagement_models") and not _table_exists(conn, "billing_models"):
        conn.execute("ALTER TABLE engagement_models RENAME TO billing_models")
    elif _table_exists(conn, "engagement_models") and _table_exists(conn, "billing_models"):
        # Both present (shouldn't normally happen) - keep the current one.
        conn.execute("DROP TABLE engagement_models")

    if _column_exists(conn, "customers", "parent_wbs_code"):
        try:
            conn.execute("ALTER TABLE customers DROP COLUMN parent_wbs_code")
        except sqlite3.OperationalError:
            # Older SQLite (<3.35) doesn't support DROP COLUMN.
            # Leaving the unused column in place is harmless; the app
            # simply stops reading/writing it.
            pass

    if _table_exists(conn, "sows") and _column_exists(conn, "sows", "client_name"):
        # The SOW form moved from a free-text client name to a Customer
        # Management dropdown, plus several new fields (Opportunity ID,
        # PO#, Billing/Operating Model). Per explicit instruction, existing
        # SOW and milestone data is discarded rather than migrated.
        conn.execute("DROP TABLE IF EXISTS milestones")
        conn.execute("DROP TABLE IF EXISTS sows")

    # Additive: Customer profile fields (Industry, Headquarters, Geo).
    if _table_exists(conn, "customers"):
        for col in ("industry", "headquarters", "geo"):
            if not _column_exists(conn, "customers", col):
                conn.execute(f"ALTER TABLE customers ADD COLUMN {col} TEXT")

    # Additive: SOW project/contract identifiers.
    if _table_exists(conn, "sows"):
        for col in ("project_title", "project_code", "contract_code"):
            if not _column_exists(conn, "sows", col):
                conn.execute(f"ALTER TABLE sows ADD COLUMN {col} TEXT")

    # Additive: a free-text "details" column on each simple master list
    # (Locations, Billing Models, Operating Models, SOW Status).
    for table in ("locations", "billing_models", "operating_models", "statuses"):
        if _table_exists(conn, table) and not _column_exists(conn, table, "details"):
            conn.execute(f"ALTER TABLE {table} ADD COLUMN details TEXT")

    if _table_exists(conn, "revenue_entries") and _column_exists(conn, "revenue_entries", "customer_id"):
        # Revenue Management moved from tracking monthly numbers directly on
        # an account to tracking them per SOW (with the account-level view
        # now a read-only rollup computed from SOWs). A customer-keyed month
        # can't be automatically attributed to one of that customer's SOWs,
        # so - per explicit instruction - old account-level entries are
        # dropped rather than migrated.
        conn.execute("DROP TABLE IF EXISTS revenue_entries")
        conn.execute("DROP TABLE IF EXISTS revenue_accounts")


DEFAULT_STATUSES = ["draft", "active", "completed", "expired", "cancelled"]
DEFAULT_EMPLOYEE_TYPES = ["FTE", "Contractor"]


def _seed_defaults(conn):
    """Populate a couple of master lists with sensible starting values, but
    only the first time (an empty table) so a user who deletes one on
    purpose doesn't have it silently reappear on next launch. The statuses
    names matter beyond display: badge/tag CSS classes and the "active"
    alert check key off of them (lowercase, exact match)."""
    count = conn.execute("SELECT COUNT(*) FROM statuses").fetchone()[0]
    if count == 0:
        conn.executemany(
            "INSERT INTO statuses (name, updated_at) VALUES (?, datetime('now'))",
            [(s,) for s in DEFAULT_STATUSES],
        )

    et_count = conn.execute("SELECT COUNT(*) FROM employee_types").fetchone()[0]
    if et_count == 0:
        conn.executemany(
            "INSERT INTO employee_types (name, updated_at) VALUES (?, datetime('now'))",
            [(t,) for t in DEFAULT_EMPLOYEE_TYPES],
        )


def _backfill_revenue_accounts(conn):
    """Make sure every (SOW, fiscal year) pair that already has month entries
    also has a revenue_sow_accounts row, so data entered before the
    add/delete-row feature existed doesn't silently disappear from the grid."""
    conn.execute(
        """INSERT OR IGNORE INTO revenue_sow_accounts (sow_id, fiscal_year)
           SELECT DISTINCT sow_id, fiscal_year FROM revenue_entries"""
    )


def init_db():
    with get_db() as conn:
        _migrate(conn)
        conn.executescript(SCHEMA)
        _seed_defaults(conn)
        _backfill_revenue_accounts(conn)
