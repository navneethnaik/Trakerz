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
    delivery_head TEXT,
    sales_head TEXT,
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

-- One row per Customer, managed under Customer Configuration > Billing
-- Hours - a fixed Onsite/Offshore/Nearshore hours-per-day triplet rather
-- than one row per Customer+Location, since Locations itself is now a
-- fixed three-value list (see the Locations seed below and the
-- name-is-readonly-on-edit rule enforced in the UI). _billing_hours_per_day
-- in main.py maps an assignment's location_id to whichever of these three
-- columns matches that location's name.
CREATE TABLE IF NOT EXISTS billing_hour_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL UNIQUE REFERENCES customers(id),
    onsite_hours REAL,
    offshore_hours REAL,
    nearshore_hours REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per Customer + Holiday Date, managed under Customer Configuration
-- > Holiday Calendar - onsite/offshore/nearshore are 0/1 flags marking which
-- of the three fixed locations observe that date (replacing the old
-- one-row-per-Customer+Location shape, where the same date for two
-- locations needed two rows), plus a free-text details field (e.g. the
-- holiday's name). _compute_tm_projections in main.py maps an assignment's
-- location_id to whichever of these three flag columns matches that
-- location's name and only counts dates with that flag set.
CREATE TABLE IF NOT EXISTS holiday_calendar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    holiday_date TEXT NOT NULL,
    onsite INTEGER NOT NULL DEFAULT 0,
    offshore INTEGER NOT NULL DEFAULT 0,
    nearshore INTEGER NOT NULL DEFAULT 0,
    holiday_details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per employee leave days by month, managed under Customer Configuration >
-- Leave Management - same "own small CRUD, not a plain lookup" shape as
-- Billing Hours Configuration/Holiday Calendar, but keyed by Customer +
-- Employee ID (employee_id is free text here too, same as tm_assignments,
-- since Time and Material employees aren't linked to the Staffing/Resources
-- module) rather than Customer + Location, and with twelve flat Apr-Mar
-- columns instead of one value - the Time and Material formula subtracts
-- leave_management.leave_<month> from that fiscal month's working-day count
-- (see _compute_tm_projections), as a per-month count rather than specific
-- leave dates the way holidays are tracked. Statement of Work / WBS ID were
-- both removed from this table per explicit instruction (see the migration
-- below that drops sow_id/wbs_id from any pre-existing database) - a leave
-- record is scoped to Customer + Employee only, not a specific SOW.
CREATE TABLE IF NOT EXISTS leave_management (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    employee_id TEXT NOT NULL,
    employee_name TEXT,
    location_id INTEGER REFERENCES locations(id),
    band_id INTEGER REFERENCES bands(id),
    employee_type_id INTEGER REFERENCES employee_types(id),
    leave_apr REAL NOT NULL DEFAULT 0,
    leave_may REAL NOT NULL DEFAULT 0,
    leave_jun REAL NOT NULL DEFAULT 0,
    leave_jul REAL NOT NULL DEFAULT 0,
    leave_aug REAL NOT NULL DEFAULT 0,
    leave_sep REAL NOT NULL DEFAULT 0,
    leave_oct REAL NOT NULL DEFAULT 0,
    leave_nov REAL NOT NULL DEFAULT 0,
    leave_dec REAL NOT NULL DEFAULT 0,
    leave_jan REAL NOT NULL DEFAULT 0,
    leave_feb REAL NOT NULL DEFAULT 0,
    leave_mar REAL NOT NULL DEFAULT 0,
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

-- What kind of SOW record this is (a brand-new SOW vs. an extension/
-- amendment of an existing one) - a simple named master list like Locations/
-- Billing Models/etc, managed under Settings.
CREATE TABLE IF NOT EXISTS opportunity_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Another simple named master list, managed under Settings exactly like
-- Locations (no seed data, no FK from sows/etc yet - just a plain list
-- users maintain themselves).
CREATE TABLE IF NOT EXISTS revenue_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Another simple named master list, managed under Settings exactly like
-- Locations/Revenue Types - which practice (delivery group/department) a
-- SOW belongs to. See the Practice column added to Revenue Management's
-- SoW Level Detail grid.
CREATE TABLE IF NOT EXISTS practices (
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
    opportunity_type_id INTEGER REFERENCES opportunity_types(id),
    po_number TEXT,
    start_date TEXT,
    end_date TEXT,
    total_value REAL NOT NULL DEFAULT 0,
    duration_months REAL,
    gm_percent REAL,
    billing_model_id INTEGER REFERENCES billing_models(id),
    operating_model_id INTEGER REFERENCES operating_models(id),
    status TEXT NOT NULL DEFAULT 'draft',
    notes TEXT,
    doc_link TEXT,
    po_doc_link TEXT,
    deal_sheet_link TEXT,
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
-- projections at the SOW level; the Account-level summary is a
-- read-only rollup computed by joining these rows up through sows.customer_id
-- (see /api/revenue/summary), not a separately-stored table. fiscal_year is
-- the calendar year the fiscal year STARTS in (e.g. fiscal_year=2026 covers
-- Apr 2026 - Mar 2027). fiscal_month is the 1-12 position within that fiscal
-- year, not the calendar month: 1=Apr, 2=May, ... 9=Dec, 10=Jan, 11=Feb,
-- 12=Mar. One row per SOW per fiscal month. (An Invoiced column used to live
-- here too - removed, front end and back end, to be rebuilt later as its own
-- feature; see _migrate()'s DROP COLUMN below.)
-- sow_id is nullable: a row can be tracked against a real Contract (the
-- original/common case, sow_id set) or, per explicit request, against just
-- a Customer with no SOW picked at all (sow_id NULL, account_id set instead
-- - see revenue_sow_accounts below). Exactly one of the two is set on any
-- given row; account_id-based rows have no natural (customer, fiscal year)
-- uniqueness limit - a Customer can have any number of them.
CREATE TABLE IF NOT EXISTS revenue_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sow_id INTEGER REFERENCES sows(id) ON DELETE CASCADE,
    account_id INTEGER REFERENCES revenue_sow_accounts(id) ON DELETE CASCADE,
    fiscal_year INTEGER NOT NULL,
    fiscal_month INTEGER NOT NULL,
    projection REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(sow_id, fiscal_year, fiscal_month)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_revenue_entries_account_month ON revenue_entries(account_id, fiscal_month);

-- Which (SOW, fiscal year) rows - or, per explicit request, which bare
-- (Customer, fiscal year) rows with no SOW picked at all - are explicitly
-- tracked on the SOW-level Revenue Management grid - like SOWs/Resources,
-- rows must be added on purpose and can be removed, rather than every SOW
-- auto-appearing. sow_id is nullable (see revenue_entries above); when
-- it's set, customer_id is redundant with sows.customer_id but kept here
-- too so every row - SOW-backed or not - can be listed/grouped by Customer
-- the same way. revenue_type_id/practice_id are used ONLY when sow_id is
-- NULL - a SOW-backed row's classification still lives on the Contract
-- itself (sows.revenue_type_id/practice_id, edited via PUT
-- /api/sows/{id}/classification) so every other view of that Contract
-- stays in sync; a SOW-less row has no Contract to hold those, so it gets
-- its own copy here instead (see PUT /api/revenue/sows/{account_id}/
-- account-classification in main.py). Onsite #/Offshore #/Nearshore # are
-- directly user-editable per row either way - see PUT
-- /api/revenue/sows/{account_id}/location-counts in main.py.
-- additional_info is free text, shown as the Managed Services grid's last
-- column ("Additional Information", after Mar) - optional for a SOW-backed
-- row, but mandatory when saving a row with no SOW at all (per explicit
-- request - enforced in main.py's create_revenue_account/
-- update_revenue_account_additional_info, not at the SQL level, since a
-- SOW-backed row must stay allowed to leave it blank).
CREATE TABLE IF NOT EXISTS revenue_sow_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sow_id INTEGER REFERENCES sows(id) ON DELETE CASCADE,
    customer_id INTEGER REFERENCES customers(id),
    fiscal_year INTEGER NOT NULL,
    onsite_count INTEGER NOT NULL DEFAULT 0,
    offshore_count INTEGER NOT NULL DEFAULT 0,
    nearshore_count INTEGER NOT NULL DEFAULT 0,
    revenue_type_id INTEGER REFERENCES revenue_types(id),
    practice_id INTEGER REFERENCES practices(id),
    additional_info TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(sow_id, fiscal_year)
);

-- Time and Material tracking (Financial > Projections > Time and
-- Material) is a different shape from the SOW-level Managed Services grid
-- above: one row per employee assignment (an employee working a Contract
-- under a rate card), not one row per SOW, so a Contract can have many rows.
-- Mirrors the sows/revenue_sow_accounts/revenue_entries split: this table
-- holds the persistent descriptive fields for an assignment (independent of
-- fiscal year, since a person can be assigned across a start/end date that
-- spans more than one), and tm_assignment_fiscal_years tracks which ones are
-- explicitly added to a given fiscal year's grid (same "must be added on
-- purpose" rule as revenue_sow_accounts). Revenue Type and Employee Practice
-- belong to the assignment itself (not inherited from the linked Contract)
-- since they describe the person doing the work, who may differ from the
-- Contract's own classification. Final Rate Card (rate_card with
-- discount_percent applied) is never stored - it's cheap to compute and
-- storing it risks going stale if rate_card/discount_percent are edited
-- later. Projections are likewise never stored - always computed on read by
-- _compute_tm_projections in main.py. (A tm_entries table used to hold
-- Invoiced numbers here - removed, front end and back end, to be rebuilt
-- later as its own feature; see _migrate()'s DROP TABLE below. Since
-- Projections was already always computed rather than read from storage,
-- Invoiced was the only thing tm_entries ever actually held.)
CREATE TABLE IF NOT EXISTS tm_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER REFERENCES customers(id),
    sow_id INTEGER REFERENCES sows(id),
    revenue_type_id INTEGER REFERENCES revenue_types(id),
    employee_id TEXT,
    employee_name TEXT,
    location_id INTEGER REFERENCES locations(id),
    practice_id INTEGER REFERENCES practices(id),
    wbs_id TEXT,
    sow_role TEXT,
    rate_card REAL,
    discount_percent REAL,
    start_date TEXT,
    end_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tm_assignment_fiscal_years (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id INTEGER NOT NULL REFERENCES tm_assignments(id) ON DELETE CASCADE,
    fiscal_year INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(assignment_id, fiscal_year)
);

CREATE INDEX IF NOT EXISTS idx_milestones_sow_id ON milestones(sow_id);
CREATE INDEX IF NOT EXISTS idx_customers_code ON customers(customer_code);
CREATE INDEX IF NOT EXISTS idx_sows_customer_id ON sows(customer_id);
CREATE INDEX IF NOT EXISTS idx_resources_employee_code ON resources(employee_code);
CREATE INDEX IF NOT EXISTS idx_revenue_entries_sow_fy ON revenue_entries(sow_id, fiscal_year);
CREATE INDEX IF NOT EXISTS idx_revenue_sow_accounts_fy ON revenue_sow_accounts(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_tm_assignment_fiscal_years_fy ON tm_assignment_fiscal_years(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_leave_management_customer_employee ON leave_management(customer_id, employee_id);
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

    # Additive: which Opportunity Type (New/Extension/Amendment/...) a SOW is.
    if _table_exists(conn, "sows") and not _column_exists(conn, "sows", "opportunity_type_id"):
        conn.execute("ALTER TABLE sows ADD COLUMN opportunity_type_id INTEGER")

    # Additive: Gross Margin % per SOW.
    if _table_exists(conn, "sows") and not _column_exists(conn, "sows", "gm_percent"):
        conn.execute("ALTER TABLE sows ADD COLUMN gm_percent REAL")

    # Additive: Purchase Order and Deal Sheet reference document links, to
    # go alongside the pre-existing doc_link (now labeled "Contract (SoW)"
    # in the SOW form's Reference Documents section).
    if _table_exists(conn, "sows"):
        for col in ("po_doc_link", "deal_sheet_link"):
            if not _column_exists(conn, "sows", col):
                conn.execute(f"ALTER TABLE sows ADD COLUMN {col} TEXT")

    # Additive: a free-text "details" column on each simple master list
    # (Locations, Billing Models, Operating Models, SOW Status).
    for table in ("locations", "billing_models", "operating_models", "statuses"):
        if _table_exists(conn, table) and not _column_exists(conn, table, "details"):
            conn.execute(f"ALTER TABLE {table} ADD COLUMN details TEXT")

    # Additive: which Revenue Type (Time and Material/Managed Services/...) a
    # SOW is - lets Revenue Management group/report on it (see the Revenue
    # Type column and summary table added to the Financial tab).
    if _table_exists(conn, "sows") and not _column_exists(conn, "sows", "revenue_type_id"):
        conn.execute("ALTER TABLE sows ADD COLUMN revenue_type_id INTEGER")

    # Additive: which Practice a SOW belongs to - lets Revenue Management
    # show/report on it (see the Practice column added to the SoW Level
    # Detail grid on the Financial tab).
    if _table_exists(conn, "sows") and not _column_exists(conn, "sows", "practice_id"):
        conn.execute("ALTER TABLE sows ADD COLUMN practice_id INTEGER")

    # Additive: Contract Duration (Months), a manually entered field the
    # Contract screen uses to annualize TCV into ACV (USD) - see
    # _enrich_sow()'s acv calculation in main.py.
    if _table_exists(conn, "sows") and not _column_exists(conn, "sows", "duration_months"):
        conn.execute("ALTER TABLE sows ADD COLUMN duration_months REAL")

    # Additive: Location/Band/Employee Type on Leave Management - same fields
    # Resource Management tracks per employee, added here too so a leave
    # record can be filtered/exported alongside the same attributes without
    # joining out to Resources (leave_management.employee_id stays free
    # text, not linked to Resources, per the table's existing convention).
    _leave_columns = [
        ("location_id", "INTEGER"),
        ("band_id", "INTEGER"),
        ("employee_type_id", "INTEGER"),
    ]
    if _table_exists(conn, "leave_management"):
        for col_name, col_type in _leave_columns:
            if not _column_exists(conn, "leave_management", col_name):
                conn.execute(f"ALTER TABLE leave_management ADD COLUMN {col_name} {col_type}")

    # Additive: SoW Role (free text) on Time and Material assignments - a new
    # per-row field on the T&M grid, same free-text convention as WBS ID on
    # the same table (no configurable lookup list requested for it).
    if _table_exists(conn, "tm_assignments") and not _column_exists(conn, "tm_assignments", "sow_role"):
        conn.execute("ALTER TABLE tm_assignments ADD COLUMN sow_role TEXT")

    # Additive: Delivery Head and Sales Head (free text) on Customers - new
    # edit fields alongside the existing Client Partner/Delivery Director,
    # same free-text convention (no configurable lookup list requested).
    for _cust_col in ("delivery_head", "sales_head"):
        if _table_exists(conn, "customers") and not _column_exists(conn, "customers", _cust_col):
            conn.execute(f"ALTER TABLE customers ADD COLUMN {_cust_col} TEXT")

    # Account Name, Statement of Work Title and WBS ID (free text) all
    # removed from Leave Management per explicit instruction: Account Name
    # was dropped outright (redundant with the existing Customer Name
    # column); sow_id (Statement of Work) and wbs_id (WBS ID) were both
    # later additions (see the now-removed sow_id/wbs_id entries that used
    # to be in _leave_columns above) dropped again per a follow-up request -
    # a leave record is scoped to Customer + Employee only, not a specific
    # SOW. All of these were only ever additive in earlier releases, so
    # there's no real data loss in dropping them.
    for _leave_col in ("account_name", "sow_title", "sow_id", "wbs_id"):
        if _table_exists(conn, "leave_management") and _column_exists(conn, "leave_management", _leave_col):
            try:
                conn.execute(f"ALTER TABLE leave_management DROP COLUMN {_leave_col}")
            except sqlite3.OperationalError:
                # Older SQLite (<3.35) doesn't support DROP COLUMN. Leaving
                # the unused column in place is harmless; the app simply
                # stops reading/writing it.
                pass

    if _table_exists(conn, "revenue_entries") and _column_exists(conn, "revenue_entries", "customer_id"):
        # Revenue Management moved from tracking monthly numbers directly on
        # an account to tracking them per SOW (with the account-level view
        # now a read-only rollup computed from SOWs). A customer-keyed month
        # can't be automatically attributed to one of that customer's SOWs,
        # so - per explicit instruction - old account-level entries are
        # dropped rather than migrated.
        conn.execute("DROP TABLE IF EXISTS revenue_entries")
        conn.execute("DROP TABLE IF EXISTS revenue_accounts")

    # Invoiced removed (front end and back end) - per explicit instruction,
    # to be rebuilt later as its own feature. tm_entries only ever held
    # Invoiced numbers meaningfully (its projection column was always
    # overwritten with the computed value on every read - see
    # _compute_tm_projections in main.py - so nothing real is lost by
    # dropping the whole table), so it's dropped outright rather than just
    # losing a column. revenue_entries.invoiced is real, separately-tracked
    # data, so only that one column is dropped there.
    if _table_exists(conn, "tm_entries"):
        conn.execute("DROP TABLE IF EXISTS tm_entries")
    if _column_exists(conn, "revenue_entries", "invoiced"):
        try:
            conn.execute("ALTER TABLE revenue_entries DROP COLUMN invoiced")
        except sqlite3.OperationalError:
            # Older SQLite (<3.35) doesn't support DROP COLUMN. Leaving the
            # unused column in place is harmless; the app simply stops
            # reading/writing it.
            pass

    # Billing Hours moved from one row per Customer+Location to one row per
    # Customer with fixed Onsite/Offshore/Nearshore columns (per explicit
    # instruction - Locations is now a fixed three-value list, see
    # DEFAULT_LOCATIONS below). Consolidate whatever old rows exist by
    # matching each one's Location name to the new column it maps to; a row
    # for a location outside Onsite/Offshore/Nearshore has no home in the new
    # shape and is dropped.
    if _column_exists(conn, "billing_hour_configs", "location_id"):
        old_rows = conn.execute(
            """SELECT bhc.customer_id, l.name AS location_name, bhc.billing_hours_per_day
               FROM billing_hour_configs bhc LEFT JOIN locations l ON l.id = bhc.location_id"""
        ).fetchall()
        consolidated: dict = {}
        for r in old_rows:
            slug = (r["location_name"] or "").strip().lower()
            if slug not in ("onsite", "offshore", "nearshore"):
                continue
            consolidated.setdefault(r["customer_id"], {})[f"{slug}_hours"] = r["billing_hours_per_day"]
        conn.execute("DROP TABLE billing_hour_configs")
        conn.execute(
            """CREATE TABLE billing_hour_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL UNIQUE REFERENCES customers(id),
                onsite_hours REAL,
                offshore_hours REAL,
                nearshore_hours REAL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )"""
        )
        for customer_id, hours in consolidated.items():
            conn.execute(
                """INSERT INTO billing_hour_configs (customer_id, onsite_hours, offshore_hours, nearshore_hours, updated_at)
                   VALUES (?, ?, ?, ?, datetime('now'))""",
                (customer_id, hours.get("onsite_hours"), hours.get("offshore_hours"), hours.get("nearshore_hours")),
            )

    # Holiday Calendar moved from one row per Customer+Location+Date to one
    # row per Customer+Date, with onsite/offshore/nearshore 0/1 flags marking
    # which locations observe it (per explicit instruction, same
    # fixed-three-locations reasoning as Billing Hours above). Consolidate by
    # merging old rows that share a Customer+Date into one, OR-ing their
    # location flags together and keeping every distinct Holiday Details text
    # seen for that date (joined with "; ") rather than picking just one.
    if _column_exists(conn, "holiday_calendar", "location_id"):
        old_rows = conn.execute(
            """SELECT hc.customer_id, hc.holiday_date, hc.holiday_details, l.name AS location_name
               FROM holiday_calendar hc LEFT JOIN locations l ON l.id = hc.location_id
               ORDER BY hc.customer_id, hc.holiday_date"""
        ).fetchall()
        consolidated: dict = {}
        for r in old_rows:
            slug = (r["location_name"] or "").strip().lower()
            if slug not in ("onsite", "offshore", "nearshore"):
                continue
            key = (r["customer_id"], r["holiday_date"])
            entry = consolidated.setdefault(key, {"onsite": 0, "offshore": 0, "nearshore": 0, "details": []})
            entry[slug] = 1
            detail = (r["holiday_details"] or "").strip()
            if detail and detail not in entry["details"]:
                entry["details"].append(detail)
        conn.execute("DROP TABLE holiday_calendar")
        conn.execute(
            """CREATE TABLE holiday_calendar (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL REFERENCES customers(id),
                holiday_date TEXT NOT NULL,
                onsite INTEGER NOT NULL DEFAULT 0,
                offshore INTEGER NOT NULL DEFAULT 0,
                nearshore INTEGER NOT NULL DEFAULT 0,
                holiday_details TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )"""
        )
        for (customer_id, holiday_date), entry in consolidated.items():
            conn.execute(
                """INSERT INTO holiday_calendar (customer_id, holiday_date, onsite, offshore, nearshore, holiday_details, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, datetime('now'))""",
                (customer_id, holiday_date, entry["onsite"], entry["offshore"], entry["nearshore"],
                 "; ".join(entry["details"]) or None),
            )

    # Onsite #/Offshore #/Nearshore # on the Managed Services grid (Best
    # Estimates > Managed Services) moved from a read-only count of Time and
    # Material assignments tied to the SOW to directly editable numbers per
    # (SOW, fiscal year) - per explicit request. Backfill the new columns
    # from whatever the old computed count was for each already-tracked row
    # (the same join _tm_location_counts_by_sow in main.py used to do), so
    # existing data doesn't silently reset to 0 the next time someone opens
    # the grid.
    if _table_exists(conn, "revenue_sow_accounts") and not _column_exists(conn, "revenue_sow_accounts", "onsite_count"):
        conn.execute("ALTER TABLE revenue_sow_accounts ADD COLUMN onsite_count INTEGER NOT NULL DEFAULT 0")
        conn.execute("ALTER TABLE revenue_sow_accounts ADD COLUMN offshore_count INTEGER NOT NULL DEFAULT 0")
        conn.execute("ALTER TABLE revenue_sow_accounts ADD COLUMN nearshore_count INTEGER NOT NULL DEFAULT 0")
        if _table_exists(conn, "tm_assignments") and _table_exists(conn, "tm_assignment_fiscal_years"):
            old_counts = conn.execute(
                """SELECT ra.id AS account_id, l.name AS location_name, COUNT(a.id) AS cnt
                   FROM revenue_sow_accounts ra
                   JOIN tm_assignments a ON a.sow_id = ra.sow_id
                   JOIN tm_assignment_fiscal_years fy ON fy.assignment_id = a.id AND fy.fiscal_year = ra.fiscal_year
                   LEFT JOIN locations l ON l.id = a.location_id
                   GROUP BY ra.id, l.name"""
            ).fetchall()
            by_account: dict = {}
            for r in old_counts:
                slug = (r["location_name"] or "").strip().lower()
                by_account.setdefault(r["account_id"], {})[slug] = r["cnt"]
            for account_id, counts in by_account.items():
                conn.execute(
                    "UPDATE revenue_sow_accounts SET onsite_count=?, offshore_count=?, nearshore_count=? WHERE id=?",
                    (counts.get("onsite", 0), counts.get("offshore", 0), counts.get("nearshore", 0), account_id),
                )

    # Managed Services rows used to require a SOW (sow_id NOT NULL). Per
    # explicit request, a row can now be tracked against just a Customer with
    # no SOW picked at all - see the schema comments above revenue_entries/
    # revenue_sow_accounts. SQLite can't drop a NOT NULL constraint or add a
    # column with a REFERENCES clause via ALTER TABLE, so both tables are
    # rebuilt (rename -> create new shape -> copy rows, preserving id values
    # so nothing that already points at these rows by id breaks -> drop the
    # renamed-away old table). revenue_sow_accounts must be rebuilt first:
    # revenue_entries' backfill of account_id below depends on the (already
    # preserved) revenue_sow_accounts.id values.
    if _table_exists(conn, "revenue_sow_accounts") and not _column_exists(conn, "revenue_sow_accounts", "customer_id"):
        conn.execute("ALTER TABLE revenue_sow_accounts RENAME TO revenue_sow_accounts_old")
        conn.execute(
            """CREATE TABLE revenue_sow_accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sow_id INTEGER REFERENCES sows(id) ON DELETE CASCADE,
                customer_id INTEGER REFERENCES customers(id),
                fiscal_year INTEGER NOT NULL,
                onsite_count INTEGER NOT NULL DEFAULT 0,
                offshore_count INTEGER NOT NULL DEFAULT 0,
                nearshore_count INTEGER NOT NULL DEFAULT 0,
                revenue_type_id INTEGER REFERENCES revenue_types(id),
                practice_id INTEGER REFERENCES practices(id),
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(sow_id, fiscal_year)
            )"""
        )
        conn.execute(
            """INSERT INTO revenue_sow_accounts
                   (id, sow_id, customer_id, fiscal_year, onsite_count, offshore_count, nearshore_count, created_at)
               SELECT old.id, old.sow_id, (SELECT s.customer_id FROM sows s WHERE s.id = old.sow_id),
                      old.fiscal_year, old.onsite_count, old.offshore_count, old.nearshore_count, old.created_at
               FROM revenue_sow_accounts_old old"""
        )
        conn.execute("DROP TABLE revenue_sow_accounts_old")

    if _table_exists(conn, "revenue_entries") and not _column_exists(conn, "revenue_entries", "account_id"):
        conn.execute("ALTER TABLE revenue_entries RENAME TO revenue_entries_old")
        conn.execute(
            """CREATE TABLE revenue_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sow_id INTEGER REFERENCES sows(id) ON DELETE CASCADE,
                account_id INTEGER REFERENCES revenue_sow_accounts(id) ON DELETE CASCADE,
                fiscal_year INTEGER NOT NULL,
                fiscal_month INTEGER NOT NULL,
                projection REAL NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(sow_id, fiscal_year, fiscal_month)
            )"""
        )
        conn.execute(
            """INSERT INTO revenue_entries (id, sow_id, fiscal_year, fiscal_month, projection, created_at, updated_at)
               SELECT id, sow_id, fiscal_year, fiscal_month, projection, created_at, updated_at
               FROM revenue_entries_old"""
        )
        conn.execute("DROP TABLE revenue_entries_old")
        # Backfill account_id for existing SOW-backed rows so they still
        # match up with their revenue_sow_accounts row under the new
        # account_id-based lookup, exactly as they did under sow_id before.
        conn.execute(
            """UPDATE revenue_entries
               SET account_id = (
                   SELECT ra.id FROM revenue_sow_accounts ra
                   WHERE ra.sow_id = revenue_entries.sow_id AND ra.fiscal_year = revenue_entries.fiscal_year
               )
               WHERE account_id IS NULL AND sow_id IS NOT NULL"""
        )

    # Additional Information - the Managed Services grid's last column, after
    # Mar (see PUT /api/revenue/accounts/{account_id}/additional-info in
    # main.py). A plain additive column (no NOT NULL, no rebuild needed) -
    # unlike the columns just above, it always allows NULL/blank at the SQL
    # level even though it's mandatory for a SOW-less row, since that rule is
    # enforced at the API layer (a SOW-backed row must stay allowed to leave
    # it blank).
    if _table_exists(conn, "revenue_sow_accounts") and not _column_exists(conn, "revenue_sow_accounts", "additional_info"):
        conn.execute("ALTER TABLE revenue_sow_accounts ADD COLUMN additional_info TEXT")


DEFAULT_STATUSES = ["draft", "active", "completed", "expired", "cancelled"]
DEFAULT_EMPLOYEE_TYPES = ["FTE", "Contractor"]
DEFAULT_OPPORTUNITY_TYPES = ["New", "Extension", "Amendment"]
# Locations is now a fixed three-value list (Billing Hours/Holiday Calendar
# both key off exactly these three names - see _billing_hours_per_day and
# _compute_tm_projections in main.py) - seeded once, same
# only-if-the-table-is-empty rule as the other defaults below, and the UI
# no longer offers an "Add Location" button so these three stay the only
# ones (Details stays freely editable per location; the name itself becomes
# readonly once a row exists - see makeInlineListManager's lockNameOnEdit).
DEFAULT_LOCATIONS = ["Onsite", "Offshore", "Nearshore"]
# Revenue Type's "Add" button is disabled in the UI (per explicit
# instruction) so these four stay the only ones short of someone using the
# API directly; Details stays freely editable, only the name is locked.
DEFAULT_REVENUE_TYPES = ["Contracted - Staffed", "Contracted - Not staffed", "Renewals", "Pipeline"]


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

    ot_count = conn.execute("SELECT COUNT(*) FROM opportunity_types").fetchone()[0]
    if ot_count == 0:
        conn.executemany(
            "INSERT INTO opportunity_types (name, updated_at) VALUES (?, datetime('now'))",
            [(t,) for t in DEFAULT_OPPORTUNITY_TYPES],
        )

    loc_count = conn.execute("SELECT COUNT(*) FROM locations").fetchone()[0]
    if loc_count == 0:
        conn.executemany(
            "INSERT INTO locations (name, updated_at) VALUES (?, datetime('now'))",
            [(l,) for l in DEFAULT_LOCATIONS],
        )

    rt_count = conn.execute("SELECT COUNT(*) FROM revenue_types").fetchone()[0]
    if rt_count == 0:
        conn.executemany(
            "INSERT INTO revenue_types (name, updated_at) VALUES (?, datetime('now'))",
            [(t,) for t in DEFAULT_REVENUE_TYPES],
        )


def _backfill_revenue_accounts(conn):
    """Make sure every (SOW, fiscal year) pair that already has month entries
    also has a revenue_sow_accounts row, so data entered before the
    add/delete-row feature existed doesn't silently disappear from the grid.
    Only applies to SOW-backed rows (sow_id NOT NULL) - an account_id-based
    (no-SOW) entry can only exist because its revenue_sow_accounts row was
    already created explicitly first, so there's nothing to backfill there."""
    conn.execute(
        """INSERT OR IGNORE INTO revenue_sow_accounts (sow_id, customer_id, fiscal_year)
           SELECT DISTINCT re.sow_id, s.customer_id, re.fiscal_year
           FROM revenue_entries re
           JOIN sows s ON s.id = re.sow_id
           WHERE re.sow_id IS NOT NULL"""
    )


def init_db():
    with get_db() as conn:
        _migrate(conn)
        conn.executescript(SCHEMA)
        _seed_defaults(conn)
        _backfill_revenue_accounts(conn)
