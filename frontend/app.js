// Trakerz frontend - vanilla JS, no build step.
const API = "/api";
const fmt = (n) => "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Renders any "YYYY-MM-DD"-ish date string as dd-mmm-yyyy (e.g. 03-Sep-2026).
function fmtDate(s) {
  if (!s) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  const mi = parseInt(m[2], 10) - 1;
  if (mi < 0 || mi > 11) return s;
  return `${m[3]}-${MONTH_ABBR[mi]}-${m[1]}`;
}
const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const slugify = (s) => (s || "").toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "unknown";

// Turns a FastAPI/pydantic error body into a readable string instead of
// alert()-ing the raw object (which renders as "[object Object]" for the
// validation-error array shape FastAPI returns on a 422).
function formatApiError(err, fallback) {
  const d = err && err.detail;
  if (typeof d === "string" && d) return d;
  if (Array.isArray(d) && d.length) {
    return d.map((item) => {
      if (item && typeof item === "object") {
        const field = Array.isArray(item.loc) ? item.loc.slice(1).join(".") : "";
        return field ? `${field}: ${item.msg}` : (item.msg || JSON.stringify(item));
      }
      return String(item);
    }).join("; ");
  }
  if (d && typeof d === "object") return JSON.stringify(d);
  return fallback;
}

