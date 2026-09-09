// Trakerz frontend - vanilla JS, no build step.
const API = "/api";
const fmt = (n) => "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Same formatting as fmt() but without the "$" - used for the read-only
// Revenue Summary (Account Level) table, matching the plain numbers typed
// into the SoW Level grid it's rolled up from.
const fmtPlain = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Abbreviated currency for tight spaces (the Dashboard's circle tiles) -
// $1.2M / $280K / $950, rather than the full "$280,000.00" fmt() produces.
function fmtCompact(n) {
  const v = Number(n || 0);
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return `${sign}$${Math.round(abs)}`;
}
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
// SOW Status is a free-text, user-editable master list (see main.py), so a
// dashboard.status_counts lookup for a specific status like "active" must
// match case-insensitively rather than assuming the exact stored casing
// (a user might rename the status to "Active", "ACTIVE", etc).
function countStatusCI(statusCounts, name) {
  const target = name.toLowerCase();
  return Object.entries(statusCounts || {})
    .filter(([status]) => status.toLowerCase() === target)
    .reduce((sum, [, count]) => sum + count, 0);
}
// Share of a total as a "12.3" style percentage string (no trailing zeros
// beyond one decimal place), used by the Dashboard's breakdown tables.
function pctOf(count, total) {
  return total ? Math.round((count / total) * 1000) / 10 : 0;
}
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
  copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
  chevron: '<polyline points="9 18 15 12 9 6"></polyline>',
  check: '<polyline points="20 6 9 17 4 12"></polyline>',
  x: '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
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

// Nav dropdowns (Contract / Financial, Customer Configuration, Global Settings) - generic so any number of them work the same way.
document.querySelectorAll(".nav-dropdown").forEach((dropdown) => {
  const toggle = dropdown.querySelector(".dropdown-toggle");
  const menu = dropdown.querySelector(".dropdown-menu");
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const wasHidden = menu.hidden;
    document.querySelectorAll(".dropdown-menu").forEach((m) => (m.hidden = true));
    closeAllSubmenus();
    menu.hidden = !wasHidden;
  });
  // Second-level submenu triggers (e.g. Financial's Projections/Actuals) -
  // toggle their own flyout without closing the parent menu. querySelectorAll
  // finds these regardless of nesting depth, so this loop also covers menus
  // with no submenus at all (nothing to wire in that case).
  menu.querySelectorAll("[data-toggle-submenu]").forEach((trigger) => {
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const submenu = document.getElementById(trigger.dataset.toggleSubmenu);
      if (!submenu) return;
      const wasHidden = submenu.hidden;
      closeAllSubmenus();
      submenu.hidden = !wasHidden;
    });
  });
  menu.querySelectorAll(".dropdown-item[data-tab]").forEach((item) => {
    item.addEventListener("click", () => {
      applyRevenueMenuPreset(item);
      showTab(item.dataset.tab);
      menu.hidden = true;
      closeAllSubmenus();
    });
  });
});
function closeAllSubmenus() {
  document.querySelectorAll(".dropdown-submenu").forEach((s) => (s.hidden = true));
}
document.addEventListener("click", (e) => {
  document.querySelectorAll(".nav-dropdown").forEach((dropdown) => {
    const menu = dropdown.querySelector(".dropdown-menu");
    if (!menu.hidden && !dropdown.contains(e.target)) menu.hidden = true;
  });
  document.querySelectorAll(".dropdown-submenu").forEach((s) => {
    if (!s.hidden && !s.contains(e.target) && !s.previousElementSibling?.contains(e.target)) s.hidden = true;
  });
});

// Applies a Financial submenu leaf's preset (Projections/Actuals view mode
// and Time and Material/Managed Services billing-model filter) to the
// Revenue Management table before showTab() switches to it. No-op for every
// other dropdown item, since only these carry data-revenue-view/
// data-revenue-billing-model.
function applyRevenueMenuPreset(item) {
  const view = item.dataset.revenueView;
  const billingModel = item.dataset.revenueBillingModel;
  // Just sets the shared revenueBillingModelFilter variable - the toolbar
  // <select> itself is synced from that variable a moment later, once
  // showTab("revenue") -> loadRevenueTab() has (re)populated its options
  // (see populateRevenueBillingModelFilter()); setting select.value directly
  // here would be a no-op since "Time and Material"/"Managed Services"
  // aren't options on it yet at this point.
  if (billingModel !== undefined) revenueBillingModelFilter = billingModel;
  if (view) setRevenueViewMode(view);
}

// Remembers the last tab the user had open so a browser refresh lands back
// where they were instead of always resetting to the Dashboard (see the
// restore call in the init section at the bottom of this file).
function rememberLastTab(name) {
  try {
    localStorage.setItem("trakerz_last_tab", name);
  } catch (e) {}
}

function showTab(name) {
  rememberLastTab(name);
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

  // The SOWs, Staffing and Revenue Management pages freeze their stat tiles
  // and table header in place and scroll only the table body (see
  // .scroll-locked rules in style.css) - toggled here rather than left on
  // permanently so every other page keeps its normal whole-page scrolling.
  document.body.classList.toggle("scroll-locked", ["sows", "resources", "revenue"].includes(name));

  if (name === "home") loadHome();
  if (name === "sows") loadSows();
  if (name === "customers") loadCustomers();
  if (name === "config-billing-hours") loadBillingHours();
  if (name === "config-holidays") loadHolidays();
  if (name === "resources") loadResources();
  if (name === "revenue") loadRevenueTab();
  if (name === "config-locations") loadLocations();
  if (name === "config-billing-models") loadBillingModels();
  if (name === "config-operating-models") loadOperatingModels();
  if (name === "config-statuses") loadStatuses();
  if (name === "config-employee-types") loadEmployeeTypes();
  if (name === "config-bands") loadBands();
  if (name === "config-opportunity-types") loadOpportunityTypes();
  if (name === "config-revenue-types") loadRevenueTypes();
}

document.getElementById("backToList").addEventListener("click", () => showTab("sows"));

// ---------- About / landing page (opened via the Trakerz logo) ----------
// Not one of the regular nav tabs (no data-tab button), so it's wired up
// separately here rather than through the .tab-btn click handlers below.
function openLandingPage() { showTab("landing"); }
const logoHomeBtn = document.getElementById("logoHomeBtn");
logoHomeBtn.addEventListener("click", openLandingPage);
logoHomeBtn.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openLandingPage(); }
});
document.getElementById("landingGetStartedBtn").addEventListener("click", () => showTab("home"));
document.getElementById("landingViewSowsBtn").addEventListener("click", () => showTab("sows"));
document.getElementById("landingFooterCtaBtn").addEventListener("click", () => showTab("home"));

// ---------- Landing page hero filmstrip (5 product screenshots) ----------
// .landing-carousel-track holds 5 slides side by side at 500% total width;
// showing slide N is just translateX(-N * 20%). Advances automatically every
// 5s, but any manual interaction (arrows, dots, or just hovering the frame)
// pauses/resets the timer so it never fights someone actively browsing it.
const LANDING_CAROUSEL_CAPTIONS = [
  "Dashboard — KPIs, revenue trend and status breakdowns at a glance",
  "Contract Management — every SOW, sortable and searchable",
  "Revenue Management — Projections vs Invoiced, month by month",
  "Staffing — see who's assigned to what, at a glance",
  "Customer Configuration & Global Settings — your own customers and master data",
];
let landingSlideIndex = 0;
let landingAutoplayTimer = null;

function goToLandingSlide(index) {
  const slideCount = LANDING_CAROUSEL_CAPTIONS.length;
  landingSlideIndex = (index + slideCount) % slideCount;
  const track = document.getElementById("landingCarouselTrack");
  if (track) track.style.transform = `translateX(-${landingSlideIndex * (100 / slideCount)}%)`;
  document.querySelectorAll(".landing-carousel-dot").forEach((dot, i) => {
    dot.classList.toggle("active", i === landingSlideIndex);
  });
  const caption = document.getElementById("landingCarouselCaption");
  if (caption) caption.textContent = LANDING_CAROUSEL_CAPTIONS[landingSlideIndex];
}

function restartLandingAutoplay() {
  clearInterval(landingAutoplayTimer);
  landingAutoplayTimer = setInterval(() => goToLandingSlide(landingSlideIndex + 1), 5000);
}

function initLandingCarousel() {
  const carousel = document.getElementById("landingCarousel");
  if (!carousel) return;
  document.getElementById("landingCarouselPrev").addEventListener("click", () => {
    goToLandingSlide(landingSlideIndex - 1);
    restartLandingAutoplay();
  });
  document.getElementById("landingCarouselNext").addEventListener("click", () => {
    goToLandingSlide(landingSlideIndex + 1);
    restartLandingAutoplay();
  });
  document.querySelectorAll(".landing-carousel-dot").forEach((dot, i) => {
    dot.addEventListener("click", () => {
      goToLandingSlide(i);
      restartLandingAutoplay();
    });
  });
  carousel.addEventListener("mouseenter", () => clearInterval(landingAutoplayTimer));
  carousel.addEventListener("mouseleave", restartLandingAutoplay);
  restartLandingAutoplay();
}
initLandingCarousel();

// ---------- Overdue/expiring/over-budget banner (computed client-side from
// the currently-filtered SOW list by loadSowStats() every time the
// Statement of Work page's search/status/customer filters change) ----------
// User-dismissible: closing it hides it for the rest of this session as long
// as the underlying counts don't change. If a later refresh produces a
// different message (a new SOW becomes overdue, one gets paid down, a
// filter is changed, etc.) the signature no longer matches and the banner
// reappears - a plain closed flag would otherwise hide genuinely new alerts
// too.
let dismissedAlertSignature = null;

function renderAlertBanner(data) {
  const el = document.getElementById("alertBanner");
  const parts = [];
  if (data.overdue.length) parts.push(`${data.overdue.length} SOW(s) overdue`);
  if (data.expiring_soon.length) parts.push(`${data.expiring_soon.length} expiring within 30 days`);
  if (data.over_budget.length) parts.push(`${data.over_budget.length} over budget`);
  if (!parts.length) {
    el.hidden = true;
    return;
  }
  const signature = parts.join(" • ");
  if (dismissedAlertSignature === signature) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.innerHTML = `<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg><span>${signature}</span><button type="button" class="alert-banner-close" id="alertBannerCloseBtn" title="Dismiss" aria-label="Dismiss">&times;</button>`;
  document.getElementById("alertBannerCloseBtn").addEventListener("click", () => {
    dismissedAlertSignature = signature;
    el.hidden = true;
  });
}

// ---------- Dark mode toggle ----------
// Theme is applied as early as possible by an inline <script> in index.html
// (before the stylesheet paints), so this just keeps the button's own label/
// icon in sync and persists the choice for that early script to pick up
// next load.
function applyTheme(theme) {
  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  const label = document.getElementById("themeToggleLabel");
  if (label) label.textContent = theme === "dark" ? "Light mode" : "Dark mode";
}
applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
document.getElementById("themeToggleBtn").addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  try { localStorage.setItem("trakerz_theme", next); } catch (e) {}
  applyTheme(next);
  // The revenue trend chart's legend text color is picked at chart-build
  // time based on the theme (see renderRevenueTrendChart), so it doesn't
  // follow a plain CSS variable - reload the Dashboard's data/charts here
  // (only if it's the visible tab) so a mid-session toggle is reflected
  // immediately instead of only on the next tab visit.
  if (document.getElementById("tab-home").classList.contains("active")) loadHome();
});

// ---------- SOWs list ----------
document.getElementById("searchInput").addEventListener("input", debounce(loadSows, 250));
document.getElementById("statusFilter").addEventListener("change", loadSows);
document.getElementById("sowCustomerFilter").addEventListener("change", loadSows);

async function refreshStatusFilterOptions() {
  const statuses = await fetch(`${API}/statuses`).then((r) => r.json());
  const sel = document.getElementById("statusFilter");
  const prevVal = sel.value;
  sel.innerHTML = '<option value="">All statuses</option>' +
    statuses.map((s) => `<option value="${escapeHtml(s.name)}">${escapeHtml(capitalize(s.name))}</option>`).join("");
  if (statuses.some((s) => s.name === prevVal)) sel.value = prevVal;
}

