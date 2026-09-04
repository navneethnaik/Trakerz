# Trakerz

A local, single-user web app for tracking Statements of Work (SOWs): customer,
title, opportunity/PO references, dates, TCV, billing/operating model, status,
milestones/invoices, budget-vs-billed, and alerts for SOWs that are expiring
soon, overdue, or over budget. It also includes a Customer Management screen
under an Administration menu, and a Configuration menu for maintaining simple
master lists (Locations, Billing Models, Operating Models).

Everything runs on your laptop. There is no cloud service, no external
database, and no account — data is stored in a single SQLite file at
`data/sow_tracker.db` inside this folder.

## Stack (all open source)

- **Backend:** [FastAPI](https://fastapi.tiangolo.com/) + [Uvicorn](https://www.uvicorn.org/) (Python)
- **Database:** SQLite (built into Python, a single local file — no server to install)
- **Frontend:** plain HTML/CSS/JS + [Chart.js](https://www.chartjs.org/), vendored locally in `frontend/vendor/` — no CDN calls at runtime
- **Reminders:** the browser's built-in Notification API — a desktop popup while the app tab is open, no email/cloud service involved

## Requirements

- Python 3.9+ installed and on your PATH (check with `python --version` or `python3 --version`)
- That's it. `pip` (bundled with Python) installs the two small backend dependencies (FastAPI, Uvicorn) into a local virtual environment on first run.

## Running it

**Windows:** double-click `run.bat` (or run it from a Command Prompt in this folder).

**macOS/Linux:** `./run.sh`

The first run creates a `.venv` folder and installs dependencies (needs
internet once, for that install only). Every run after that is instant and
fully offline. The script opens `http://127.0.0.1:8000` in your browser
automatically once the server is actually up. On Windows, the server itself
runs in a separate minimized window titled "Trakerz Server" — closing that
window stops the app.

## Using it

- **Dashboard tab:** totals, SOWs-by-status / value-by-client / budget-vs-billed
  charts, and three alert lists (expiring within 30 days, overdue, over budget).
  Click "🔔 Enable reminders" once to let the browser pop up a native desktop
  notification (once per day, only while the app is open) when something needs
  attention.
- **SOWs tab:** searchable/filterable table of every SOW. "+ New SOW" to add
  one; click a row to open its detail page.
- **SOW form fields:** Customer Name (chosen from Customer Management),
  SOW Title, Opportunity ID, PO#, Start Date, End Date, TCV (USD), Billing
  Model and Operating Model (both chosen from Configuration), Status,
  Document Link, and Additional Information.
- **SOW detail page:** edit the SOW, and add/edit/delete milestones or
  invoices under it. "Billed" = sum of milestones marked `invoiced` or `paid`;
  "Remaining" = TCV minus billed.
- **Administration > Customer Management:** maintain your customer master
  list — Customer Code, Customer Name, Client Partner, and Delivery Director.
  Customer Code must be unique. Add, edit, search, or delete customers from
  here.
- **Configuration:** three simple master lists — Locations, Billing Models,
  and Operating Models. Add, edit, or delete entries in any of them; names
  must be unique within each list.

Status values are `draft`, `active`, `completed`, `expired`, `cancelled` — you
set these yourself. The "overdue" alert is computed automatically for any
`active` SOW whose end date has passed; "expiring soon" fires within 30 days
of the end date.

## Backing up / moving your data

Your data is the single file `data/sow_tracker.db`. To back it up, copy that
file somewhere safe. To move the app to another machine, copy this whole
folder (or just `data/sow_tracker.db` into a fresh copy of the project) — no
export/import step needed.

## Project layout

```
Trackerz/
├── run.bat / run.sh      # one-command launchers
├── backend/
│   ├── main.py           # FastAPI app: REST API + serves the frontend
│   ├── db.py             # SQLite schema + connection helper
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── vendor/chart.umd.min.js   # Chart.js, vendored locally
└── data/
    └── sow_tracker.db    # created on first run
```

## Changing the port

If port 8000 is taken, edit the `--port 8000` value in `run.bat`/`run.sh`
(and open the matching URL in your browser).