// ---------- Icons (inline SVG, feather-style, inherits currentColor) ----------
const ICON_PATHS = {
  edit: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>',
  trash: '<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line>',
  chevron: '<polyline points="9 18 15 12 9 6"></polyline>',
};
function icon(name, size) {
  size = size || 14;
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] || ""}</svg>`;
}

let currentSowId = null;

// ---------- Tabs ----------
document.querySelectorAll(".tab-btn[data-tab]").forEach((btn) => {
  btn.addEventListener("click", () => showTab(btn.dataset.tab));
});

// Nav dropdowns (Management, Configuration) - generic so any number of them work the same way.
document.querySelectorAll(".nav-dropdown").forEach((dropdown) => {
  const toggle = dropdown.querySelector(".dropdown-toggle");
  const menu = dropdown.querySelector(".dropdown-menu");
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const wasHidden = menu.hidden;
    document.querySelectorAll(".dropdown-menu").forEach((m) => (m.hidden = true));
    menu.hidden = !wasHidden;
  });
  menu.querySelectorAll(".dropdown-item[data-tab]").forEach((item) => {
    item.addEventListener("click", () => {
      showTab(item.dataset.tab);
      menu.hidden = true;
    });
  });
});
document.addEventListener("click", (e) => {
  document.querySelectorAll(".nav-dropdown").forEach((dropdown) => {
    const menu = dropdown.querySelector(".dropdown-menu");
    if (!menu.hidden && !dropdown.contains(e.target)) menu.hidden = true;
  });
});

function showTab(name) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  const topLevelBtn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
  if (topLevelBtn) {
    topLevelBtn.classList.add("active");
  } else {
    const dropdownItem = document.querySelector(`.dropdown-item[data-tab="${name}"]`);
    const toggle = dropdownItem && dropdownItem.closest(".nav-dropdown").querySelector(".dropdown-toggle");
    if (toggle) toggle.classList.add("active");
  }

  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  const panel = document.getElementById("tab-" + name);
  if (panel) panel.classList.add("active");

  if (name === "sows") loadSows();
  if (name === "customers") loadCustomers();
  if (name === "config-locations") loadLocations();
  if (name === "config-billing-models") loadBillingModels();
  if (name === "config-operating-models") loadOperatingModels();
  if (name === "config-statuses") loadStatuses();
}

document.getElementById("backToList").addEventListener("click", () => showTab("sows"));

// ---------- Overdue/expiring/over-budget banner (data comes from /api/dashboard,
// fetched by loadSowStats() every time the Statement of Work page loads) ----------
function renderAlertBanner(data) {
  const el = document.getElementById("alertBanner");
  const parts = [];
  if (data.overdue.length) parts.push(`${data.overdue.length} SOW(s) overdue`);
  if (data.expiring_soon.length) parts.push(`${data.expiring_soon.length} expiring within 30 days`);
  if (data.over_budget.length) parts.push(`${data.over_budget.length} over budget`);
  if (parts.length) {
    el.hidden = false;
    el.innerHTML = `<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg><span>${parts.join(" • ")}</span>`;
  } else {
    el.hidden = true;
  }
}

// ---------- Desktop reminders (Web Notification API, fully local) ----------
document.getElementById("notifBtn").addEventListener("click", async () => {
  if (!("Notification" in window)) { alert("This browser does not support notifications."); return; }
  const perm = await Notification.requestPermission();
  if (perm === "granted") {
    localStorage.setItem("sow_notif_enabled", "1");
    new Notification("Trakerz reminders enabled", { body: "You'll be notified about expiring or overdue SOWs when this app is open." });
  }
});

function maybeNotify(data) {
  if (localStorage.getItem("sow_notif_enabled") !== "1") return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const today = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem("sow_notif_last_date") === today) return; // once per day
  const urgent = [...data.overdue, ...data.expiring_soon];
  if (urgent.length) {
    new Notification(`Trakerz: ${urgent.length} SOW(s) need attention`, {
      body: urgent.slice(0, 3).map((s) => `${s.customer_name}: ${s.title}`).join("\n"),
    });
    localStorage.setItem("sow_notif_last_date", today);
  }
}

// ---------- SOWs list ----------
document.getElementById("searchInput").addEventListener("input", debounce(loadSows, 250));
document.getElementById("statusFilter").addEventListener("change", loadSows);

async function refreshStatusFilterOptions() {
  const statuses = await fetch(`${API}/statuses`).then((r) => r.json());
  const sel = document.getElementById("statusFilter");
  const prevVal = sel.value;
  sel.innerHTML = '<option value="">All statuses</option>' +
    statuses.map((s) => `<option value="${escapeHtml(s.name)}">${escapeHtml(capitalize(s.name))}</option>`).join("");
  if (statuses.some((s) => s.name === prevVal)) sel.value = prevVal;
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Portfolio-wide counts shown at the top of the SOWs page (independent of the
// search box / status filter below, same spirit as the Dashboard's header cards).
//
// SOWs expiring within 30 days, populated by loadSowStats() and read when the
// "Expiring in 30 days" card is clicked to render the popup without a second
// API call.
let expiringSows30 = [];

async function loadSowStats() {
  const data = await fetch(`${API}/dashboard`).then((r) => r.json());
  const counts = data.status_counts || {};
  document.getElementById("sowStatTotal").textContent = data.sow_count ?? 0;
  document.getElementById("sowStatActive").textContent = counts.active || 0;
  document.getElementById("sowStatCompleted").textContent = counts.completed || 0;
  document.getElementById("sowStatValue").textContent = fmt(data.total_value);
  expiringSows30 = data.expiring_30 || [];
  document.getElementById("expiryLink30").textContent = expiringSows30.length;
  renderAlertBanner(data);
  maybeNotify(data);
}

const expiryModal = document.getElementById("expiryModal");
document.getElementById("expiryCard30").addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("expiryModalTitle").textContent = "SOWs expiring in 30 days";
  const body = document.getElementById("expiryModalBody");
  if (!expiringSows30.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty-state">No SOWs expiring in this window.</td></tr>';
  } else {
    body.innerHTML = expiringSows30.map((s) => `
      <tr>
        <td>${escapeHtml(s.customer_name) || "—"}</td>
        <td>${escapeHtml(s.title)}</td>
        <td>${fmtDate(s.end_date)}</td>
        <td>${s.days_to_end}</td>
        <td>${fmt(s.total_value)}</td>
        <td><span class="badge badge-${slugify(s.status)}">${escapeHtml(s.status)}</span></td>
      </tr>
    `).join("");
  }
  expiryModal.hidden = false;
});
document.getElementById("closeExpiryModalBtn").addEventListener("click", () => (expiryModal.hidden = true));

async function loadSows() {
  loadSowStats();
  const q = document.getElementById("searchInput").value.trim();
  const status = document.getElementById("statusFilter").value;
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  const sows = await fetch(`${API}/sows?${params}`).then((r) => r.json());

  const tbody = document.getElementById("sowTableBody");
  tbody.innerHTML = "";
  if (!sows.length) {
    tbody.innerHTML = '<tr><td colspan="17" class="empty-state">No SOWs yet. Click "New SOW" to add one.</td></tr>';
    return;
  }
  sows.forEach((s) => {
    const isFixedPrice = (s.billing_model_name || "").toLowerCase().includes("fixed price");
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${isFixedPrice ? `<button type="button" class="expand-btn" title="Show milestones">${icon("chevron")}</button>` : ""}</td>
      <td>${escapeHtml(s.customer_name)}</td>
      <td>${escapeHtml(s.title)}</td>
      <td>${escapeHtml(s.project_title) || "—"}</td>
      <td>${escapeHtml(s.project_code) || "—"}</td>
      <td>${escapeHtml(s.contract_code) || "—"}</td>
      <td>${escapeHtml(s.opportunity_id) || "—"}</td>
      <td>${escapeHtml(s.po_number) || "—"}</td>
      <td>${fmtDate(s.start_date)}</td>
      <td>${fmtDate(s.end_date)}</td>
      <td>${fmt(s.total_value)}</td>
      <td><span class="badge badge-${slugify(s.status)}">${escapeHtml(s.status)}</span></td>
      <td>${escapeHtml(s.billing_model_name) || "—"}</td>
      <td>${escapeHtml(s.operating_model_name) || "—"}</td>
      <td>${s.doc_link ? `<span class="truncate-cell">${renderDocLink(s.doc_link)}</span>` : "—"}</td>
      <td>${s.notes ? `<span class="truncate-cell" title="${escapeHtml(s.notes)}">${escapeHtml(s.notes)}</span>` : "—"}</td>
      <td class="row-actions">
        <button class="ghost-btn btn-edit edit-btn">${icon("edit")}<span>Edit</span></button>
        <button class="ghost-btn btn-danger del-btn" data-id="${s.id}">${icon("trash")}<span>Delete</span></button>
      </td>
    `;
    tr.addEventListener("click", (e) => {
      if (e.target.closest(".del-btn") || e.target.closest(".edit-btn") || e.target.closest(".expand-btn") || e.target.closest("a")) return;
      openDetail(s.id);
    });
    if (isFixedPrice) {
      tr.querySelector(".expand-btn").addEventListener("click", async (e) => {
        e.stopPropagation();
        await toggleMilestoneSubrow(tr, s);
      });
    }
    tr.querySelector(".edit-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      openSowModal(s);
    });
    tr.querySelector(".del-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm(`Delete SOW "${s.title}" for ${s.customer_name}? This also deletes its milestones.`)) {
        await fetch(`${API}/sows/${s.id}`, { method: "DELETE" });
        loadSows();
      }
    });
    tbody.appendChild(tr);
  });
}