// Customer filter for the SOWs table - refreshed here (called at startup)
// and again after any customer is added/edited/deleted on the Customers
// page (see openCustomerModal()'s save handler and the delete button below),
// same "onChange" spirit as refreshStatusFilterOptions() above so the
// dropdown never goes stale just because the edit happened on another tab.
async function refreshSowCustomerFilterOptions() {
  const customers = await fetch(`${API}/customers`).then((r) => r.json());
  const sel = document.getElementById("sowCustomerFilter");
  const prevVal = sel.value;
  sel.innerHTML = '<option value="">All customers</option>' +
    customers.map((c) => `<option value="${c.id}">${escapeHtml(c.customer_name)}</option>`).join("");
  if (customers.some((c) => String(c.id) === prevVal)) sel.value = prevVal;
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Statuses that don't count towards "expiring soon"/"overdue" alerts even
// past their end date - mirrors CLOSED_STATUSES in backend/main.py exactly,
// since these tile/banner numbers are now computed client-side from the
// already-enriched (and already search/status/customer-filtered) SOW list
// rather than a separate unfiltered /api/dashboard call.
const CLOSED_STATUSES = ["completed", "cancelled", "expired"];

// Tiles at the top of the SOWs page now reflect whatever the search box /
// status filter / customer filter currently narrow the table down to
// (rather than always showing portfolio-wide totals), so switching filters
// updates "SoW #", "TCV", "Expiring in 30 days" and the per-status counts
// together with the table below them. Order: Total SOWs, Total TCV, then
// one tile per configured SOW status (even statuses with zero matches in
// the current filter), built dynamically since statuses are user-editable
// master data. Cycles through the stat-card color classes since there's no
// fixed number of statuses.
const SOW_STATUS_TILE_COLORS = ["stat-emerald", "stat-cyan", "stat-red", "stat-orange", "stat-indigo", "stat-amber"];

function renderSowStatusTiles(statuses, statusCounts) {
  const row = document.getElementById("sowStatusTiles");
  row.querySelectorAll(".sow-status-tile").forEach((el) => el.remove());
  (statuses || []).forEach((status, i) => {
    const count = countStatusCI(statusCounts, status.name);
    const color = SOW_STATUS_TILE_COLORS[i % SOW_STATUS_TILE_COLORS.length];
    const tile = document.createElement("div");
    tile.className = `stat-card ${color} sow-status-tile`;
    tile.innerHTML = `
      <div class="stat-value">${count}</div>
      <div class="stat-label">${escapeHtml(capitalize(status.name))}</div>
    `;
    row.appendChild(tile);
  });
}

// Same idea as the per-status tiles above, but one tile per configured
// Opportunity Type (New/Extension/Amendment/...) - also user-editable master
// data (Settings > Opportunity Type), so built dynamically rather than
// hardcoded. Appended after the status tiles; uses a separate marker class
// (sow-opptype-tile) so the two groups can each be cleared/rebuilt on every
// filter change without touching one another.
const SOW_OPPTYPE_TILE_COLORS = ["stat-violet", "stat-pink", "stat-cyan", "stat-amber", "stat-emerald", "stat-orange"];

function renderSowOpportunityTypeTiles(opportunityTypes, typeCounts) {
  const row = document.getElementById("sowOpportunityTypeTiles");
  row.querySelectorAll(".sow-opptype-tile").forEach((el) => el.remove());
  (opportunityTypes || []).forEach((type, i) => {
    const count = countStatusCI(typeCounts, type.name);
    const color = SOW_OPPTYPE_TILE_COLORS[i % SOW_OPPTYPE_TILE_COLORS.length];
    const tile = document.createElement("div");
    tile.className = `stat-card ${color} sow-opptype-tile`;
    tile.innerHTML = `
      <div class="stat-value">${count}</div>
      <div class="stat-label">${escapeHtml(capitalize(type.name))}</div>
    `;
    row.appendChild(tile);
  });
}

// sows here is the already-filtered list loadSows() just fetched from
// /api/sows (search/status/customer applied server-side) - each row already
// carries days_to_end/alerts/status/total_value from the backend's
// _enrich_sow(), so every tile and the alert banner can be derived from it
// directly instead of a second, unfiltered /api/dashboard round trip.
async function loadSowStats(sows) {
  const [statuses, opportunityTypes] = await Promise.all([
    fetch(`${API}/statuses`).then((r) => r.json()),
    fetch(`${API}/opportunity-types`).then((r) => r.json()),
  ]);

  document.getElementById("sowStatTotal").textContent = sows.length;
  const totalValue = sows.reduce((sum, s) => sum + (s.total_value || 0), 0);
  // Abbreviated ($22.5M) rather than fmt()'s full "$22,474,000.00" - the
  // full figure overflowed the circular tile. Full precision is still one
  // hover away via the title tooltip.
  const sowStatValueEl = document.getElementById("sowStatValue");
  sowStatValueEl.textContent = fmtCompact(totalValue);
  sowStatValueEl.title = fmt(totalValue);

  const expiringCount = sows.filter((s) => {
    if (CLOSED_STATUSES.includes((s.status || "").trim().toLowerCase())) return false;
    return s.days_to_end !== null && s.days_to_end !== undefined && s.days_to_end >= 0 && s.days_to_end <= 30;
  }).length;
  document.getElementById("sowStatExpiring").textContent = expiringCount;

  const statusCounts = {};
  sows.forEach((s) => { statusCounts[s.status] = (statusCounts[s.status] || 0) + 1; });
  renderSowStatusTiles(statuses, statusCounts);

  const opportunityTypeCounts = {};
  sows.forEach((s) => {
    const name = s.opportunity_type_name;
    if (name) opportunityTypeCounts[name] = (opportunityTypeCounts[name] || 0) + 1;
  });
  renderSowOpportunityTypeTiles(opportunityTypes, opportunityTypeCounts);

  renderAlertBanner({
    overdue: sows.filter((s) => (s.alerts || []).includes("overdue")),
    expiring_soon: sows.filter((s) => (s.alerts || []).includes("expiring_soon")),
    over_budget: sows.filter((s) => (s.alerts || []).includes("over_budget")),
  });
}

// Column sorting for the SOW table - client-side only, since /api/sows has
// no server-side sort support. currentSows holds the last-fetched (and
// search/status-filtered) list so a header click can just re-sort and
// re-render without another round trip; sowSort persists the chosen column
// and direction across reloads (e.g. after search/filter changes or edits).
let currentSows = [];
let sowSort = { key: null, dir: 1 };

function sortSows(sows) {
  if (!sowSort.key) return sows;
  const key = sowSort.key;
  const dir = sowSort.dir;
  const sorted = [...sows].sort((a, b) => {
    let av = a[key];
    let bv = b[key];
    if (key === "total_value" || key === "gm_percent") {
      av = av || 0; bv = bv || 0;
      return (av - bv) * dir;
    }
    if (key === "start_date" || key === "end_date") {
      // Sort SOWs with no date to the end regardless of direction.
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
    }
    av = (av || "").toString().toLowerCase();
    bv = (bv || "").toString().toLowerCase();
    return av.localeCompare(bv, undefined, { numeric: true }) * dir;
  });
  return sorted;
}

function updateSortArrows() {
  document.querySelectorAll("#tab-sows .sow-table thead th.sortable-th").forEach((th) => {
    const arrow = th.querySelector(".sort-arrow");
    if (th.dataset.sortKey === sowSort.key) {
      th.classList.add("sorted");
      arrow.textContent = sowSort.dir === 1 ? "▲" : "▼";
    } else {
      th.classList.remove("sorted");
      arrow.textContent = "";
    }
  });
}

document.querySelectorAll("#tab-sows .sow-table thead th.sortable-th").forEach((th) => {
  th.addEventListener("click", () => {
    const key = th.dataset.sortKey;
    if (sowSort.key === key) {
      sowSort.dir *= -1;
    } else {
      sowSort = { key, dir: 1 };
    }
    renderSowsTable(currentSows);
  });
});

async function loadSows() {
  const q = document.getElementById("searchInput").value.trim();
  const status = document.getElementById("statusFilter").value;
  const customerId = document.getElementById("sowCustomerFilter").value;
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  if (customerId) params.set("customer_id", customerId);
  currentSows = await fetch(`${API}/sows?${params}`).then((r) => r.json());
  renderSowsTable(currentSows);
  // Tiles/banner reflect this same filtered list, so they stay in sync with
  // whatever the search box / status filter / customer filter narrowed the
  // table down to.
  loadSowStats(currentSows);
}

function renderSowsTable(sowsIn) {
  const sows = sortSows(sowsIn);
  updateSortArrows();
  const tbody = document.getElementById("sowTableBody");
  tbody.innerHTML = "";
  if (!sows.length) {
    tbody.innerHTML = '<tr><td colspan="22" class="empty-state">No SOWs yet. Click "New SOW" to add one.</td></tr>';
    return;
  }
  sows.forEach((s, idx) => {
    const isFixedPrice = (s.billing_model_name || "").toLowerCase().includes("fixed price");
    const tr = document.createElement("tr");
    // Highlight rows by how soon the SOW's end date is coming up: 0-15 days
    // out in red, 16-50 days out in amber. Independent of status - it's a
    // visual "check this date" cue, not a replacement for the Status badge.
    if (s.days_to_end !== null && s.days_to_end !== undefined) {
      if (s.days_to_end >= 0 && s.days_to_end <= 15) tr.classList.add("expiry-red");
      else if (s.days_to_end >= 16 && s.days_to_end <= 50) tr.classList.add("expiry-amber");
    }
    tr.innerHTML = `
      <td class="row-actions">
        <button class="ghost-btn btn-edit icon-btn copy-btn" title="Copy">${icon("copy")}</button>
        <button class="ghost-btn btn-edit icon-btn edit-btn" title="Edit">${icon("edit")}</button>
        <button class="ghost-btn btn-danger icon-btn del-btn" data-id="${s.id}" title="Delete">${icon("trash")}</button>
      </td>
      <td class="sl-no-cell">${idx + 1}</td>
      <td>${escapeHtml(s.opportunity_id) || "—"}</td>
      <td>${escapeHtml(s.opportunity_type_name) || "—"}</td>
      <td>${escapeHtml(s.title)}${isFixedPrice ? `<button type="button" class="expand-btn" title="Show milestones">${icon("chevron")}</button>` : ""}</td>
      <td>${escapeHtml(s.customer_name)}</td>
      <td>${escapeHtml(s.po_number) || "—"}</td>
      <td>${fmtDate(s.start_date)}</td>
      <td>${fmtDate(s.end_date)}</td>
      <td>${fmt(s.total_value)}</td>
      <td>${s.gm_percent !== null && s.gm_percent !== undefined ? Number(s.gm_percent.toFixed(2)) + "%" : "—"}</td>
      <td><span class="badge badge-${slugify(s.status)}">${escapeHtml(s.status)}</span></td>
      <td>${escapeHtml(s.billing_model_name) || "—"}</td>
      <td>${escapeHtml(s.operating_model_name) || "—"}</td>
      <td>${escapeHtml(s.customer_code) || "—"}</td>
      <td>${escapeHtml(s.project_title) || "—"}</td>
      <td>${escapeHtml(s.contract_code) || "—"}</td>
      <td>${escapeHtml(s.project_code) || "—"}</td>
      <td>${s.doc_link ? `<span class="truncate-cell">${renderDocLink(s.doc_link)}</span>` : "—"}</td>
      <td>${s.po_doc_link ? `<span class="truncate-cell">${renderDocLink(s.po_doc_link)}</span>` : "—"}</td>
      <td>${s.deal_sheet_link ? `<span class="truncate-cell">${renderDocLink(s.deal_sheet_link)}</span>` : "—"}</td>
      <td>${s.notes ? `<span class="truncate-cell" title="${escapeHtml(s.notes)}">${escapeHtml(s.notes)}</span>` : "—"}</td>
    `;
    tr.addEventListener("click", (e) => {
      if (e.target.closest(".del-btn") || e.target.closest(".edit-btn") || e.target.closest(".copy-btn") || e.target.closest(".expand-btn") || e.target.closest("a")) return;
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
    // Opens the New/Edit SOW modal pre-filled with this SOW's values (title
    // gets a "(Copy)" suffix) plus its milestones, but with no id anywhere -
    // openSowModal() treats an id-less sow object as a fresh "New SOW", so
    // Save creates a new record instead of overwriting the original, and the
    // user can review/edit anything before it's actually saved.
    tr.querySelector(".copy-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      const full = await fetch(`${API}/sows/${s.id}`).then((r) => r.json());
      openSowModal({
        ...full,
        id: null,
        title: `${full.title} (Copy)`,
        milestones: (full.milestones || []).map((m) => ({
          id: null,
          description: m.description,
          amount: m.amount,
          due_date: m.due_date,
          status: "pending",
          billed_date: null,
        })),
      });
    });
    tr.querySelector(".del-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm(`Delete SOW "${s.title}" for ${s.customer_name}? This also deletes its milestones.`)) {
        const resp = await fetch(`${API}/sows/${s.id}`, { method: "DELETE" });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          alert(formatApiError(err, "Failed to delete this SOW."));
          return;
        }
        loadSows();
      }
    });
    tbody.appendChild(tr);
  });
}

const MILESTONE_BADGE_CLASS = { paid: "completed", invoiced: "active", pending: "draft" };

