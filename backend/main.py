"""Trakerz - FastAPI backend.

Fully local: SQLite file storage, no external services.
Run with: uvicorn main:app --host 127.0.0.1 --port 8000
(see ../run.sh or ../run.bat)
"""
import calendar
import re
import shutil
import sqlite3
import uuid
from datetime import date, datetime, timedelta
from io import BytesIO
from pathlib import Path
from typing import Optional, List, Dict

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter
from pydantic import BaseModel

import db

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
UPLOADS_DIR = BASE_DIR / "data" / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Trakerz", version="1.0")

BILLED_STATUSES = ("invoiced", "paid")
EXPIRING_SOON_DAYS = 30
# SOW Status is a free-text, user-editable master list (Configuration > SOW
# Status), not a fixed enum - customers add their own labels (e.g. "Future
# (Upcoming)"). So "is this SOW still open" can't check for an exact
# "active" match; instead we exclude only the statuses that clearly mean the
# SOW is closed out, and treat every other status as still in play.
CLOSED_STATUSES = ("completed", "cancelled", "expired")


@app.on_event("startup")
def startup():
    db.init_db()


# ---------- Pydantic models ----------

class MilestoneIn(BaseModel):
    description: str
    amount: float = 0
    due_date: Optional[str] = None
    status: str = "pending"          # pending | invoiced | paid
    billed_date: Optional[str] = None


class SowIn(BaseModel):
    customer_id: int
    title: str
    project_title: Optional[str] = None
    project_code: Optional[str] = None
    contract_code: Optional[str] = None
    opportunity_id: Optional[str] = None
    opportunity_type_id: Optional[int] = None
    po_number: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    total_value: float = 0
    duration_months: Optional[float] = None
    gm_percent: Optional[float] = None
    billing_model_id: Optional[int] = None
    operating_model_id: Optional[int] = None
    revenue_type_id: Optional[int] = None
    practice_id: Optional[int] = None
    status: str = "draft"            # draft | active | completed | expired | cancelled
    notes: Optional[str] = None
    doc_link: Optional[str] = None
    po_doc_link: Optional[str] = None
    deal_sheet_link: Optional[str] = None


class SowClassificationIn(BaseModel):
    revenue_type_id: Optional[int] = None
    practice_id: Optional[int] = None


class CustomerIn(BaseModel):
    customer_code: str
    customer_name: str
    client_partner: Optional[str] = None
    delivery_director: Optional[str] = None
    delivery_head: Optional[str] = None
    sales_head: Optional[str] = None
    industry: Optional[str] = None
    headquarters: Optional[str] = None
    geo: Optional[str] = None


class NameIn(BaseModel):
    name: str
    details: Optional[str] = None


class BillingHoursConfigIn(BaseModel):
    customer_id: int
    onsite_hours: Optional[float] = None
    offshore_hours: Optional[float] = None
    nearshore_hours: Optional[float] = None


class HolidayCalendarIn(BaseModel):
    customer_id: int
    holiday_date: str
    onsite: bool = False
    offshore: bool = False
    nearshore: bool = False
    holiday_details: Optional[str] = None


# Leave Management (Customer Configuration > Leave Management) - one row per
# Customer + Employee ID, with a flat leave-day count per fiscal month
# (Apr-Mar) rather than specific leave dates. Field order matches the
# fiscal-month convention used throughout (fiscal_month 1=Apr ... 12=Mar -
# see FISCAL_MONTH_LABELS) so _LEAVE_MONTH_COLUMNS[fiscal_month - 1] is a
# direct index into this model's fields.
class LeaveManagementIn(BaseModel):
    customer_id: int
    employee_id: str
    employee_name: Optional[str] = None
    location_id: Optional[int] = None
    band_id: Optional[int] = None
    employee_type_id: Optional[int] = None
    leave_apr: float = 0
    leave_may: float = 0
    leave_jun: float = 0
    leave_jul: float = 0
    leave_aug: float = 0
    leave_sep: float = 0
    leave_oct: float = 0
    leave_nov: float = 0
    leave_dec: float = 0
    leave_jan: float = 0
    leave_feb: float = 0
    leave_mar: float = 0


class ResourceIn(BaseModel):
    account_name: Optional[str] = None
    project_name: Optional[str] = None
    wbs_id: Optional[str] = None
    employee_code: Optional[str] = None
    employee_name: str
    location_id: Optional[int] = None
    employee_type_id: Optional[int] = None
    band_id: Optional[int] = None
    allocation_start_date: Optional[str] = None
    allocation_end_date: Optional[str] = None


class RevenueCellIn(BaseModel):
    sow_id: int
    fiscal_year: int
    fiscal_month: int          # 1-12, fiscal position: 1=Apr ... 9=Dec, 10=Jan, 11=Feb, 12=Mar
    projection: float = 0


class RevenueSowIn(BaseModel):
    sow_id: int
    fiscal_year: int


# Onsite #/Offshore #/Nearshore # on the Managed Services grid - directly
# user-editable per (SOW, fiscal year), see upsert_revenue_sow_location_counts.
class RevenueSowLocationCountsIn(BaseModel):
    sow_id: int
    fiscal_year: int
    onsite_count: int = 0
    offshore_count: int = 0
    nearshore_count: int = 0


# Time and Material tracking (Financial > Projections > Time and
# Material) - one row per employee assignment to a Contract, not per SOW.
# See tm_assignments/tm_assignment_fiscal_years in db.py.
class TmAssignmentIn(BaseModel):
    customer_id: Optional[int] = None
    sow_id: Optional[int] = None
    revenue_type_id: Optional[int] = None
    employee_id: Optional[str] = None
    employee_name: Optional[str] = None
    location_id: Optional[int] = None
    practice_id: Optional[int] = None
    wbs_id: Optional[str] = None
    sow_role: Optional[str] = None
    rate_card: Optional[float] = None
    discount_percent: Optional[float] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class TmAssignmentCreateIn(TmAssignmentIn):
    """Add Entry on the Time and Material grid creates the assignment and
    registers it for a fiscal year in one step - there's no separate
    "manage assignments" page the way SOWs have Contract Management, so
    unlike revenue_sow_accounts (which tracks a pre-existing SOW), this is
    the only place a tm_assignment row is ever created."""
    fiscal_year: int


# Revenue Management's fiscal year runs Apr-Mar. fiscal_month is a 1-12
# position within that year (not the calendar month), so this list is
# indexed the same way: FISCAL_MONTH_LABELS[0] is fiscal_month 1 (Apr).
FISCAL_MONTH_LABELS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"]


# ---------- helpers ----------

def _row_to_dict(row):
    return dict(row)


def _execute_delete(conn, sql: str, params: tuple, in_use_label: str):
    """Run a DELETE statement and turn a foreign-key violation (the row is
    still referenced by another table - e.g. a Location used by a Customer's
    Billing Hours Configuration, or a Billing Model used by an existing SOW)
    into a clear 409 instead of an unhandled 500. Every delete endpoint in
    the app goes through this so failures are reported to the user instead
    of silently leaving the row in place (foreign_keys=ON is set per
    connection in db.py, so these violations are real and expected whenever
    a master-data row is still in use)."""
    try:
        conn.execute(sql, params)
    except sqlite3.IntegrityError:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete this {in_use_label} because it is still used by other records "
                   f"(e.g. a SoW, resource, or configuration entry). Remove or reassign those first.",
        )


def _load_lookup_maps(conn):
    """Return {id: name} maps for customers, billing_models, operating_models,
    opportunity_types, revenue_types, practices (plus a {id: code} map for
    customers) so SOW rows can be annotated with human-readable names without
    one query per foreign key per row."""
    customer_rows = conn.execute("SELECT id, customer_name, customer_code FROM customers").fetchall()
    customers = {r["id"]: r["customer_name"] for r in customer_rows}
    customer_codes = {r["id"]: r["customer_code"] for r in customer_rows}
    billing_models = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM billing_models")}
    operating_models = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM operating_models")}
    opportunity_types = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM opportunity_types")}
    revenue_types = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM revenue_types")}
    practices = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM practices")}
    return customers, billing_models, operating_models, opportunity_types, customer_codes, revenue_types, practices


def _attach_names(sow: dict, customers: Dict[int, str], billing_models: Dict[int, str], operating_models: Dict[int, str], opportunity_types: Dict[int, str], customer_codes: Dict[int, str], revenue_types: Dict[int, str], practices: Dict[int, str]) -> dict:
    sow["customer_name"] = customers.get(sow.get("customer_id"))
    sow["customer_code"] = customer_codes.get(sow.get("customer_id"))
    sow["billing_model_name"] = billing_models.get(sow.get("billing_model_id"))
    sow["operating_model_name"] = operating_models.get(sow.get("operating_model_id"))
    sow["opportunity_type_name"] = opportunity_types.get(sow.get("opportunity_type_id"))
    sow["revenue_type_name"] = revenue_types.get(sow.get("revenue_type_id"))
    sow["practice_name"] = practices.get(sow.get("practice_id"))
    return sow


def _compute_acv(total_value, duration_months) -> float:
    """ACV (USD): find the SOW's monthly run rate (TCV / Contract Duration
    (Months)), then multiply by however many of those months count toward
    one fiscal year (at most 12). See _enrich_sow's fuller comment - pulled
    out as its own helper so list_revenue_sows (Best Estimates > Managed
    Services grid) can compute the same figure without duplicating the
    formula."""
    total_value = total_value or 0
    duration_months = duration_months or 0
    if duration_months > 0:
        monthly_value = total_value / duration_months
        months_in_fiscal_year = min(duration_months, 12)
        return round(monthly_value * months_in_fiscal_year, 2)
    return 0.0


def _enrich_sow(sow: dict, milestones: List[dict]) -> dict:
    billed_total = sum(m["amount"] for m in milestones if m["status"] in BILLED_STATUSES)
    total_value = sow["total_value"] or 0
    remaining_budget = total_value - billed_total

    alerts = []
    today = date.today()
    end_date = sow.get("end_date")
    days_to_end = None
    if end_date:
        try:
            d = datetime.strptime(end_date, "%Y-%m-%d").date()
            days_to_end = (d - today).days
        except ValueError:
            days_to_end = None

    if (sow["status"] or "").strip().lower() not in CLOSED_STATUSES and days_to_end is not None:
        if days_to_end < 0:
            alerts.append("overdue")
        elif days_to_end <= EXPIRING_SOON_DAYS:
            alerts.append("expiring_soon")

    if billed_total > total_value > 0:
        alerts.append("over_budget")

    # ACV (USD) - see _compute_acv()'s own comment for the formula. Net
    # effect: a SOW of 12 months or less has ACV == TCV (its whole value
    # already fits in a single fiscal year); a multi-year SOW gets its TCV
    # normalized down to a per-year figure, e.g. a 24-month SOW shows half
    # its TCV as ACV.
    acv = _compute_acv(total_value, sow.get("duration_months"))

    sow["billed_total"] = round(billed_total, 2)
    sow["remaining_budget"] = round(remaining_budget, 2)
    sow["acv"] = acv
    sow["days_to_end"] = days_to_end
    sow["alerts"] = alerts
    sow["milestone_count"] = len(milestones)
    return sow