const MILESTONE_BADGE_CLASS = { paid: "completed", invoiced: "active", pending: "draft" };

function renderMilestoneSubtable(milestones) {
  if (!milestones.length) {
    return '<div class="empty-state" style="padding:6px 0">No milestones yet.</div>';
  }
  const rows = milestones.map((m) => `
    <tr>
      <td>${escapeHtml(m.description)}</td>
      <td>${fmtDate(m.due_date)}</td>
      <td>${fmt(m.amount)}</td>
      <td><span class="badge badge-${MILESTONE_BADGE_CLASS[m.status] || "draft"}">${escapeHtml(m.status)}</span></td>
    </tr>
  `).join("");
  return `
    <table class="milestone-subtable">
      <thead><tr><th>Milestone title</th><th>Milestone date</th><th>Milestone amount (USD)</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function toggleMilestoneSubrow(tr, s) {
  const btn = tr.querySelector(".expand-btn");
  const next = tr.nextElementSibling;
  if (next && next.classList.contains("milestone-subrow")) {
    next.remove();
    btn.classList.remove("expanded");
    return;
  }
  btn.classList.add("expanded");
  const milestones = await fetch(`${API}/sows/${s.id}/milestones`).then((r) => r.json());
  const subTr = document.createElement("tr");
  subTr.className = "milestone-subrow";
  subTr.innerHTML = `<td colspan="17">${renderMilestoneSubtable(milestones)}</td>`;
  tr.after(subTr);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ---------- SOW create/edit modal ----------
const sowModal = document.getElementById("sowModal");
document.getElementById("newSowBtn").addEventListener("click", () => openSowModal());
document.getElementById("cancelSowBtn").addEventListener("click", () => (sowModal.hidden = true));

function fillSelect(selectId, items, valueKey, labelKey, placeholder) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    items.map((i) => `<option value="${i[valueKey]}">${escapeHtml(i[labelKey])}</option>`).join("");
}

let currentBillingModels = [];
let originalMilestoneIdsAtOpen = [];

async function populateSowDropdowns() {
  const [customers, billingModels, operatingModels, statuses] = await Promise.all([
    fetch(`${API}/customers`).then((r) => r.json()),
    fetch(`${API}/billing-models`).then((r) => r.json()),
    fetch(`${API}/operating-models`).then((r) => r.json()),
    fetch(`${API}/statuses`).then((r) => r.json()),
  ]);
  currentBillingModels = billingModels;
  fillSelect("f_customer", customers, "id", "customer_name", "Select customer&hellip;");
  fillSelect("f_billing_model", billingModels, "id", "name", "Select billing model&hellip;");
  fillSelect("f_operating_model", operatingModels, "id", "name", "Select operating model&hellip;");

  const statusSel = document.getElementById("f_status");
  statusSel.innerHTML = statuses.map((s) => `<option value="${escapeHtml(s.name)}">${escapeHtml(capitalize(s.name))}</option>`).join("");
}

// ---------- Inline milestone capture (shown when the Billing Model name contains "Fixed Price") ----------
function isFixedPriceSelected() {
  const selectedId = document.getElementById("f_billing_model").value;
  const selected = currentBillingModels.find((b) => String(b.id) === selectedId);
  return !!selected && selected.name.trim().toLowerCase().includes("fixed price");
}

function updateMilestonesVisibility() {
  document.getElementById("milestonesSection").hidden = !isFixedPriceSelected();
}

function createMilestoneRowEl(row) {
  const div = document.createElement("div");
  div.className = "milestone-row";
  div.dataset.milestoneId = row.id ?? "";
  div.dataset.status = row.status ?? "pending";
  div.dataset.billedDate = row.billed_date ?? "";
  div.innerHTML = `
    <input class="ms-title" placeholder="Milestone title" value="${escapeHtml(row.description ?? "")}" />
    <input class="ms-date" type="date" value="${row.due_date ?? ""}" />
    <input class="ms-amount" type="number" step="0.01" min="0" value="${row.amount ?? 0}" />
    <button type="button" class="ghost-btn btn-danger remove-ms-row" title="Remove milestone">${icon("trash")}</button>
  `;
  div.querySelector(".remove-ms-row").addEventListener("click", () => div.remove());
  return div;
}

function renderMilestoneRows(rows) {
  const container = document.getElementById("milestoneRows");
  container.innerHTML = "";
  rows.forEach((row) => container.appendChild(createMilestoneRowEl(row)));
}

function collectMilestoneRows() {
  return Array.from(document.querySelectorAll("#milestoneRows .milestone-row")).map((div) => ({
    id: div.dataset.milestoneId ? parseInt(div.dataset.milestoneId, 10) : null,
    description: div.querySelector(".ms-title").value.trim(),
    amount: parseFloat(div.querySelector(".ms-amount").value) || 0,
    due_date: div.querySelector(".ms-date").value || null,
    status: div.dataset.status || "pending",
    billed_date: div.dataset.billedDate || null,
  }));
}

document.getElementById("addMilestoneRowBtn").addEventListener("click", () => {
  document.getElementById("milestoneRows").appendChild(
    createMilestoneRowEl({ id: null, description: "", amount: 0, due_date: null, status: "pending", billed_date: null })
  );
});

document.getElementById("f_billing_model").addEventListener("change", updateMilestonesVisibility);

async function syncMilestonesForSow(sowId) {
  const rows = collectMilestoneRows().filter((r) => r.description);
  const currentIds = rows.filter((r) => r.id).map((r) => r.id);
  const toDelete = originalMilestoneIdsAtOpen.filter((mid) => !currentIds.includes(mid));

  await Promise.all([
    ...rows.map((r) => {
      const payload = { description: r.description, amount: r.amount, due_date: r.due_date, status: r.status, billed_date: r.billed_date };
      return r.id
        ? fetch(`${API}/milestones/${r.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : fetch(`${API}/sows/${sowId}/milestones`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    }),
    ...toDelete.map((mid) => fetch(`${API}/milestones/${mid}`, { method: "DELETE" })),
  ]);
}