function renderMilestoneSubtable(milestones) {
  if (!milestones.length) {
    return '<div class="empty-state empty-state-tight">No milestones yet.</div>';
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
  subTr.innerHTML = `<td colspan="22">${renderMilestoneSubtable(milestones)}</td>`;
  tr.after(subTr);
}

// Wires up any number of Cancel buttons (a modal's top-of-header one and its
// bottom-of-form one) to simply hide the given modal - shared by every modal
// below instead of repeating the same addEventListener call per button.
function wireModalCancel(modal, ...btnIds) {
  btnIds.forEach((btnId) => {
    const btn = document.getElementById(btnId);
    if (btn) btn.addEventListener("click", () => (modal.hidden = true));
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ---------- SOW create/edit modal ----------
const sowModal = document.getElementById("sowModal");
document.getElementById("newSowBtn").addEventListener("click", () => openSowModal());

// Exports whatever the SOW table currently shows: the same search/status
// filter used by loadSows() is appended so a filtered view downloads only
// the filtered rows, not the whole portfolio.
document.getElementById("exportSowsBtn").addEventListener("click", () => {
  const q = document.getElementById("searchInput").value.trim();
  const status = document.getElementById("statusFilter").value;
  const customerId = document.getElementById("sowCustomerFilter").value;
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  if (customerId) params.set("customer_id", customerId);
  const qs = params.toString();
  window.location.href = `${API}/sows/export${qs ? "?" + qs : ""}`;
});
wireModalCancel(sowModal, "cancelSowBtn", "cancelSowBtnTop");

function fillSelect(selectId, items, valueKey, labelKey, placeholder) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    items.map((i) => `<option value="${i[valueKey]}">${escapeHtml(i[labelKey])}</option>`).join("");
}

let currentBillingModels = [];
let currentSowCustomers = [];
let originalMilestoneIdsAtOpen = [];

async function populateSowDropdowns() {
  const [customers, billingModels, operatingModels, statuses, opportunityTypes] = await Promise.all([
    fetch(`${API}/customers`).then((r) => r.json()),
    fetch(`${API}/billing-models`).then((r) => r.json()),
    fetch(`${API}/operating-models`).then((r) => r.json()),
    fetch(`${API}/statuses`).then((r) => r.json()),
    fetch(`${API}/opportunity-types`).then((r) => r.json()),
  ]);
  currentBillingModels = billingModels;
  currentSowCustomers = customers;
  fillSelect("f_customer", customers, "id", "customer_name", "Select customer&hellip;");
  fillSelect("f_billing_model", billingModels, "id", "name", "Select billing model&hellip;");
  fillSelect("f_operating_model", operatingModels, "id", "name", "Select operating model&hellip;");
  fillSelect("f_opportunity_type", opportunityTypes, "id", "name", "Select opportunity type&hellip;");

  const statusSel = document.getElementById("f_status");
  statusSel.innerHTML = statuses.map((s) => `<option value="${escapeHtml(s.name)}">${escapeHtml(capitalize(s.name))}</option>`).join("");
}

// BTP Information's "Customer Code" field isn't its own input - it's a
// read-only mirror of the selected customer's code, kept in sync whenever
// the Customer Name dropdown changes (see the "change" listener below) and
// set once up front when the modal opens for an existing SOW.
function updateCustomerCodeField() {
  const customerId = document.getElementById("f_customer").value;
  const match = currentSowCustomers.find((c) => String(c.id) === String(customerId));
  document.getElementById("f_customer_code").value = match ? match.customer_code : "";
}
document.getElementById("f_customer").addEventListener("change", updateCustomerCodeField);

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
  // A "Copy" draft (see the SOW table's copy-btn handler) is a sow-shaped
  // object with every field pre-filled but no id, so it must fall into the
  // same "New SOW" / create-on-save path as a blank form - checking sow?.id
  // rather than just sow's truthiness is what makes that distinction.
  document.getElementById("sowModalTitle").textContent = sow?.id ? "Edit SOW" : "New SOW";
  document.getElementById("sowId").value = sow?.id ?? "";
  document.getElementById("f_customer").value = sow?.customer_id ?? "";
  document.getElementById("f_title").value = sow?.title ?? "";
  document.getElementById("f_project_title").value = sow?.project_title ?? "";
  document.getElementById("f_project_code").value = sow?.project_code ?? "";
  document.getElementById("f_contract_code").value = sow?.contract_code ?? "";
  document.getElementById("f_opportunity").value = sow?.opportunity_id ?? "";
  document.getElementById("f_opportunity_type").value = sow?.opportunity_type_id ?? "";
  document.getElementById("f_po").value = sow?.po_number ?? "";
  document.getElementById("f_start").value = sow?.start_date ?? "";
  document.getElementById("f_end").value = sow?.end_date ?? "";
  document.getElementById("f_value").value = sow?.total_value ?? 0;
  document.getElementById("f_gm_percent").value = sow?.gm_percent ?? "";
  document.getElementById("f_status").value = sow?.status ?? "draft";
  document.getElementById("f_billing_model").value = sow?.billing_model_id ?? "";
  document.getElementById("f_operating_model").value = sow?.operating_model_id ?? "";
  document.getElementById("f_doclink").value = sow?.doc_link ?? "";
  document.getElementById("f_po_doclink").value = sow?.po_doc_link ?? "";
  document.getElementById("f_deal_sheet_link").value = sow?.deal_sheet_link ?? "";
  document.getElementById("f_notes").value = sow?.notes ?? "";
  updateCustomerCodeField();

  // .filter(Boolean) matters for a "Copy" draft (see the copy-btn handler
  // above): its milestones all carry id: null since none exist in the
  // database yet, and without the filter those nulls would end up in
  // syncMilestonesForSow()'s "delete anything missing" diff and fire
  // DELETE requests against a nonsensical /api/milestones/null.
  originalMilestoneIdsAtOpen = (sow?.milestones || []).map((m) => m.id).filter(Boolean);
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
  const opportunityTypeVal = document.getElementById("f_opportunity_type").value;
  const payload = {
    customer_id: parseInt(customerVal, 10),
    title: document.getElementById("f_title").value,
    project_title: document.getElementById("f_project_title").value || null,
    project_code: document.getElementById("f_project_code").value || null,
    contract_code: document.getElementById("f_contract_code").value || null,
    opportunity_id: document.getElementById("f_opportunity").value || null,
    opportunity_type_id: opportunityTypeVal ? parseInt(opportunityTypeVal, 10) : null,
    po_number: document.getElementById("f_po").value || null,
    start_date: document.getElementById("f_start").value || null,
    end_date: document.getElementById("f_end").value || null,
    total_value: parseFloat(document.getElementById("f_value").value) || 0,
    gm_percent: document.getElementById("f_gm_percent").value !== "" ? parseFloat(document.getElementById("f_gm_percent").value) : null,
    billing_model_id: billingVal ? parseInt(billingVal, 10) : null,
    operating_model_id: operatingVal ? parseInt(operatingVal, 10) : null,
    status: document.getElementById("f_status").value,
    doc_link: document.getElementById("f_doclink").value || null,
    po_doc_link: document.getElementById("f_po_doclink").value || null,
    deal_sheet_link: document.getElementById("f_deal_sheet_link").value || null,
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
// Shared by all three Reference Documents fields (Contract/SoW, Purchase
// Order, Deal Sheet) - each just passes its own trigger button, hidden file
// input and destination link field.
function wireSowDocUpload(btnId, fileInputId, linkInputId) {
  document.getElementById(btnId).addEventListener("click", () => {
    document.getElementById(fileInputId).click();
  });
  document.getElementById(fileInputId).addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const uploadBtn = document.getElementById(btnId);
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
      document.getElementById(linkInputId).value = result.path;
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.innerHTML = prevHtml;
      e.target.value = "";
    }
  });
}
wireSowDocUpload("uploadDocBtn", "f_doc_file", "f_doclink");
wireSowDocUpload("uploadPoDocBtn", "f_po_doc_file", "f_po_doclink");
wireSowDocUpload("uploadDealSheetBtn", "f_deal_sheet_file", "f_deal_sheet_link");

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
  // Milestones/Invoices only make sense for Fixed Price SOWs (matches the
  // same "Fixed Price" substring check used to show/hide the inline
  // milestones capture in the SOW create/edit modal - see isFixedPriceSelected()).
  const isFixedPrice = (s.billing_model_name || "").toLowerCase().includes("fixed price");
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
        <button class="ghost-btn btn-edit icon-btn" id="editSowBtn" title="Edit SOW">${icon("edit")}</button>
      </div>
    </div>
    <div class="detail-cards">
      <div class="stat-card"><div class="stat-label">Start &rarr; end</div><div class="stat-value stat-value-sm">${fmtDate(s.start_date)} &rarr; ${fmtDate(s.end_date)}</div></div>
      <div class="stat-card"><div class="stat-label">TCV (USD)</div><div class="stat-value">${fmt(s.total_value)}</div></div>
      <div class="stat-card"><div class="stat-label">GM %</div><div class="stat-value">${s.gm_percent !== null && s.gm_percent !== undefined ? Number(s.gm_percent.toFixed(2)) + "%" : "—"}</div></div>
      <div class="stat-card"><div class="stat-label">Billed</div><div class="stat-value">${fmt(s.billed_total)}</div></div>
      <div class="stat-card"><div class="stat-label">Remaining</div><div class="stat-value">${fmt(s.remaining_budget)}</div></div>
    </div>
    <p><strong>Project Title:</strong> ${escapeHtml(s.project_title) || "—"} &nbsp;&middot;&nbsp; <strong>Project Code:</strong> ${escapeHtml(s.project_code) || "—"} &nbsp;&middot;&nbsp; <strong>Contract Code:</strong> ${escapeHtml(s.contract_code) || "—"}</p>
    <p><strong>Opportunity ID:</strong> ${escapeHtml(s.opportunity_id) || "—"} &nbsp;&middot;&nbsp; <strong>PO#:</strong> ${escapeHtml(s.po_number) || "—"}</p>
    <p><strong>Billing model:</strong> ${escapeHtml(s.billing_model_name) || "—"} &nbsp;&middot;&nbsp; <strong>Operating model:</strong> ${escapeHtml(s.operating_model_name) || "—"}</p>
    ${s.doc_link ? `<p><strong>Contract (SoW):</strong> ${renderDocLink(s.doc_link)}</p>` : ""}
    ${s.po_doc_link ? `<p><strong>Purchase Order:</strong> ${renderDocLink(s.po_doc_link)}</p>` : ""}
    ${s.deal_sheet_link ? `<p><strong>Deal Sheet:</strong> ${renderDocLink(s.deal_sheet_link)}</p>` : ""}
    ${s.notes ? `<p><strong>Additional information:</strong> ${escapeHtml(s.notes)}</p>` : ""}

    ${isFixedPrice ? `
      <div class="toolbar milestones-toolbar">
        <h3>Milestones / Invoices</h3>
        <button class="primary-btn" id="newMilestoneBtn"><svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>Add milestone</button>
      </div>
      <table class="milestone-table">
        <thead><tr><th>Description</th><th>Amount</th><th>Status</th><th>Due</th><th>Billed date</th><th></th></tr></thead>
        <tbody id="milestoneBody"></tbody>
      </table>
    ` : ""}
  `;

  document.getElementById("editSowBtn").addEventListener("click", () => openSowModal(s));
  if (!isFixedPrice) return;

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
          <button class="ghost-btn btn-edit icon-btn edit-m-btn" title="Edit">${icon("edit")}</button>
          <button class="ghost-btn btn-danger icon-btn del-m-btn" title="Delete">${icon("trash")}</button>
        </td>
      `;
      tr.querySelector(".edit-m-btn").addEventListener("click", () => openMilestoneModal(m));
      tr.querySelector(".del-m-btn").addEventListener("click", async () => {
        if (confirm(`Delete milestone "${m.description}"?`)) {
          const resp = await fetch(`${API}/milestones/${m.id}`, { method: "DELETE" });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            alert(formatApiError(err, "Failed to delete this milestone."));
            return;
          }
          renderDetail();
        }
      });
      mbody.appendChild(tr);
    });
  }
}

const milestoneModal = document.getElementById("milestoneModal");
wireModalCancel(milestoneModal, "cancelMilestoneBtn", "cancelMilestoneBtnTop");

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
// Inline-edit table - no modal. Each row's Edit icon swaps it in place into
// the same row with text inputs (Save/Cancel replacing Edit/Delete), and
// "New Customer" prepends a blank row in that same editable state. Mirrors
// the toggle-in-place approach Revenue Management's grid uses
// (buildRevenueSowRow()/replaceRevenueRow()) rather than opening a form.
document.getElementById("customerSearchInput").addEventListener("input", debounce(loadCustomers, 250));

// Field order/required-ness shared between the editable inputs and the
// payload sent to the API - keeps buildCustomerRow() and saveCustomerRow()
// in sync, and matches the table's header column order.
const CUSTOMER_FIELDS = [
  { key: "customer_code", label: "Customer code", required: true },
  { key: "customer_name", label: "Customer name", required: true },
  { key: "client_partner", label: "Client partner" },
  { key: "delivery_director", label: "Delivery director" },
  { key: "industry", label: "Industry" },
  { key: "headquarters", label: "Headquarters" },
  { key: "geo", label: "Geo" },
];

async function loadCustomers() {
  const q = document.getElementById("customerSearchInput").value.trim();
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  const customers = await fetch(`${API}/customers?${params}`).then((r) => r.json());

  const tbody = document.getElementById("customerTableBody");
  tbody.innerHTML = "";
  if (!customers.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No customers yet. Click "New Customer" to add one.</td></tr>';
    return;
  }
  customers.forEach((c, idx) => {
    const tr = buildCustomerRow(c, false);
    tr.querySelector(".cust-sl-no").textContent = idx + 1;
    tbody.appendChild(tr);
  });
}

// Builds one <tr> for the Customers table. editing=false renders plain text
// with Edit/Delete actions; editing=true renders a text input per field
// with Save/Cancel actions. Text values are set via the DOM (textContent/
// .value) rather than interpolated into an HTML string, so customer data
// containing quotes, "&", "<", etc. can never break out of the markup.
function buildCustomerRow(c, editing) {
  const tr = document.createElement("tr");
  if (editing) tr.classList.add("inline-editing-row");

  const slTd = document.createElement("td");
  slTd.className = "sl-no-cell cust-sl-no";
  tr.appendChild(slTd);

  CUSTOMER_FIELDS.forEach(({ key, required }) => {
    const td = document.createElement("td");
    if (editing) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "cust-cell";
      input.dataset.field = key;
      input.value = c[key] || "";
      if (required) input.required = true;
      td.appendChild(input);
    } else {
      td.textContent = c[key] || "—";
    }
    tr.appendChild(td);
  });

  const actionsTd = document.createElement("td");
  actionsTd.className = "row-actions";
  actionsTd.innerHTML = editing
    ? `<button type="button" class="ghost-btn btn-edit icon-btn cust-save-btn" title="Save">${icon("check")}</button>
       <button type="button" class="ghost-btn icon-btn cust-cancel-btn" title="Cancel">${icon("x")}</button>`
    : `<button type="button" class="ghost-btn btn-edit icon-btn cust-edit-btn" title="Edit">${icon("edit")}</button>
       <button type="button" class="ghost-btn btn-danger icon-btn cust-del-btn" title="Delete">${icon("trash")}</button>`;
  tr.appendChild(actionsTd);

  if (editing) {
    actionsTd.querySelector(".cust-save-btn").addEventListener("click", () => saveCustomerRow(c, tr));
    actionsTd.querySelector(".cust-cancel-btn").addEventListener("click", () => {
      if (c.id) {
        replaceCustomerRow(tr, buildCustomerRow(c, false));
      } else {
        loadCustomers(); // discard the unsaved draft row and restore the normal listing
      }
    });
  } else {
    actionsTd.querySelector(".cust-edit-btn").addEventListener("click", () => {
      replaceCustomerRow(tr, buildCustomerRow(c, true));
    });
    actionsTd.querySelector(".cust-del-btn").addEventListener("click", async () => {
      if (confirm(`Delete customer "${c.customer_name}" (${c.customer_code})?`)) {
        const resp = await fetch(`${API}/customers/${c.id}`, { method: "DELETE" });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          alert(formatApiError(err, "Failed to delete this customer."));
          return;
        }
        loadCustomers();
        refreshSowCustomerFilterOptions();
      }
    });
  }

  return tr;
}

// Preserves the row's current Sl. No when toggling edit/read-only in place,
// same reasoning as Revenue Management's replaceRevenueRow().
function replaceCustomerRow(oldTr, newTr) {
  const slNo = oldTr.querySelector(".cust-sl-no")?.textContent;
  oldTr.replaceWith(newTr);
  if (slNo) newTr.querySelector(".cust-sl-no").textContent = slNo;
}

