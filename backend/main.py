"""Trakerz - FastAPI backend.

Fully local: SQLite file storage, no external services.
Run with: uvicorn main:app --host 127.0.0.1 --port 8000
(see ../run.sh or ../run.bat)
"""
import re
import shutil
import sqlite3
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Optional, List, Dict

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
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
    po_number: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    total_value: float = 0
    billing_model_id: Optional[int] = None
    operating_model_id: Optional[int] = None
    status: str = "draft"            # draft | active | completed | expired | cancelled
    notes: Optional[str] = None
    doc_link: Optional[str] = None


class CustomerIn(BaseModel):
    customer_code: str
    customer_name: str
    client_partner: Optional[str] = None
    delivery_director: Optional[str] = None
    industry: Optional[str] = None
    headquarters: Optional[str] = None
    geo: Optional[str] = None


class NameIn(BaseModel):
    name: str
    details: Optional[str] = None


# ---------- helpers ----------

def _row_to_dict(row):
    return dict(row)


def _load_lookup_maps(conn):
    """Return {id: name} maps for customers, billing_models, operating_models
    so SOW rows can be annotated with human-readable names without one query
    per foreign key per row."""
    customers = {r["id"]: r["customer_name"] for r in conn.execute("SELECT id, customer_name FROM customers")}
    billing_models = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM billing_models")}
    operating_models = {r["id"]: r["name"] for r in conn.execute("SELECT id, name FROM operating_models")}
    return customers, billing_models, operating_models


def _attach_names(sow: dict, customers: Dict[int, str], billing_models: Dict[int, str], operating_models: Dict[int, str]) -> dict:
    sow["customer_name"] = customers.get(sow.get("customer_id"))
    sow["billing_model_name"] = billing_models.get(sow.get("billing_model_id"))
    sow["operating_model_name"] = operating_models.get(sow.get("operating_model_id"))
    return sow


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

    sow["billed_total"] = round(billed_total, 2)
    sow["remaining_budget"] = round(remaining_budget, 2)
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


# ---------- SOW endpoints ----------

@app.get("/api/sows")
def list_sows(status: Optional[str] = None, customer_id: Optional[int] = None, q: Optional[str] = None):
    with db.get_db() as conn:
        rows = conn.execute("SELECT * FROM sows ORDER BY end_date IS NULL, end_date ASC").fetchall()
        sows = [_row_to_dict(r) for r in rows]
        customers, billing_models, operating_models = _load_lookup_maps(conn)
        sows = [_attach_names(s, customers, billing_models, operating_models) for s in sows]

        if status:
            sows = [s for s in sows if s["status"] == status]
        if customer_id:
            sows = [s for s in sows if s["customer_id"] == customer_id]
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
               opportunity_id, po_number, start_date, end_date,
               total_value, billing_model_id, operating_model_id, status, notes, doc_link, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))""",
            (sow.customer_id, sow.title, sow.project_title, sow.project_code, sow.contract_code,
             sow.opportunity_id, sow.po_number, sow.start_date, sow.end_date,
             sow.total_value, sow.billing_model_id, sow.operating_model_id, sow.status, sow.notes, sow.doc_link),
        )
        new_id = cur.lastrowid
        row = _get_sow_or_404(conn, new_id)
        customers, billing_models, operating_models = _load_lookup_maps(conn)
        row = _attach_names(row, customers, billing_models, operating_models)
        return _enrich_sow(row, [])


@app.get("/api/sows/{sow_id}")
def get_sow(sow_id: int):
    with db.get_db() as conn:
        sow = _get_sow_or_404(conn, sow_id)
        customers, billing_models, operating_models = _load_lookup_maps(conn)
        sow = _attach_names(sow, customers, billing_models, operating_models)
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
               opportunity_id=?, po_number=?, start_date=?, end_date=?,
               total_value=?, billing_model_id=?, operating_model_id=?, status=?, notes=?, doc_link=?,
               updated_at=datetime('now') WHERE id=?""",
            (sow.customer_id, sow.title, sow.project_title, sow.project_code, sow.contract_code,
             sow.opportunity_id, sow.po_number, sow.start_date, sow.end_date,
             sow.total_value, sow.billing_model_id, sow.operating_model_id, sow.status, sow.notes, sow.doc_link,
             sow_id),
        )
        row = _get_sow_or_404(conn, sow_id)
        customers, billing_models, operating_models = _load_lookup_maps(conn)
        row = _attach_names(row, customers, billing_models, operating_models)
        m_rows = conn.execute("SELECT * FROM milestones WHERE sow_id = ?", (sow_id,)).fetchall()
        return _enrich_sow(row, [_row_to_dict(m) for m in m_rows])


@app.delete("/api/sows/{sow_id}", status_code=204)
def delete_sow(sow_id: int):
    with db.get_db() as conn:
        _get_sow_or_404(conn, sow_id)
        conn.execute("DELETE FROM sows WHERE id = ?", (sow_id,))
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
        conn.execute("DELETE FROM milestones WHERE id = ?", (milestone_id,))
    return None


# ---------- Customer endpoints (Administration > Customer Management) ----------

@app.get("/api/customers")
def list_customers(q: Optional[str] = None):
    with db.get_db() as conn:
        rows = conn.execute("SELECT * FROM customers ORDER BY customer_name COLLATE NOCASE").fetchall()
        customers = [_row_to_dict(r) for r in rows]
        if q:
            ql = q.lower()
            customers = [
                c for c in customers
                if ql in (c["customer_code"] or "").lower() or ql in (c["customer_name"] or "").lower()
            ]
        return customers


@app.post("/api/customers", status_code=201)
def create_customer(c: CustomerIn):
    with db.get_db() as conn:
        try:
            cur = conn.execute(
                """INSERT INTO customers (customer_code, customer_name, client_partner, delivery_director,
                   industry, headquarters, geo, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))""",
                (c.customer_code, c.customer_name, c.client_partner, c.delivery_director,
                 c.industry, c.headquarters, c.geo),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail=f"Customer code '{c.customer_code}' already exists")
        return _get_customer_or_404(conn, cur.lastrowid)


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
                   delivery_director=?, industry=?, headquarters=?, geo=?,
                   updated_at=datetime('now') WHERE id=?""",
                (c.customer_code, c.customer_name, c.client_partner, c.delivery_director,
                 c.industry, c.headquarters, c.geo, customer_id),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail=f"Customer code '{c.customer_code}' already exists")
        return _get_customer_or_404(conn, customer_id)


@app.delete("/api/customers/{customer_id}", status_code=204)
def delete_customer(customer_id: int):
    with db.get_db() as conn:
        _get_customer_or_404(conn, customer_id)
        conn.execute("DELETE FROM customers WHERE id = ?", (customer_id,))
    return None


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
            conn.execute(f"DELETE FROM {table} WHERE id = ?", (item_id,))
        return None


_register_lookup_crud("locations", "locations", "Location")
_register_lookup_crud("billing-models", "billing_models", "Billing model")
_register_lookup_crud("operating-models", "operating_models", "Operating model")
_register_lookup_crud("statuses", "statuses", "Status")


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
        customers, billing_models, operating_models = _load_lookup_maps(conn)

        enriched = []
        for s in sows:
            s = _attach_names(s, customers, billing_models, operating_models)
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