async function openSowModal(sowStub) {
  await populateSowDropdowns();
  let sow = sowStub;
  if (sowStub && sowStub.id) {
    sow = await fetch(`${API}/sows/${sowStub.id}`).then((r) => r.json());
  }
  document.getElementById("sowModalTitle").textContent = sow ? "Edit SOW" : "New SOW";
  document.getElementById("sowId").value = sow?.id ?? "";
  document.getElementById("f_customer").value = sow?.customer_id ?? "";
  document.getElementById("f_title").value = sow?.title ?? "";
  document.getElementById("f_project_title").value = sow?.project_title ?? "";
  document.getElementById("f_project_code").value = sow?.project_code ?? "";
  document.getElementById("f_contract_code").value = sow?.contract_code ?? "";
  document.getElementById("f_opportunity").value = sow?.opportunity_id ?? "";
  document.getElementById("f_po").value = sow?.po_number ?? "";
  document.getElementById("f_start").value = sow?.start_date ?? "";
  document.getElementById("f_end").value = sow?.end_date ?? "";
  document.getElementById("f_value").value = sow?.total_value ?? 0;
  document.getElementById("f_status").value = sow?.status ?? "draft";
  document.getElementById("f_billing_model").value = sow?.billing_model_id ?? "";
  document.getElementById("f_operating_model").value = sow?.operating_model_id ?? "";
  document.getElementById("f_doclink").value = sow?.doc_link ?? "";
  document.getElementById("f_notes").value = sow?.notes ?? "";

  originalMilestoneIdsAtOpen = (sow?.milestones || []).map((m) => m.id);
  renderMilestoneRows(sow?.milestones || []);
  updateMilestonesVisibility();

  sowModal.hidden = false;
}