async function saveCustomerRow(c, tr) {
  const saveBtn = tr.querySelector(".cust-save-btn");
  const cancelBtn = tr.querySelector(".cust-cancel-btn");
  const payload = {};
  let missingRequired = false;
  CUSTOMER_FIELDS.forEach(({ key, required }) => {
    const value = tr.querySelector(`.cust-cell[data-field="${key}"]`).value.trim();
    if (required && !value) missingRequired = true;
    payload[key] = value || null;
  });
  if (missingRequired) {
    alert("Customer code and Customer name are required.");
    return;
  }
  saveBtn.disabled = true;
  cancelBtn.disabled = true;
  try {
    const url = c.id ? `${API}/customers/${c.id}` : `${API}/customers`;
    const method = c.id ? "PUT" : "POST";
    const resp = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      alert(formatApiError(err, "Failed to save customer."));
      return;
    }
    await loadCustomers();
    refreshSowCustomerFilterOptions();
  } finally {
    saveBtn.disabled = false;
    cancelBtn.disabled = false;
  }
}

document.getElementById("newCustomerBtn").addEventListener("click", () => {
  const tbody = document.getElementById("customerTableBody");
  const existingDraft = tbody.querySelector('tr[data-draft="true"]');
  if (existingDraft) {
    existingDraft.querySelector(".cust-cell").focus();
    return;
  }
  if (tbody.querySelector(".empty-state")) tbody.innerHTML = "";
  const draft = buildCustomerRow({}, true);
  draft.dataset.draft = "true";
  tbody.prepend(draft);
  draft.querySelector(".cust-cell").focus();
});

document.getElementById("exportCustomersBtn").addEventListener("click", () => {
  const q = document.getElementById("customerSearchInput").value.trim();
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  const qs = params.toString();
  window.location.href = `${API}/customers/export${qs ? "?" + qs : ""}`;
});

// ---------- Customer Configuration: Billing Hours ----------
// Inline-edit table, same toggle-in-place Edit/Save/Cancel pattern as
// buildCustomerRow() and the generic Global Settings lists
// (makeInlineListManager) - but each row picks a Customer and a Location
// from dropdowns (both FKs) rather than typing a name, plus a numeric
// "billing hours per day" field.
function selectOptionsHtml(items, valueKey, labelKey, placeholder) {
  return `<option value="">${placeholder}</option>` +
    items.map((i) => `<option value="${i[valueKey]}">${escapeHtml(i[labelKey])}</option>`).join("");
}

function buildBillingHoursRow(item, editing, customers, locations) {
  const tr = document.createElement("tr");
  if (editing) tr.classList.add("inline-editing-row");

  const slTd = document.createElement("td");
  slTd.className = "sl-no-cell bh-sl-no";
  tr.appendChild(slTd);

  const customerTd = document.createElement("td");
  if (editing) {
    const select = document.createElement("select");
    select.className = "inline-cell";
    select.dataset.field = "customer_id";
    select.required = true;
    select.innerHTML = selectOptionsHtml(customers, "id", "customer_name", "Select customer…");
    if (item.customer_id) select.value = String(item.customer_id);
    customerTd.appendChild(select);
  } else {
    customerTd.textContent = item.customer_name || "—";
  }
  tr.appendChild(customerTd);

  const locationTd = document.createElement("td");
  if (editing) {
    const select = document.createElement("select");
    select.className = "inline-cell";
    select.dataset.field = "location_id";
    select.required = true;
    select.innerHTML = selectOptionsHtml(locations, "id", "name", "Select location…");
    if (item.location_id) select.value = String(item.location_id);
    locationTd.appendChild(select);
  } else {
    locationTd.textContent = item.location_name || "—";
  }
  tr.appendChild(locationTd);

  const hoursTd = document.createElement("td");
  if (editing) {
    const input = document.createElement("input");
    input.type = "number";
    input.step = "0.5";
    input.min = "0";
    input.className = "inline-cell";
    input.dataset.field = "billing_hours_per_day";
    input.value = item.billing_hours_per_day ?? "";
    input.required = true;
    hoursTd.appendChild(input);
  } else {
    hoursTd.textContent = item.billing_hours_per_day ?? "—";
  }
  tr.appendChild(hoursTd);

  const actionsTd = document.createElement("td");
  actionsTd.className = "row-actions";
  actionsTd.innerHTML = editing
    ? `<button type="button" class="ghost-btn btn-edit icon-btn bh-save-btn" title="Save">${icon("check")}</button>
       <button type="button" class="ghost-btn icon-btn bh-cancel-btn" title="Cancel">${icon("x")}</button>`
    : `<button type="button" class="ghost-btn btn-edit icon-btn bh-edit-btn" title="Edit">${icon("edit")}</button>
       <button type="button" class="ghost-btn btn-danger icon-btn bh-del-btn" title="Delete">${icon("trash")}</button>`;
  tr.appendChild(actionsTd);

  if (editing) {
    actionsTd.querySelector(".bh-save-btn").addEventListener("click", () => saveBillingHoursRow(item, tr, customers, locations));
    actionsTd.querySelector(".bh-cancel-btn").addEventListener("click", () => {
      if (item.id) {
        replaceBillingHoursRow(tr, buildBillingHoursRow(item, false, customers, locations));
      } else {
        loadBillingHours(); // discard the unsaved draft row and restore the normal listing
      }
    });
  } else {
    actionsTd.querySelector(".bh-edit-btn").addEventListener("click", () => {
      replaceBillingHoursRow(tr, buildBillingHoursRow(item, true, customers, locations));
    });
    actionsTd.querySelector(".bh-del-btn").addEventListener("click", async () => {
      if (confirm(`Delete the billing hours configuration for "${item.customer_name}" / "${item.location_name}"?`)) {
        const resp = await fetch(`${API}/billing-hours/${item.id}`, { method: "DELETE" });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          alert(formatApiError(err, "Failed to delete this billing hours configuration."));
          return;
        }
        loadBillingHours();
      }
    });
  }

  return tr;
}

// Preserves the row's current Sl. No when toggling edit/read-only in place,
// same reasoning as Revenue Management's replaceRevenueRow().
function replaceBillingHoursRow(oldTr, newTr) {
  const slNo = oldTr.querySelector(".bh-sl-no")?.textContent;
  oldTr.replaceWith(newTr);
  if (slNo) newTr.querySelector(".bh-sl-no").textContent = slNo;
}

async function saveBillingHoursRow(item, tr, customers, locations) {
  const saveBtn = tr.querySelector(".bh-save-btn");
  const cancelBtn = tr.querySelector(".bh-cancel-btn");
  const customerId = tr.querySelector('.inline-cell[data-field="customer_id"]').value;
  const locationId = tr.querySelector('.inline-cell[data-field="location_id"]').value;
  const hoursVal = tr.querySelector('.inline-cell[data-field="billing_hours_per_day"]').value.trim();
  if (!customerId || !locationId || !hoursVal) {
    alert("Customer, Location and Billing Hours per day are all required.");
    return;
  }
  const payload = {
    customer_id: parseInt(customerId, 10),
    location_id: parseInt(locationId, 10),
    billing_hours_per_day: parseFloat(hoursVal),
  };
  saveBtn.disabled = true;
  cancelBtn.disabled = true;
  try {
    const url = item.id ? `${API}/billing-hours/${item.id}` : `${API}/billing-hours`;
    const method = item.id ? "PUT" : "POST";
    const resp = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      alert(formatApiError(err, "Failed to save billing hours configuration."));
      return;
    }
    await loadBillingHours();
  } finally {
    saveBtn.disabled = false;
    cancelBtn.disabled = false;
  }
}

async function loadBillingHours() {
  const [items, customers, locations] = await Promise.all([
    fetch(`${API}/billing-hours`).then((r) => r.json()),
    fetch(`${API}/customers`).then((r) => r.json()),
    fetch(`${API}/locations`).then((r) => r.json()),
  ]);
  const tbody = document.getElementById("billingHoursTableBody");
  tbody.innerHTML = "";
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No billing hours configurations yet. Click "Add Billing Hours Configuration" to add one.</td></tr>';
    return;
  }
  items.forEach((item, idx) => {
    const tr = buildBillingHoursRow(item, false, customers, locations);
    tr.querySelector(".bh-sl-no").textContent = idx + 1;
    tbody.appendChild(tr);
  });
}

document.getElementById("newBillingHoursBtn").addEventListener("click", async () => {
  const tbody = document.getElementById("billingHoursTableBody");
  const existingDraft = tbody.querySelector('tr[data-draft="true"]');
  if (existingDraft) {
    existingDraft.querySelector(".inline-cell").focus();
    return;
  }
  const [customers, locations] = await Promise.all([
    fetch(`${API}/customers`).then((r) => r.json()),
    fetch(`${API}/locations`).then((r) => r.json()),
  ]);
  if (tbody.querySelector(".empty-state")) tbody.innerHTML = "";
  const draft = buildBillingHoursRow({}, true, customers, locations);
  draft.dataset.draft = "true";
  tbody.prepend(draft);
  draft.querySelector(".inline-cell").focus();
});

// ---------- Customer Configuration: Holiday Calendar ----------
// Same shape as Billing Hours Configuration - Customer/Location dropdowns,
// same toggle-in-place Edit/Save/Cancel pattern - but with a date field and
// a multiline details textarea instead of a single numeric field.
function buildHolidayRow(item, editing, customers, locations) {
  const tr = document.createElement("tr");
  if (editing) tr.classList.add("inline-editing-row");

  const slTd = document.createElement("td");
  slTd.className = "sl-no-cell hol-sl-no";
  tr.appendChild(slTd);

  const customerTd = document.createElement("td");
  if (editing) {
    const select = document.createElement("select");
    select.className = "inline-cell";
    select.dataset.field = "customer_id";
    select.required = true;
    select.innerHTML = selectOptionsHtml(customers, "id", "customer_name", "Select customer…");
    if (item.customer_id) select.value = String(item.customer_id);
    customerTd.appendChild(select);
  } else {
    customerTd.textContent = item.customer_name || "—";
  }
  tr.appendChild(customerTd);

  const locationTd = document.createElement("td");
  if (editing) {
    const select = document.createElement("select");
    select.className = "inline-cell";
    select.dataset.field = "location_id";
    select.required = true;
    select.innerHTML = selectOptionsHtml(locations, "id", "name", "Select location…");
    if (item.location_id) select.value = String(item.location_id);
    locationTd.appendChild(select);
  } else {
    locationTd.textContent = item.location_name || "—";
  }
  tr.appendChild(locationTd);

  const dateTd = document.createElement("td");
  if (editing) {
    const input = document.createElement("input");
    input.type = "date";
    input.className = "inline-cell";
    input.dataset.field = "holiday_date";
    input.value = item.holiday_date || "";
    input.required = true;
    dateTd.appendChild(input);
  } else {
    dateTd.textContent = fmtDate(item.holiday_date);
  }
  tr.appendChild(dateTd);

  const detailsTd = document.createElement("td");
  if (editing) {
    const textarea = document.createElement("textarea");
    textarea.rows = 2;
    textarea.className = "inline-cell";
    textarea.dataset.field = "holiday_details";
    textarea.value = item.holiday_details || "";
    detailsTd.appendChild(textarea);
  } else {
    detailsTd.textContent = item.holiday_details || "—";
    detailsTd.style.whiteSpace = "pre-wrap";
  }
  tr.appendChild(detailsTd);

  const actionsTd = document.createElement("td");
  actionsTd.className = "row-actions";
  actionsTd.innerHTML = editing
    ? `<button type="button" class="ghost-btn btn-edit icon-btn hol-save-btn" title="Save">${icon("check")}</button>
       <button type="button" class="ghost-btn icon-btn hol-cancel-btn" title="Cancel">${icon("x")}</button>`
    : `<button type="button" class="ghost-btn btn-edit icon-btn hol-edit-btn" title="Edit">${icon("edit")}</button>
       <button type="button" class="ghost-btn btn-danger icon-btn hol-del-btn" title="Delete">${icon("trash")}</button>`;
  tr.appendChild(actionsTd);

  if (editing) {
    actionsTd.querySelector(".hol-save-btn").addEventListener("click", () => saveHolidayRow(item, tr, customers, locations));
    actionsTd.querySelector(".hol-cancel-btn").addEventListener("click", () => {
      if (item.id) {
        replaceHolidayRow(tr, buildHolidayRow(item, false, customers, locations));
      } else {
        loadHolidays(); // discard the unsaved draft row and restore the normal listing
      }
    });
  } else {
    actionsTd.querySelector(".hol-edit-btn").addEventListener("click", () => {
      replaceHolidayRow(tr, buildHolidayRow(item, true, customers, locations));
    });
    actionsTd.querySelector(".hol-del-btn").addEventListener("click", async () => {
      if (confirm(`Delete the holiday on ${fmtDate(item.holiday_date)} for "${item.customer_name}" / "${item.location_name}"?`)) {
        const resp = await fetch(`${API}/holidays/${item.id}`, { method: "DELETE" });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          alert(formatApiError(err, "Failed to delete this holiday."));
          return;
        }
        loadHolidays();
      }
    });
  }

  return tr;
}

// Preserves the row's current Sl. No when toggling edit/read-only in
// place, same reasoning as Revenue Management's replaceRevenueRow().
function replaceHolidayRow(oldTr, newTr) {
  const slNo = oldTr.querySelector(".hol-sl-no")?.textContent;
  oldTr.replaceWith(newTr);
  if (slNo) newTr.querySelector(".hol-sl-no").textContent = slNo;
}

async function saveHolidayRow(item, tr, customers, locations) {
  const saveBtn = tr.querySelector(".hol-save-btn");
  const cancelBtn = tr.querySelector(".hol-cancel-btn");
  const customerId = tr.querySelector('.inline-cell[data-field="customer_id"]').value;
  const locationId = tr.querySelector('.inline-cell[data-field="location_id"]').value;
  const holidayDate = tr.querySelector('.inline-cell[data-field="holiday_date"]').value;
  const holidayDetails = tr.querySelector('.inline-cell[data-field="holiday_details"]').value.trim();
  if (!customerId || !locationId || !holidayDate) {
    alert("Customer, Location and Holiday Date are all required.");
    return;
  }
  const payload = {
    customer_id: parseInt(customerId, 10),
    location_id: parseInt(locationId, 10),
    holiday_date: holidayDate,
    holiday_details: holidayDetails || null,
  };
  saveBtn.disabled = true;
  cancelBtn.disabled = true;
  try {
    const url = item.id ? `${API}/holidays/${item.id}` : `${API}/holidays`;
    const method = item.id ? "PUT" : "POST";
    const resp = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      alert(formatApiError(err, "Failed to save holiday."));
      return;
    }
    await loadHolidays();
  } finally {
    saveBtn.disabled = false;
    cancelBtn.disabled = false;
  }
}