def _get_sow_or_404(conn, sow_id: int) -> dict:
    row = conn.execute("SELECT * FROM sows WHERE id = ?", (sow_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="SOW not found")
    return _row_to_dict(row)


def _get_customer_or_404(conn, customer_id: int) -> dict:
    row = conn.execute("SELECT * FROM customers WHERE id = ?", (customer_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Customer not found")
    return _row_to_dict(row)


def _parse_iso_date(s: Optional[str]):
    """Turn a stored 'YYYY-MM-DD' string into a real date object so Excel
    treats it as a date (sortable, formattable) instead of plain text."""
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        return None


def _build_workbook(sheet_title: str, headers: List[str], rows: List[list],
                     date_cols: tuple = (), currency_cols: tuple = (), percent_cols: tuple = (),
                     widths: Optional[List[int]] = None) -> Workbook:
    """Shared .xlsx builder for the export endpoints: bold header row, plain
    data rows, optional date/currency/percent number formatting on 1-indexed
    column numbers, and optional fixed column widths. percent_cols expects
    the raw number already scaled as a percentage (32.5, not 0.325)."""
    wb = Workbook()
    ws = wb.active
    ws.title = sheet_title

    ws.append(headers)
    for cell in ws[1]:
        cell.font = Font(bold=True)

    for row in rows:
        ws.append(row)

    for row in ws.iter_rows(min_row=2, max_row=ws.max_row):
        for col in date_cols:
            cell = row[col - 1]
            if cell.value is not None:
                cell.number_format = "dd-mmm-yyyy"
        for col in currency_cols:
            row[col - 1].number_format = "#,##0.00"
        for col in percent_cols:
            cell = row[col - 1]
            if cell.value is not None:
                cell.number_format = '0.00"%"'

    if widths:
        for i, w in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(i)].width = w

    return wb


def _add_reference_sheet(wb: Workbook, title: str, columns: Dict[str, List[str]]) -> None:
    """Appends a second, read-only "reference" sheet to an already-built
    template workbook - one bold header per column, the given values listed
    underneath, columns as given (no lookups back into the data sheet; this
    is purely a "here's what you can type" cheat sheet for whoever is
    filling in Sheet 1 by hand). Column widths are sized to the longest
    value in each column, with a floor/ceiling so a very short or very long
    list doesn't produce a sliver or a runaway-wide column."""
    ws = wb.create_sheet(title)
    headers = list(columns.keys())
    ws.append(headers)
    for cell in ws[1]:
        cell.font = Font(bold=True)
    max_len = max((len(v) for v in columns.values()), default=0)
    for row_idx in range(max_len):
        ws.append([values[row_idx] if row_idx < len(values) else None for values in columns.values()])
    for col_idx, (header, values) in enumerate(columns.items(), start=1):
        longest = max([len(header)] + [len(str(v)) for v in values]) if values else len(header)
        ws.column_dimensions[get_column_letter(col_idx)].width = max(16, min(40, longest + 2))


def _xlsx_response(wb: Workbook, filename: str) -> StreamingResponse:
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------- Excel import helpers (Revenue Management: SoW Level and Time
# and Material grids both offer "Import from Excel" against a downloadable
# template - see /import-template and /import below each export endpoint).
# Columns are matched by header text rather than position so a reordered or
# narrowed copy of the template still imports; identifying rows (a SOW, a
# Customer) are matched by name rather than internal id since that's what's
# visible/editable in a spreadsheet.

def _cell_str(v) -> Optional[str]:
    """None/blank -> None; anything else -> its trimmed string form (Excel
    hands back numbers/dates as native Python types, not just strings)."""
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _cell_float(v) -> float:
    """Blank -> 0.0 (the same default an un-typed-into month cell has
    everywhere else in the app); anything non-blank must parse as a number."""
    if v is None or (isinstance(v, str) and not v.strip()):
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        raise ValueError(f"'{v}' is not a number")


def _cell_float_or_none(v) -> Optional[float]:
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    return _cell_float(v)


def _cell_date(v) -> Optional[str]:
    """Accepts a real Excel date (openpyxl hands those back as datetime/date
    objects) or a plain YYYY-MM-DD/DD-MMM-YYYY/MM-DD-YYYY string; blank ->
    None. Returns the same 'YYYY-MM-DD' string every other date field in the
    app stores."""
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    s = str(v).strip()
    for fmt in ("%Y-%m-%d", "%d-%b-%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    raise ValueError(f"'{v}' is not a recognizable date (expected YYYY-MM-DD)")


def _read_import_rows(file_bytes: bytes, required_headers: List[str]) -> List[Dict[str, object]]:
    """Parses an uploaded .xlsx into a list of {lowercased header: cell
    value} dicts, one per non-blank data row (the header row - row 1 - is
    matched by text, case/whitespace-insensitively, not by position).
    Raises ValueError (turned into a 400 by the caller) if the file can't be
    read at all, or if any of required_headers is missing from row 1."""
    try:
        wb = load_workbook(BytesIO(file_bytes), data_only=True)
    except Exception:
        raise ValueError("Could not read this file - please upload a .xlsx file")
    ws = wb.active
    rows_iter = ws.iter_rows(values_only=True)
    try:
        header_row = next(rows_iter)
    except StopIteration:
        raise ValueError("This file has no header row")

    header_map: Dict[str, int] = {}
    for idx, h in enumerate(header_row or []):
        if h is None:
            continue
        header_map[str(h).strip().lower()] = idx

    missing = [h for h in required_headers if h.lower() not in header_map]
    if missing:
        raise ValueError(f"Missing required column(s): {', '.join(missing)} - please use the downloaded template")

    records = []
    for row in rows_iter:
        if row is None or all(v is None or (isinstance(v, str) and not v.strip()) for v in row):
            continue  # skip fully blank rows
        records.append({h: (row[i] if i < len(row) else None) for h, i in header_map.items()})
    return records


def _lookup_customer_id_by_name(conn, name: Optional[str]) -> Optional[int]:
    if not name:
        return None
    row = conn.execute("SELECT id FROM customers WHERE lower(customer_name) = lower(?)", (name,)).fetchone()
    if not row:
        raise ValueError(f"Customer '{name}' was not found")
    return row["id"]


def _lookup_id_by_name(conn, table: str, name: Optional[str]) -> Optional[int]:
    """Case-insensitive exact-match lookup against a master-data table's
    'name' column (Revenue Types, Locations, Practices - all shaped that
    way). table is always one of a fixed set of literal strings from this
    file, never request data, so the f-string is safe here."""
    if not name:
        return None
    row = conn.execute(f"SELECT id FROM {table} WHERE lower(name) = lower(?)", (name,)).fetchone()
    if not row:
        raise ValueError(f"'{name}' was not found")
    return row["id"]


def _lookup_sow_id(conn, customer_id: int, title: Optional[str]) -> Optional[int]:
    """Contract Title is only unique within a customer (not globally), so
    the match is scoped to customer_id - and treated as an error rather than
    "pick the first one" if that still leaves more than one match."""
    if not title:
        return None
    rows = conn.execute(
        "SELECT id FROM sows WHERE customer_id = ? AND lower(title) = lower(?)", (customer_id, title)
    ).fetchall()
    if not rows:
        raise ValueError(f"Statement of Work '{title}' was not found for this customer")
    if len(rows) > 1:
        raise ValueError(f"Statement of Work '{title}' matches more than one SOW for this customer")
    return rows[0]["id"]


def _lookup_sow_id_by_customer_only(conn, customer_id: int, customer_name: str) -> int:
    """Managed Services import-template fallback for a row with no Contract
    Title column (see revenue_sows_import_template) - resolves to that
    customer's one SOW. Errors, rather than guessing, the moment the
    customer has zero or more than one SOW; the message tells the person
    exactly how to unblock the row (add a Contract Title column) instead of
    just saying "ambiguous". Counts every SOW for the customer regardless
    of Billing Model, same as the "Add Entry" SOW dropdown on this grid
    (which also isn't filtered to Billing Model = Managed Services)."""
    rows = conn.execute("SELECT id FROM sows WHERE customer_id = ?", (customer_id,)).fetchall()
    if not rows:
        raise ValueError(f"No Statement of Work was found for customer '{customer_name}'")
    if len(rows) > 1:
        raise ValueError(
            f"Customer '{customer_name}' has {len(rows)} Statements of Work - add a Contract Title "
            f"column to this row to say which one, or add this entry directly from the grid instead"
        )
    return rows[0]["id"]


def _validate_sow_refs(conn, sow: SowIn):
    if not conn.execute("SELECT 1 FROM customers WHERE id = ?", (sow.customer_id,)).fetchone():
        raise HTTPException(status_code=400, detail="Selected customer does not exist")
    if sow.billing_model_id is not None and not conn.execute(
        "SELECT 1 FROM billing_models WHERE id = ?", (sow.billing_model_id,)
    ).fetchone():
        raise HTTPException(status_code=400, detail="Selected billing model does not exist")
    if sow.operating_model_id is not None and not conn.execute(
        "SELECT 1 FROM operating_models WHERE id = ?", (sow.operating_model_id,)
    ).fetchone():
        raise HTTPException(status_code=400, detail="Selected operating model does not exist")
    if sow.opportunity_type_id is not None and not conn.execute(
        "SELECT 1 FROM opportunity_types WHERE id = ?", (sow.opportunity_type_id,)
    ).fetchone():
        raise HTTPException(status_code=400, detail="Selected opportunity type does not exist")
    if sow.revenue_type_id is not None and not conn.execute(
        "SELECT 1 FROM revenue_types WHERE id = ?", (sow.revenue_type_id,)
    ).fetchone():
        raise HTTPException(status_code=400, detail="Selected revenue type does not exist")
    if sow.practice_id is not None and not conn.execute(
        "SELECT 1 FROM practices WHERE id = ?", (sow.practice_id,)
    ).fetchone():
        raise HTTPException(status_code=400, detail="Selected practice does not exist")


def _get_resource_or_404(conn, resource_id: int) -> dict:
    row = conn.execute("SELECT * FROM resources WHERE id = ?", (resource_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Resource not found")
    return _row_to_dict(row)


def _load_resource_lookup_maps(conn):
    """Return {id: name} maps for the three dropdowns on the Resource
    Management form, so a list of resources can be annotated with
    human-readable names without one query per foreign key per row."""
    locations = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM locations")}
    employee_types = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM employee_types")}
    bands = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM bands")}
    return locations, employee_types, bands


def _attach_resource_names(resource: dict, locations: Dict[int, str], employee_types: Dict[int, str], bands: Dict[int, str]) -> dict:
    resource["location_name"] = locations.get(resource.get("location_id"))
    resource["employee_type_name"] = employee_types.get(resource.get("employee_type_id"))
    resource["band_name"] = bands.get(resource.get("band_id"))
    return resource


def _validate_resource_refs(conn, r: ResourceIn):
    if r.location_id is not None and not conn.execute(
        "SELECT 1 FROM locations WHERE id = ?", (r.location_id,)
    ).fetchone():
        raise HTTPException(status_code=400, detail="Selected location does not exist")
    if r.employee_type_id is not None and not conn.execute(
        "SELECT 1 FROM employee_types WHERE id = ?", (r.employee_type_id,)
    ).fetchone():
        raise HTTPException(status_code=400, detail="Selected employee type does not exist")
    if r.band_id is not None and not conn.execute(
        "SELECT 1 FROM bands WHERE id = ?", (r.band_id,)
    ).fetchone():
        raise HTTPException(status_code=400, detail="Selected band does not exist")


# ---------- SOW endpoints ----------

@app.get("/api/sows")
def list_sows(status: Optional[str] = None, customer_id: Optional[int] = None, billing_model_id: Optional[int] = None, q: Optional[str] = None):
    with db.get_db() as conn:
        rows = conn.execute("SELECT * FROM sows ORDER BY end_date IS NULL, end_date ASC").fetchall()
        sows = [_row_to_dict(r) for r in rows]
        customers, billing_models, operating_models, opportunity_types, customer_codes, revenue_types, practices = _load_lookup_maps(conn)
        sows = [_attach_names(s, customers, billing_models, operating_models, opportunity_types, customer_codes, revenue_types, practices) for s in sows]

        if status:
            sows = [s for s in sows if s["status"] == status]
        if customer_id:
            sows = [s for s in sows if s["customer_id"] == customer_id]
        if billing_model_id:
            sows = [s for s in sows if s["billing_model_id"] == billing_model_id]
        if q:
            ql = q.lower()
            sows = [
                s for s in sows
                if ql in s["title"].lower() or ql in (s["customer_name"] or "").lower()
            ]

        result = []
        for s in sows:
            m_rows = conn.execute("SELECT * FROM milestones WHERE sow_id = ?", (s["id"],)).fetchall()
            milestones = [_row_to_dict(m) for m in m_rows]
            result.append(_enrich_sow(s, milestones))
        return result


@app.post("/api/sows", status_code=201)
def create_sow(sow: SowIn):
    with db.get_db() as conn:
        _validate_sow_refs(conn, sow)
        cur = conn.execute(
            """INSERT INTO sows (customer_id, title, project_title, project_code, contract_code,
               opportunity_id, opportunity_type_id, po_number, start_date, end_date,
               total_value, duration_months, gm_percent, billing_model_id, operating_model_id, revenue_type_id, practice_id, status, notes, doc_link,
               po_doc_link, deal_sheet_link, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))""",
            (sow.customer_id, sow.title, sow.project_title, sow.project_code, sow.contract_code,
             sow.opportunity_id, sow.opportunity_type_id, sow.po_number, sow.start_date, sow.end_date,
             sow.total_value, sow.duration_months, sow.gm_percent, sow.billing_model_id, sow.operating_model_id, sow.revenue_type_id, sow.practice_id, sow.status, sow.notes, sow.doc_link,
             sow.po_doc_link, sow.deal_sheet_link),
        )
        new_id = cur.lastrowid
        row = _get_sow_or_404(conn, new_id)
        customers, billing_models, operating_models, opportunity_types, customer_codes, revenue_types, practices = _load_lookup_maps(conn)
        row = _attach_names(row, customers, billing_models, operating_models, opportunity_types, customer_codes, revenue_types, practices)
        return _enrich_sow(row, [])


@app.get("/api/sows/export")
def export_sows(status: Optional[str] = None, customer_id: Optional[int] = None, billing_model_id: Optional[int] = None, q: Optional[str] = None):
    """Export the SOW list to an .xlsx workbook. Accepts the same filters as
    GET /api/sows, so exporting from a filtered/searched view downloads
    exactly what's on screen. Registered before /api/sows/{sow_id} so the
    literal "export" path isn't swallowed by that route's int converter."""
    sows = list_sows(status=status, customer_id=customer_id, billing_model_id=billing_model_id, q=q)

    # Column order mirrors the New/Edit SOW form's section layout (Contract
    # Details, BTP Information, Reference Documents, Additional Information)
    # and the same order used for the on-screen SOW list table.
    headers = [
        "Opportunity ID", "Opportunity Type", "Contract Title", "Customer Name", "Purchase Order #",
        "Start date", "End date", "TCV", "Duration (Months)", "ACV (USD)", "GM %", "Status", "Billing model", "Operating model",
        "Customer Code", "Project Title", "Contract Code", "Project Code",
        "Contract (SoW) link", "Purchase order link", "Deal sheet link",
        "Additional information",
    ]
    rows = [
        [
            s.get("opportunity_id") or "",
            s.get("opportunity_type_name") or "",
            s.get("title") or "",
            s.get("customer_name") or "",
            s.get("po_number") or "",
            _parse_iso_date(s.get("start_date")),
            _parse_iso_date(s.get("end_date")),
            s.get("total_value") or 0,
            s.get("duration_months"),
            s.get("acv") or 0,
            s.get("gm_percent"),
            s.get("status") or "",
            s.get("billing_model_name") or "",
            s.get("operating_model_name") or "",
            s.get("customer_code") or "",
            s.get("project_title") or "",
            s.get("contract_code") or "",
            s.get("project_code") or "",
            s.get("doc_link") or "",
            s.get("po_doc_link") or "",
            s.get("deal_sheet_link") or "",
            s.get("notes") or "",
        ]
        for s in sows
    ]
    date_cols = (6, 7)
    currency_cols = (8, 10)
    percent_cols = (11,)
    widths = [16, 16, 28, 22, 14, 13, 13, 14, 16, 14, 10, 14, 18, 18, 16, 24, 16, 16, 30, 22, 22, 34]
    wb = _build_workbook("SOWs", headers, rows, date_cols=date_cols, currency_cols=currency_cols,
                          percent_cols=percent_cols, widths=widths)
    return _xlsx_response(wb, f"trakerz_sows_{date.today().isoformat()}.xlsx")


@app.get("/api/sows/{sow_id}")
def get_sow(sow_id: int):
    with db.get_db() as conn:
        sow = _get_sow_or_404(conn, sow_id)
        customers, billing_models, operating_models, opportunity_types, customer_codes, revenue_types, practices = _load_lookup_maps(conn)
        sow = _attach_names(sow, customers, billing_models, operating_models, opportunity_types, customer_codes, revenue_types, practices)
        m_rows = conn.execute("SELECT * FROM milestones WHERE sow_id = ? ORDER BY due_date IS NULL, due_date ASC", (sow_id,)).fetchall()
        milestones = [_row_to_dict(m) for m in m_rows]
        enriched = _enrich_sow(sow, milestones)
        enriched["milestones"] = milestones
        return enriched


@app.put("/api/sows/{sow_id}")
def update_sow(sow_id: int, sow: SowIn):
    with db.get_db() as conn:
        _get_sow_or_404(conn, sow_id)
        _validate_sow_refs(conn, sow)
        conn.execute(
            """UPDATE sows SET customer_id=?, title=?, project_title=?, project_code=?, contract_code=?,
               opportunity_id=?, opportunity_type_id=?, po_number=?, start_date=?, end_date=?,
               total_value=?, duration_months=?, gm_percent=?, billing_model_id=?, operating_model_id=?, revenue_type_id=?, practice_id=?, status=?, notes=?, doc_link=?,
               po_doc_link=?, deal_sheet_link=?,
               updated_at=datetime('now') WHERE id=?""",
            (sow.customer_id, sow.title, sow.project_title, sow.project_code, sow.contract_code,
             sow.opportunity_id, sow.opportunity_type_id, sow.po_number, sow.start_date, sow.end_date,
             sow.total_value, sow.duration_months, sow.gm_percent, sow.billing_model_id, sow.operating_model_id, sow.revenue_type_id, sow.practice_id, sow.status, sow.notes, sow.doc_link,
             sow.po_doc_link, sow.deal_sheet_link,
             sow_id),
        )
        row = _get_sow_or_404(conn, sow_id)
        customers, billing_models, operating_models, opportunity_types, customer_codes, revenue_types, practices = _load_lookup_maps(conn)
        row = _attach_names(row, customers, billing_models, operating_models, opportunity_types, customer_codes, revenue_types, practices)
        m_rows = conn.execute("SELECT * FROM milestones WHERE sow_id = ?", (sow_id,)).fetchall()
        return _enrich_sow(row, [_row_to_dict(m) for m in m_rows])


@app.put("/api/sows/{sow_id}/classification")
def update_sow_classification(sow_id: int, payload: SowClassificationIn):
    """Narrow update for just Revenue Type and Practice - used by Revenue
    Management's SoW Level Detail grid, whose inline Edit (and Add Entry
    draft) only exposes those two Contract fields (not the full Contract
    form), so it must touch nothing else on the SOW. A full PUT
    /api/sows/{sow_id} would require - and silently null out - every other
    field this endpoint's caller never sees."""
    with db.get_db() as conn:
        _get_sow_or_404(conn, sow_id)
        if payload.revenue_type_id is not None and not conn.execute(
            "SELECT 1 FROM revenue_types WHERE id = ?", (payload.revenue_type_id,)
        ).fetchone():
            raise HTTPException(status_code=400, detail="Selected revenue type does not exist")
        if payload.practice_id is not None and not conn.execute(
            "SELECT 1 FROM practices WHERE id = ?", (payload.practice_id,)
        ).fetchone():
            raise HTTPException(status_code=400, detail="Selected practice does not exist")
        conn.execute(
            "UPDATE sows SET revenue_type_id=?, practice_id=?, updated_at=datetime('now') WHERE id=?",
            (payload.revenue_type_id, payload.practice_id, sow_id),
        )
        row = _get_sow_or_404(conn, sow_id)
        customers, billing_models, operating_models, opportunity_types, customer_codes, revenue_types, practices = _load_lookup_maps(conn)
        return _attach_names(row, customers, billing_models, operating_models, opportunity_types, customer_codes, revenue_types, practices)


@app.delete("/api/sows/{sow_id}", status_code=204)
def delete_sow(sow_id: int):
    with db.get_db() as conn:
        _get_sow_or_404(conn, sow_id)
        _execute_delete(conn, "DELETE FROM sows WHERE id = ?", (sow_id,), "SoW")
    return None


# ---------- Milestone endpoints ----------

@app.get("/api/sows/{sow_id}/milestones")
def list_milestones(sow_id: int):
    with db.get_db() as conn:
        _get_sow_or_404(conn, sow_id)
        rows = conn.execute("SELECT * FROM milestones WHERE sow_id = ? ORDER BY due_date IS NULL, due_date ASC", (sow_id,)).fetchall()
        return [_row_to_dict(r) for r in rows]


@app.post("/api/sows/{sow_id}/milestones", status_code=201)
def create_milestone(sow_id: int, m: MilestoneIn):
    with db.get_db() as conn:
        _get_sow_or_404(conn, sow_id)
        cur = conn.execute(
            """INSERT INTO milestones (sow_id, description, amount, due_date, status, billed_date, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, datetime('now'))""",
            (sow_id, m.description, m.amount, m.due_date, m.status, m.billed_date),
        )
        row = conn.execute("SELECT * FROM milestones WHERE id = ?", (cur.lastrowid,)).fetchone()
        return _row_to_dict(row)


@app.put("/api/milestones/{milestone_id}")
def update_milestone(milestone_id: int, m: MilestoneIn):
    with db.get_db() as conn:
        existing = conn.execute("SELECT * FROM milestones WHERE id = ?", (milestone_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Milestone not found")
        conn.execute(
            """UPDATE milestones SET description=?, amount=?, due_date=?, status=?, billed_date=?,
               updated_at=datetime('now') WHERE id=?""",
            (m.description, m.amount, m.due_date, m.status, m.billed_date, milestone_id),
        )
        row = conn.execute("SELECT * FROM milestones WHERE id = ?", (milestone_id,)).fetchone()
        return _row_to_dict(row)


@app.delete("/api/milestones/{milestone_id}", status_code=204)
def delete_milestone(milestone_id: int):
    with db.get_db() as conn:
        existing = conn.execute("SELECT * FROM milestones WHERE id = ?", (milestone_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Milestone not found")
        _execute_delete(conn, "DELETE FROM milestones WHERE id = ?", (milestone_id,), "milestone")
    return None


# ---------- Customer endpoints (Administration > Customer Management) ----------

@app.get("/api/customers")
def list_customers(
    q: Optional[str] = None,
    delivery_director: Optional[str] = None,
    delivery_head: Optional[str] = None,
    client_partner: Optional[str] = None,
    sales_head: Optional[str] = None,
):
    with db.get_db() as conn:
        rows = conn.execute("SELECT * FROM customers ORDER BY customer_name COLLATE NOCASE").fetchall()
        customers = [_row_to_dict(r) for r in rows]
        if q:
            ql = q.lower()
            customers = [
                c for c in customers
                if ql in (c["customer_code"] or "").lower() or ql in (c["customer_name"] or "").lower()
            ]
        # Customer page's 4 "All X" toolbar dropdowns (Delivery director/head,
        # Client partner, Sales head) - exact match against the free-text
        # value, same fields populate their own options from (see
        # populateCustomerFilterOptions in app.js).
        for field, value in (
            ("delivery_director", delivery_director),
            ("delivery_head", delivery_head),
            ("client_partner", client_partner),
            ("sales_head", sales_head),
        ):
            if value:
                customers = [c for c in customers if (c.get(field) or "") == value]
        return customers


@app.post("/api/customers", status_code=201)
def create_customer(c: CustomerIn):
    with db.get_db() as conn:
        try:
            cur = conn.execute(
                """INSERT INTO customers (customer_code, customer_name, client_partner, delivery_director,
                   delivery_head, sales_head, industry, headquarters, geo, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))""",
                (c.customer_code, c.customer_name, c.client_partner, c.delivery_director,
                 c.delivery_head, c.sales_head, c.industry, c.headquarters, c.geo),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail=f"Customer code '{c.customer_code}' already exists")
        return _get_customer_or_404(conn, cur.lastrowid)


@app.get("/api/customers/export")
def export_customers(
    q: Optional[str] = None,
    delivery_director: Optional[str] = None,
    delivery_head: Optional[str] = None,
    client_partner: Optional[str] = None,
    sales_head: Optional[str] = None,
):
    """Export the customer list to an .xlsx workbook, honoring the same
    search/filter parameters as GET /api/customers (so an export taken while
    the grid is filtered matches what's on screen). Registered before
    /api/customers/{customer_id} for the same reason as /api/sows/export."""
    customers = list_customers(
        q=q, delivery_director=delivery_director, delivery_head=delivery_head,
        client_partner=client_partner, sales_head=sales_head,
    )

    headers = ["Customer code", "Customer name", "Delivery director", "Delivery head",
               "Client partner", "Sales head", "Industry", "Headquarters", "Geo"]
    rows = [
        [
            c.get("customer_code") or "",
            c.get("customer_name") or "",
            c.get("delivery_director") or "",
            c.get("delivery_head") or "",
            c.get("client_partner") or "",
            c.get("sales_head") or "",
            c.get("industry") or "",
            c.get("headquarters") or "",
            c.get("geo") or "",
        ]
        for c in customers
    ]
    widths = [18, 28, 22, 22, 22, 22, 20, 22, 14]
    wb = _build_workbook("Customers", headers, rows, widths=widths)
    return _xlsx_response(wb, f"trakerz_customers_{date.today().isoformat()}.xlsx")


@app.get("/api/customers/{customer_id}")
def get_customer(customer_id: int):
    with db.get_db() as conn:
        return _get_customer_or_404(conn, customer_id)


@app.put("/api/customers/{customer_id}")
def update_customer(customer_id: int, c: CustomerIn):
    with db.get_db() as conn:
        _get_customer_or_404(conn, customer_id)
        try:
            conn.execute(
                """UPDATE customers SET customer_code=?, customer_name=?, client_partner=?,
                   delivery_director=?, delivery_head=?, sales_head=?, industry=?, headquarters=?, geo=?,
                   updated_at=datetime('now') WHERE id=?""",
                (c.customer_code, c.customer_name, c.client_partner, c.delivery_director,
                 c.delivery_head, c.sales_head, c.industry, c.headquarters, c.geo, customer_id),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail=f"Customer code '{c.customer_code}' already exists")
        return _get_customer_or_404(conn, customer_id)


@app.delete("/api/customers/{customer_id}", status_code=204)
def delete_customer(customer_id: int):
    with db.get_db() as conn:
        _get_customer_or_404(conn, customer_id)
        _execute_delete(conn, "DELETE FROM customers WHERE id = ?", (customer_id,), "customer")
    return None


# ---------- Resource endpoints (Management > Resource Management) ----------

@app.get("/api/resources")
def list_resources(q: Optional[str] = None):
    with db.get_db() as conn:
        rows = conn.execute("SELECT * FROM resources ORDER BY employee_name COLLATE NOCASE").fetchall()
        resources = [_row_to_dict(r) for r in rows]
        locations, employee_types, bands = _load_resource_lookup_maps(conn)
        resources = [_attach_resource_names(r, locations, employee_types, bands) for r in resources]
        if q:
            ql = q.lower()
            resources = [
                r for r in resources
                if ql in (r["employee_name"] or "").lower()
                or ql in (r["employee_code"] or "").lower()
                or ql in (r["account_name"] or "").lower()
                or ql in (r["project_name"] or "").lower()
            ]
        return resources


@app.get("/api/resources/export")
def export_resources(q: Optional[str] = None):
    """Export the Resource Management list to an .xlsx workbook, honoring
    the same search filter as GET /api/resources. Registered before
    /api/resources/{resource_id} for the same route-ordering reason as the
    SOW/Customer export endpoints above."""
    resources = list_resources(q=q)

    headers = ["Account Name", "SoW Name", "WBS ID", "Employee Code", "Employee Name",
               "Location", "Employee Type", "Band", "Allocation Start Date", "Allocation End Date"]
    rows = [
        [
            r.get("account_name") or "",
            r.get("project_name") or "",
            r.get("wbs_id") or "",
            r.get("employee_code") or "",
            r.get("employee_name") or "",
            r.get("location_name") or "",
            r.get("employee_type_name") or "",
            r.get("band_name") or "",
            _parse_iso_date(r.get("allocation_start_date")),
            _parse_iso_date(r.get("allocation_end_date")),
        ]
        for r in resources
    ]
    date_cols = (9, 10)
    widths = [22, 22, 14, 16, 22, 16, 16, 12, 20, 20]
    wb = _build_workbook("Resources", headers, rows, date_cols=date_cols, widths=widths)
    return _xlsx_response(wb, f"trakerz_resources_{date.today().isoformat()}.xlsx")


@app.post("/api/resources", status_code=201)
def create_resource(r: ResourceIn):
    with db.get_db() as conn:
        _validate_resource_refs(conn, r)
        cur = conn.execute(
            """INSERT INTO resources (account_name, project_name, wbs_id, employee_code, employee_name,
               location_id, employee_type_id, band_id, allocation_start_date, allocation_end_date, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))""",
            (r.account_name, r.project_name, r.wbs_id, r.employee_code, r.employee_name,
             r.location_id, r.employee_type_id, r.band_id, r.allocation_start_date, r.allocation_end_date),
        )
        new_id = cur.lastrowid
        row = _get_resource_or_404(conn, new_id)
        locations, employee_types, bands = _load_resource_lookup_maps(conn)
        return _attach_resource_names(row, locations, employee_types, bands)


@app.get("/api/resources/{resource_id}")
def get_resource(resource_id: int):
    with db.get_db() as conn:
        row = _get_resource_or_404(conn, resource_id)
        locations, employee_types, bands = _load_resource_lookup_maps(conn)
        return _attach_resource_names(row, locations, employee_types, bands)


@app.put("/api/resources/{resource_id}")
def update_resource(resource_id: int, r: ResourceIn):
    with db.get_db() as conn:
        _get_resource_or_404(conn, resource_id)
        _validate_resource_refs(conn, r)
        conn.execute(
            """UPDATE resources SET account_name=?, project_name=?, wbs_id=?, employee_code=?, employee_name=?,
               location_id=?, employee_type_id=?, band_id=?, allocation_start_date=?, allocation_end_date=?,
               updated_at=datetime('now') WHERE id=?""",
            (r.account_name, r.project_name, r.wbs_id, r.employee_code, r.employee_name,
             r.location_id, r.employee_type_id, r.band_id, r.allocation_start_date, r.allocation_end_date,
             resource_id),
        )
        row = _get_resource_or_404(conn, resource_id)
        locations, employee_types, bands = _load_resource_lookup_maps(conn)
        return _attach_resource_names(row, locations, employee_types, bands)


@app.delete("/api/resources/{resource_id}", status_code=204)
def delete_resource(resource_id: int):
    with db.get_db() as conn:
        _get_resource_or_404(conn, resource_id)
        _execute_delete(conn, "DELETE FROM resources WHERE id = ?", (resource_id,), "resource")
    return None


# ---------- Revenue Management (Management > Revenue Management) ----------
# Two views over the same underlying data. "SoW Level" is where revenue is
# actually entered - add/edit/delete a row per SOW, exactly like SOWs and
# Resources. "Account Level" is a read-only rollup of those same SOW numbers
# grouped by customer; it has no storage of its own, it's a join+sum below.

def _current_fiscal_year() -> int:
    """The fiscal year (Apr-start) that today falls in, e.g. Feb 2027 is
    still fiscal_year 2026 (the FY that started Apr 2026)."""
    today = date.today()
    return today.year if today.month >= 4 else today.year - 1


def _fiscal_months(entries: Dict[int, dict]) -> List[dict]:
    months = []
    for fm in range(1, 13):
        cell = entries.get(fm, {"projection": 0})
        months.append({
            "fiscal_month": fm,
            "month_label": FISCAL_MONTH_LABELS[fm - 1],
            "projection": cell["projection"],
        })
    return months


@app.get("/api/revenue/sows")
def list_revenue_sows(fiscal_year: Optional[int] = None):
    """SoW Level grid: one row per SOW explicitly added to revenue tracking
    for this fiscal year (see POST /api/revenue/sows), each with all 12
    fiscal months (Apr-Mar) - months with no entry yet default to 0 so the
    grid is ready to type into immediately after a row is added. Onsite #/
    Offshore #/Nearshore # are read straight off the revenue_sow_accounts
    row - directly user-editable (see upsert_revenue_sow_location_counts),
    not derived from anything else."""
    fy = fiscal_year if fiscal_year is not None else _current_fiscal_year()
    with db.get_db() as conn:
        tracked = conn.execute(
            """SELECT s.id AS sow_id, s.title AS sow_title, s.customer_id, c.customer_name,
                      s.total_value, s.duration_months, bm.name AS billing_model_name,
                      s.revenue_type_id, rt.name AS revenue_type_name,
                      s.practice_id, p.name AS practice_name,
                      ra.onsite_count, ra.offshore_count, ra.nearshore_count
               FROM revenue_sow_accounts ra
               JOIN sows s ON s.id = ra.sow_id
               LEFT JOIN customers c ON c.id = s.customer_id
               LEFT JOIN billing_models bm ON bm.id = s.billing_model_id
               LEFT JOIN revenue_types rt ON rt.id = s.revenue_type_id
               LEFT JOIN practices p ON p.id = s.practice_id
               WHERE ra.fiscal_year = ?
               ORDER BY c.customer_name COLLATE NOCASE, s.title COLLATE NOCASE""",
            (fy,),
        ).fetchall()
        entries = conn.execute(
            "SELECT sow_id, fiscal_month, projection FROM revenue_entries WHERE fiscal_year = ?",
            (fy,),
        ).fetchall()

        by_sow: Dict[int, Dict[int, dict]] = {}
        for e in entries:
            by_sow.setdefault(e["sow_id"], {})[e["fiscal_month"]] = {
                "projection": e["projection"],
            }

        rows = [
            {
                "sow_id": s["sow_id"],
                "sow_title": s["sow_title"],
                "customer_id": s["customer_id"],
                "customer_name": s["customer_name"] or "Unassigned",
                "total_value": s["total_value"],
                "duration_months": s["duration_months"],
                "acv": _compute_acv(s["total_value"], s["duration_months"]),
                "billing_model_name": s["billing_model_name"],
                "revenue_type_id": s["revenue_type_id"],
                "revenue_type_name": s["revenue_type_name"],
                "practice_id": s["practice_id"],
                "practice_name": s["practice_name"],
                "onsite_count": s["onsite_count"] or 0,
                "offshore_count": s["offshore_count"] or 0,
                "nearshore_count": s["nearshore_count"] or 0,
                "months": _fiscal_months(by_sow.get(s["sow_id"], {})),
            }
            for s in tracked
        ]
        return {"fiscal_year": fy, "rows": rows}


@app.get("/api/revenue/summary")
def revenue_summary(fiscal_year: Optional[int] = None):
    """Account Level summary: read-only rollup of every tracked SOW's
    monthly numbers, grouped by customer. Nothing to add/edit/delete here -
    it's entirely derived from the SoW Level data above."""
    fy = fiscal_year if fiscal_year is not None else _current_fiscal_year()
    sow_data = list_revenue_sows(fiscal_year=fy)

    by_customer: Dict[int, dict] = {}
    order: List[int] = []
    for row in sow_data["rows"]:
        cid = row["customer_id"] or 0
        if cid not in by_customer:
            by_customer[cid] = {
                "customer_id": row["customer_id"],
                "customer_name": row["customer_name"],
                "months": [
                    {"fiscal_month": fm, "month_label": FISCAL_MONTH_LABELS[fm - 1], "projection": 0}
                    for fm in range(1, 13)
                ],
            }
            order.append(cid)
        for i, m in enumerate(row["months"]):
            by_customer[cid]["months"][i]["projection"] += m["projection"]

    accounts = sorted((by_customer[cid] for cid in order), key=lambda a: (a["customer_name"] or "").lower())
    return {"fiscal_year": fy, "accounts": accounts}


@app.post("/api/revenue/sows")
def add_revenue_sow(payload: RevenueSowIn):
    """Add a SOW to the SoW Level Revenue Management grid for a fiscal year
    (an explicit "Add Entry" action, mirroring how SOWs/Resources are added)."""
    with db.get_db() as conn:
        sow = conn.execute(
            """SELECT s.id, s.title, s.customer_id, s.total_value, c.customer_name,
                      bm.name AS billing_model_name,
                      s.revenue_type_id, rt.name AS revenue_type_name,
                      s.practice_id, p.name AS practice_name
               FROM sows s
               LEFT JOIN customers c ON c.id = s.customer_id
               LEFT JOIN billing_models bm ON bm.id = s.billing_model_id
               LEFT JOIN revenue_types rt ON rt.id = s.revenue_type_id
               LEFT JOIN practices p ON p.id = s.practice_id
               WHERE s.id = ?""",
            (payload.sow_id,),
        ).fetchone()
        if not sow:
            raise HTTPException(status_code=400, detail="Selected SOW does not exist")
        conn.execute(
            "INSERT OR IGNORE INTO revenue_sow_accounts (sow_id, fiscal_year) VALUES (?, ?)",
            (payload.sow_id, payload.fiscal_year),
        )
        entries = {
            e["fiscal_month"]: e
            for e in conn.execute(
                "SELECT fiscal_month, projection FROM revenue_entries WHERE sow_id=? AND fiscal_year=?",
                (payload.sow_id, payload.fiscal_year),
            ).fetchall()
        }
        return {
            "sow_id": sow["id"],
            "sow_title": sow["title"],
            "customer_id": sow["customer_id"],
            "customer_name": sow["customer_name"] or "Unassigned",
            "total_value": sow["total_value"],
            "billing_model_name": sow["billing_model_name"],
            "revenue_type_id": sow["revenue_type_id"],
            "revenue_type_name": sow["revenue_type_name"],
            "practice_id": sow["practice_id"],
            "practice_name": sow["practice_name"],
            "months": _fiscal_months(entries),
        }


@app.delete("/api/revenue/sows/{sow_id}/{fiscal_year}", status_code=204)
def delete_revenue_sow(sow_id: int, fiscal_year: int):
    """Remove a SOW from the Revenue Management grid for a fiscal year,
    deleting all of its month entries for that year along with it."""
    with db.get_db() as conn:
        row = conn.execute(
            "SELECT 1 FROM revenue_sow_accounts WHERE sow_id=? AND fiscal_year=?",
            (sow_id, fiscal_year),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Revenue row not found")
        conn.execute("DELETE FROM revenue_entries WHERE sow_id=? AND fiscal_year=?", (sow_id, fiscal_year))
        _execute_delete(
            conn, "DELETE FROM revenue_sow_accounts WHERE sow_id=? AND fiscal_year=?",
            (sow_id, fiscal_year), "revenue row",
        )
    return None


def _add_revenue_type_summary_sheet(wb: Workbook, rows: List[dict]) -> None:
    """Appends a "Revenue Type Summary" sheet to an export workbook, with the
    same Revenue Type x Month rollup (one row per Revenue Type in the master
    list, plus "Unassigned" only if at least one row here has none, Total/
    Q1-Q4 alongside Apr-Mar) shown on screen directly above the grid being
    exported - see renderRevenueTypeSummaryTable in app.js, which this
    mirrors exactly. Shared by both the Managed Services and Time and
    Material exports."""
    with db.get_db() as conn:
        revenue_type_names = [
            r["name"] for r in conn.execute("SELECT name FROM revenue_types ORDER BY name COLLATE NOCASE").fetchall()
        ]

    sums_by_type: Dict[str, List[float]] = {}
    for r in rows:
        key = r.get("revenue_type_name") or ""
        sums = sums_by_type.setdefault(key, [0.0] * 12)
        for i, m in enumerate(r["months"]):
            sums[i] += m["projection"] or 0

    labels = list(revenue_type_names)
    if "" in sums_by_type:
        labels.append("Unassigned")

    headers = ["Revenue Type", "Total", "Apr", "May", "Jun", "Q1", "Jul", "Aug", "Sep", "Q2",
               "Oct", "Nov", "Dec", "Q3", "Jan", "Feb", "Mar", "Q4"]
    summary_rows = []
    for label in labels:
        key = "" if label == "Unassigned" else label
        sums = sums_by_type.get(key, [0.0] * 12)
        q1, q2, q3, q4 = sum(sums[0:3]), sum(sums[3:6]), sum(sums[6:9]), sum(sums[9:12])
        summary_rows.append([
            label, q1 + q2 + q3 + q4,
            sums[0], sums[1], sums[2], q1,
            sums[3], sums[4], sums[5], q2,
            sums[6], sums[7], sums[8], q3,
            sums[9], sums[10], sums[11], q4,
        ])

    ws = wb.create_sheet("Revenue Type Summary")
    ws.append(headers)
    for cell in ws[1]:
        cell.font = Font(bold=True)
    for row in summary_rows:
        ws.append(row)
    for row in ws.iter_rows(min_row=2, max_row=ws.max_row):
        for col in range(2, len(headers) + 1):
            row[col - 1].number_format = "#,##0.00"
    widths = [22] + [12] * (len(headers) - 1)
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w


@app.get("/api/revenue/sows/export")
def export_revenue_sows(fiscal_year: Optional[int] = None):
    fy = fiscal_year if fiscal_year is not None else _current_fiscal_year()
    data = list_revenue_sows(fiscal_year=fy)

    headers = ["Account Name", "Contract Title", "TCV (USD)", "Duration (Months)", "ACV (USD)", "Billing Model", "Revenue Type", "Practice"]
    headers.extend(FISCAL_MONTH_LABELS)

    rows = []
    for r in data["rows"]:
        row = [r["customer_name"], r["sow_title"], r["total_value"], r["duration_months"], r["acv"], r["billing_model_name"] or "", r["revenue_type_name"] or "", r["practice_name"] or ""]
        for m in r["months"]:
            row.append(m["projection"])
        rows.append(row)

    # TCV (USD)/ACV (USD) (columns 3, 5) and every month column (9 onward -
    # Duration/Billing Model/Revenue Type/Practice at 4/6/7/8 are plain
    # numbers/text) are currency-formatted; kept as one non-contiguous tuple
    # rather than separate ranges since _build_workbook takes a single
    # currency_cols argument.
    currency_cols = (3, 5) + tuple(range(9, len(headers) + 1))
    widths = [24, 28, 14, 16, 14, 18, 18, 18] + [14] * (len(headers) - 8)
    wb = _build_workbook(f"Revenue SoW Level FY{fy}", headers, rows, currency_cols=currency_cols, widths=widths)
    # A second sheet with the same Revenue Type x Month rollup shown on
    # screen right above this grid (see renderRevenueTypeSummaryTable in
    # app.js), so the export isn't missing what the user is looking at when
    # they click Export.
    _add_revenue_type_summary_sheet(wb, data["rows"])
    return _xlsx_response(wb, f"trakerz_revenue_sow_level_fy{fy}_{date.today().isoformat()}.xlsx")


@app.get("/api/revenue/sows/import-template")
def revenue_sows_import_template():
    """Deliberately narrower than export_revenue_sows() - per explicit
    request, Sheet 1 carries only Revenue Type, Customer Name, Practice,
    Onsite #/Offshore #/Nearshore # and the 12 fiscal months (Apr-Mar);
    Contract Title is no longer one of these columns, so a row is matched
    to a SOW by Customer Name alone (see import_revenue_sows) - that only
    works while the customer has exactly one SOW, otherwise the row is
    rejected asking to disambiguate. Revenue Type, Practice and the three
    location-count columns are shown here for context only and still
    ignored on import (the main grid's own values aren't touched by an
    import even though Onsite #/Offshore #/Nearshore # are directly
    user-editable there - see upsert_revenue_sow_location_counts). A
    "contract title" column is still
    honored if present (older template/export round-tripped back in), which
    resolves the SOW directly and skips the customer-only ambiguity check.
    Sheet 2 is a plain reference list of the Revenue Types, Customers and
    Practices already configured, so whoever is filling in Sheet 1 knows
    which exact spellings will match on import (see _lookup_id_by_name/
    _lookup_customer_id_by_name - both are case-insensitive but still need
    an exact name match)."""
    headers = ["Revenue Type", "Customer Name", "Practice", "Onsite #", "Offshore #", "Nearshore #"]
    headers.extend(FISCAL_MONTH_LABELS)
    widths = [18, 22, 16, 12, 12, 12] + [12] * (len(headers) - 6)
    wb = _build_workbook("Revenue SoW Level Template", headers, [], widths=widths)
    with db.get_db() as conn:
        revenue_types = [r["name"] for r in conn.execute("SELECT name FROM revenue_types ORDER BY name COLLATE NOCASE").fetchall()]
        customer_names = [r["customer_name"] for r in conn.execute("SELECT customer_name FROM customers ORDER BY customer_name COLLATE NOCASE").fetchall()]
        practice_names = [r["name"] for r in conn.execute("SELECT name FROM practices ORDER BY name COLLATE NOCASE").fetchall()]
    _add_reference_sheet(wb, "Reference Lists", {
        "Available Revenue Types": revenue_types,
        "Available Customer Name": customer_names,
        "Available Practice": practice_names,
    })
    return _xlsx_response(wb, "trakerz_revenue_sow_level_template.xlsx")


@app.post("/api/revenue/sows/import")
async def import_revenue_sows(fiscal_year: Optional[int] = None, file: UploadFile = File(...)):
    """Bulk version of "Add Entry" + typing in the months: each row picks an
    existing SOW and sets its 12 monthly Projections for the fiscal year,
    registering it into tracking first if it wasn't already (same INSERT OR
    IGNORE as add_revenue_sow/upsert_revenue_cell). A row already tracked
    for this fiscal year is simply overwritten with the sheet's numbers
    rather than rejected, so re-importing an edited export is the expected
    workflow. The current template (see revenue_sows_import_template) has
    no Contract Title column, so a row is resolved to a SOW by Customer
    Name alone via _lookup_sow_id_by_customer_only - which requires that
    customer to have exactly one SOW, erroring otherwise rather than
    guessing. A "contract title" cell is still honored when present (an
    older template/export filled back in), resolving the SOW directly via
    _lookup_sow_id instead. Every row is validated in full before anything
    is written for it, so one bad row can't leave a half-written entry
    behind; other rows still import even if this one fails."""
    fy = fiscal_year if fiscal_year is not None else _current_fiscal_year()
    content = await file.read()
    try:
        records = _read_import_rows(content, ["Customer Name"])
    except ValueError as e:
        try:
            # Backward compatible with the old template/export, which used
            # "Account Name" for this same column instead of "Customer Name".
            records = _read_import_rows(content, ["Account Name"])
        except ValueError:
            raise HTTPException(status_code=400, detail=str(e))

    imported = 0
    errors = []
    with db.get_db() as conn:
        for i, rec in enumerate(records, start=2):  # row 1 is the header
            try:
                customer_name = _cell_str(rec.get("customer name")) or _cell_str(rec.get("account name"))
                if not customer_name:
                    raise ValueError("Customer Name is required")
                customer_id = _lookup_customer_id_by_name(conn, customer_name)
                title = _cell_str(rec.get("contract title"))
                if title:
                    sow_id = _lookup_sow_id(conn, customer_id, title)
                else:
                    sow_id = _lookup_sow_id_by_customer_only(conn, customer_id, customer_name)

                months = []
                for m_idx, label in enumerate(FISCAL_MONTH_LABELS, start=1):
                    # Plain month name (current export/template header) with a
                    # fallback to the old "<month> projections" wording, so a
                    # file exported before that header was shortened still
                    # imports cleanly.
                    cell = rec.get(label.lower())
                    if cell is None:
                        cell = rec.get(f"{label.lower()} projections")
                    months.append((m_idx, _cell_float(cell)))

                conn.execute(
                    "INSERT OR IGNORE INTO revenue_sow_accounts (sow_id, fiscal_year) VALUES (?, ?)",
                    (sow_id, fy),
                )
                for m_idx, projection in months:
                    conn.execute(
                        """INSERT INTO revenue_entries (sow_id, fiscal_year, fiscal_month, projection, updated_at)
                           VALUES (?, ?, ?, ?, datetime('now'))
                           ON CONFLICT(sow_id, fiscal_year, fiscal_month)
                           DO UPDATE SET projection = excluded.projection, updated_at = datetime('now')""",
                        (sow_id, fy, m_idx, projection),
                    )
                imported += 1
            except Exception as e:
                errors.append({"row": i, "message": str(e)})
    return {"fiscal_year": fy, "imported": imported, "errors": errors}


@app.get("/api/revenue/summary/export")
def export_revenue_summary(fiscal_year: Optional[int] = None):
    fy = fiscal_year if fiscal_year is not None else _current_fiscal_year()
    data = revenue_summary(fiscal_year=fy)

    headers = ["Account Name"]
    headers.extend(FISCAL_MONTH_LABELS)

    rows = []
    for acc in data["accounts"]:
        row = [acc["customer_name"]]
        for m in acc["months"]:
            row.append(m["projection"])
        rows.append(row)

    currency_cols = tuple(range(2, len(headers) + 1))
    widths = [24] + [14] * (len(headers) - 1)
    wb = _build_workbook(f"Revenue Account Summary FY{fy}", headers, rows, currency_cols=currency_cols, widths=widths)
    return _xlsx_response(wb, f"trakerz_revenue_account_summary_fy{fy}_{date.today().isoformat()}.xlsx")


@app.put("/api/revenue/sows")
def upsert_revenue_cell(cell: RevenueCellIn):
    """Upsert one (SOW, fiscal month) cell - the inline grid calls this once
    per cell on blur rather than saving the whole grid at once."""
    if not 1 <= cell.fiscal_month <= 12:
        raise HTTPException(status_code=400, detail="fiscal_month must be between 1 and 12")
    with db.get_db() as conn:
        if not conn.execute("SELECT 1 FROM sows WHERE id = ?", (cell.sow_id,)).fetchone():
            raise HTTPException(status_code=400, detail="Selected SOW does not exist")
        # Defensive: keep the row tracked even if this cell was saved out of
        # band (e.g. a stale grid) rather than through the Add Entry flow.
        conn.execute(
            "INSERT OR IGNORE INTO revenue_sow_accounts (sow_id, fiscal_year) VALUES (?, ?)",
            (cell.sow_id, cell.fiscal_year),
        )
        conn.execute(
            """INSERT INTO revenue_entries (sow_id, fiscal_year, fiscal_month, projection, updated_at)
               VALUES (?, ?, ?, ?, datetime('now'))
               ON CONFLICT(sow_id, fiscal_year, fiscal_month)
               DO UPDATE SET projection = excluded.projection, updated_at = datetime('now')""",
            (cell.sow_id, cell.fiscal_year, cell.fiscal_month, cell.projection),
        )
        row = conn.execute(
            """SELECT sow_id, fiscal_year, fiscal_month, projection FROM revenue_entries
               WHERE sow_id=? AND fiscal_year=? AND fiscal_month=?""",
            (cell.sow_id, cell.fiscal_year, cell.fiscal_month),
        ).fetchone()
        return _row_to_dict(row)


@app.put("/api/revenue/sows/location-counts")
def upsert_revenue_sow_location_counts(payload: RevenueSowLocationCountsIn):
    """Upsert Onsite #/Offshore #/Nearshore # for one (SOW, fiscal year) row
    on the Managed Services grid - directly user-editable per explicit
    request (previously a read-only count of Time and Material assignments
    tied to the SOW). Self-sufficient INSERT OR IGNORE first, same as
    upsert_revenue_cell just above, so this can safely run concurrently with
    (or before) the month-cell PUTs and classification PUT that a single
    Save/Add Entry click fires together."""
    with db.get_db() as conn:
        if not conn.execute("SELECT 1 FROM sows WHERE id = ?", (payload.sow_id,)).fetchone():
            raise HTTPException(status_code=400, detail="Selected SOW does not exist")
        conn.execute(
            "INSERT OR IGNORE INTO revenue_sow_accounts (sow_id, fiscal_year) VALUES (?, ?)",
            (payload.sow_id, payload.fiscal_year),
        )
        conn.execute(
            """UPDATE revenue_sow_accounts SET onsite_count=?, offshore_count=?, nearshore_count=?
               WHERE sow_id=? AND fiscal_year=?""",
            (payload.onsite_count, payload.offshore_count, payload.nearshore_count, payload.sow_id, payload.fiscal_year),
        )
        return {
            "sow_id": payload.sow_id,
            "fiscal_year": payload.fiscal_year,
            "onsite_count": payload.onsite_count,
            "offshore_count": payload.offshore_count,
            "nearshore_count": payload.nearshore_count,
        }


# ---------- Time and Material tracking (Financial > Projections > Time and Material) ----------
# One row per employee assignment to a Contract (not per SOW - see db.py's
# tm_assignments comment), with its own Revenue Type/Employee Practice
# separate from the linked Contract's.

def _final_rate_card(rate_card: Optional[float], discount_percent: Optional[float]) -> Optional[float]:
    """Rate Card with Discount % applied. Computed on every read rather than
    stored, so editing rate_card or discount_percent later can never leave a
    stale Final Rate Card behind."""
    if rate_card is None:
        return None
    pct = discount_percent or 0
    return round(rate_card * (1 - pct / 100), 2)


def _location_slug(conn, location_id: Optional[int]) -> Optional[str]:
    """Maps a Location's id to "onsite"/"offshore"/"nearshore" - the fixed
    three-value set Billing Hours and Holiday Calendar both key their
    per-location columns off (see billing_hour_configs/holiday_calendar in
    db.py). None for a missing id or a location whose name isn't one of the
    three (Locations no longer offers an "Add" button, but a name typed
    directly through the API is still possible)."""
    if not location_id:
        return None
    row = conn.execute("SELECT name FROM locations WHERE id = ?", (location_id,)).fetchone()
    if not row:
        return None
    slug = (row["name"] or "").strip().lower()
    return slug if slug in ("onsite", "offshore", "nearshore") else None


def _billing_hours_per_day(conn, customer_id: Optional[int], location_id: Optional[int]) -> Optional[float]:
    """Looked up from Billing Hours (Customer Configuration), never stored on
    the assignment - so re-configuring it there is picked up immediately by
    every assignment at that Customer+Location. None when Location isn't set
    yet, isn't one of the fixed three, or no configuration exists for that
    Customer."""
    if not customer_id:
        return None
    slug = _location_slug(conn, location_id)
    if not slug:
        return None
    row = conn.execute(
        f"SELECT {slug}_hours FROM billing_hour_configs WHERE customer_id = ?",
        (customer_id,),
    ).fetchone()
    return row[f"{slug}_hours"] if row else None


def _fiscal_month_calendar_range(fiscal_year: int, fiscal_month: int):
    """The (first_day, last_day) calendar-month range a fiscal_month falls
    in, for a fiscal year that runs Apr(fiscal_year)-Mar(fiscal_year+1) -
    same convention as _current_fiscal_year/FISCAL_MONTH_LABELS."""
    if fiscal_month <= 9:
        cal_year, cal_month = fiscal_year, fiscal_month + 3
    else:
        cal_year, cal_month = fiscal_year + 1, fiscal_month - 9
    first_day = date(cal_year, cal_month, 1)
    last_day = date(cal_year, cal_month, calendar.monthrange(cal_year, cal_month)[1])
    return first_day, last_day


def _count_weekdays(start: date, end: date) -> int:
    """Count Mon-Fri calendar days in [start, end] inclusive (0 if start is
    after end)."""
    if start > end:
        return 0
    total_days = (end - start).days + 1
    full_weeks, remainder = divmod(total_days, 7)
    count = full_weeks * 5
    for i in range(remainder):
        if (start + timedelta(days=full_weeks * 7 + i)).weekday() < 5:
            count += 1
    return count


def _has_leave_record(conn, customer_id: Optional[int], employee_id: Optional[str]) -> bool:
    """Whether a Leave Management row (Configuration > Resource and Leave)
    exists for this assignment's Customer + Employee ID - drives the
    "Leave details are missing" info icon next to the employee name on the
    Time and Material grid, same cross-reference direction as the "not
    tagged to any SOW" highlight on the Leave grid itself (see
    _employee_ids_tagged_to_sow), just checked from the other table."""
    if not customer_id or not (employee_id or "").strip():
        return False
    row = conn.execute(
        "SELECT 1 FROM leave_management WHERE customer_id=? AND employee_id = ? COLLATE NOCASE",
        (customer_id, employee_id.strip()),
    ).fetchone()
    return row is not None


def _compute_tm_projections(conn, a, fiscal_year: int, billing_hours: Optional[float]) -> Dict[int, float]:
    """Time and Material's Projections are auto-calculated, never manually
    entered - for each fiscal month:
        billable_days = max(working_days - holidays - leaves, 0)
        projection = billable_days * final_rate_card * billing_hours_per_day
    where working_days is Mon-Fri only, counted over the overlap between the
    assignment's [start_date, end_date] and that fiscal month; holidays come
    from Holiday Calendar for this assignment's Customer+Location (only
    counting ones that themselves fall on a weekday within that overlap, so
    a holiday is never subtracted twice by also not being a "working day");
    leaves come from Leave Management for this assignment's Customer+
    Employee ID as a flat per-month count (not clipped to the overlap the
    way individual holiday dates are, since leave is only tracked as a
    monthly total). Returns all-zero when start/end date, location, or rate
    aren't set yet, or no Billing Hours Configuration exists for the
    Customer+Location - there's nothing to compute against."""
    result: Dict[int, float] = {fm: 0.0 for fm in range(1, 13)}

    final_rate = _final_rate_card(a["rate_card"], a["discount_percent"])
    if not billing_hours or final_rate is None:
        return result

    try:
        assignment_start = date.fromisoformat(a["start_date"]) if a["start_date"] else None
        assignment_end = date.fromisoformat(a["end_date"]) if a["end_date"] else None
    except ValueError:
        return result
    if not assignment_start or not assignment_end or assignment_start > assignment_end:
        return result

    customer_id = a["customer_id"]
    location_id = a["location_id"]
    employee_id = a["employee_id"]

    holiday_dates = set()
    location_slug = _location_slug(conn, location_id)
    if customer_id and location_slug:
        for hr in conn.execute(
            f"SELECT holiday_date FROM holiday_calendar WHERE customer_id=? AND {location_slug}=1",
            (customer_id,),
        ).fetchall():
            try:
                holiday_dates.add(date.fromisoformat(hr["holiday_date"]))
            except (TypeError, ValueError):
                continue

    leave_row = None
    if customer_id and employee_id:
        leave_row = conn.execute(
            "SELECT * FROM leave_management WHERE customer_id=? AND employee_id = ? COLLATE NOCASE",
            (customer_id, employee_id),
        ).fetchone()

    for fm in range(1, 13):
        month_first, month_last = _fiscal_month_calendar_range(fiscal_year, fm)
        range_start = max(month_first, assignment_start)
        range_end = min(month_last, assignment_end)
        if range_start > range_end:
            continue  # this fiscal month is entirely outside the assignment's dates

        working_days = _count_weekdays(range_start, range_end)
        holidays_in_range = sum(
            1 for d in holiday_dates if range_start <= d <= range_end and d.weekday() < 5
        )
        leave_days = leave_row[_LEAVE_MONTH_COLUMNS[fm - 1]] if leave_row else 0

        billable_days = max(working_days - holidays_in_range - (leave_days or 0), 0)
        result[fm] = round(billable_days * final_rate * billing_hours, 2)

    return result


def _tm_row_dict(conn, a, fiscal_year: int) -> dict:
    billing_hours = _billing_hours_per_day(conn, a["customer_id"], a["location_id"])
    computed_projections = _compute_tm_projections(conn, a, fiscal_year, billing_hours)
    months = [
        {"fiscal_month": fm, "month_label": FISCAL_MONTH_LABELS[fm - 1], "projection": computed_projections.get(fm, 0)}
        for fm in range(1, 13)
    ]
    return {
        "assignment_id": a["assignment_id"],
        "customer_id": a["customer_id"],
        "customer_name": a["customer_name"] or "Unassigned",
        "sow_id": a["sow_id"],
        "sow_title": a["sow_title"],
        "billing_model_id": a["billing_model_id"],
        "billing_model_name": a["billing_model_name"],
        "revenue_type_id": a["revenue_type_id"],
        "revenue_type_name": a["revenue_type_name"],
        "employee_id": a["employee_id"],
        "employee_name": a["employee_name"],
        "leave_details_missing": not _has_leave_record(conn, a["customer_id"], a["employee_id"]),
        "location_id": a["location_id"],
        "location_name": a["location_name"],
        "practice_id": a["practice_id"],
        "practice_name": a["practice_name"],
        "wbs_id": a["wbs_id"],
        "sow_role": a["sow_role"],
        "rate_card": a["rate_card"],
        "discount_percent": a["discount_percent"],
        "final_rate_card": _final_rate_card(a["rate_card"], a["discount_percent"]),
        "billing_hours_per_day": billing_hours,
        "start_date": a["start_date"],
        "end_date": a["end_date"],
        "months": months,
    }


_TM_ASSIGNMENT_SELECT = """
    SELECT a.id AS assignment_id, a.customer_id, c.customer_name,
           a.sow_id, s.title AS sow_title,
           s.billing_model_id, bm.name AS billing_model_name,
           a.revenue_type_id, rt.name AS revenue_type_name,
           a.employee_id, a.employee_name,
           a.location_id, l.name AS location_name,
           a.practice_id, p.name AS practice_name,
           a.wbs_id, a.sow_role, a.rate_card, a.discount_percent,
           a.start_date, a.end_date
    FROM tm_assignments a
    LEFT JOIN customers c ON c.id = a.customer_id
    LEFT JOIN sows s ON s.id = a.sow_id
    LEFT JOIN billing_models bm ON bm.id = s.billing_model_id
    LEFT JOIN revenue_types rt ON rt.id = a.revenue_type_id
    LEFT JOIN locations l ON l.id = a.location_id
    LEFT JOIN practices p ON p.id = a.practice_id
"""


def _validate_tm_refs(conn, payload: TmAssignmentIn):
    if payload.customer_id is not None and not conn.execute(
        "SELECT 1 FROM customers WHERE id = ?", (payload.customer_id,)
    ).fetchone():
        raise HTTPException(status_code=400, detail="Selected customer does not exist")
    if payload.sow_id is not None and not conn.execute(
        "SELECT 1 FROM sows WHERE id = ?", (payload.sow_id,)
    ).fetchone():
        raise HTTPException(status_code=400, detail="Selected Statement of Work does not exist")
    if payload.revenue_type_id is not None and not conn.execute(
        "SELECT 1 FROM revenue_types WHERE id = ?", (payload.revenue_type_id,)
    ).fetchone():
        raise HTTPException(status_code=400, detail="Selected revenue type does not exist")
    if payload.location_id is not None and not conn.execute(
        "SELECT 1 FROM locations WHERE id = ?", (payload.location_id,)
    ).fetchone():
        raise HTTPException(status_code=400, detail="Selected location does not exist")
    if payload.practice_id is not None and not conn.execute(
        "SELECT 1 FROM practices WHERE id = ?", (payload.practice_id,)
    ).fetchone():
        raise HTTPException(status_code=400, detail="Selected practice does not exist")


@app.get("/api/tm/assignments")
def list_tm_assignments(fiscal_year: Optional[int] = None):
    """Time and Material grid: one row per employee assignment explicitly
    added to this fiscal year (see POST /api/tm/assignments), each with all
    12 fiscal months - mirrors GET /api/revenue/sows but keyed by assignment
    rather than by SOW, since several assignments can share one Contract."""
    fy = fiscal_year if fiscal_year is not None else _current_fiscal_year()
    with db.get_db() as conn:
        tracked = conn.execute(
            _TM_ASSIGNMENT_SELECT + """
               JOIN tm_assignment_fiscal_years fy ON fy.assignment_id = a.id
               WHERE fy.fiscal_year = ?
               ORDER BY c.customer_name COLLATE NOCASE, a.employee_name COLLATE NOCASE""",
            (fy,),
        ).fetchall()

        rows = [_tm_row_dict(conn, a, fy) for a in tracked]
        return {"fiscal_year": fy, "rows": rows}


@app.post("/api/tm/assignments", status_code=201)
def add_tm_assignment(payload: TmAssignmentCreateIn):
    """Add Entry on the Time and Material grid: creates the assignment and
    registers it for a fiscal year in one step (there's no separate
    "manage assignments" page the way SOWs have Contract Management)."""
    with db.get_db() as conn:
        _validate_tm_refs(conn, payload)
        cur = conn.execute(
            """INSERT INTO tm_assignments (customer_id, sow_id, revenue_type_id, employee_id, employee_name,
               location_id, practice_id, wbs_id, sow_role, rate_card, discount_percent, start_date, end_date, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))""",
            (payload.customer_id, payload.sow_id, payload.revenue_type_id, payload.employee_id, payload.employee_name,
             payload.location_id, payload.practice_id, payload.wbs_id, payload.sow_role, payload.rate_card, payload.discount_percent,
             payload.start_date, payload.end_date),
        )
        assignment_id = cur.lastrowid
        conn.execute(
            "INSERT OR IGNORE INTO tm_assignment_fiscal_years (assignment_id, fiscal_year) VALUES (?, ?)",
            (assignment_id, payload.fiscal_year),
        )
        row = conn.execute(_TM_ASSIGNMENT_SELECT + "WHERE a.id = ?", (assignment_id,)).fetchone()
        return _tm_row_dict(conn, row, payload.fiscal_year)


@app.put("/api/tm/assignments/{assignment_id}")
def update_tm_assignment(assignment_id: int, payload: TmAssignmentIn):
    """Edits an assignment's descriptive fields (Revenue Type, Employee
    ID/Name, Location, Practice, Contract, SoW Role, WBS ID, Rate Card,
    Discount %, Start/End Date) - used by the grid's row-level Edit/Save,
    paired with PUT /api/tm/entries for the 12 month cells."""
    with db.get_db() as conn:
        if not conn.execute("SELECT 1 FROM tm_assignments WHERE id = ?", (assignment_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Assignment not found")
        _validate_tm_refs(conn, payload)
        conn.execute(
            """UPDATE tm_assignments SET customer_id=?, sow_id=?, revenue_type_id=?, employee_id=?, employee_name=?,
               location_id=?, practice_id=?, wbs_id=?, sow_role=?, rate_card=?, discount_percent=?, start_date=?, end_date=?,
               updated_at=datetime('now') WHERE id=?""",
            (payload.customer_id, payload.sow_id, payload.revenue_type_id, payload.employee_id, payload.employee_name,
             payload.location_id, payload.practice_id, payload.wbs_id, payload.sow_role, payload.rate_card, payload.discount_percent,
             payload.start_date, payload.end_date, assignment_id),
        )
        row = conn.execute(_TM_ASSIGNMENT_SELECT + "WHERE a.id = ?", (assignment_id,)).fetchone()
        # Note: the caller's currently-selected fiscal year isn't part of this
        # payload (an assignment isn't itself scoped to one - see
        # tm_assignment_fiscal_years), and this response's computed months
        # aren't used directly anyway (the grid's row-level Save always
        # follows up with a full loadTmAssignments() reload), so any fiscal
        # year works here.
        return _tm_row_dict(conn, row, _current_fiscal_year())


@app.delete("/api/tm/assignments/{assignment_id}/{fiscal_year}", status_code=204)
def delete_tm_assignment(assignment_id: int, fiscal_year: int):
    """Removes this assignment from just this fiscal year's grid - mirrors
    DELETE /api/revenue/sows/{sow_id}/{fy}. The assignment record itself
    survives if it's still tracked in another fiscal year."""
    with db.get_db() as conn:
        conn.execute(
            "DELETE FROM tm_assignment_fiscal_years WHERE assignment_id = ? AND fiscal_year = ?",
            (assignment_id, fiscal_year),
        )
    return None


@app.get("/api/tm/assignments/export")
def export_tm_assignments(fiscal_year: Optional[int] = None):
    fy = fiscal_year if fiscal_year is not None else _current_fiscal_year()
    data = list_tm_assignments(fiscal_year=fy)

    # Column order mirrors the on-screen grid (see buildTmAssignmentRow in
    # app.js), minus Actions/Sl. No which aren't data.
    headers = ["Revenue Type", "Customer Name", "Statement of Work",
               "Employee ID", "Employee Name", "Location", "Billing Hours per day",
               "Practice", "SoW Role", "WBS ID", "Rate Card", "Discount %", "Discounted Rate Card",
               "Start date", "End date"]
    headers.extend(FISCAL_MONTH_LABELS)

    rows = []
    for r in data["rows"]:
        row = [
            r["revenue_type_name"] or "", r["customer_name"] or "", r["sow_title"] or "",
            r["employee_id"] or "", r["employee_name"] or "", r["location_name"] or "",
            r["billing_hours_per_day"] or 0,
            r["practice_name"] or "", r["sow_role"] or "", r["wbs_id"] or "",
            r["rate_card"] or 0, r["discount_percent"] or 0, r["final_rate_card"] or 0,
            _parse_iso_date(r.get("start_date")), _parse_iso_date(r.get("end_date")),
        ]
        for m in r["months"]:
            row.append(m["projection"])
        rows.append(row)

    date_cols = (14, 15)
    currency_cols = (11, 13) + tuple(range(16, len(headers) + 1))
    percent_cols = (12,)
    widths = [16, 22, 26, 14, 20, 16, 16, 18, 16, 14, 12, 10, 14, 13, 13] + [14] * (len(headers) - 15)
    wb = _build_workbook("T&M Projections", headers, rows, date_cols=date_cols,
                          currency_cols=currency_cols, percent_cols=percent_cols, widths=widths)
    # Same Revenue Type Summary sheet as the Managed Services export (see
    # _add_revenue_type_summary_sheet) - the rollup shown on screen directly
    # above this grid.
    _add_revenue_type_summary_sheet(wb, data["rows"])
    return _xlsx_response(wb, f"trakerz_time_material_fy{fy}_{date.today().isoformat()}.xlsx")


@app.get("/api/tm/assignments/import-template")
def tm_assignments_import_template():
    """Deliberately narrower than export_tm_assignments() - Sheet 1 carries
    only the fields someone actually fills in by hand (Employee Name +
    Customer Name are the only two required, matching the "Add Entry" draft
    row's own Save-enabling rule); Final Rate Card, Billing Hours per day
    and every month's Projections are all server-computed (see
    _final_rate_card/_billing_hours_per_day/_compute_tm_projections) and
    left out entirely so the template doesn't imply they're editable input.
    Discount (%) IS a plain input field though (see TmAssignmentIn) and is
    included here, read back in import_tm_assignments(). Contract Title
    (SOW) is intentionally not one of these columns per explicit request -
    an imported assignment lands unlinked to any SOW (same as leaving it
    blank always did) and can still be tied to one afterward from the grid.
    Sheet 2 is a plain reference list of the Revenue Types, Customers,
    Practices and Locations already configured, so whoever is filling in
    Sheet 1 knows which exact spellings will match on import (see
    _lookup_id_by_name/_lookup_customer_id_by_name - both are
    case-insensitive but still need an exact name match)."""
    headers = ["Revenue Type", "Customer Name", "Employee ID", "Employee Name", "Location", "Practice",
               "SoW Role", "WBS ID", "Rate Card", "Discount (%)", "Start Date (dd-mmm-yyyy)", "End Date (dd-mmm-yyyy)"]
    date_cols = (11, 12)
    widths = [16, 22, 14, 20, 16, 16, 16, 14, 12, 14, 24, 24]
    wb = _build_workbook("Time and Material Template", headers, [], date_cols=date_cols, widths=widths)
    with db.get_db() as conn:
        revenue_types = [r["name"] for r in conn.execute("SELECT name FROM revenue_types ORDER BY name COLLATE NOCASE").fetchall()]
        customer_names = [r["customer_name"] for r in conn.execute("SELECT customer_name FROM customers ORDER BY customer_name COLLATE NOCASE").fetchall()]
        practice_names = [r["name"] for r in conn.execute("SELECT name FROM practices ORDER BY name COLLATE NOCASE").fetchall()]
        location_names = [r["name"] for r in conn.execute("SELECT name FROM locations ORDER BY name COLLATE NOCASE").fetchall()]
    _add_reference_sheet(wb, "Reference Lists", {
        "Available Revenue Types": revenue_types,
        "Available Customer Name": customer_names,
        "Available Practice": practice_names,
        "Available Location": location_names,
    })
    return _xlsx_response(wb, "trakerz_time_material_template.xlsx")


@app.post("/api/tm/assignments/import")
async def import_tm_assignments(fiscal_year: Optional[int] = None, file: UploadFile = File(...)):
    """Bulk version of "Add Entry": unlike the SoW Level grid, an assignment
    has no uniqueness rule (each Add Entry always creates a brand-new row,
    even a duplicate one), so every row here becomes a new tm_assignments
    row - there's no matching-existing-row/upsert case to handle. Contract
    Title isn't a column in tm_assignments_import_template() at all (per
    explicit request), so every imported row lands unlinked to any SOW -
    same as leaving Contract Title blank always did - and can be tied to
    one afterward from the grid; the sheet is still read leniently enough
    that a "contract title" cell in an older template/file is honored if
    present. Discount (%) IS one of the template's columns and is read and
    applied here, same as Rate Card; leaving that cell blank imports the
    row undiscounted (Final Rate Card equal to Rate Card), same as a
    freshly-typed "Add Entry" row with Discount % left blank. Final Rate
    Card, Billing Hours per day and Projections are all likewise never read
    from the sheet - they're computed server-side on every read (see
    _final_rate_card/_billing_hours_per_day/_compute_tm_projections), so
    nothing but the assignment's own descriptive fields below is written
    here. Every row is validated in full before anything is written for it,
    so one bad row can't leave a half-written assignment behind; other rows
    still import even if this one fails."""
    fy = fiscal_year if fiscal_year is not None else _current_fiscal_year()
    content = await file.read()
    try:
        records = _read_import_rows(content, ["Employee Name", "Customer Name"])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    imported = 0
    errors = []
    with db.get_db() as conn:
        for i, rec in enumerate(records, start=2):  # row 1 is the header
            try:
                employee_name = _cell_str(rec.get("employee name"))
                customer_name = _cell_str(rec.get("customer name"))
                if not employee_name or not customer_name:
                    raise ValueError("Employee Name and Customer Name are both required")
                customer_id = _lookup_customer_id_by_name(conn, customer_name)
                sow_id = _lookup_sow_id(conn, customer_id, _cell_str(rec.get("contract title")))
                revenue_type_id = _lookup_id_by_name(conn, "revenue_types", _cell_str(rec.get("revenue type")))
                location_id = _lookup_id_by_name(conn, "locations", _cell_str(rec.get("location")))
                practice_id = _lookup_id_by_name(conn, "practices", _cell_str(rec.get("practice")))
                employee_id = _cell_str(rec.get("employee id"))
                wbs_id = _cell_str(rec.get("wbs id"))
                sow_role = _cell_str(rec.get("sow role"))
                rate_card = _cell_float_or_none(rec.get("rate card"))
                discount_percent = _cell_float_or_none(rec.get("discount (%)"))
                # Header text is "Start Date (dd-mmm-yyyy)"/"End Date
                # (dd-mmm-yyyy)" on the current template (the format hint
                # lives in the header since an empty template has no data
                # row to show actual date formatting on) - the plain
                # "start date"/"end date" key is also accepted so a file
                # built off an older template still imports.
                start_date = _cell_date(rec.get("start date (dd-mmm-yyyy)", rec.get("start date")))
                end_date = _cell_date(rec.get("end date (dd-mmm-yyyy)", rec.get("end date")))

                cur = conn.execute(
                    """INSERT INTO tm_assignments (customer_id, sow_id, revenue_type_id, employee_id, employee_name,
                       location_id, practice_id, wbs_id, sow_role, rate_card, discount_percent, start_date, end_date, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))""",
                    (customer_id, sow_id, revenue_type_id, employee_id, employee_name,
                     location_id, practice_id, wbs_id, sow_role, rate_card, discount_percent, start_date, end_date),
                )
                assignment_id = cur.lastrowid
                conn.execute(
                    "INSERT OR IGNORE INTO tm_assignment_fiscal_years (assignment_id, fiscal_year) VALUES (?, ?)",
                    (assignment_id, fy),
                )
                imported += 1
            except Exception as e:
                errors.append({"row": i, "message": str(e)})
    return {"fiscal_year": fy, "imported": imported, "errors": errors}


# ---------- Configuration lookups: Locations, Billing Models, Operating Models ----------
# All are simple named master lists, so they share one CRUD implementation.

def _register_lookup_crud(path: str, table: str, label: str):
    @app.get(f"/api/{path}")
    def _list(q: Optional[str] = None):
        with db.get_db() as conn:
            rows = conn.execute(f"SELECT * FROM {table} ORDER BY name COLLATE NOCASE").fetchall()
            items = [_row_to_dict(r) for r in rows]
            if q:
                ql = q.lower()
                items = [i for i in items if ql in i["name"].lower()]
            return items

    @app.post(f"/api/{path}", status_code=201)
    def _create(item: NameIn):
        with db.get_db() as conn:
            try:
                cur = conn.execute(
                    f"INSERT INTO {table} (name, details, updated_at) VALUES (?, ?, datetime('now'))",
                    (item.name, item.details),
                )
            except sqlite3.IntegrityError:
                raise HTTPException(status_code=400, detail=f"{label} '{item.name}' already exists")
            row = conn.execute(f"SELECT * FROM {table} WHERE id = ?", (cur.lastrowid,)).fetchone()
            return _row_to_dict(row)

    @app.put(f"/api/{path}/{{item_id}}")
    def _update(item_id: int, item: NameIn):
        with db.get_db() as conn:
            existing = conn.execute(f"SELECT * FROM {table} WHERE id = ?", (item_id,)).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail=f"{label} not found")
            try:
                conn.execute(
                    f"UPDATE {table} SET name=?, details=?, updated_at=datetime('now') WHERE id=?",
                    (item.name, item.details, item_id),
                )
            except sqlite3.IntegrityError:
                raise HTTPException(status_code=400, detail=f"{label} '{item.name}' already exists")
            row = conn.execute(f"SELECT * FROM {table} WHERE id = ?", (item_id,)).fetchone()
            return _row_to_dict(row)

    @app.delete(f"/api/{path}/{{item_id}}", status_code=204)
    def _delete(item_id: int):
        with db.get_db() as conn:
            existing = conn.execute(f"SELECT * FROM {table} WHERE id = ?", (item_id,)).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail=f"{label} not found")
            _execute_delete(conn, f"DELETE FROM {table} WHERE id = ?", (item_id,), label.lower())
        return None


_register_lookup_crud("locations", "locations", "Location")
_register_lookup_crud("billing-models", "billing_models", "Billing model")
_register_lookup_crud("operating-models", "operating_models", "Operating model")
_register_lookup_crud("statuses", "statuses", "Status")
_register_lookup_crud("employee-types", "employee_types", "Employee type")
_register_lookup_crud("bands", "bands", "Employee band")
_register_lookup_crud("opportunity-types", "opportunity_types", "Opportunity type")
_register_lookup_crud("revenue-types", "revenue_types", "Revenue type")
_register_lookup_crud("practices", "practices", "Practice")


# ---------- Customer Configuration: Billing Hours ----------
# One row per Customer (customer_id is UNIQUE) with a fixed Onsite/Offshore/
# Nearshore hours-per-day triplet - not a plain name+details list like the
# lookups above, so it gets its own small CRUD rather than going through
# _register_lookup_crud.

_BILLING_HOURS_SELECT = """
    SELECT bhc.*, c.customer_name
    FROM billing_hour_configs bhc
    LEFT JOIN customers c ON c.id = bhc.customer_id
"""


def _validate_billing_hours_refs(conn, item: BillingHoursConfigIn):
    if not conn.execute("SELECT 1 FROM customers WHERE id = ?", (item.customer_id,)).fetchone():
        raise HTTPException(status_code=400, detail="Selected customer does not exist")


@app.get("/api/billing-hours")
def list_billing_hours():
    with db.get_db() as conn:
        rows = conn.execute(
            _BILLING_HOURS_SELECT + " ORDER BY c.customer_name COLLATE NOCASE"
        ).fetchall()
        return [_row_to_dict(r) for r in rows]


@app.post("/api/billing-hours", status_code=201)
def create_billing_hours(item: BillingHoursConfigIn):
    with db.get_db() as conn:
        _validate_billing_hours_refs(conn, item)
        try:
            cur = conn.execute(
                """INSERT INTO billing_hour_configs (customer_id, onsite_hours, offshore_hours, nearshore_hours, updated_at)
                   VALUES (?, ?, ?, ?, datetime('now'))""",
                (item.customer_id, item.onsite_hours, item.offshore_hours, item.nearshore_hours),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail="Billing hours are already configured for this customer - edit that row instead")
        row = conn.execute(_BILLING_HOURS_SELECT + " WHERE bhc.id = ?", (cur.lastrowid,)).fetchone()
        return _row_to_dict(row)


@app.put("/api/billing-hours/{item_id}")
def update_billing_hours(item_id: int, item: BillingHoursConfigIn):
    with db.get_db() as conn:
        existing = conn.execute("SELECT * FROM billing_hour_configs WHERE id = ?", (item_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Billing hours configuration not found")
        _validate_billing_hours_refs(conn, item)
        try:
            conn.execute(
                """UPDATE billing_hour_configs SET customer_id=?, onsite_hours=?, offshore_hours=?, nearshore_hours=?,
                   updated_at=datetime('now') WHERE id=?""",
                (item.customer_id, item.onsite_hours, item.offshore_hours, item.nearshore_hours, item_id),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail="Billing hours are already configured for this customer - edit that row instead")
        row = conn.execute(_BILLING_HOURS_SELECT + " WHERE bhc.id = ?", (item_id,)).fetchone()
        return _row_to_dict(row)


@app.delete("/api/billing-hours/{item_id}", status_code=204)
def delete_billing_hours(item_id: int):
    with db.get_db() as conn:
        existing = conn.execute("SELECT * FROM billing_hour_configs WHERE id = ?", (item_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Billing hours configuration not found")
        _execute_delete(conn, "DELETE FROM billing_hour_configs WHERE id = ?", (item_id,), "billing hours configuration")
    return None


# ---------- Customer Configuration: Holiday Calendar ----------
# One row per Customer + Holiday Date, with onsite/offshore/nearshore 0/1
# flags marking which of the fixed three locations observe that date (see
# db.py) - not a plain name+details list, so it gets its own small CRUD too.

_HOLIDAY_SELECT = """
    SELECT hc.*, c.customer_name
    FROM holiday_calendar hc
    LEFT JOIN customers c ON c.id = hc.customer_id
"""


def _validate_holiday_refs(conn, item: HolidayCalendarIn):
    if not conn.execute("SELECT 1 FROM customers WHERE id = ?", (item.customer_id,)).fetchone():
        raise HTTPException(status_code=400, detail="Selected customer does not exist")


@app.get("/api/holidays")
def list_holidays():
    with db.get_db() as conn:
        rows = conn.execute(
            _HOLIDAY_SELECT + " ORDER BY hc.holiday_date, c.customer_name COLLATE NOCASE"
        ).fetchall()
        return [_row_to_dict(r) for r in rows]


@app.post("/api/holidays", status_code=201)
def create_holiday(item: HolidayCalendarIn):
    with db.get_db() as conn:
        _validate_holiday_refs(conn, item)
        cur = conn.execute(
            """INSERT INTO holiday_calendar (customer_id, holiday_date, onsite, offshore, nearshore, holiday_details, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, datetime('now'))""",
            (item.customer_id, item.holiday_date, int(item.onsite), int(item.offshore), int(item.nearshore), item.holiday_details),
        )
        row = conn.execute(_HOLIDAY_SELECT + " WHERE hc.id = ?", (cur.lastrowid,)).fetchone()
        return _row_to_dict(row)


@app.put("/api/holidays/{item_id}")
def update_holiday(item_id: int, item: HolidayCalendarIn):
    with db.get_db() as conn:
        existing = conn.execute("SELECT * FROM holiday_calendar WHERE id = ?", (item_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Holiday not found")
        _validate_holiday_refs(conn, item)
        conn.execute(
            """UPDATE holiday_calendar SET customer_id=?, holiday_date=?, onsite=?, offshore=?, nearshore=?, holiday_details=?,
               updated_at=datetime('now') WHERE id=?""",
            (item.customer_id, item.holiday_date, int(item.onsite), int(item.offshore), int(item.nearshore), item.holiday_details, item_id),
        )
        row = conn.execute(_HOLIDAY_SELECT + " WHERE hc.id = ?", (item_id,)).fetchone()
        return _row_to_dict(row)


@app.delete("/api/holidays/{item_id}", status_code=204)
def delete_holiday(item_id: int):
    with db.get_db() as conn:
        existing = conn.execute("SELECT * FROM holiday_calendar WHERE id = ?", (item_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Holiday not found")
        _execute_delete(conn, "DELETE FROM holiday_calendar WHERE id = ?", (item_id,), "holiday")
    return None


# ---------- Customer Configuration: Leave Management ----------
# One row per Customer + Employee ID with a leave-day count per fiscal month
# (Apr-Mar) - own small CRUD like Billing Hours/Holiday Calendar above,
# since it has an FK dropdown (Customer) plus more fields than a plain
# lookup. Feeds the Time and Material Projections formula (see
# _compute_tm_projections) - not tied to a fiscal year itself, same as
# Billing Hours Configuration.

_LEAVE_MONTH_COLUMNS = [
    "leave_apr", "leave_may", "leave_jun", "leave_jul", "leave_aug", "leave_sep",
    "leave_oct", "leave_nov", "leave_dec", "leave_jan", "leave_feb", "leave_mar",
]

_LEAVE_SELECT = """
    SELECT lm.*, c.customer_name
    FROM leave_management lm
    LEFT JOIN customers c ON c.id = lm.customer_id
"""


def _employee_ids_tagged_to_sow(conn) -> set:
    """Employee IDs (lowercased) that currently have at least one Time and
    Material assignment against a real Statement of Work. Used to flag Leave
    records for employees who aren't tied to any active SOW work - a leave
    record itself no longer carries a SOW/WBS ID (see the tab-config-leaves
    comment in index.html), so this is computed by cross-referencing the
    T&M grid's own employee_id/sow_id instead."""
    rows = conn.execute(
        "SELECT DISTINCT employee_id FROM tm_assignments "
        "WHERE sow_id IS NOT NULL AND employee_id IS NOT NULL AND TRIM(employee_id) <> ''"
    ).fetchall()
    return {(r["employee_id"] or "").strip().lower() for r in rows}


def _validate_leave_refs(conn, item: LeaveManagementIn):
    if not conn.execute("SELECT 1 FROM customers WHERE id = ?", (item.customer_id,)).fetchone():
        raise HTTPException(status_code=400, detail="Selected customer does not exist")
    if item.location_id is not None and not conn.execute(
        "SELECT 1 FROM locations WHERE id = ?", (item.location_id,)
    ).fetchone():
        raise HTTPException(status_code=400, detail="Selected location does not exist")
    if item.band_id is not None and not conn.execute(
        "SELECT 1 FROM bands WHERE id = ?", (item.band_id,)
    ).fetchone():
        raise HTTPException(status_code=400, detail="Selected band does not exist")
    if item.employee_type_id is not None and not conn.execute(
        "SELECT 1 FROM employee_types WHERE id = ?", (item.employee_type_id,)
    ).fetchone():
        raise HTTPException(status_code=400, detail="Selected employee type does not exist")


@app.get("/api/leaves")
def list_leaves():
    with db.get_db() as conn:
        rows = conn.execute(
            _LEAVE_SELECT + " ORDER BY c.customer_name COLLATE NOCASE, lm.employee_name COLLATE NOCASE"
        ).fetchall()
        locations, employee_types, bands = _load_resource_lookup_maps(conn)
        tagged_ids = _employee_ids_tagged_to_sow(conn)
        result = []
        for r in rows:
            item = _attach_resource_names(_row_to_dict(r), locations, employee_types, bands)
            item["tagged_to_sow"] = (item.get("employee_id") or "").strip().lower() in tagged_ids
            result.append(item)
        return result


@app.get("/api/leaves/export")
def export_leaves():
    """Export the Resource and Leave grid to an .xlsx workbook - same
    column set/order as leaves_import_template() below (Customer Name,
    Employee ID, Employee Name, Location, Band, Employee Type, then the 12
    Apr-Mar leave-day columns) but filled with every row currently in the
    table, so the export can be edited and re-imported unchanged. Registered
    before /api/leaves/{item_id} for the same route-ordering reason as the
    SOW/Customer/Resource export endpoints above (moot here since those
    routes are PUT/DELETE only, but kept consistent)."""
    items = list_leaves()
    headers = ["Customer Name", "Employee ID", "Employee Name", "Location", "Band", "Employee Type", *FISCAL_MONTH_LABELS]
    rows = [
        [
            item.get("customer_name") or "",
            item.get("employee_id") or "",
            item.get("employee_name") or "",
            item.get("location_name") or "",
            item.get("band_name") or "",
            item.get("employee_type_name") or "",
            *[item.get(col) for col in _LEAVE_MONTH_COLUMNS],
        ]
        for item in items
    ]
    widths = [22, 14, 20, 16, 14, 16] + [9] * 12
    wb = _build_workbook("Resources and Leaves", headers, rows, widths=widths)
    return _xlsx_response(wb, f"trakerz_leave_tracker_{date.today().isoformat()}.xlsx")


@app.post("/api/leaves", status_code=201)
def create_leave(item: LeaveManagementIn):
    with db.get_db() as conn:
        _validate_leave_refs(conn, item)
        month_values = [getattr(item, col) for col in _LEAVE_MONTH_COLUMNS]
        cur = conn.execute(
            f"""INSERT INTO leave_management (customer_id, employee_id, employee_name,
                location_id, band_id, employee_type_id,
                {", ".join(_LEAVE_MONTH_COLUMNS)}, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, {", ".join(["?"] * 12)}, datetime('now'))""",
            (item.customer_id, item.employee_id, item.employee_name,
             item.location_id, item.band_id, item.employee_type_id, *month_values),
        )
        row = conn.execute(_LEAVE_SELECT + " WHERE lm.id = ?", (cur.lastrowid,)).fetchone()
        locations, employee_types, bands = _load_resource_lookup_maps(conn)
        return _attach_resource_names(_row_to_dict(row), locations, employee_types, bands)


@app.put("/api/leaves/{item_id}")
def update_leave(item_id: int, item: LeaveManagementIn):
    with db.get_db() as conn:
        existing = conn.execute("SELECT * FROM leave_management WHERE id = ?", (item_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Leave record not found")
        _validate_leave_refs(conn, item)
        month_values = [getattr(item, col) for col in _LEAVE_MONTH_COLUMNS]
        set_clause = ", ".join(f"{col}=?" for col in _LEAVE_MONTH_COLUMNS)
        conn.execute(
            f"""UPDATE leave_management SET customer_id=?, employee_id=?, employee_name=?,
                location_id=?, band_id=?, employee_type_id=?,
                {set_clause}, updated_at=datetime('now') WHERE id=?""",
            (item.customer_id, item.employee_id, item.employee_name,
             item.location_id, item.band_id, item.employee_type_id, *month_values, item_id),
        )
        row = conn.execute(_LEAVE_SELECT + " WHERE lm.id = ?", (item_id,)).fetchone()
        locations, employee_types, bands = _load_resource_lookup_maps(conn)
        return _attach_resource_names(_row_to_dict(row), locations, employee_types, bands)


@app.delete("/api/leaves/{item_id}", status_code=204)
def delete_leave(item_id: int):
    with db.get_db() as conn:
        existing = conn.execute("SELECT * FROM leave_management WHERE id = ?", (item_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Leave record not found")
        _execute_delete(conn, "DELETE FROM leave_management WHERE id = ?", (item_id,), "leave record")
    return None


@app.get("/api/leaves/import-template")
def leaves_import_template():
    """Sheet 1 ("Resources and Leaves") carries the fields someone fills in
    by hand for a new Leave Tracker row, plus all twelve Apr-Mar leave-day
    columns so a full fiscal year of leave can be filled in and imported in
    one pass rather than added blank and edited in the grid afterward (see
    import_leaves() below for how these are read back in). Statement of Work
    and WBS ID are both left out entirely - Statement of Work because in the
    UI it was a Customer-scoped dropdown with no stable spelling to import
    against, and WBS ID per explicit instruction that Leave no longer tracks
    either field at all. Sheet 2 is a plain reference list of the Customers,
    Locations, Bands and Employee Types already configured, so whoever is
    filling in Sheet 1 knows which exact spellings will match on import (see
    _lookup_id_by_name/_lookup_customer_id_by_name below - both are
    case-insensitive but still need an exact name match)."""
    headers = ["Customer Name", "Employee ID", "Employee Name", "Location", "Band", "Employee Type", *FISCAL_MONTH_LABELS]
    widths = [22, 14, 20, 16, 14, 16] + [9] * 12
    wb = _build_workbook("Resources and Leaves", headers, [], widths=widths)
    with db.get_db() as conn:
        customer_names = [r["customer_name"] for r in conn.execute("SELECT customer_name FROM customers ORDER BY customer_name COLLATE NOCASE").fetchall()]
        location_names = [r["name"] for r in conn.execute("SELECT name FROM locations ORDER BY name COLLATE NOCASE").fetchall()]
        band_names = [r["name"] for r in conn.execute("SELECT name FROM bands ORDER BY name COLLATE NOCASE").fetchall()]
        employee_type_names = [r["name"] for r in conn.execute("SELECT name FROM employee_types ORDER BY name COLLATE NOCASE").fetchall()]
    _add_reference_sheet(wb, "Reference Lists", {
        "Available Customer Name": customer_names,
        "Available Location": location_names,
        "Available Band": band_names,
        "Available Employee Type": employee_type_names,
    })
    return _xlsx_response(wb, "trakerz_leave_tracker_template.xlsx")


@app.post("/api/leaves/import")
async def import_leaves(file: UploadFile = File(...)):
    """Bulk version of "Add Leave Record": like the Time and Material grid's
    own import, each row here always becomes a brand-new leave_management
    row - there's no matching-existing-row/upsert case (Customer + Employee
    ID isn't a uniqueness rule the way a SoW Level grid row is), so
    importing the same sheet twice creates duplicates. Every column in
    leaves_import_template()'s Sheet 1 is read here, including the twelve
    Apr-Mar leave-day counts (blank cells default to 0, same as a freshly
    added row in the grid). Every row is validated in full before anything
    is written for it, so one bad row can't leave a half-written record
    behind; other rows still import even if this one fails."""
    content = await file.read()
    try:
        records = _read_import_rows(content, ["Customer Name", "Employee ID"])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    imported = 0
    errors = []
    with db.get_db() as conn:
        for i, rec in enumerate(records, start=2):  # row 1 is the header
            try:
                customer_name = _cell_str(rec.get("customer name"))
                employee_id = _cell_str(rec.get("employee id"))
                if not customer_name or not employee_id:
                    raise ValueError("Customer Name and Employee ID are both required")
                customer_id = _lookup_customer_id_by_name(conn, customer_name)
                employee_name = _cell_str(rec.get("employee name"))
                location_id = _lookup_id_by_name(conn, "locations", _cell_str(rec.get("location")))
                band_id = _lookup_id_by_name(conn, "bands", _cell_str(rec.get("band")))
                employee_type_id = _lookup_id_by_name(conn, "employee_types", _cell_str(rec.get("employee type")))
                month_values = [_cell_float(rec.get(label.lower())) for label in FISCAL_MONTH_LABELS]

                conn.execute(
                    f"""INSERT INTO leave_management (customer_id, employee_id, employee_name,
                       location_id, band_id, employee_type_id,
                       {", ".join(_LEAVE_MONTH_COLUMNS)}, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, {", ".join(["?"] * 12)}, datetime('now'))""",
                    (customer_id, employee_id, employee_name, location_id, band_id, employee_type_id, *month_values),
                )
                imported += 1
            except Exception as e:
                errors.append({"row": i, "message": str(e)})
    return {"imported": imported, "errors": errors}


# ---------- File uploads (SOW documents) ----------

def _safe_filename(name: str) -> str:
    """Strip any path components and anything that isn't safe for a plain
    filename, so an uploaded file can't be used to write outside UPLOADS_DIR
    or clobber another file's extension handling."""
    name = Path(name).name
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._") or "file"
    return name


@app.post("/api/uploads", status_code=201)
async def upload_file(file: UploadFile = File(...)):
    safe_name = _safe_filename(file.filename or "file")
    stored_name = f"{uuid.uuid4().hex}_{safe_name}"
    dest = UPLOADS_DIR / stored_name
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)
    return {"path": f"uploads/{stored_name}", "filename": safe_name}


# ---------- Dashboard ----------

@app.get("/api/dashboard")
def dashboard():
    with db.get_db() as conn:
        sow_rows = conn.execute("SELECT * FROM sows").fetchall()
        sows = [_row_to_dict(r) for r in sow_rows]
        customers, billing_models, operating_models, opportunity_types, customer_codes, revenue_types, practices = _load_lookup_maps(conn)

        enriched = []
        for s in sows:
            s = _attach_names(s, customers, billing_models, operating_models, opportunity_types, customer_codes, revenue_types, practices)
            m_rows = conn.execute("SELECT * FROM milestones WHERE sow_id = ?", (s["id"],)).fetchall()
            enriched.append(_enrich_sow(s, [_row_to_dict(m) for m in m_rows]))

        status_counts = {}
        value_by_client = {}
        total_value = 0.0
        total_billed = 0.0
        expiring_soon = []
        overdue = []
        over_budget = []
        expiring_30 = []

        for s in enriched:
            status_counts[s["status"]] = status_counts.get(s["status"], 0) + 1
            client_label = s["customer_name"] or "Unassigned"
            value_by_client[client_label] = value_by_client.get(client_label, 0) + (s["total_value"] or 0)
            total_value += s["total_value"] or 0
            total_billed += s["billed_total"] or 0

            if "expiring_soon" in s["alerts"]:
                expiring_soon.append(s)
            if "overdue" in s["alerts"]:
                overdue.append(s)
            if "over_budget" in s["alerts"]:
                over_budget.append(s)

            # "Expiring in 30 days" card on the SOW page (open/not-yet-closed
            # SOWs only, not already past their end date).
            days_to_end = s.get("days_to_end")
            if (s["status"] or "").strip().lower() not in CLOSED_STATUSES and days_to_end is not None and 0 <= days_to_end <= 30:
                expiring_30.append({
                    "id": s["id"],
                    "title": s["title"],
                    "customer_name": s["customer_name"],
                    "end_date": s["end_date"],
                    "days_to_end": days_to_end,
                    "status": s["status"],
                    "total_value": s["total_value"],
                })

        return {
            "status_counts": status_counts,
            "value_by_client": value_by_client,
            "total_value": round(total_value, 2),
            "total_billed": round(total_billed, 2),
            "total_remaining": round(total_value - total_billed, 2),
            "sow_count": len(enriched),
            "expiring_soon": expiring_soon,
            "overdue": overdue,
            "over_budget": over_budget,
            "expiring_30": expiring_30,
        }


# ---------- Uploaded SOW documents ----------
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")


# ---------- Static frontend ----------
# Explicit routes for the HTML shell itself, marked no-store so a browser
# never serves a stale cached page after the app is updated and restarted
# (the versioned ?v= query on app.js/style.css below handles the assets).
# Registered before the catch-all mount so they take precedence over it.
@app.get("/", include_in_schema=False)
def serve_index():
    return FileResponse(FRONTEND_DIR / "index.html", headers={"Cache-Control": "no-store"})


@app.get("/index.html", include_in_schema=False)
def serve_index_html():
    return FileResponse(FRONTEND_DIR / "index.html", headers={"Cache-Control": "no-store"})


# Mounted last so /api/* routes and the explicit routes above take precedence.
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