document.getElementById("sowForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("sowId").value;
  const customerVal = document.getElementById("f_customer").value;
  if (!customerVal) { alert("Please select a customer."); return; }
  const billingVal = document.getElementById("f_billing_model").value;
  const operatingVal = document.getElementById("f_operating_model").value;
  const payload = {
    customer_id: parseInt(customerVal, 10),
    title: document.getElementById("f_title").value,
    project_title: document.getElementById("f_project_title").value || null,
    project_code: document.getElementById("f_project_code").value || null,
    contract_code: document.getElementById("f_contract_code").value || null,
    opportunity_id: document.getElementById("f_opportunity").value || null,
    po_number: document.getElementById("f_po").value || null,
    start_date: document.getElementById("f_start").value || null,
    end_date: document.getElementById("f_end").value || null,
    total_value: parseFloat(document.getElementById("f_value").value) || 0,
    billing_model_id: billingVal ? parseInt(billingVal, 10) : null,
    operating_model_id: operatingVal ? parseInt(operatingVal, 10) : null,
    status: document.getElementById("f_status").value,
    doc_link: document.getElementById("f_doclink").value || null,
    notes: document.getElementById("f_notes").value || null,
  };
  const url = id ? `${API}/sows/${id}` : `${API}/sows`;
  const method = id ? "PUT" : "POST";
  const resp = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    alert(formatApiError(err, "Failed to save SOW."));
    return;
  }
  const saved = await resp.json();

  if (!document.getElementById("milestonesSection").hidden) {
    await syncMilestonesForSow(saved.id);
  }

  sowModal.hidden = true;
  if (document.getElementById("tab-detail").classList.contains("active") && id) {
    openDetail(saved.id);
  } else {
    loadSows();
  }
});

// ---------- SOW document upload ----------
document.getElementById("uploadDocBtn").addEventListener("click", () => {
  document.getElementById("f_doc_file").click();
});

document.getElementById("f_doc_file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const uploadBtn = document.getElementById("uploadDocBtn");
  const prevHtml = uploadBtn.innerHTML;
  uploadBtn.disabled = true;
  uploadBtn.innerHTML = "<span>Uploading&hellip;</span>";
  try {
    const formData = new FormData();
    formData.append("file", file);
    const resp = await fetch(`${API}/uploads`, { method: "POST", body: formData });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      alert(formatApiError(err, "Failed to upload the file."));
      return;
    }
    const result = await resp.json();
    document.getElementById("f_doclink").value = result.path;
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.innerHTML = prevHtml;
    e.target.value = "";
  }
});

function renderDocLink(link) {
  if (!link) return "";
  const isUpload = link.startsWith("uploads/");
  const isUrl = /^https?:\/\//i.test(link);
  if (!isUpload && !isUrl) return escapeHtml(link);
  const href = isUpload ? "/" + link : link;
  const label = isUpload ? link.replace(/^uploads\/[0-9a-f]{32}_/, "") : link;
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
}

// ---------- SOW detail + milestones ----------
async function openDetail(id) {
  currentSowId = id;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  document.getElementById("tab-detail").classList.add("active");
  await renderDetail();
}