async function loadHolidays() {
  const [items, customers, locations] = await Promise.all([
    fetch(`${API}/holidays`).then((r) => r.json()),
    fetch(`${API}/customers`).then((r) => r.json()),
    fetch(`${API}/locations`).then((r) => r.json()),
  ]);
  const tbody = document.getElementById("holidayTableBody");
  tbody.innerHTML = "";
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No holidays yet. Click "Add Holiday" to add one.</td></tr>';
    return;
  }
  items.forEach((item, idx) => {
    const tr = buildHolidayRow(item, false, customers, locations);
    tr.querySelector(".hol-sl-no").textContent = idx + 1;
    tbody.appendChild(tr);
  });
}

document.getElementById("newHolidayBtn").addEventListener("click", async () => {
  const tbody = document.getElementById("holidayTableBody");
  const existingDraft = tbody.querySelector('tr[data-draft="true"]');
  if (existingDraft) {
    existingDraft.querySelector(".inline-cell").focus();
    return;
  }
  const [customers, locations] = await Promise.all([
    fetch(`${API}/customers`).then((r) => r.json()),
    fetch(`${API}/locations`).then((r) => r.json()),
  ]);
  if (tbody.querySelector(".empty-state")) tbody.innerHTML = "";
  const draft = buildHolidayRow({}, true, customers, locations);
  draft.dataset.draft = "true";
  tbody.prepend(draft);
  draft.querySelector(".inline-cell").focus();
});

// ---------- Resource Management (Management) ----------
document.getElementById("resourceSearchInput").addEventListener("input", debounce(loadResources, 250));

// Employee # whose allocation ends within the next 30 days (inclusive of
// today and 30 days out) - shown in the note pinned below the Staffing
// table. Plain ISO-string comparison rather than Date objects/timezones,
// matching fmtDate()'s approach elsewhere in this file to the same
// "YYYY-MM-DD" fields.
function updateStaffingEndingSoonCount(resources) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const in30 = new Date();
  in30.setDate(in30.getDate() + 30);
  const in30Str = in30.toISOString().slice(0, 10);
  const count = resources.filter((r) => {
    const end = (r.allocation_end_date || "").slice(0, 10);
    return end && end >= todayStr && end <= in30Str;
  }).length;
  document.getElementById("staffingEndingSoonCount").textContent = count;
}

async function loadResources() {
  const q = document.getElementById("resourceSearchInput").value.trim();
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  const resources = await fetch(`${API}/resources?${params}`).then((r) => r.json());

  updateStaffingEndingSoonCount(resources);

  const tbody = document.getElementById("resourceTableBody");
  tbody.innerHTML = "";
  if (!resources.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty-state">No resources yet. Click "New Resource" to add one.</td></tr>';
    return;
  }
  resources.forEach((r, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="sl-no-cell">${idx + 1}</td>
      <td>${escapeHtml(r.account_name) || "—"}</td>
      <td>${escapeHtml(r.project_name) || "—"}</td>
      <td>${escapeHtml(r.wbs_id) || "—"}</td>
      <td>${escapeHtml(r.employee_code) || "—"}</td>
      <td>${escapeHtml(r.employee_name)}</td>
      <td>${escapeHtml(r.location_name) || "—"}</td>
      <td>${escapeHtml(r.employee_type_name) || "—"}</td>
      <td>${escapeHtml(r.band_name) || "—"}</td>
      <td>${fmtDate(r.allocation_start_date)}</td>
      <td>${fmtDate(r.allocation_end_date)}</td>
      <td class="row-actions">
        <button class="ghost-btn btn-edit icon-btn edit-r-btn" title="Edit">${icon("edit")}</button>
        <button class="ghost-btn btn-danger icon-btn del-r-btn" title="Delete">${icon("trash")}</button>
      </td>
    `;
    tr.querySelector(".edit-r-btn").addEventListener("click", () => openResourceModal(r));
    tr.querySelector(".del-r-btn").addEventListener("click", async () => {
      if (confirm(`Delete resource "${r.employee_name}"?`)) {
        const resp = await fetch(`${API}/resources/${r.id}`, { method: "DELETE" });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          alert(formatApiError(err, "Failed to delete this resource."));
          return;
        }
        loadResources();
      }
    });
    tbody.appendChild(tr);
  });
}

const resourceModal = document.getElementById("resourceModal");
document.getElementById("newResourceBtn").addEventListener("click", () => openResourceModal());

document.getElementById("exportResourcesBtn").addEventListener("click", () => {
  const q = document.getElementById("resourceSearchInput").value.trim();
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  const qs = params.toString();
  window.location.href = `${API}/resources/export${qs ? "?" + qs : ""}`;
});
wireModalCancel(resourceModal, "cancelResourceBtn", "cancelResourceBtnTop");

async function populateResourceDropdowns() {
  const [locations, employeeTypes, bands] = await Promise.all([
    fetch(`${API}/locations`).then((r) => r.json()),
    fetch(`${API}/employee-types`).then((r) => r.json()),
    fetch(`${API}/bands`).then((r) => r.json()),
  ]);
  fillSelect("r_location", locations, "id", "name", "Select location&hellip;");
  fillSelect("r_emptype", employeeTypes, "id", "name", "Select employee type&hellip;");
  fillSelect("r_band", bands, "id", "name", "Select band&hellip;");
}

async function openResourceModal(r) {
  await populateResourceDropdowns();
  document.getElementById("resourceModalTitle").textContent = r ? "Edit Resource" : "New Resource";
  document.getElementById("r_id").value = r?.id ?? "";
  document.getElementById("r_account").value = r?.account_name ?? "";
  document.getElementById("r_project").value = r?.project_name ?? "";
  document.getElementById("r_wbs").value = r?.wbs_id ?? "";
  document.getElementById("r_empcode").value = r?.employee_code ?? "";
  document.getElementById("r_empname").value = r?.employee_name ?? "";
  document.getElementById("r_location").value = r?.location_id ?? "";
  document.getElementById("r_emptype").value = r?.employee_type_id ?? "";
  document.getElementById("r_band").value = r?.band_id ?? "";
  document.getElementById("r_start").value = r?.allocation_start_date ?? "";
  document.getElementById("r_end").value = r?.allocation_end_date ?? "";
  resourceModal.hidden = false;
}

document.getElementById("resourceForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("r_id").value;
  const locationVal = document.getElementById("r_location").value;
  const empTypeVal = document.getElementById("r_emptype").value;
  const bandVal = document.getElementById("r_band").value;
  const payload = {
    account_name: document.getElementById("r_account").value || null,
    project_name: document.getElementById("r_project").value || null,
    wbs_id: document.getElementById("r_wbs").value || null,
    employee_code: document.getElementById("r_empcode").value || null,
    employee_name: document.getElementById("r_empname").value,
    location_id: locationVal ? parseInt(locationVal, 10) : null,
    employee_type_id: empTypeVal ? parseInt(empTypeVal, 10) : null,
    band_id: bandVal ? parseInt(bandVal, 10) : null,
    allocation_start_date: document.getElementById("r_start").value || null,
    allocation_end_date: document.getElementById("r_end").value || null,
  };
  const url = id ? `${API}/resources/${id}` : `${API}/resources`;
  const method = id ? "PUT" : "POST";
  const resp = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    alert(formatApiError(err, "Failed to save resource."));
    return;
  }
  resourceModal.hidden = true;
  loadResources();
});

// ---------- Dashboard (landing page) ----------
// Pulls a quick summary from each of the underlying screens' own endpoints
// rather than maintaining a separate aggregate endpoint - the Dashboard is
// just a read-only overview, so a few parallel fetches on tab-open is fine.

// Customer filter (top right of the Dashboard heading) - "" means "All".
// Every widget on the page is re-derived from data scoped to this customer.
let dashboardCustomerFilter = "";
document.getElementById("dashboardCustomerFilter").addEventListener("change", (e) => {
  dashboardCustomerFilter = e.target.value;
  loadHome();
});

// Rebuilds the filter's <option> list from the current customers, keeping
// whatever is currently selected (customers are re-fetched on every
// loadHome(), so this runs each time rather than once at page load).
function populateDashboardCustomerFilter(customers) {
  const select = document.getElementById("dashboardCustomerFilter");
  const current = select.value;
  select.innerHTML = '<option value="">All</option>' +
    customers.map((c) => `<option value="${c.id}">${escapeHtml(c.customer_name)}</option>`).join("");
  select.value = current;
}

// Fiscal-month labels for chart x-axes (Apr..Mar) - a JS-side copy of the
// same convention main.py's FISCAL_MONTH_LABELS uses.
const FY_MONTH_LABELS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

const CHART_COLORS = {
  indigo: "#0284c7", emerald: "#10b981", amber: "#f59e0b", red: "#ef4444",
  orange: "#ea580c", cyan: "#0891b2", pink: "#db2777", slate: "#64748b",
};

// Chart.js instances, kept so loadHome() can destroy+recreate them each time
// the Dashboard tab is opened (Chart.js throws if a canvas already has a
// live chart bound to it).
const homeCharts = { revenueTrend: null, resourceLocation: null };

function destroyHomeCharts() {
  Object.keys(homeCharts).forEach((k) => {
    if (homeCharts[k]) { homeCharts[k].destroy(); homeCharts[k] = null; }
  });
}

// Sums every account's per-month projection/invoiced figures into two
// 12-slot (Apr..Mar) totals, shared by the revenue trend chart and the
// variance table below it so both read off the same numbers.
function aggregateMonthlyRevenue(accounts) {
  const projections = new Array(12).fill(0);
  const invoiced = new Array(12).fill(0);
  accounts.forEach((acc) => {
    acc.months.forEach((m, i) => {
      projections[i] += m.projection || 0;
      invoiced[i] += m.invoiced || 0;
    });
  });
  return { projections, invoiced };
}

// $ value in thousands, e.g. 50000 -> "$50K", 2500 -> "$2.5K" - used for the
// revenue trend chart's per-point data labels, where the full "$50,000.00"
// fmt() produces would be far too wide to sit next to a chart point.
function fmtK(n) {
  return "$" + (Number(n || 0) / 1000).toFixed(1).replace(/\.0$/, "") + "K";
}

// Draws each line point's value (in $K) just above (Projections) or below
// (Invoiced) the point, in that dataset's own color, so the two series'
// labels don't collide. Zero-value points are skipped - most fiscal years
// are only partly filled in, and labeling every empty month as "$0K" would
// clutter the chart for no information gained.
const lineLabelPlugin = {
  id: "lineLabels",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    chart.data.datasets.forEach((dataset, dsIndex) => {
      const meta = chart.getDatasetMeta(dsIndex);
      if (meta.hidden) return;
      meta.data.forEach((point, i) => {
        const value = dataset.data[i];
        if (!value) return;
        const pos = point.getProps(["x", "y"], true);
        ctx.save();
        ctx.font = "bold 10px Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = dataset.borderColor;
        if (dsIndex === 0) {
          ctx.textBaseline = "bottom";
          ctx.fillText(fmtK(value), pos.x, pos.y - 6);
        } else {
          ctx.textBaseline = "top";
          ctx.fillText(fmtK(value), pos.x, pos.y + 6);
        }
        ctx.restore();
      });
    });
  },
};

// canvasId is a parameter (rather than hardcoded) so this same renderer
// serves both the Dashboard's chart and Revenue Management's own copy of
// it - two separate <canvas> elements, since a Chart.js instance is tied
// to one canvas and both tabs can be visited independently.
// Saffron accent for this chart's legend text in dark mode - the default
// Chart.js legend color is a mid-gray tuned for a light background, which
// reads as too low-contrast against the dark card. Chart.js renders its
// legend on <canvas> rather than as styled DOM text, so this can't be a
// plain CSS rule - the color has to be picked at chart-construction time
// based on the current theme instead.
const SAFFRON = "#F4C430";

function renderRevenueTrendChart(canvasId, projections, invoiced) {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const legendLabels = { boxWidth: 10, font: { size: 11 } };
  if (isDark) legendLabels.color = SAFFRON;
  return new Chart(document.getElementById(canvasId), {
    type: "line",
    data: {
      labels: FY_MONTH_LABELS,
      datasets: [
        { label: "Projections", data: projections, borderColor: CHART_COLORS.amber, backgroundColor: CHART_COLORS.amber, tension: 0.3, pointRadius: 3, fill: false },
        { label: "Invoiced", data: invoiced, borderColor: CHART_COLORS.indigo, backgroundColor: CHART_COLORS.indigo, tension: 0.3, pointRadius: 3, fill: false },
      ],
    },
    options: {
      // This card spans the full page width on its own row, so a fixed
      // aspect ratio would make it very tall; maintainAspectRatio:false
      // instead lets it fill its wrapper's explicit (short) CSS height.
      responsive: true, maintainAspectRatio: false,
      // Extra padding on every side so the Projections/Invoiced data labels
      // (drawn just outside each point) don't get clipped by the canvas
      // edge - most noticeable on Apr/Mar, the first/last points.
      layout: { padding: { top: 16, bottom: 8, left: 20, right: 20 } },
      scales: { y: { beginAtZero: true } },
      plugins: { legend: { position: "bottom", labels: legendLabels } },
    },
    plugins: [lineLabelPlugin],
  });
}

// Formats a signed dollar amount as "$1,234.56" / "-$1,234.56" - fmt()'s
// plain Number().toLocaleString() would instead print "$-1,234.56" for a
// negative value, putting the minus sign after the "$".
function fmtVariance(n) {
  const v = Number(n || 0);
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Invoiced-minus-Projected for the fiscal year, right next to the chart
// plotting the same two series. Laid out horizontally - one row per metric
// (Projected / Invoiced / Variance), one column per month - rather than a
// row per month, so all 12 months read left-to-right at a glance instead of
// scrolling down a long list. The header row (Apr..Mar) is static markup in
// index.html; this only ever fills in the three body rows.
function renderRevenueVarianceTable(tbodyId, projections, invoiced) {
  const tbody = document.getElementById(tbodyId);
  const varianceCells = projections.map((_, i) => {
    const variance = (invoiced[i] || 0) - (projections[i] || 0);
    const cls = variance > 0 ? "variance-positive" : variance < 0 ? "variance-negative" : "";
    return `<td class="${cls}">${fmtVariance(variance)}</td>`;
  }).join("");
  const variancePctCells = projections.map((_, i) => {
    const projected = projections[i] || 0;
    const variance = (invoiced[i] || 0) - projected;
    const pct = projected ? Math.round((variance / projected) * 1000) / 10 : 0;
    const cls = pct > 0 ? "variance-positive" : pct < 0 ? "variance-negative" : "";
    return `<td class="${cls}">${pct}%</td>`;
  }).join("");
  tbody.innerHTML = `
    <tr><td>Projected</td>${projections.map((v) => `<td>${fmt(v)}</td>`).join("")}</tr>
    <tr><td>Invoiced</td>${invoiced.map((v) => `<td>${fmt(v)}</td>`).join("")}</tr>
    <tr><td>Variance</td>${varianceCells}</tr>
    <tr><td>Variance (%)</td>${variancePctCells}</tr>
  `;
}

// Draws a "<count> (<pct>%)" label centered on each pie/doughnut slice.
// Chart.js has no built-in data-label support, and pulling in the
// chartjs-plugin-datalabels package would mean vendoring another external
// file for one small feature, so this is a small inline plugin instead -
// it only needs each arc's own center point and share of the dataset total.
const sliceLabelPlugin = {
  id: "sliceLabels",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    chart.data.datasets.forEach((dataset, dsIndex) => {
      const meta = chart.getDatasetMeta(dsIndex);
      if (meta.hidden) return;
      const total = dataset.data.reduce((sum, v) => sum + (v || 0), 0);
      meta.data.forEach((arc, i) => {
        const value = dataset.data[i];
        if (!value) return;
        const pct = total ? Math.round((value / total) * 1000) / 10 : 0;
        const pos = arc.getCenterPoint();
        const label = `${value} (${pct}%)`;
        ctx.save();
        ctx.font = "bold 11px Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,.55)";
        ctx.strokeText(label, pos.x, pos.y);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, pos.x, pos.y);
        ctx.restore();
      });
    });
  },
};

// Resources by Location - a pie chart over every resource's location
// (locations without any resources simply don't appear as a slice), with
// each slice labeled with its count and share of the total.
function renderResourceLocationChart(resources) {
  document.getElementById("homeLocationCount").textContent = resources.length;
  const counts = {};
  resources.forEach((r) => {
    const key = r.location_name || "Unspecified";
    counts[key] = (counts[key] || 0) + 1;
  });
  const labels = Object.keys(counts);
  if (!labels.length) return;
  const palette = Object.values(CHART_COLORS);
  homeCharts.resourceLocation = new Chart(document.getElementById("chartResourceLocation"), {
    type: "pie",
    data: {
      labels,
      datasets: [{ data: labels.map((l) => counts[l]), backgroundColor: labels.map((_, i) => palette[i % palette.length]), borderWidth: 0 }],
    },
    options: {
      // A shorter aspect ratio than the other dashboard charts - this card
      // now shares its row with two tables, so it's sized down to match.
      responsive: true, aspectRatio: 2.4,
      plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } } },
    },
    plugins: [sliceLabelPlugin],
  });
}

// Resources by Band - every configured band (Configuration > Band), even
// ones with no resources yet, listed in ascending order with a numeric-aware
// compare so "Band 10" sorts after "Band 2" rather than before it.
function renderBandTable(resources, bands) {
  const tbody = document.getElementById("homeBandTableBody");
  document.getElementById("homeBandCount").textContent = resources.length;
  const counts = {};
  resources.forEach((r) => {
    const key = r.band_name || "Unspecified";
    counts[key] = (counts[key] || 0) + 1;
  });
  const names = bands.map((b) => b.name);
  Object.keys(counts).forEach((k) => { if (!names.includes(k)) names.push(k); });
  names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!names.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-state">No bands yet.</td></tr>';
    return;
  }
  const total = resources.length;
  tbody.innerHTML = names.map((name) => {
    const count = counts[name] || 0;
    return `<tr><td>${escapeHtml(name)}</td><td>${count}</td><td>${pctOf(count, total)}%</td></tr>`;
  }).join("");
}

// Resources by Type - every configured employee type (Configuration >
// Employee Type), even ones with no resources yet, same pattern as the
// Band table right next to it.
function renderResourceTypeTable(resources, employeeTypes) {
  const tbody = document.getElementById("homeResourceTypeTableBody");
  document.getElementById("homeResourceTypeCount").textContent = resources.length;
  const counts = {};
  resources.forEach((r) => {
    const key = r.employee_type_name || "Unspecified";
    counts[key] = (counts[key] || 0) + 1;
  });
  const names = employeeTypes.map((t) => t.name);
  Object.keys(counts).forEach((k) => { if (!names.includes(k)) names.push(k); });
  names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!names.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-state">No employee types yet.</td></tr>';
    return;
  }
  const total = resources.length;
  tbody.innerHTML = names.map((name) => {
    const count = counts[name] || 0;
    return `<tr><td>${escapeHtml(name)}</td><td>${count}</td><td>${pctOf(count, total)}%</td></tr>`;
  }).join("");
}

// Billing Models vs. count of currently Active SOWs using each - every
// configured billing model is listed (even with 0 active SOWs), ascending.
function renderBillingModelTable(sows, billingModels) {
  const tbody = document.getElementById("homeBillingModelTableBody");
  const activeCounts = {};
  let totalActive = 0;
  sows.forEach((s) => {
    if ((s.status || "").toLowerCase() !== "active") return;
    const key = s.billing_model_name || "Unspecified";
    activeCounts[key] = (activeCounts[key] || 0) + 1;
    totalActive += 1;
  });
  document.getElementById("homeBillingModelCount").textContent = totalActive;
  const names = billingModels.map((b) => b.name);
  Object.keys(activeCounts).forEach((k) => { if (!names.includes(k)) names.push(k); });
  names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!names.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-state">No billing models yet.</td></tr>';
    return;
  }
  tbody.innerHTML = names.map((name) => {
    const count = activeCounts[name] || 0;
    return `<tr><td>${escapeHtml(name)}</td><td>${count}</td><td>${pctOf(count, totalActive)}%</td></tr>`;
  }).join("");
}

// SOW Status breakdown - one row per configured status (Configuration > SOW
// Status), even ones with zero SOWs currently, grouped into a single table
// alongside the Billing Models / Expiring cards rather than as separate
// stat tiles. Matched against dashboard.status_counts case-insensitively
// since SOW Status is free-text, user-editable master data.
function renderSowStatusTable(statuses, statusCounts) {
  const tbody = document.getElementById("homeSowStatusTableBody");
  const names = (statuses || []).map((s) => s.name);
  if (!names.length) {
    document.getElementById("homeSowStatusCount").textContent = 0;
    tbody.innerHTML = '<tr><td colspan="3" class="empty-state">No statuses yet.</td></tr>';
    return;
  }
  const counts = {};
  names.forEach((name) => { counts[name] = countStatusCI(statusCounts, name); });
  const total = Object.values(counts).reduce((sum, c) => sum + c, 0);
  document.getElementById("homeSowStatusCount").textContent = total;
  tbody.innerHTML = names.map((name) => {
    const count = counts[name];
    return `<tr><td>${escapeHtml(name)}</td><td>${count}</td><td>${pctOf(count, total)}%</td></tr>`;
  }).join("");
}

// SOWs expiring within 30 days - Account Name / SOW Name / days remaining,
// soonest first. Same underlying data as the SOWs page's "Expiring in 30
// days" card (GET /api/dashboard), just shown as a table here.
function renderExpiringTable(items) {
  const tbody = document.getElementById("homeExpiringTableBody");
  document.getElementById("homeExpiringCount").textContent = items.length;
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-state">Nothing expiring in the next 30 days.</td></tr>';
    return;
  }
  const sorted = [...items].sort((a, b) => a.days_to_end - b.days_to_end);
  tbody.innerHTML = sorted.map((s) => `
    <tr>
      <td>${escapeHtml(s.customer_name) || "—"}</td>
      <td>${escapeHtml(s.title)}</td>
      <td>${s.days_to_end}d</td>
    </tr>
  `).join("");
}

async function loadHome() {
  const fy = currentFiscalYear === null ? fiscalYearForToday() : currentFiscalYear;

  // SOWs are filtered server-side (customer_id is a real column on sows),
  // which also gives us per-status counts and the "expiring in 30 days"
  // list for free via each sow's own status/alerts fields - no separate
  // /api/dashboard call needed. Resources have no customer_id column (they
  // link to a customer by matching account_name text instead), so those are
  // fetched in full and filtered client-side below.
  const sowsUrl = dashboardCustomerFilter ? `${API}/sows?customer_id=${dashboardCustomerFilter}` : `${API}/sows`;
  const [customers, resources, revenue, sows, bands, billingModels, statuses, employeeTypes] = await Promise.all([
    fetch(`${API}/customers`).then((r) => r.json()),
    fetch(`${API}/resources`).then((r) => r.json()),
    fetch(`${API}/revenue/summary?fiscal_year=${fy}`).then((r) => r.json()),
    fetch(sowsUrl).then((r) => r.json()),
    fetch(`${API}/bands`).then((r) => r.json()),
    fetch(`${API}/billing-models`).then((r) => r.json()),
    fetch(`${API}/statuses`).then((r) => r.json()),
    fetch(`${API}/employee-types`).then((r) => r.json()),
  ]);

  populateDashboardCustomerFilter(customers);

  const selectedCustomer = dashboardCustomerFilter
    ? customers.find((c) => String(c.id) === dashboardCustomerFilter)
    : null;
  const filteredResources = selectedCustomer
    ? resources.filter((r) => (r.account_name || "") === selectedCustomer.customer_name)
    : resources;
  const filteredAccounts = dashboardCustomerFilter
    ? (revenue.accounts || []).filter((a) => String(a.customer_id) === dashboardCustomerFilter)
    : (revenue.accounts || []);

  const statusCounts = {};
  sows.forEach((s) => { statusCounts[s.status] = (statusCounts[s.status] || 0) + 1; });
  renderSowStatusTable(statuses, statusCounts);

  // Circle KPI tiles at the top - Total Customers is 1 when a specific
  // customer is selected (consistent with every other widget respecting the
  // filter), otherwise the full customer count. TCV sums total_value across
  // the (possibly filtered) sows list, same scope as the other three tiles.
  document.getElementById("dashCircleCustomers").textContent = selectedCustomer ? 1 : customers.length;
  document.getElementById("dashCircleActiveSows").textContent = countStatusCI(statusCounts, "active");
  document.getElementById("dashCircleResources").textContent = filteredResources.length;
  const totalTcv = sows.reduce((sum, s) => sum + (s.total_value || 0), 0);
  const dashCircleTcvEl = document.getElementById("dashCircleTcv");
  dashCircleTcvEl.textContent = fmtCompact(totalTcv);
  dashCircleTcvEl.title = fmt(totalTcv);
  // SoWs expiring in 30 days - same scope as the Expiring in 30 Days list
  // card below (respects the customer filter, since `sows` is already
  // fetched pre-filtered).
  document.getElementById("dashCircleExpiring").textContent =
    sows.filter((s) => (s.alerts || []).includes("expiring_soon")).length;

  destroyHomeCharts();
  renderResourceLocationChart(filteredResources);

  renderBandTable(filteredResources, bands);
  renderResourceTypeTable(filteredResources, employeeTypes);
  renderBillingModelTable(sows, billingModels);
  renderExpiringTable(sows.filter((s) => (s.alerts || []).includes("expiring_soon")));

  const { projections, invoiced } = aggregateMonthlyRevenue(filteredAccounts);
  homeCharts.revenueTrend = renderRevenueTrendChart("chartRevenueTrend", projections, invoiced);
  renderRevenueVarianceTable("homeRevenueVarianceTableBody", projections, invoiced);

  // Projections/Invoiced circle tiles - fiscal-year totals for the same
  // (possibly customer-filtered) accounts feeding the chart/variance table
  // right above, so all three always agree with each other.
  const totalProjections = projections.reduce((sum, v) => sum + (v || 0), 0);
  const totalInvoiced = invoiced.reduce((sum, v) => sum + (v || 0), 0);
  const dashCircleProjectionsEl = document.getElementById("dashCircleProjections");
  dashCircleProjectionsEl.textContent = fmtCompact(totalProjections);
  dashCircleProjectionsEl.title = fmt(totalProjections);
  const dashCircleInvoicedEl = document.getElementById("dashCircleInvoiced");
  dashCircleInvoicedEl.textContent = fmtCompact(totalInvoiced);
  dashCircleInvoicedEl.title = fmt(totalInvoiced);
}

// ---------- Revenue Management (Management) ----------
// Fiscal year runs Apr-Mar. currentFiscalYear holds the starting calendar
// year (e.g. 2026 = Apr 2026 - Mar 2027) and is initialized lazily to
// "whichever FY today falls in" the first time this tab is opened.
let currentFiscalYear = null;

function fiscalYearForToday() {
  const today = new Date();
  const month = today.getMonth() + 1; // JS getMonth() is 0-based
  return month >= 4 ? today.getFullYear() : today.getFullYear() - 1;
}

function fyLabelText(fy) {
  return `FY${fy} (Apr ${fy} – Mar ${fy + 1})`;
}

// SOW ids already tracked on the currently-loaded fiscal year's SoW-level
// grid - used to keep the inline "Add Entry" row from offering a SOW twice.
let revenueTrackedSowIds = new Set();
// Last-loaded data for each tracked SOW row (by sow_id), so clicking
// "Cancel" while editing a row can revert it to its saved values without a
// network round trip.
let revenueSowsCache = new Map();

// Customer / Billing Model filters at the top of Revenue Management - ""
// means "All". Both narrow the SoW-level grid below *and* the Monthly
// Projected vs Invoiced chart/variance table above it, since all three are
// built from the same fetched rows (see loadRevenueSows()).
let revenueCustomerFilter = "";
let revenueBillingModelFilter = "";
document.getElementById("revenueCustomerFilter").addEventListener("change", (e) => {
  revenueCustomerFilter = e.target.value;
  loadRevenueSows();
});
document.getElementById("revenueBillingModelFilter").addEventListener("change", (e) => {
  revenueBillingModelFilter = e.target.value;
  loadRevenueSows();
});

// Financial nav presets (Projections/Actuals) narrow the 24 month columns
// down to just the Projections or just the Invoiced half of each month
// instead of showing both side by side - see the view-mode-* CSS in
// style.css, which hides the half not wanted via the rev-col-proj/rev-col-inv
// classes every month cell already carries. Colspan on the month group
// header can't be done in CSS, so it's kept in sync here instead.
let revenueViewMode = "both";
function setRevenueViewMode(mode) {
  revenueViewMode = mode;
  const panel = document.getElementById("tab-revenue");
  panel.classList.remove("view-mode-both", "view-mode-projections", "view-mode-actuals");
  panel.classList.add("view-mode-" + mode);
  document.querySelectorAll(".rev-month-hdr").forEach((th) => {
    th.colSpan = mode === "both" ? 2 : 1;
  });
  const subtitle = document.getElementById("revenueSectionSubtitle");
  if (subtitle) {
    subtitle.textContent = mode === "both"
      ? "Add, edit or delete monthly projections and invoiced amounts per SOW"
      : `Showing ${mode === "projections" ? "Projections" : "Actuals (Invoiced)"} only` +
        (revenueBillingModelFilter ? ` · ${revenueBillingModelFilter}` : "");
  }
}

function populateRevenueCustomerFilter(customers) {
  const select = document.getElementById("revenueCustomerFilter");
  const current = select.value;
  select.innerHTML = '<option value="">All customers</option>' +
    customers.map((c) => `<option value="${c.id}">${escapeHtml(c.customer_name)}</option>`).join("");
  select.value = current;
}

function populateRevenueBillingModelFilter(models) {
  const select = document.getElementById("revenueBillingModelFilter");
  // Read from the revenueBillingModelFilter variable rather than select.value:
  // a Financial submenu preset (see applyRevenueMenuPreset()) sets that
  // variable before this function's caller (loadRevenueTab) ever runs, at a
  // point where the <select> may still only hold its default "All billing
  // models" option - assigning a not-yet-present value to select.value is a
  // silent no-op, so reading it back here would lose the preset. The
  // variable is always kept in sync with the select's own change handler
  // too, so it's the reliable source either way.
  const current = revenueBillingModelFilter;
  select.innerHTML = '<option value="">All billing models</option>' +
    models.map((m) => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}</option>`).join("");
  select.value = current;
}

async function loadRevenueTab() {
  if (currentFiscalYear === null) currentFiscalYear = fiscalYearForToday();
  const [customers, billingModels] = await Promise.all([
    fetch(`${API}/customers`).then((r) => r.json()),
    fetch(`${API}/billing-models`).then((r) => r.json()),
  ]);
  populateRevenueCustomerFilter(customers);
  populateRevenueBillingModelFilter(billingModels);
  await loadRevenueSows();
}

// Revenue Summary (SoW Level). Rows display read-only by default; clicking
// "Edit" on a row reveals input boxes for its 12 months, and "Save" commits
// them and reverts the row back to read-only display.
async function loadRevenueSows() {
  const data = await fetch(`${API}/revenue/sows?fiscal_year=${currentFiscalYear}`).then((r) => r.json());
  revenueTrackedSowIds = new Set(data.rows.map((r) => r.sow_id));
  revenueSowsCache = new Map(data.rows.map((r) => [r.sow_id, r]));

  const filteredRows = data.rows.filter((r) =>
    (!revenueCustomerFilter || String(r.customer_id) === revenueCustomerFilter) &&
    (!revenueBillingModelFilter || (r.billing_model_name || "") === revenueBillingModelFilter)
  );

  const tbody = document.getElementById("revenueSowsTableBody");
  tbody.innerHTML = "";
  if (!filteredRows.length) {
    tbody.innerHTML = `<tr><td colspan="29" class="empty-state">${
      data.rows.length ? "No entries match the selected filters." : 'No entries yet. Click "Add Entry" to start tracking revenue for a SOW.'
    }</td></tr>`;
  } else {
    filteredRows.forEach((r) => tbody.appendChild(buildRevenueSowRow(r, false)));
    const totals = aggregateMonthlyRevenue(filteredRows);
    tbody.appendChild(buildRevenueTotalsRow(totals));
    renumberRevenueRows();
  }
}

// Fills in the leading "Sl. No" cell of every data row (skipping the Total
// row and any in-progress "Add Entry" draft row) based on current DOM
// order. Re-run after anything that changes the row set or order - a full
// reload (loadRevenueSows()) or splicing in a newly-saved entry - rather
// than baking a fixed number into each row, since edit/cancel toggle a row
// in place (see buildRevenueSowRow()) without knowing its position.
function renumberRevenueRows() {
  const tbody = document.getElementById("revenueSowsTableBody");
  let n = 0;
  tbody.querySelectorAll("tr").forEach((tr) => {
    if (tr.classList.contains("revenue-total-row") || tr.classList.contains("revenue-draft-row")) return;
    const cell = tr.querySelector(".rev-sl-no");
    if (cell) {
      n += 1;
      cell.textContent = n;
    }
  });
}

// Bottom "Total" row summing Projections and Invoiced per month across all
// currently visible (filtered) rows. Rebuilt every time loadRevenueSows()
// runs, so it always reflects the active Customer/Billing Model filters.
function buildRevenueTotalsRow(totals) {
  const tr = document.createElement("tr");
  tr.className = "revenue-total-row";
  // Blank Actions cell, blank Sl. No cell, then "Total" spanning
  // Customer Name/SOW Title/Billing Model.
  let cells = `<td></td><td></td><td colspan="3">Total</td>`;
  for (let i = 0; i < 12; i++) {
    const band = i % 2 === 0 ? "rev-band-a" : "rev-band-b";
    cells += `
      <td class="rev-readonly-cell ${band} rev-col-proj">${fmtPlain(totals.projections[i])}</td>
      <td class="rev-readonly-cell ${band} rev-col-inv">${fmtPlain(totals.invoiced[i])}</td>
    `;
  }
  tr.innerHTML = cells;
  return tr;
}

// Swaps a row for a rebuilt version of itself (used when toggling a row
// between read-only and editing) while preserving its already-assigned
// Sl. No, since the rebuilt row starts with that cell blank (see
// buildRevenueSowRow()) and the row's position/count isn't changing here so
// a full renumberRevenueRows() pass isn't needed.
function replaceRevenueRow(oldTr, newTr) {
  const oldCell = oldTr.querySelector(".rev-sl-no");
  const newCell = newTr.querySelector(".rev-sl-no");
  if (oldCell && newCell) newCell.textContent = oldCell.textContent;
  oldTr.replaceWith(newTr);
}

// Builds one <tr> for the SoW-level grid. editing=false renders plain
// read-only month text with Edit/Delete actions; editing=true renders
// number inputs for the 12 months with Save/Cancel actions.
function buildRevenueSowRow(r, editing) {
  const tr = document.createElement("tr");
  if (editing) tr.classList.add("revenue-editing-row");
  // Actions come first (matches the SOW list table's convention), then
  // Sl. No - left blank here and filled in by renumberRevenueRows() based
  // on the row's actual position in the table, since this function rebuilds
  // a single row in place for edit/cancel toggling without knowing its index.
  let cells = editing
    ? `<td class="row-actions">
        <button type="button" class="ghost-btn btn-edit icon-btn rev-save-btn" title="Save">${icon("check")}</button>
        <button type="button" class="ghost-btn icon-btn rev-cancel-btn" title="Cancel">${icon("x")}</button>
      </td>`
    : `<td class="row-actions">
        <button type="button" class="ghost-btn btn-edit icon-btn rev-edit-btn" title="Edit">${icon("edit")}</button>
        <button type="button" class="ghost-btn btn-danger icon-btn rev-del-btn" title="Delete">${icon("trash")}</button>
      </td>`;
  cells += `<td class="rev-sl-no"></td><td>${escapeHtml(r.customer_name)}</td><td>${escapeHtml(r.sow_title)}</td><td>${escapeHtml(r.billing_model_name) || "—"}</td>`;
  // Alternating background per month (both its Projections and Invoiced
  // columns share the same band) so adjacent months are visually grouped
  // and easy to tell apart across 24 otherwise-identical columns - matches
  // the same rev-band-a/rev-band-b classes on the header cells.
  r.months.forEach((m, i) => {
    const band = i % 2 === 0 ? "rev-band-a" : "rev-band-b";
    if (editing) {
      cells += `
        <td class="${band} rev-col-proj"><input type="number" step="0.01" class="rev-cell" data-fiscal-month="${m.fiscal_month}" data-field="projection" value="${m.projection}" /></td>
        <td class="${band} rev-col-inv"><input type="number" step="0.01" class="rev-cell" data-fiscal-month="${m.fiscal_month}" data-field="invoiced" value="${m.invoiced}" /></td>
      `;
    } else {
      cells += `
        <td class="rev-readonly-cell ${band} rev-col-proj">${fmtPlain(m.projection)}</td>
        <td class="rev-readonly-cell ${band} rev-col-inv">${fmtPlain(m.invoiced)}</td>
      `;
    }
  });
  tr.innerHTML = cells;

  if (editing) {
    tr.querySelector(".rev-save-btn").addEventListener("click", () => saveRevenueRow(r.sow_id, tr));
    tr.querySelector(".rev-cancel-btn").addEventListener("click", () => {
      const cached = revenueSowsCache.get(r.sow_id) || r;
      replaceRevenueRow(tr, buildRevenueSowRow(cached, false));
    });
  } else {
    tr.querySelector(".rev-edit-btn").addEventListener("click", () => {
      replaceRevenueRow(tr, buildRevenueSowRow(r, true));
    });
    tr.querySelector(".rev-del-btn").addEventListener("click", async () => {
      if (confirm(`Remove "${r.sow_title}" (${r.customer_name}) from Revenue Management for ${fyLabelText(currentFiscalYear)}? This deletes all of its months for this fiscal year.`)) {
        const resp = await fetch(`${API}/revenue/sows/${r.sow_id}/${currentFiscalYear}`, { method: "DELETE" });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          alert(formatApiError(err, "Failed to remove this SOW from Revenue Management."));
          return;
        }
        loadRevenueTab();
      }
    });
  }

  return tr;
}