async function renderDetail() {
  const s = await fetch(`${API}/sows/${currentSowId}`).then((r) => r.json());
  const container = document.getElementById("detailContent");
  container.innerHTML = `
    <div class="detail-header">
      <div>
        <h2>${escapeHtml(s.title)}</h2>
        <div class="meta">${escapeHtml(s.customer_name)} &middot; <span class="badge badge-${slugify(s.status)}">${escapeHtml(s.status)}</span>
          ${s.alerts.map((a) => `<span class="tag tag-${a}">${a.replace("_", " ")}</span>`).join("")}
        </div>
      </div>
      <div>
        <button class="ghost-btn btn-edit" id="editSowBtn">${icon("edit")}<span>Edit SOW</span></button>
      </div>
    </div>
    <div class="detail-cards">
      <div class="stat-card"><div class="stat-label">Start &rarr; End</div><div class="stat-value" style="font-size:16px">${fmtDate(s.start_date)} &rarr; ${fmtDate(s.end_date)}</div></div>
      <div class="stat-card"><div class="stat-label">TCV (USD)</div><div class="stat-value">${fmt(s.total_value)}</div></div>
      <div class="stat-card"><div class="stat-label">Billed</div><div class="stat-value">${fmt(s.billed_total)}</div></div>
      <div class="stat-card"><div class="stat-label">Remaining</div><div class="stat-value">${fmt(s.remaining_budget)}</div></div>
    </div>
    <p><strong>Project Title:</strong> ${escapeHtml(s.project_title) || "—"} &nbsp;&middot;&nbsp; <strong>Project Code:</strong> ${escapeHtml(s.project_code) || "—"} &nbsp;&middot;&nbsp; <strong>Contract Code:</strong> ${escapeHtml(s.contract_code) || "—"}</p>
    <p><strong>Opportunity ID:</strong> ${escapeHtml(s.opportunity_id) || "—"} &nbsp;&middot;&nbsp; <strong>PO#:</strong> ${escapeHtml(s.po_number) || "—"}</p>
    <p><strong>Billing model:</strong> ${escapeHtml(s.billing_model_name) || "—"} &nbsp;&middot;&nbsp; <strong>Operating model:</strong> ${escapeHtml(s.operating_model_name) || "—"}</p>
    ${s.doc_link ? `<p><strong>Document:</strong> ${renderDocLink(s.doc_link)}</p>` : ""}
    ${s.notes ? `<p><strong>Additional information:</strong> ${escapeHtml(s.notes)}</p>` : ""}

    <div class="toolbar" style="margin-top:24px">
      <h3 style="flex:1;margin:0">Milestones / Invoices</h3>
      <button class="primary-btn" id="newMilestoneBtn"><svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>Add milestone</button>
    </div>
    <table class="milestone-table">
      <thead><tr><th>Description</th><th>Amount</th><th>Status</th><th>Due</th><th>Billed date</th><th></th></tr></thead>
      <tbody id="milestoneBody"></tbody>
    </table>
  `;

  document.getElementById("editSowBtn").addEventListener("click", () => openSowModal(s));
  document.getElementById("newMilestoneBtn").addEventListener("click", () => openMilestoneModal());

  const mbody = document.getElementById("milestoneBody");
  mbody.innerHTML = "";
  if (!s.milestones.length) {
    mbody.innerHTML = '<tr><td colspan="6" class="empty-state">No milestones yet.</td></tr>';
  } else {
    s.milestones.forEach((m) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(m.description)}</td>
        <td>${fmt(m.amount)}</td>
        <td><span class="badge badge-${m.status === "paid" ? "completed" : m.status === "invoiced" ? "active" : "draft"}">${m.status}</span></td>
        <td>${fmtDate(m.due_date)}</td>
        <td>${fmtDate(m.billed_date)}</td>
        <td class="row-actions">
          <button class="ghost-btn btn-edit edit-m-btn">${icon("edit")}<span>Edit</span></button>
          <button class="ghost-btn btn-danger del-m-btn">${icon("trash")}<span>Delete</span></button>
        </td>
      `;
      tr.querySelector(".edit-m-btn").addEventListener("click", () => openMilestoneModal(m));
      tr.querySelector(".del-m-btn").addEventListener("click", async () => {
        if (confirm(`Delete milestone "${m.description}"?`)) {
          await fetch(`${API}/milestones/${m.id}`, { method: "DELETE" });
          renderDetail();
        }
      });
      mbody.appendChild(tr);
    });
  }
}

const milestoneModal = document.getElementById("milestoneModal");
document.getElementById("cancelMilestoneBtn").addEventListener("click", () => (milestoneModal.hidden = true));

function openMilestoneModal(m) {
  document.getElementById("milestoneModalTitle").textContent = m ? "Edit Milestone" : "New Milestone / Invoice";
  document.getElementById("m_id").value = m?.id ?? "";
  document.getElementById("m_sowId").value = currentSowId;
  document.getElementById("m_description").value = m?.description ?? "";
  document.getElementById("m_amount").value = m?.amount ?? 0;
  document.getElementById("m_status").value = m?.status ?? "pending";
  document.getElementById("m_due").value = m?.due_date ?? "";
  document.getElementById("m_billed").value = m?.billed_date ?? "";
  milestoneModal.hidden = false;
}

document.getElementById("milestoneForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("m_id").value;
  const sowId = document.getElementById("m_sowId").value;
  const payload = {
    description: document.getElementById("m_description").value,
    amount: parseFloat(document.getElementById("m_amount").value) || 0,
    status: document.getElementById("m_status").value,
    due_date: document.getElementById("m_due").value || null,
    billed_date: document.getElementById("m_billed").value || null,
  };
  const url = id ? `${API}/milestones/${id}` : `${API}/sows/${sowId}/milestones`;
  const method = id ? "PUT" : "POST";
  await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  milestoneModal.hidden = true;
  renderDetail();
});

// ---------- Customer Management (Administration) ----------
document.getElementById("customerSearchInput").addEventListener("input", debounce(loadCustomers, 250));

async function loadCustomers() {
  const q = document.getElementById("customerSearchInput").value.trim();
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  const customers = await fetch(`${API}/customers?${params}`).then((r) => r.json());

  const tbody = document.getElementById("customerTableBody");
  tbody.innerHTML = "";
  if (!customers.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No customers yet. Click "New Customer" to add one.</td></tr>';
    return;
  }
  customers.forEach((c) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(c.customer_code)}</td>
      <td>${escapeHtml(c.customer_name)}</td>
      <td>${escapeHtml(c.client_partner) || "—"}</td>
      <td>${escapeHtml(c.delivery_director) || "—"}</td>
      <td>${escapeHtml(c.industry) || "—"}</td>
      <td>${escapeHtml(c.headquarters) || "—"}</td>
      <td>${escapeHtml(c.geo) || "—"}</td>
      <td class="row-actions">
        <button class="ghost-btn btn-edit edit-c-btn">${icon("edit")}<span>Edit</span></button>
        <button class="ghost-btn btn-danger del-c-btn">${icon("trash")}<span>Delete</span></button>
      </td>
    `;
    tr.querySelector(".edit-c-btn").addEventListener("click", () => openCustomerModal(c));
    tr.querySelector(".del-c-btn").addEventListener("click", async () => {
      if (confirm(`Delete customer "${c.customer_name}" (${c.customer_code})?`)) {
        await fetch(`${API}/customers/${c.id}`, { method: "DELETE" });
        loadCustomers();
      }
    });
    tbody.appendChild(tr);
  });
}