// Collects the 12 months' input values from an editing row and PUTs each
// one (there's no bulk-upsert endpoint), then reloads the grid so the row
// reverts to read-only display showing the saved values.
async function saveRevenueRow(sowId, tr) {
  const saveBtn = tr.querySelector(".rev-save-btn");
  const cancelBtn = tr.querySelector(".rev-cancel-btn");
  saveBtn.disabled = true;
  cancelBtn.disabled = true;
  const projectionInputs = tr.querySelectorAll('.rev-cell[data-field="projection"]');
  const payloads = Array.from(projectionInputs).map((projectionInput) => {
    const fiscalMonth = parseInt(projectionInput.dataset.fiscalMonth, 10);
    const invoicedInput = tr.querySelector(`.rev-cell[data-fiscal-month="${fiscalMonth}"][data-field="invoiced"]`);
    return {
      sow_id: sowId,
      fiscal_year: currentFiscalYear,
      fiscal_month: fiscalMonth,
      projection: parseFloat(projectionInput.value) || 0,
      invoiced: parseFloat(invoicedInput.value) || 0,
    };
  });
  try {
    const responses = await Promise.all(payloads.map((payload) =>
      fetch(`${API}/revenue/sows`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
    ));
    const failed = responses.find((resp) => !resp.ok);
    if (failed) {
      const err = await failed.json().catch(() => ({}));
      alert(formatApiError(err, "Failed to save one or more months for this row."));
      return;
    }
    await loadRevenueSows();
  } finally {
    saveBtn.disabled = false;
    cancelBtn.disabled = false;
  }
}

document.getElementById("exportRevenueSowsBtn").addEventListener("click", () => {
  if (currentFiscalYear === null) currentFiscalYear = fiscalYearForToday();
  window.location.href = `${API}/revenue/sows/export?fiscal_year=${currentFiscalYear}`;
});

// Builds the 24 month <td>s (Projections+Invoiced x 12) for the "Add Entry"
// draft row - read-only "—" placeholders before a SOW is picked, real number
// inputs once one is (see setDraftMonthsEditable() below). Mirrors the same
// fiscal-month/band pattern buildRevenueSowRow() uses for a tracked row, but
// starting from blank/zero values since nothing has been saved yet.
function draftMonthCellsHtml(editable) {
  let html = "";
  for (let fm = 1; fm <= 12; fm++) {
    const band = (fm - 1) % 2 === 0 ? "rev-band-a" : "rev-band-b";
    html += editable
      ? `
        <td class="${band} draft-month-cell rev-col-proj">
          <input type="number" step="0.01" class="rev-cell draft-projection-input" data-fiscal-month="${fm}" data-field="projection" value="0" />
        </td>
        <td class="${band} draft-month-cell rev-col-inv">
          <input type="number" step="0.01" class="rev-cell draft-invoiced-input" data-fiscal-month="${fm}" data-field="invoiced" value="0" />
        </td>
      `
      : `
        <td class="rev-readonly-cell ${band} draft-month-cell rev-col-proj">—</td>
        <td class="rev-readonly-cell ${band} draft-month-cell rev-col-inv">—</td>
      `;
  }
  return html;
}

// Add Entry - adds a new row directly in the datatable (no popup): a
// Customer dropdown narrows a SOW dropdown to that customer's SOWs. The
// month columns start out read-only ("—") and switch to editable inputs as
// soon as a SOW is chosen, so Save commits everything typed in in one shot
// instead of a separate "register, then edit, then save again" round trip.
document.getElementById("newRevenueEntryBtn").addEventListener("click", async () => {
  if (currentFiscalYear === null) currentFiscalYear = fiscalYearForToday();

  const existingDraft = document.querySelector(".revenue-draft-row");
  if (existingDraft) existingDraft.remove();

  const [customers, sows] = await Promise.all([
    fetch(`${API}/customers`).then((r) => r.json()),
    fetch(`${API}/sows`).then((r) => r.json()),
  ]);

  const tbody = document.getElementById("revenueSowsTableBody");
  const emptyRow = tbody.querySelector(".empty-state");
  if (emptyRow) emptyRow.closest("tr").remove();

  const tr = document.createElement("tr");
  tr.className = "revenue-draft-row";
  tr.innerHTML = `
    <td class="row-actions">
      <button type="button" class="ghost-btn btn-edit icon-btn draft-save-btn" disabled title="Save">${icon("check")}</button>
      <button type="button" class="ghost-btn icon-btn draft-cancel-btn" title="Cancel">${icon("x")}</button>
    </td>
    <td></td>
    <td>
      <select class="draft-account-select">
        <option value="">Select customer&hellip;</option>
        ${customers.map((c) => `<option value="${c.id}">${escapeHtml(c.customer_name)}</option>`).join("")}
      </select>
    </td>
    <td>
      <select class="draft-sow-select" disabled>
        <option value="">Select customer first&hellip;</option>
      </select>
    </td>
    <td class="draft-billing-model">&mdash;</td>
    ${draftMonthCellsHtml(false)}
  `;
  tbody.insertBefore(tr, tbody.firstChild);

  const accountSelect = tr.querySelector(".draft-account-select");
  const sowSelect = tr.querySelector(".draft-sow-select");
  const billingModelCell = tr.querySelector(".draft-billing-model");
  const saveBtn = tr.querySelector(".draft-save-btn");

  function setDraftMonthsEditable(editable) {
    tr.querySelectorAll(".draft-month-cell").forEach((td) => td.remove());
    billingModelCell.insertAdjacentHTML("afterend", draftMonthCellsHtml(editable));
  }

  accountSelect.addEventListener("change", () => {
    const val = accountSelect.value;
    saveBtn.disabled = true;
    billingModelCell.textContent = "—";
    setDraftMonthsEditable(false);
    if (!val) {
      sowSelect.disabled = true;
      sowSelect.innerHTML = '<option value="">Select customer first&hellip;</option>';
      return;
    }
    const matching = sows.filter((s) => {
      return s.customer_id === parseInt(val, 10) && !revenueTrackedSowIds.has(s.id);
    });
    sowSelect.disabled = false;
    if (!matching.length) {
      sowSelect.innerHTML = '<option value="">No available SOWs for this customer</option>';
    } else {
      sowSelect.innerHTML = '<option value="">Select SOW&hellip;</option>' +
        matching.map((s) => `<option value="${s.id}">${escapeHtml(s.title)}</option>`).join("");
    }
  });

  sowSelect.addEventListener("change", () => {
    const hasSow = !!sowSelect.value;
    saveBtn.disabled = !hasSow;
    const selectedSow = sows.find((s) => String(s.id) === sowSelect.value);
    billingModelCell.textContent = (selectedSow && selectedSow.billing_model_name) || "—";
    setDraftMonthsEditable(hasSow);
  });

  tr.querySelector(".draft-cancel-btn").addEventListener("click", () => {
    tr.remove();
    if (!tbody.querySelector("tr")) loadRevenueSows();
  });

  saveBtn.addEventListener("click", async () => {
    const sowId = sowSelect.value;
    if (!sowId) return;
    const selectedSow = sows.find((s) => String(s.id) === sowId);
    const cancelBtn = tr.querySelector(".draft-cancel-btn");
    saveBtn.disabled = true;
    cancelBtn.disabled = true;

    // Collect whatever was typed into the (now-editable) month inputs and
    // persist all 12 months in one go - the PUT endpoint registers the SOW
    // into revenue tracking for this fiscal year as a side effect, so no
    // separate "create" call is needed first.
    const projectionInputs = tr.querySelectorAll(".draft-projection-input");
    const months = Array.from(projectionInputs).map((projectionInput) => {
      const fiscalMonth = parseInt(projectionInput.dataset.fiscalMonth, 10);
      const invoicedInput = tr.querySelector(`.draft-invoiced-input[data-fiscal-month="${fiscalMonth}"]`);
      return {
        fiscal_month: fiscalMonth,
        projection: parseFloat(projectionInput.value) || 0,
        invoiced: parseFloat(invoicedInput.value) || 0,
      };
    });

    const responses = await Promise.all(months.map((m) =>
      fetch(`${API}/revenue/sows`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sow_id: parseInt(sowId, 10), fiscal_year: currentFiscalYear, ...m }),
      })
    ));
    const failed = responses.find((resp) => !resp.ok);
    if (failed) {
      const err = await failed.json().catch(() => ({}));
      alert(formatApiError(err, "Failed to save this entry."));
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
      return;
    }

    const newRow = {
      sow_id: selectedSow.id,
      sow_title: selectedSow.title,
      customer_id: selectedSow.customer_id,
      customer_name: selectedSow.customer_name || "Unassigned",
      billing_model_name: selectedSow.billing_model_name,
      months,
    };
    revenueTrackedSowIds.add(newRow.sow_id);
    revenueSowsCache.set(newRow.sow_id, newRow);
    tr.replaceWith(buildRevenueSowRow(newRow, false));
    renumberRevenueRows();
  });
});

// ---------- Configuration: generic simple-list helper (Locations, Billing
// Models, Statuses, Employee Types, Bands, Opportunity Types) ----------
// Inline-edit table - no modal. Same toggle-in-place approach as the
// Customer Management table (buildCustomerRow()) and Revenue Management's
// grid: an Edit icon swaps a row into text inputs with Save/Cancel, and the
// "Add X" button prepends a blank row in that same editable state.
function makeInlineListManager(opts) {
  const { apiPath, tableBodyId, newBtnId, hasDetails, itemLabel, onChange } = opts;
  const tbody = document.getElementById(tableBodyId);
  const colCount = hasDetails ? 4 : 3;

  function buildRow(item, editing) {
    const tr = document.createElement("tr");
    if (editing) tr.classList.add("inline-editing-row");

    const slTd = document.createElement("td");
    slTd.className = "sl-no-cell inline-sl-no";
    tr.appendChild(slTd);

    const nameTd = document.createElement("td");
    if (editing) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "inline-cell";
      input.dataset.field = "name";
      input.value = item.name || "";
      input.required = true;
      nameTd.appendChild(input);
    } else {
      nameTd.textContent = item.name || "";
    }
    tr.appendChild(nameTd);

    if (hasDetails) {
      const detailsTd = document.createElement("td");
      if (editing) {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "inline-cell";
        input.dataset.field = "details";
        input.value = item.details || "";
        detailsTd.appendChild(input);
      } else {
        detailsTd.textContent = item.details || "—";
      }
      tr.appendChild(detailsTd);
    }

    const actionsTd = document.createElement("td");
    actionsTd.className = "row-actions";
    actionsTd.innerHTML = editing
      ? `<button type="button" class="ghost-btn btn-edit icon-btn inline-save-btn" title="Save">${icon("check")}</button>
         <button type="button" class="ghost-btn icon-btn inline-cancel-btn" title="Cancel">${icon("x")}</button>`
      : `<button type="button" class="ghost-btn btn-edit icon-btn inline-edit-btn" title="Edit">${icon("edit")}</button>
         <button type="button" class="ghost-btn btn-danger icon-btn inline-del-btn" title="Delete">${icon("trash")}</button>`;
    tr.appendChild(actionsTd);

    if (editing) {
      actionsTd.querySelector(".inline-save-btn").addEventListener("click", () => saveRow(item, tr));
      actionsTd.querySelector(".inline-cancel-btn").addEventListener("click", () => {
        if (item.id) {
          replaceRow(tr, buildRow(item, false));
        } else {
          load(); // discard the unsaved draft row and restore the normal listing
        }
      });
    } else {
      actionsTd.querySelector(".inline-edit-btn").addEventListener("click", () => {
        replaceRow(tr, buildRow(item, true));
      });
      actionsTd.querySelector(".inline-del-btn").addEventListener("click", async () => {
        if (confirm(`Delete ${itemLabel.toLowerCase()} "${item.name}"?`)) {
          const resp = await fetch(`${API}/${apiPath}/${item.id}`, { method: "DELETE" });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            alert(formatApiError(err, `Failed to delete this ${itemLabel.toLowerCase()}.`));
            return;
          }
          load();
          if (onChange) onChange();
        }
      });
    }

    return tr;
  }

  // Preserves the row's current Sl. No when toggling edit/read-only in
  // place, same reasoning as Revenue Management's replaceRevenueRow().
  function replaceRow(oldTr, newTr) {
    const slNo = oldTr.querySelector(".inline-sl-no")?.textContent;
    oldTr.replaceWith(newTr);
    if (slNo) newTr.querySelector(".inline-sl-no").textContent = slNo;
  }

  async function saveRow(item, tr) {
    const saveBtn = tr.querySelector(".inline-save-btn");
    const cancelBtn = tr.querySelector(".inline-cancel-btn");
    const name = tr.querySelector('.inline-cell[data-field="name"]').value.trim();
    if (!name) {
      alert(`${itemLabel} name is required.`);
      return;
    }
    const payload = { name };
    if (hasDetails) payload.details = tr.querySelector('.inline-cell[data-field="details"]').value.trim() || null;
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    try {
      const url = item.id ? `${API}/${apiPath}/${item.id}` : `${API}/${apiPath}`;
      const method = item.id ? "PUT" : "POST";
      const resp = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        alert(formatApiError(err, `Failed to save ${itemLabel.toLowerCase()}.`));
        return;
      }
      await load();
      if (onChange) onChange();
    } finally {
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  }

  async function load() {
    const items = await fetch(`${API}/${apiPath}`).then((r) => r.json());
    tbody.innerHTML = "";
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="${colCount}" class="empty-state">No ${itemLabel.toLowerCase()}s yet.</td></tr>`;
      return;
    }
    items.forEach((item, idx) => {
      const tr = buildRow(item, false);
      tr.querySelector(".inline-sl-no").textContent = idx + 1;
      tbody.appendChild(tr);
    });
  }

  document.getElementById(newBtnId).addEventListener("click", () => {
    const existingDraft = tbody.querySelector('tr[data-draft="true"]');
    if (existingDraft) {
      existingDraft.querySelector(".inline-cell").focus();
      return;
    }
    if (tbody.querySelector(".empty-state")) tbody.innerHTML = "";
    const draft = buildRow({}, true);
    draft.dataset.draft = "true";
    tbody.prepend(draft);
    draft.querySelector(".inline-cell").focus();
  });

  return { load };
}

const locationManager = makeInlineListManager({
  apiPath: "locations",
  tableBodyId: "locationTableBody",
  newBtnId: "newLocationBtn",
  hasDetails: true,
  itemLabel: "Location",
});

const billingModelManager = makeInlineListManager({
  apiPath: "billing-models",
  tableBodyId: "billingModelTableBody",
  newBtnId: "newBillingModelBtn",
  hasDetails: true,
  itemLabel: "Billing Model",
});

const operatingModelManager = makeInlineListManager({
  apiPath: "operating-models",
  tableBodyId: "operatingModelTableBody",
  newBtnId: "newOperatingModelBtn",
  hasDetails: true,
  itemLabel: "Operating Model",
});

const statusManager = makeInlineListManager({
  apiPath: "statuses",
  tableBodyId: "statusTableBody",
  newBtnId: "newStatusBtn",
  hasDetails: true,
  itemLabel: "Status",
  onChange: refreshStatusFilterOptions,
});

const employeeTypeManager = makeInlineListManager({
  apiPath: "employee-types",
  tableBodyId: "employeeTypeTableBody",
  newBtnId: "newEmployeeTypeBtn",
  hasDetails: true,
  itemLabel: "Employee Type",
});

const bandManager = makeInlineListManager({
  apiPath: "bands",
  tableBodyId: "bandTableBody",
  newBtnId: "newBandBtn",
  hasDetails: true,
  itemLabel: "Band",
});

// What kind of SOW record something is - a brand-new SOW vs. an extension/
// amendment of an existing one - managed here the same way as any other
// simple master list (Locations, Billing Models, etc).
const opportunityTypeManager = makeInlineListManager({
  apiPath: "opportunity-types",
  tableBodyId: "opportunityTypeTableBody",
  newBtnId: "newOpportunityTypeBtn",
  hasDetails: true,
  itemLabel: "Opportunity Type",
});

// Another simple master list, managed under Settings exactly like Locations.
const revenueTypeManager = makeInlineListManager({
  apiPath: "revenue-types",
  tableBodyId: "revenueTypeTableBody",
  newBtnId: "newRevenueTypeBtn",
  hasDetails: true,
  itemLabel: "Revenue Type",
});

function loadLocations() { locationManager.load(); }
function loadBillingModels() { billingModelManager.load(); }
function loadOperatingModels() { operatingModelManager.load(); }
function loadStatuses() { statusManager.load(); }
function loadEmployeeTypes() { employeeTypeManager.load(); }
function loadBands() { bandManager.load(); }
function loadOpportunityTypes() { opportunityTypeManager.load(); }
function loadRevenueTypes() { revenueTypeManager.load(); }

// ---------- init ----------
// A refresh should land back on whatever tab the user was actually working
// in (see rememberLastTab()/showTab() above) - the landing/About page is
// only the fallback for a genuinely fresh visit, when nothing has been
// stored yet (or the stored tab no longer exists, e.g. after a future page
// removal). SOW-page-specific setup (status/customer filter options) is
// cheap and harmless to run up front so the SOWs tab is ready whenever it's
// opened.
let lastTab = null;
try {
  lastTab = localStorage.getItem("trakerz_last_tab");
} catch (e) {}
if (lastTab && document.getElementById("tab-" + lastTab)) {
  showTab(lastTab);
} else {
  showTab("landing");
}
refreshStatusFilterOptions();
refreshSowCustomerFilterOptions();