const customerModal = document.getElementById("customerModal");
document.getElementById("newCustomerBtn").addEventListener("click", () => openCustomerModal());
document.getElementById("cancelCustomerBtn").addEventListener("click", () => (customerModal.hidden = true));

function openCustomerModal(c) {
  document.getElementById("customerModalTitle").textContent = c ? "Edit Customer" : "New Customer";
  document.getElementById("c_id").value = c?.id ?? "";
  document.getElementById("c_code").value = c?.customer_code ?? "";
  document.getElementById("c_name").value = c?.customer_name ?? "";
  document.getElementById("c_partner").value = c?.client_partner ?? "";
  document.getElementById("c_director").value = c?.delivery_director ?? "";
  document.getElementById("c_industry").value = c?.industry ?? "";
  document.getElementById("c_headquarters").value = c?.headquarters ?? "";
  document.getElementById("c_geo").value = c?.geo ?? "";
  customerModal.hidden = false;
}

document.getElementById("customerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("c_id").value;
  const payload = {
    customer_code: document.getElementById("c_code").value,
    customer_name: document.getElementById("c_name").value,
    client_partner: document.getElementById("c_partner").value || null,
    delivery_director: document.getElementById("c_director").value || null,
    industry: document.getElementById("c_industry").value || null,
    headquarters: document.getElementById("c_headquarters").value || null,
    geo: document.getElementById("c_geo").value || null,
  };
  const url = id ? `${API}/customers/${id}` : `${API}/customers`;
  const method = id ? "PUT" : "POST";
  const resp = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    alert(formatApiError(err, "Failed to save customer."));
    return;
  }
  customerModal.hidden = true;
  loadCustomers();
});

// ---------- Configuration: generic simple-list helper (Locations, Billing Models, Statuses) ----------
function makeSimpleListManager(opts) {
  const { apiPath, tableBodyId, newBtnId, modal, modalTitleId, formId, idFieldId, nameFieldId, detailsFieldId, cancelBtnId, itemLabel, onChange } = opts;
  const tbody = document.getElementById(tableBodyId);
  const form = document.getElementById(formId);
  const colCount = detailsFieldId ? 3 : 2;

  function openModal(item) {
    document.getElementById(modalTitleId).textContent = item ? `Edit ${itemLabel}` : `New ${itemLabel}`;
    document.getElementById(idFieldId).value = item?.id ?? "";
    document.getElementById(nameFieldId).value = item?.name ?? "";
    if (detailsFieldId) document.getElementById(detailsFieldId).value = item?.details ?? "";
    modal.hidden = false;
  }

  async function load() {
    const items = await fetch(`${API}/${apiPath}`).then((r) => r.json());
    tbody.innerHTML = "";
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="${colCount}" class="empty-state">No ${itemLabel.toLowerCase()}s yet.</td></tr>`;
      return;
    }
    items.forEach((item) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(item.name)}</td>
        ${detailsFieldId ? `<td>${escapeHtml(item.details) || "—"}</td>` : ""}
        <td class="row-actions">
          <button class="ghost-btn btn-edit edit-btn">${icon("edit")}<span>Edit</span></button>
          <button class="ghost-btn btn-danger del-btn">${icon("trash")}<span>Delete</span></button>
        </td>
      `;
      tr.querySelector(".edit-btn").addEventListener("click", () => openModal(item));
      tr.querySelector(".del-btn").addEventListener("click", async () => {
        if (confirm(`Delete ${itemLabel.toLowerCase()} "${item.name}"?`)) {
          await fetch(`${API}/${apiPath}/${item.id}`, { method: "DELETE" });
          load();
          if (onChange) onChange();
        }
      });
      tbody.appendChild(tr);
    });
  }

  document.getElementById(newBtnId).addEventListener("click", () => openModal());
  document.getElementById(cancelBtnId).addEventListener("click", () => (modal.hidden = true));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById(idFieldId).value;
    const payload = { name: document.getElementById(nameFieldId).value };
    if (detailsFieldId) payload.details = document.getElementById(detailsFieldId).value || null;
    const url = id ? `${API}/${apiPath}/${id}` : `${API}/${apiPath}`;
    const method = id ? "PUT" : "POST";
    const resp = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      alert(formatApiError(err, `Failed to save ${itemLabel.toLowerCase()}.`));
      return;
    }
    modal.hidden = true;
    load();
    if (onChange) onChange();
  });

  return { load };
}

const locationManager = makeSimpleListManager({
  apiPath: "locations",
  tableBodyId: "locationTableBody",
  newBtnId: "newLocationBtn",
  modal: document.getElementById("locationModal"),
  modalTitleId: "locationModalTitle",
  formId: "locationForm",
  idFieldId: "loc_id",
  nameFieldId: "loc_name",
  detailsFieldId: "loc_details",
  cancelBtnId: "cancelLocationBtn",
  itemLabel: "Location",
});

const billingModelManager = makeSimpleListManager({
  apiPath: "billing-models",
  tableBodyId: "billingModelTableBody",
  newBtnId: "newBillingModelBtn",
  modal: document.getElementById("billingModelModal"),
  modalTitleId: "billingModelModalTitle",
  formId: "billingModelForm",
  idFieldId: "bm_id",
  nameFieldId: "bm_name",
  detailsFieldId: "bm_details",
  cancelBtnId: "cancelBillingModelBtn",
  itemLabel: "Billing Model",
});

const operatingModelManager = makeSimpleListManager({
  apiPath: "operating-models",
  tableBodyId: "operatingModelTableBody",
  newBtnId: "newOperatingModelBtn",
  modal: document.getElementById("operatingModelModal"),
  modalTitleId: "operatingModelModalTitle",
  formId: "operatingModelForm",
  idFieldId: "om_id",
  nameFieldId: "om_name",
  detailsFieldId: "om_details",
  cancelBtnId: "cancelOperatingModelBtn",
  itemLabel: "Operating Model",
});

const statusManager = makeSimpleListManager({
  apiPath: "statuses",
  tableBodyId: "statusTableBody",
  newBtnId: "newStatusBtn",
  modal: document.getElementById("statusModal"),
  modalTitleId: "statusModalTitle",
  formId: "statusForm",
  idFieldId: "st_id",
  nameFieldId: "st_name",
  detailsFieldId: "st_details",
  cancelBtnId: "cancelStatusBtn",
  itemLabel: "Status",
  onChange: refreshStatusFilterOptions,
});

function loadLocations() { locationManager.load(); }
function loadBillingModels() { billingModelManager.load(); }
function loadOperatingModels() { operatingModelManager.load(); }
function loadStatuses() { statusManager.load(); }

// ---------- init ----------
// Statement of Work is the landing page now that Dashboard has been removed.
loadSows();
refreshStatusFilterOptions();
