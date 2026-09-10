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

// Nav dropdowns (Contract, Best Estimates, Customer Configuration, Global Settings) - generic so any number of them work the same way.
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
  // Second-level submenu triggers - toggle their own flyout without closing
  // the parent menu. Not currently used by any menu (see the
  // .dropdown-item-group comment in style.css), but querySelectorAll finds
  // these regardless of nesting depth, so this loop harmlessly covers menus
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

// Applies a Best Estimates menu leaf's preset (which Time and Material/
// Managed Services category is shown) to the Revenue Management table
// before showTab() switches to it. No-op for every other dropdown item,
// since only these carry data-revenue-billing-model.
function applyRevenueMenuPreset(item) {
  const category = item.dataset.revenueBillingModel;
  // Every Best Estimates menu leaf (Time and Material/Managed Services)
  // only switches which category's grid is shown - it doesn't filter the
  // grid down further. Customer (and, for Managed Services,
  // Billing Model) both reset to "All" on every click instead, so each grid
  // always starts from its own full picture; the toolbar <select>s are
  // synced from these variables a moment later once showTab("revenue") ->
  // loadRevenueTab() has (re)populated their options.
  revenueCustomerFilter = "";
  revenueBillingModelFilter = "";
  revenueRevenueTypeFilter = "";
  revenuePracticeFilter = "";
  tmCustomerFilter = "";
  tmBillingModelFilter = "";
  tmRevenueTypeFilter = "";
  tmLocationFilter = "";
  tmPracticeFilter = "";
  if (category === "Time and Material") setRevenueCategory("time-material");
  else if (category === "Managed Services") setRevenueCategory("managed-services");
}

// Switches which of the two Revenue Management grids (Managed Services'
// SOW-level grid, or Time and Material's per-assignment grid) is visible -
// see the .ms-section/.tm-section wrapper divs inside #tab-revenue in
// index.html, toggled here via a category-* class on the panel itself.
let revenueCategory = "managed-services";
function setRevenueCategory(category) {
  revenueCategory = category;
  const panel = document.getElementById("tab-revenue");
  panel.classList.remove("category-managed-services", "category-time-material");
  panel.classList.add("category-" + category);
  // Toggle the actual .hidden property (not just the category-* class above)
  // so each section's [hidden] attribute stays authoritative - a CSS rule
  // trying to un-hide one of these through the class alone would need to
  // out-specificity the browser's own [hidden]{display:none} default.
  const msSection = panel.querySelector(".ms-section");
  const tmSection = panel.querySelector(".tm-section");
  if (msSection) msSection.hidden = category !== "managed-services";
  if (tmSection) tmSection.hidden = category !== "time-material";
  const heading = document.getElementById("revenueSectionHeading");
  if (heading) {
    heading.textContent = category === "time-material" ? "Time and Material" : "Revenue Summary (SoW Level)";
  }
}

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
  if (name === "config-leaves") loadLeaves();
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
  if (name === "config-practices") loadPractices();
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
  "Statement of Work Management — every SOW, sortable and searchable",
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

// ---------- Theme picker ----------
// Six selectable Color Hunt palettes replace the old light/dark toggle - see
// the "---------- Color themes ----------" block in style.css for what each
// slug actually redefines. "" (empty string / no data-theme attribute) is
// the default theme ("Blush Navy"), matching every other slug's absence
// meaning "default" the same way the old dark-mode toggle worked. Kept in
// sync with the validThemes list in index.html's early inline <script>
// (which applies the saved choice before first paint, so the page never
// flashes the default theme) and with the six .theme-swatch-item buttons in
// #themeMenu.
const THEMES = ["", "sky", "sage", "taupe", "navy", "blueteal"];

function applyTheme(themeId) {
  if (themeId && THEMES.includes(themeId)) {
    document.documentElement.setAttribute("data-theme", themeId);
  } else {
    document.documentElement.removeAttribute("data-theme");
    themeId = "";
  }
  document.querySelectorAll("#themeMenu .theme-swatch-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.themeId === themeId);
  });
}
applyTheme(document.documentElement.getAttribute("data-theme") || "");
document.querySelectorAll("#themeMenu .theme-swatch-item").forEach((item) => {
  item.addEventListener("click", () => {
    const themeId = item.dataset.themeId;
    try { localStorage.setItem("trakerz_theme", themeId); } catch (e) {}
    applyTheme(themeId);
    document.getElementById("themeMenu").hidden = true;
    // Re-render the Dashboard (only if it's the visible tab) so its charts
    // pick up any theme-dependent styling immediately instead of only on the
    // next tab visit.
    if (document.getElementById("tab-home").classList.contains("active")) loadHome();
  });
});

// ---------- SOWs list ----------
document.getElementById("searchInput").addEventListener("input", debounce(loadSows, 250));
document.getElementById("statusFilter").addEventListener("change", loadSows);
document.getElementById("sowCustomerFilter").addEventListener("change", loadSows);
document.getElementById("sowBillingModelFilter").addEventListener("change", loadSows);

async function refreshStatusFilterOptions() {
  const statuses = await fetch(`${API}/statuses`).then((r) => r.json());
  const sel = document.getElementById("statusFilter");
  const prevVal = sel.value;
  sel.innerHTML = '<option value="">All statuses</option>' +
    statuses.map((s) => `<option value="${escapeHtml(s.name)}">${escapeHtml(capitalize(s.name))}</option>`).join("");
  if (statuses.some((s) => s.name === prevVal)) sel.value = prevVal;
}

// Billing Model filter for the SOWs table - same refresh-on-demand pattern
// as refreshStatusFilterOptions()/refreshSowCustomerFilterOptions() above.
async function refreshSowBillingModelFilterOptions() {
  const billingModels = await fetch(`${API}/billing-models`).then((r) => r.json());
  const sel = document.getElementById("sowBillingModelFilter");
  const prevVal = sel.value;
  sel.innerHTML = '<option value="">All billing models</option>' +
    billingModels.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("");
  if (billingModels.some((b) => String(b.id) === prevVal)) sel.value = prevVal;
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

  const totalAcv = sows.reduce((sum, s) => sum + (s.acv || 0), 0);
  const sowStatAcvEl = document.getElementById("sowStatAcv");
  sowStatAcvEl.textContent = fmtCompact(totalAcv);
  sowStatAcvEl.title = fmt(totalAcv);

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
    if (key === "total_value" || key === "gm_percent" || key === "duration_months" || key === "acv") {
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
  const billingModelId = document.getElementById("sowBillingModelFilter").value;
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  if (customerId) params.set("customer_id", customerId);
  if (billingModelId) params.set("billing_model_id", billingModelId);
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
    tbody.innerHTML = '<tr><td colspan="24" class="empty-state">No SOWs yet. Click "New SOW" to add one.</td></tr>';
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
      <td>${s.duration_months !== null && s.duration_months !== undefined ? s.duration_months : "—"}</td>
      <td>${fmt(s.acv)}</td>
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
  subTr.innerHTML = `<td colspan="24">${renderMilestoneSubtable(milestones)}</td>`;
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
  const billingModelId = document.getElementById("sowBillingModelFilter").value;
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  if (customerId) params.set("customer_id", customerId);
  if (billingModelId) params.set("billing_model_id", billingModelId);
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
  const [customers, billingModels, operatingModels, statuses, opportunityTypes, revenueTypes, practices] = await Promise.all([
    fetch(`${API}/customers`).then((r) => r.json()),
    fetch(`${API}/billing-models`).then((r) => r.json()),
    fetch(`${API}/operating-models`).then((r) => r.json()),
    fetch(`${API}/statuses`).then((r) => r.json()),
    fetch(`${API}/opportunity-types`).then((r) => r.json()),
    fetch(`${API}/revenue-types`).then((r) => r.json()),
    fetch(`${API}/practices`).then((r) => r.json()),
  ]);
  currentBillingModels = billingModels;
  currentSowCustomers = customers;
  fillSelect("f_customer", customers, "id", "customer_name", "Select customer&hellip;");
  fillSelect("f_billing_model", billingModels, "id", "name", "Select billing model&hellip;");
  fillSelect("f_operating_model", operatingModels, "id", "name", "Select operating model&hellip;");
  fillSelect("f_opportunity_type", opportunityTypes, "id", "name", "Select opportunity type&hellip;");
  fillSelect("f_revenue_type", revenueTypes, "id", "name", "Select revenue type&hellip;");
  fillSelect("f_practice", practices, "id", "name", "Select practice&hellip;");

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

// ACV (USD) mirrors the server's own _enrich_sow() formula - monthly value
// (TCV / Contract Duration (Months)) times however many of those months
// count toward one fiscal year (capped at 12) - so the form shows the
// number that will actually be saved/displayed without a round trip. It's
// read-only and never itself sent to the backend (see the submit handler
// below), just recomputed live whenever TCV or Duration changes.
function updateAcvPreview() {
  const tcv = parseFloat(document.getElementById("f_value").value) || 0;
  const months = parseFloat(document.getElementById("f_duration_months").value) || 0;
  let acv = 0;
  if (months > 0) {
    const monthlyValue = tcv / months;
    const monthsInFiscalYear = Math.min(months, 12);
    acv = monthlyValue * monthsInFiscalYear;
  }
  document.getElementById("f_acv").value = acv ? Number(acv.toFixed(2)) : 0;
}
document.getElementById("f_value").addEventListener("input", updateAcvPreview);

// Statement of Work Duration (Months) is derived from Start Date/End Date
// rather than typed in (the field is read-only - see index.html) - inclusive
// day count between the two dates divided by the average length of a
// calendar month (365.2425 / 12), rounded to one decimal, so a Jan 1-Dec 31
// SOW comes out to a clean 12.0 rather than the 11 a raw calendar-month
// subtraction would give. Recomputed whenever either date changes, and
// always followed by updateAcvPreview() since ACV depends on Duration.
// Left untouched if either date is missing (or End is before Start) so a
// SOW that predates Start/End Date - or simply has neither set - keeps
// showing whatever Duration is already on record instead of being blanked.
function updateDurationFromDates() {
  const startVal = document.getElementById("f_start").value;
  const endVal = document.getElementById("f_end").value;
  if (!startVal || !endVal) return;
  const start = new Date(`${startVal}T00:00:00`);
  const end = new Date(`${endVal}T00:00:00`);
  if (isNaN(start) || isNaN(end) || end < start) return;
  const inclusiveDays = Math.round((end - start) / 86400000) + 1;
  const months = Math.round((inclusiveDays / 30.4368) * 10) / 10;
  document.getElementById("f_duration_months").value = months;
  updateAcvPreview();
}
document.getElementById("f_start").addEventListener("change", updateDurationFromDates);
document.getElementById("f_end").addEventListener("change", updateDurationFromDates);

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
  // Duration (Months) is derived from Start Date/End Date (see
  // updateDurationFromDates) - only fall back to whatever's on record when
  // one of the dates is missing, so an older SOW without Start/End Date set
  // doesn't have its stored Duration blanked out just by opening the form.
  document.getElementById("f_duration_months").value = sow?.duration_months ?? "";
  updateDurationFromDates();
  document.getElementById("f_gm_percent").value = sow?.gm_percent ?? "";
  document.getElementById("f_status").value = sow?.status ?? "draft";
  document.getElementById("f_billing_model").value = sow?.billing_model_id ?? "";
  document.getElementById("f_operating_model").value = sow?.operating_model_id ?? "";
  document.getElementById("f_revenue_type").value = sow?.revenue_type_id ?? "";
  document.getElementById("f_practice").value = sow?.practice_id ?? "";
  document.getElementById("f_doclink").value = sow?.doc_link ?? "";
  document.getElementById("f_po_doclink").value = sow?.po_doc_link ?? "";
  document.getElementById("f_deal_sheet_link").value = sow?.deal_sheet_link ?? "";
  document.getElementById("f_notes").value = sow?.notes ?? "";
  updateCustomerCodeField();
  updateAcvPreview();

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
  const revenueTypeVal = document.getElementById("f_revenue_type").value;
  const practiceVal = document.getElementById("f_practice").value;
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
    duration_months: document.getElementById("f_duration_months").value !== "" ? parseFloat(document.getElementById("f_duration_months").value) : null,
    gm_percent: document.getElementById("f_gm_percent").value !== "" ? parseFloat(document.getElementById("f_gm_percent").value) : null,
    billing_model_id: billingVal ? parseInt(billingVal, 10) : null,
    operating_model_id: operatingVal ? parseInt(operatingVal, 10) : null,
    revenue_type_id: revenueTypeVal ? parseInt(revenueTypeVal, 10) : null,
    practice_id: practiceVal ? parseInt(practiceVal, 10) : null,
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
      <div class="stat-card"><div class="stat-label">Duration (Months)</div><div class="stat-value">${s.duration_months !== null && s.duration_months !== undefined ? s.duration_months : "—"}</div></div>
      <div class="stat-card"><div class="stat-label">ACV (USD)</div><div class="stat-value">${fmt(s.acv)}</div></div>
      <div class="stat-card"><div class="stat-label">GM %</div><div class="stat-value">${s.gm_percent !== null && s.gm_percent !== undefined ? Number(s.gm_percent.toFixed(2)) + "%" : "—"}</div></div>
      <div class="stat-card"><div class="stat-label">Billed</div><div class="stat-value">${fmt(s.billed_total)}</div></div>
      <div class="stat-card"><div class="stat-label">Remaining</div><div class="stat-value">${fmt(s.remaining_budget)}</div></div>
    </div>
    <p><strong>Project Title:</strong> ${escapeHtml(s.project_title) || "—"} &nbsp;&middot;&nbsp; <strong>Project Code:</strong> ${escapeHtml(s.project_code) || "—"} &nbsp;&middot;&nbsp; <strong>Statement of Work Code:</strong> ${escapeHtml(s.contract_code) || "—"}</p>
    <p><strong>Opportunity ID:</strong> ${escapeHtml(s.opportunity_id) || "—"} &nbsp;&middot;&nbsp; <strong>PO#:</strong> ${escapeHtml(s.po_number) || "—"}</p>
    <p><strong>Billing model:</strong> ${escapeHtml(s.billing_model_name) || "—"} &nbsp;&middot;&nbsp; <strong>Operating model:</strong> ${escapeHtml(s.operating_model_name) || "—"}</p>
    ${s.doc_link ? `<p><strong>Statement of Work:</strong> ${renderDocLink(s.doc_link)}</p>` : ""}
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

  const actionsTd = document.createElement("td");
  actionsTd.className = "row-actions";
  actionsTd.innerHTML = editing
    ? `<button type="button" class="ghost-btn btn-edit icon-btn cust-save-btn" title="Save">${icon("check")}</button>
       <button type="button" class="ghost-btn icon-btn cust-cancel-btn" title="Cancel">${icon("x")}</button>`
    : `<button type="button" class="ghost-btn btn-edit icon-btn cust-copy-btn" title="Copy">${icon("copy")}</button>
       <button type="button" class="ghost-btn btn-edit icon-btn cust-edit-btn" title="Edit">${icon("edit")}</button>
       <button type="button" class="ghost-btn btn-danger icon-btn cust-del-btn" title="Delete">${icon("trash")}</button>`;
  tr.appendChild(actionsTd);

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
    actionsTd.querySelector(".cust-copy-btn").addEventListener("click", () => {
      // Opens a new editable draft row pre-filled with this customer's
      // values but no id, prepended above it - Save then creates a new
      // record (same id-less-draft-means-create convention as "New
      // Customer") rather than overwriting the original. Customer code is
      // left blank rather than copied verbatim, since it's unique - typing
      // the same code back in would fail to save, same as any other new
      // customer.
      const tbody = tr.parentElement;
      const existingDraft = tbody.querySelector('tr[data-draft="true"]');
      if (existingDraft) {
        existingDraft.querySelector(".cust-cell").focus();
        return;
      }
      const draft = buildCustomerRow({ ...c, id: undefined, customer_code: "" }, true);
      draft.dataset.draft = "true";
      tbody.prepend(draft);
      draft.querySelector(".cust-cell").focus();
    });
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
// (makeInlineListManager) - but each row picks a Customer from a dropdown
// (an FK) rather than typing a name, plus three numeric "billing hours per
// day" fields, one per fixed Location (Onsite/Offshore/Nearshore - see
// billing_hour_configs in db.py). No Location dropdown: Locations is now a
// fixed three-value list, so each Customer gets exactly one row with all
// three hours side by side instead of one row per Customer+Location.
function selectOptionsHtml(items, valueKey, labelKey, placeholder) {
  return `<option value="">${placeholder}</option>` +
    items.map((i) => `<option value="${i[valueKey]}">${escapeHtml(i[labelKey])}</option>`).join("");
}

const BILLING_HOURS_LOCATION_FIELDS = ["onsite_hours", "offshore_hours", "nearshore_hours"];

function buildBillingHoursRow(item, editing, customers) {
  const tr = document.createElement("tr");
  if (editing) tr.classList.add("inline-editing-row");

  const actionsTd = document.createElement("td");
  actionsTd.className = "row-actions";
  actionsTd.innerHTML = editing
    ? `<button type="button" class="ghost-btn btn-edit icon-btn bh-save-btn" title="Save">${icon("check")}</button>
       <button type="button" class="ghost-btn icon-btn bh-cancel-btn" title="Cancel">${icon("x")}</button>`
    : `<button type="button" class="ghost-btn btn-edit icon-btn bh-copy-btn" title="Copy">${icon("copy")}</button>
       <button type="button" class="ghost-btn btn-edit icon-btn bh-edit-btn" title="Edit">${icon("edit")}</button>
       <button type="button" class="ghost-btn btn-danger icon-btn bh-del-btn" title="Delete">${icon("trash")}</button>`;
  tr.appendChild(actionsTd);

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

  BILLING_HOURS_LOCATION_FIELDS.forEach((field) => {
    const hoursTd = document.createElement("td");
    if (editing) {
      const input = document.createElement("input");
      input.type = "number";
      input.step = "0.5";
      input.min = "0";
      input.className = "inline-cell";
      input.dataset.field = field;
      input.value = item[field] ?? "";
      hoursTd.appendChild(input);
    } else {
      hoursTd.textContent = item[field] ?? "—";
    }
    tr.appendChild(hoursTd);
  });

  if (editing) {
    actionsTd.querySelector(".bh-save-btn").addEventListener("click", () => saveBillingHoursRow(item, tr, customers));
    actionsTd.querySelector(".bh-cancel-btn").addEventListener("click", () => {
      if (item.id) {
        replaceBillingHoursRow(tr, buildBillingHoursRow(item, false, customers));
      } else {
        loadBillingHours(); // discard the unsaved draft row and restore the normal listing
      }
    });
  } else {
    actionsTd.querySelector(".bh-copy-btn").addEventListener("click", () => {
      // Same id-less-draft-means-create convention as buildCustomerRow()'s
      // copy handler above. Note: Customer is unique per row now (the
      // backend rejects a second row for the same Customer), so a copied
      // draft must have its Customer changed before it can be saved.
      const tbody = tr.parentElement;
      const existingDraft = tbody.querySelector('tr[data-draft="true"]');
      if (existingDraft) {
        existingDraft.querySelector(".inline-cell").focus();
        return;
      }
      const draft = buildBillingHoursRow({ ...item, id: undefined }, true, customers);
      draft.dataset.draft = "true";
      tbody.prepend(draft);
      draft.querySelector(".inline-cell").focus();
    });
    actionsTd.querySelector(".bh-edit-btn").addEventListener("click", () => {
      replaceBillingHoursRow(tr, buildBillingHoursRow(item, true, customers));
    });
    actionsTd.querySelector(".bh-del-btn").addEventListener("click", async () => {
      if (confirm(`Delete the billing hours configuration for "${item.customer_name}"?`)) {
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

async function saveBillingHoursRow(item, tr, customers) {
  const saveBtn = tr.querySelector(".bh-save-btn");
  const cancelBtn = tr.querySelector(".bh-cancel-btn");
  const customerId = tr.querySelector('.inline-cell[data-field="customer_id"]').value;
  if (!customerId) {
    alert("Customer is required.");
    return;
  }
  const payload = { customer_id: parseInt(customerId, 10) };
  BILLING_HOURS_LOCATION_FIELDS.forEach((field) => {
    const val = tr.querySelector(`.inline-cell[data-field="${field}"]`).value.trim();
    payload[field] = val === "" ? null : parseFloat(val);
  });
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
  const [items, customers] = await Promise.all([
    fetch(`${API}/billing-hours`).then((r) => r.json()),
    fetch(`${API}/customers`).then((r) => r.json()),
  ]);
  const tbody = document.getElementById("billingHoursTableBody");
  tbody.innerHTML = "";
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No billing hours configurations yet. Click "Add Billing Hours" to add one.</td></tr>';
    return;
  }
  items.forEach((item, idx) => {
    const tr = buildBillingHoursRow(item, false, customers);
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
  const customers = await fetch(`${API}/customers`).then((r) => r.json());
  if (tbody.querySelector(".empty-state")) tbody.innerHTML = "";
  const draft = buildBillingHoursRow({}, true, customers);
  draft.dataset.draft = "true";
  tbody.prepend(draft);
  draft.querySelector(".inline-cell").focus();
});

// ---------- Customer Configuration: Holiday Calendar ----------
// One row per Customer + Holiday Date - fixed Onsite/Offshore/Nearshore
// checkboxes mark which locations observe that date (same fixed-three-
// locations reasoning as Billing Hours above), plus a multiline details
// textarea for the holiday's name/notes.
const HOLIDAY_LOCATION_FIELDS = ["onsite", "offshore", "nearshore"];

// Account Name/Location filters - same id-based client-side filtering
// approach used app-wide (see tmRowMatchesFilters() etc). Location filters
// on the row's onsite/offshore/nearshore flag matching whichever of the
// fixed three locations was picked (resolved from the location's name to
// one of those flag names, same as billingHoursFor()/_location_slug()).
let holidayCustomerFilter = "";
let holidayLocationFilter = "";
document.getElementById("holidayCustomerFilter").addEventListener("change", (e) => {
  holidayCustomerFilter = e.target.value;
  loadHolidays();
});
document.getElementById("holidayLocationFilter").addEventListener("change", (e) => {
  holidayLocationFilter = e.target.value;
  loadHolidays();
});

function populateHolidayCustomerFilter(customers) {
  const select = document.getElementById("holidayCustomerFilter");
  const current = holidayCustomerFilter;
  select.innerHTML = '<option value="">All customers</option>' +
    customers.map((c) => `<option value="${c.id}">${escapeHtml(c.customer_name)}</option>`).join("");
  select.value = current;
}

function populateHolidayLocationFilter(locations) {
  const select = document.getElementById("holidayLocationFilter");
  const current = holidayLocationFilter;
  select.innerHTML = '<option value="">All locations</option>' +
    locations.map((l) => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join("");
  select.value = current;
}

function holidayRowMatchesFilters(item, locations) {
  if (holidayCustomerFilter && String(item.customer_id) !== holidayCustomerFilter) return false;
  if (holidayLocationFilter) {
    const loc = locations.find((l) => String(l.id) === holidayLocationFilter);
    const slug = (loc?.name || "").trim().toLowerCase();
    if (!HOLIDAY_LOCATION_FIELDS.includes(slug) || !item[slug]) return false;
  }
  return true;
}

function buildHolidayRow(item, editing, customers) {
  const tr = document.createElement("tr");
  if (editing) tr.classList.add("inline-editing-row");

  const actionsTd = document.createElement("td");
  actionsTd.className = "row-actions";
  actionsTd.innerHTML = editing
    ? `<button type="button" class="ghost-btn btn-edit icon-btn hol-save-btn" title="Save">${icon("check")}</button>
       <button type="button" class="ghost-btn icon-btn hol-cancel-btn" title="Cancel">${icon("x")}</button>`
    : `<button type="button" class="ghost-btn btn-edit icon-btn hol-copy-btn" title="Copy">${icon("copy")}</button>
       <button type="button" class="ghost-btn btn-edit icon-btn hol-edit-btn" title="Edit">${icon("edit")}</button>
       <button type="button" class="ghost-btn btn-danger icon-btn hol-del-btn" title="Delete">${icon("trash")}</button>`;
  tr.appendChild(actionsTd);

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

  HOLIDAY_LOCATION_FIELDS.forEach((field) => {
    const td = document.createElement("td");
    td.className = "center-cell";
    if (editing) {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "inline-cell";
      checkbox.dataset.field = field;
      checkbox.checked = !!item[field];
      td.appendChild(checkbox);
    } else {
      td.textContent = item[field] ? "✓" : "—";
    }
    tr.appendChild(td);
  });

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

  if (editing) {
    actionsTd.querySelector(".hol-save-btn").addEventListener("click", () => saveHolidayRow(item, tr, customers));
    actionsTd.querySelector(".hol-cancel-btn").addEventListener("click", () => {
      if (item.id) {
        replaceHolidayRow(tr, buildHolidayRow(item, false, customers));
      } else {
        loadHolidays(); // discard the unsaved draft row and restore the normal listing
      }
    });
  } else {
    actionsTd.querySelector(".hol-copy-btn").addEventListener("click", () => {
      // Same id-less-draft-means-create convention as buildCustomerRow()'s
      // copy handler above.
      const tbody = tr.parentElement;
      const existingDraft = tbody.querySelector('tr[data-draft="true"]');
      if (existingDraft) {
        existingDraft.querySelector(".inline-cell").focus();
        return;
      }
      const draft = buildHolidayRow({ ...item, id: undefined }, true, customers);
      draft.dataset.draft = "true";
      tbody.prepend(draft);
      draft.querySelector(".inline-cell").focus();
    });
    actionsTd.querySelector(".hol-edit-btn").addEventListener("click", () => {
      replaceHolidayRow(tr, buildHolidayRow(item, true, customers));
    });
    actionsTd.querySelector(".hol-del-btn").addEventListener("click", async () => {
      if (confirm(`Delete the holiday on ${fmtDate(item.holiday_date)} for "${item.customer_name}"?`)) {
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

async function saveHolidayRow(item, tr, customers) {
  const saveBtn = tr.querySelector(".hol-save-btn");
  const cancelBtn = tr.querySelector(".hol-cancel-btn");
  const customerId = tr.querySelector('.inline-cell[data-field="customer_id"]').value;
  const holidayDate = tr.querySelector('.inline-cell[data-field="holiday_date"]').value;
  const holidayDetails = tr.querySelector('.inline-cell[data-field="holiday_details"]').value.trim();
  if (!customerId || !holidayDate) {
    alert("Customer and Holiday Date are both required.");
    return;
  }
  const payload = {
    customer_id: parseInt(customerId, 10),
    holiday_date: holidayDate,
    holiday_details: holidayDetails || null,
  };
  HOLIDAY_LOCATION_FIELDS.forEach((field) => {
    payload[field] = tr.querySelector(`.inline-cell[data-field="${field}"]`).checked;
  });
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
  populateHolidayCustomerFilter(customers);
  populateHolidayLocationFilter(locations);
  const filteredItems = items.filter((item) => holidayRowMatchesFilters(item, locations));
  const tbody = document.getElementById("holidayTableBody");
  tbody.innerHTML = "";
  if (!filteredItems.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">${
      items.length ? "No holidays match the selected filters." : 'No holidays yet. Click "Add Holiday" to add one.'
    }</td></tr>`;
    return;
  }
  filteredItems.forEach((item, idx) => {
    const tr = buildHolidayRow(item, false, customers);
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
  const customers = await fetch(`${API}/customers`).then((r) => r.json());
  if (tbody.querySelector(".empty-state")) tbody.innerHTML = "";
  const draft = buildHolidayRow({}, true, customers);
  draft.dataset.draft = "true";
  tbody.prepend(draft);
  draft.querySelector(".inline-cell").focus();
});

// ---------- Customer Configuration: Leave Management ----------
// One row per Customer + Employee ID, with a flat leave-day count per
// fiscal month (Apr-Mar) instead of one value - own small CRUD like Billing
// Hours Configuration/Holiday Calendar above, just with 12 month inputs
// instead of 1-2 fields. Employee ID/Name are free text, matching the Time
// and Material grid this feeds (see _compute_tm_projections in main.py) -
// not linked to Staffing/Resources.
const LEAVE_MONTH_FIELDS = [
  "leave_apr", "leave_may", "leave_jun", "leave_jul", "leave_aug", "leave_sep",
  "leave_oct", "leave_nov", "leave_dec", "leave_jan", "leave_feb", "leave_mar",
];

function buildLeaveRow(item, editing, customers, locations, employeeTypes, bands) {
  const tr = document.createElement("tr");
  if (editing) tr.classList.add("inline-editing-row");

  const actionsTd = document.createElement("td");
  actionsTd.className = "row-actions";
  actionsTd.innerHTML = editing
    ? `<button type="button" class="ghost-btn btn-edit icon-btn leave-save-btn" title="Save">${icon("check")}</button>
       <button type="button" class="ghost-btn icon-btn leave-cancel-btn" title="Cancel">${icon("x")}</button>`
    : `<button type="button" class="ghost-btn btn-edit icon-btn leave-copy-btn" title="Copy">${icon("copy")}</button>
       <button type="button" class="ghost-btn btn-edit icon-btn leave-edit-btn" title="Edit">${icon("edit")}</button>
       <button type="button" class="ghost-btn btn-danger icon-btn leave-del-btn" title="Delete">${icon("trash")}</button>`;
  tr.appendChild(actionsTd);

  const slTd = document.createElement("td");
  slTd.className = "sl-no-cell leave-sl-no";
  tr.appendChild(slTd);

  const customerTd = document.createElement("td");
  let customerSelect = null;
  if (editing) {
    customerSelect = document.createElement("select");
    customerSelect.className = "inline-cell";
    customerSelect.dataset.field = "customer_id";
    customerSelect.required = true;
    customerSelect.innerHTML = selectOptionsHtml(customers, "id", "customer_name", "Select customer…");
    if (item.customer_id) customerSelect.value = String(item.customer_id);
    customerTd.appendChild(customerSelect);
  } else {
    customerTd.textContent = item.customer_name || "—";
  }
  tr.appendChild(customerTd);

  const empIdTd = document.createElement("td");
  if (editing) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "inline-cell";
    input.dataset.field = "employee_id";
    input.value = item.employee_id || "";
    input.required = true;
    empIdTd.appendChild(input);
  } else {
    empIdTd.textContent = item.employee_id || "—";
  }
  tr.appendChild(empIdTd);

  const empNameTd = document.createElement("td");
  if (editing) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "inline-cell";
    input.dataset.field = "employee_name";
    input.value = item.employee_name || "";
    empNameTd.appendChild(input);
  } else {
    empNameTd.textContent = item.employee_name || "—";
  }
  tr.appendChild(empNameTd);

  const locationTd = document.createElement("td");
  if (editing) {
    const select = document.createElement("select");
    select.className = "inline-cell";
    select.dataset.field = "location_id";
    select.innerHTML = selectOptionsHtml(locations, "id", "name", "Select location…");
    if (item.location_id) select.value = String(item.location_id);
    locationTd.appendChild(select);
  } else {
    locationTd.textContent = item.location_name || "—";
  }
  tr.appendChild(locationTd);

  const bandTd = document.createElement("td");
  if (editing) {
    const select = document.createElement("select");
    select.className = "inline-cell";
    select.dataset.field = "band_id";
    select.innerHTML = selectOptionsHtml(bands, "id", "name", "Select band…");
    if (item.band_id) select.value = String(item.band_id);
    bandTd.appendChild(select);
  } else {
    bandTd.textContent = item.band_name || "—";
  }
  tr.appendChild(bandTd);

  const empTypeTd = document.createElement("td");
  if (editing) {
    const select = document.createElement("select");
    select.className = "inline-cell";
    select.dataset.field = "employee_type_id";
    select.innerHTML = selectOptionsHtml(employeeTypes, "id", "name", "Select employee type…");
    if (item.employee_type_id) select.value = String(item.employee_type_id);
    empTypeTd.appendChild(select);
  } else {
    empTypeTd.textContent = item.employee_type_name || "—";
  }
  tr.appendChild(empTypeTd);

  LEAVE_MONTH_FIELDS.forEach((field) => {
    const monthTd = document.createElement("td");
    if (editing) {
      const input = document.createElement("input");
      input.type = "number";
      input.step = "0.5";
      input.min = "0";
      input.className = "inline-cell leave-month-input";
      input.dataset.field = field;
      input.value = item[field] ?? 0;
      monthTd.appendChild(input);
    } else {
      monthTd.textContent = fmtPlain(item[field] || 0);
      monthTd.style.textAlign = "right";
    }
    tr.appendChild(monthTd);
  });

  if (editing) {
    actionsTd.querySelector(".leave-save-btn").addEventListener("click", () => saveLeaveRow(item, tr, customers, locations, employeeTypes, bands));
    actionsTd.querySelector(".leave-cancel-btn").addEventListener("click", () => {
      if (item.id) {
        replaceLeaveRow(tr, buildLeaveRow(item, false, customers, locations, employeeTypes, bands));
      } else {
        loadLeaves(); // discard the unsaved draft row and restore the normal listing
      }
    });
  } else {
    actionsTd.querySelector(".leave-copy-btn").addEventListener("click", () => {
      // Same id-less-draft-means-create convention as buildCustomerRow()'s
      // copy handler above.
      const tbody = tr.parentElement;
      const existingDraft = tbody.querySelector('tr[data-draft="true"]');
      if (existingDraft) {
        existingDraft.querySelector(".inline-cell").focus();
        return;
      }
      const draft = buildLeaveRow({ ...item, id: undefined }, true, customers, locations, employeeTypes, bands);
      draft.dataset.draft = "true";
      tbody.prepend(draft);
      draft.querySelector(".inline-cell").focus();
    });
    actionsTd.querySelector(".leave-edit-btn").addEventListener("click", () => {
      replaceLeaveRow(tr, buildLeaveRow(item, true, customers, locations, employeeTypes, bands));
    });
    actionsTd.querySelector(".leave-del-btn").addEventListener("click", async () => {
      if (confirm(`Delete the leave record for "${item.employee_name || item.employee_id}" (${item.customer_name})?`)) {
        const resp = await fetch(`${API}/leaves/${item.id}`, { method: "DELETE" });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          alert(formatApiError(err, "Failed to delete this leave record."));
          return;
        }
        loadLeaves();
      }
    });
  }

  return tr;
}

// Preserves the row's current Sl. No when toggling edit/read-only in
// place, same reasoning as Revenue Management's replaceRevenueRow().
function replaceLeaveRow(oldTr, newTr) {
  const slNo = oldTr.querySelector(".leave-sl-no")?.textContent;
  oldTr.replaceWith(newTr);
  if (slNo) newTr.querySelector(".leave-sl-no").textContent = slNo;
}

async function saveLeaveRow(item, tr, customers, locations, employeeTypes, bands) {
  const saveBtn = tr.querySelector(".leave-save-btn");
  const cancelBtn = tr.querySelector(".leave-cancel-btn");
  const customerId = tr.querySelector('.inline-cell[data-field="customer_id"]').value;
  const employeeId = tr.querySelector('.inline-cell[data-field="employee_id"]').value.trim();
  const employeeName = tr.querySelector('.inline-cell[data-field="employee_name"]').value.trim();
  if (!customerId || !employeeId) {
    alert("Customer Name and Employee ID are both required.");
    return;
  }
  const locationId = tr.querySelector('.inline-cell[data-field="location_id"]').value;
  const bandId = tr.querySelector('.inline-cell[data-field="band_id"]').value;
  const employeeTypeId = tr.querySelector('.inline-cell[data-field="employee_type_id"]').value;
  const payload = {
    customer_id: parseInt(customerId, 10),
    employee_id: employeeId,
    employee_name: employeeName || null,
    location_id: locationId ? parseInt(locationId, 10) : null,
    band_id: bandId ? parseInt(bandId, 10) : null,
    employee_type_id: employeeTypeId ? parseInt(employeeTypeId, 10) : null,
  };
  LEAVE_MONTH_FIELDS.forEach((field) => {
    const val = tr.querySelector(`.inline-cell[data-field="${field}"]`).value;
    payload[field] = val === "" ? 0 : parseFloat(val);
  });
  saveBtn.disabled = true;
  cancelBtn.disabled = true;
  try {
    const url = item.id ? `${API}/leaves/${item.id}` : `${API}/leaves`;
    const method = item.id ? "PUT" : "POST";
    const resp = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      alert(formatApiError(err, "Failed to save leave record."));
      return;
    }
    await loadLeaves();
  } finally {
    saveBtn.disabled = false;
    cancelBtn.disabled = false;
  }
}

async function loadLeaves() {
  const [items, customers, locations, employeeTypes, bands] = await Promise.all([
    fetch(`${API}/leaves`).then((r) => r.json()),
    fetch(`${API}/customers`).then((r) => r.json()),
    fetch(`${API}/locations`).then((r) => r.json()),
    fetch(`${API}/employee-types`).then((r) => r.json()),
    fetch(`${API}/bands`).then((r) => r.json()),
  ]);
  const tbody = document.getElementById("leaveTableBody");
  tbody.innerHTML = "";
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="20" class="empty-state">No leave records yet. Click "Add Leave Record" to add one.</td></tr>';
    return;
  }
  items.forEach((item, idx) => {
    const tr = buildLeaveRow(item, false, customers, locations, employeeTypes, bands);
    tr.querySelector(".leave-sl-no").textContent = idx + 1;
    tbody.appendChild(tr);
  });
}

document.getElementById("newLeaveBtn").addEventListener("click", async () => {
  const tbody = document.getElementById("leaveTableBody");
  const existingDraft = tbody.querySelector('tr[data-draft="true"]');
  if (existingDraft) {
    existingDraft.querySelector(".inline-cell").focus();
    return;
  }
  const [customers, locations, employeeTypes, bands] = await Promise.all([
    fetch(`${API}/customers`).then((r) => r.json()),
    fetch(`${API}/locations`).then((r) => r.json()),
    fetch(`${API}/employee-types`).then((r) => r.json()),
    fetch(`${API}/bands`).then((r) => r.json()),
  ]);
  if (tbody.querySelector(".empty-state")) tbody.innerHTML = "";
  const draft = buildLeaveRow({}, true, customers, locations, employeeTypes, bands);
  draft.dataset.draft = "true";
  tbody.prepend(draft);
  draft.querySelector(".inline-cell").focus();
});

// "Import from Excel" for Leave Tracker - same {imported, errors} result
// shape as the Time and Material grid's own import (see import_leaves() in
// main.py), but with no fiscal year concept and its own reload afterward,
// so it's a small dedicated handler rather than reusing wireExcelImport()
// above (which is tied to the current fiscal year and Revenue Management's
// own reload).
document.getElementById("importLeaveBtn").addEventListener("click", () => {
  document.getElementById("leaveImportFile").click();
});
document.getElementById("leaveImportFile").addEventListener("change", async () => {
  const fileInput = document.getElementById("leaveImportFile");
  const button = document.getElementById("importLeaveBtn");
  const file = fileInput.files[0];
  if (!file) return;
  button.disabled = true;
  try {
    const formData = new FormData();
    formData.append("file", file);
    const resp = await fetch(`${API}/leaves/import`, { method: "POST", body: formData });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      alert(formatApiError(result, "Failed to import this file."));
      return;
    }
    const errorLines = (result.errors || []).map((e) => `Row ${e.row}: ${e.message}`);
    let message = `Imported ${result.imported || 0} row${result.imported === 1 ? "" : "s"}.`;
    if (errorLines.length) {
      message += `\n\n${errorLines.length} row${errorLines.length === 1 ? "" : "s"} skipped:\n${errorLines.join("\n")}`;
    }
    alert(message);
    if (result.imported) await loadLeaves();
  } finally {
    button.disabled = false;
    fileInput.value = "";
  }
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
      <td class="row-actions">
        <button class="ghost-btn btn-edit icon-btn edit-r-btn" title="Edit">${icon("edit")}</button>
        <button class="ghost-btn btn-danger icon-btn del-r-btn" title="Delete">${icon("trash")}</button>
      </td>
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
  indigo: "#0284c7", emerald: "#55e07e", amber: "#f59e0b", red: "#ef4444",
  orange: "#ff9d50", cyan: "#1dced8", pink: "#db2777", slate: "#64748b",
};

// Chart.js instances, kept so loadHome() can destroy+recreate them each time
// the Dashboard tab is opened (Chart.js throws if a canvas already has a
// live chart bound to it).
const homeCharts = { resourceLocation: null };

function destroyHomeCharts() {
  Object.keys(homeCharts).forEach((k) => {
    if (homeCharts[k]) { homeCharts[k].destroy(); homeCharts[k] = null; }
  });
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

  // Projections circle tile - fiscal-year total summed straight from the
  // same (possibly customer-filtered) accounts list used above, across all
  // 12 months of each account.
  const totalProjections = filteredAccounts.reduce(
    (sum, acc) => sum + acc.months.reduce((s, m) => s + (m.projection || 0), 0),
    0
  );
  const dashCircleProjectionsEl = document.getElementById("dashCircleProjections");
  dashCircleProjectionsEl.textContent = fmtCompact(totalProjections);
  dashCircleProjectionsEl.title = fmt(totalProjections);
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
let revenueRevenueTypeFilter = "";
let revenuePracticeFilter = "";
document.getElementById("revenueCustomerFilter").addEventListener("change", (e) => {
  revenueCustomerFilter = e.target.value;
  loadRevenueSows();
});
document.getElementById("revenueBillingModelFilter").addEventListener("change", (e) => {
  revenueBillingModelFilter = e.target.value;
  loadRevenueSows();
});
document.getElementById("revenueRevenueTypeFilter").addEventListener("change", (e) => {
  revenueRevenueTypeFilter = e.target.value;
  loadRevenueSows();
});
document.getElementById("revenuePracticeFilter").addEventListener("change", (e) => {
  revenuePracticeFilter = e.target.value;
  loadRevenueSows();
});

// Time and Material assignment ids already tracked on the currently-loaded
// fiscal year's grid, and the last-loaded data for each (by assignment_id) -
// same purpose as revenueTrackedSowIds/revenueSowsCache above, but unlike
// those, Time and Material doesn't need a "keep the Add Entry row from
// offering this again" set: several assignments can share one Contract, so
// the Contract Title dropdown never excludes already-tracked ones.
let tmAssignmentsCache = new Map();
// Time and Material's own Customer filter - separate from
// revenueCustomerFilter (Managed Services') since the two grids are
// different data and a user may want to filter each independently.
let tmCustomerFilter = "";
document.getElementById("tmCustomerFilter").addEventListener("change", (e) => {
  tmCustomerFilter = e.target.value;
  loadTmAssignments();
});

// Billing Model/Revenue Type/Location/Employee Practice filters for the
// Time and Material grid - same id-based client-side filtering approach as
// tmCustomerFilter above, each independent of the others.
let tmBillingModelFilter = "";
let tmRevenueTypeFilter = "";
let tmLocationFilter = "";
let tmPracticeFilter = "";
document.getElementById("tmBillingModelFilter").addEventListener("change", (e) => {
  tmBillingModelFilter = e.target.value;
  loadTmAssignments();
});
document.getElementById("tmRevenueTypeFilter").addEventListener("change", (e) => {
  tmRevenueTypeFilter = e.target.value;
  loadTmAssignments();
});
document.getElementById("tmLocationFilter").addEventListener("change", (e) => {
  tmLocationFilter = e.target.value;
  loadTmAssignments();
});
document.getElementById("tmPracticeFilter").addEventListener("change", (e) => {
  tmPracticeFilter = e.target.value;
  loadTmAssignments();
});

// Customer/Billing Model/Revenue Type/Practice filters for Managed
// Services - same shared-predicate reasoning as tmRowMatchesFilters()
// below, just for the SoW Level Detail grid instead of the TM grid.
function revenueSowMatchesFilters(r) {
  return (
    (!revenueCustomerFilter || String(r.customer_id) === revenueCustomerFilter) &&
    (!revenueBillingModelFilter || (r.billing_model_name || "") === revenueBillingModelFilter) &&
    (!revenueRevenueTypeFilter || String(r.revenue_type_id) === revenueRevenueTypeFilter) &&
    (!revenuePracticeFilter || String(r.practice_id) === revenuePracticeFilter)
  );
}

// Matches loadTmAssignments()'s/the Add-Entry save handler's own inline
// filter predicate - pulled into one shared function so the two call sites
// (and any future one) can't drift apart.
function tmRowMatchesFilters(r) {
  return (
    (!tmCustomerFilter || String(r.customer_id) === tmCustomerFilter) &&
    (!tmBillingModelFilter || String(r.billing_model_id) === tmBillingModelFilter) &&
    (!tmRevenueTypeFilter || String(r.revenue_type_id) === tmRevenueTypeFilter) &&
    (!tmLocationFilter || String(r.location_id) === tmLocationFilter) &&
    (!tmPracticeFilter || String(r.practice_id) === tmPracticeFilter)
  );
}

function populateRevenueCustomerFilter(customers) {
  const select = document.getElementById("revenueCustomerFilter");
  // Read from the revenueCustomerFilter variable rather than select.value -
  // a Best Estimates menu click (see applyRevenueMenuPreset()) resets that
  // variable directly without touching the <select> itself, so trusting
  // select.value here would keep showing whatever was previously picked.
  const current = revenueCustomerFilter;
  select.innerHTML = '<option value="">All customers</option>' +
    customers.map((c) => `<option value="${c.id}">${escapeHtml(c.customer_name)}</option>`).join("");
  select.value = current;
}

function populateRevenueBillingModelFilter(models) {
  const select = document.getElementById("revenueBillingModelFilter");
  // Read from the revenueBillingModelFilter variable rather than select.value:
  // a Best Estimates menu preset (see applyRevenueMenuPreset()) sets that
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

function populateTmCustomerFilter(customers) {
  const select = document.getElementById("tmCustomerFilter");
  const current = tmCustomerFilter;
  select.innerHTML = '<option value="">All customers</option>' +
    customers.map((c) => `<option value="${c.id}">${escapeHtml(c.customer_name)}</option>`).join("");
  select.value = current;
}

// Revenue Type/Practice filters for Managed Services - same "read from the
// filter variable, not select.value" reasoning as populateRevenueBillingModelFilter()
// above (a Best Estimates menu preset can set the variable before the
// <select> has its options yet).
function populateRevenueRevenueTypeFilter(revenueTypes) {
  const select = document.getElementById("revenueRevenueTypeFilter");
  const current = revenueRevenueTypeFilter;
  select.innerHTML = '<option value="">All revenue types</option>' +
    revenueTypes.map((rt) => `<option value="${rt.id}">${escapeHtml(rt.name)}</option>`).join("");
  select.value = current;
}

function populateRevenuePracticeFilter(practices) {
  const select = document.getElementById("revenuePracticeFilter");
  const current = revenuePracticeFilter;
  select.innerHTML = '<option value="">All practices</option>' +
    practices.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  select.value = current;
}

// Billing Model/Revenue Type/Location/Employee Practice filters for Time
// and Material - same pattern as populateTmCustomerFilter() above.
function populateTmBillingModelFilter(billingModels) {
  const select = document.getElementById("tmBillingModelFilter");
  const current = tmBillingModelFilter;
  select.innerHTML = '<option value="">All billing models</option>' +
    billingModels.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("");
  select.value = current;
}

function populateTmRevenueTypeFilter(revenueTypes) {
  const select = document.getElementById("tmRevenueTypeFilter");
  const current = tmRevenueTypeFilter;
  select.innerHTML = '<option value="">All revenue types</option>' +
    revenueTypes.map((rt) => `<option value="${rt.id}">${escapeHtml(rt.name)}</option>`).join("");
  select.value = current;
}

function populateTmLocationFilter(locations) {
  const select = document.getElementById("tmLocationFilter");
  const current = tmLocationFilter;
  select.innerHTML = '<option value="">All locations</option>' +
    locations.map((l) => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join("");
  select.value = current;
}

function populateTmPracticeFilter(practices) {
  const select = document.getElementById("tmPracticeFilter");
  const current = tmPracticeFilter;
  select.innerHTML = '<option value="">All employee practices</option>' +
    practices.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  select.value = current;
}

let currentRevenueTypes = [];
let currentPractices = [];
let currentLocations = [];
let currentTmCustomers = [];
let currentAllSows = [];
let currentBillingHourConfigs = [];

// Looked up client-side purely for the Time and Material grid's live
// "Billing Hours per day" display while adding/editing a row (before the
// row is saved and the server recomputes it) - the actual Projections
// formula always uses the server's own lookup (_billing_hours_per_day in
// main.py), this is only a preview.
function billingHoursFor(customerId, locationId) {
  if (!customerId || !locationId) return null;
  const location = currentLocations.find((l) => String(l.id) === String(locationId));
  const slug = (location?.name || "").trim().toLowerCase();
  if (!["onsite", "offshore", "nearshore"].includes(slug)) return null;
  const match = currentBillingHourConfigs.find((b) => String(b.customer_id) === String(customerId));
  return match ? match[`${slug}_hours`] : null;
}

async function loadRevenueTab() {
  if (currentFiscalYear === null) currentFiscalYear = fiscalYearForToday();
  const [customers, billingModels, revenueTypes, practices, locations, allSows, billingHourConfigs] = await Promise.all([
    fetch(`${API}/customers`).then((r) => r.json()),
    fetch(`${API}/billing-models`).then((r) => r.json()),
    fetch(`${API}/revenue-types`).then((r) => r.json()),
    fetch(`${API}/practices`).then((r) => r.json()),
    fetch(`${API}/locations`).then((r) => r.json()),
    fetch(`${API}/sows`).then((r) => r.json()),
    fetch(`${API}/billing-hours`).then((r) => r.json()),
  ]);
  populateRevenueCustomerFilter(customers);
  populateRevenueBillingModelFilter(billingModels);
  populateRevenueRevenueTypeFilter(revenueTypes);
  populateRevenuePracticeFilter(practices);
  populateTmCustomerFilter(customers);
  populateTmBillingModelFilter(billingModels);
  populateTmRevenueTypeFilter(revenueTypes);
  populateTmLocationFilter(locations);
  populateTmPracticeFilter(practices);
  currentRevenueTypes = revenueTypes;
  currentPractices = practices;
  currentLocations = locations;
  currentTmCustomers = customers;
  currentAllSows = allSows;
  currentBillingHourConfigs = billingHourConfigs;
  // Both grids load every time the Revenue Management tab opens, regardless of which
  // category is currently shown - simpler and more robust than fetching on
  // demand only when a leaf switches category, and avoids stale data if the
  // user flips between Managed Services and Time and Material without a
  // full tab reload in between.
  await Promise.all([loadRevenueSows(), loadTmAssignments()]);
}

// Revenue Summary (SoW Level). Rows display read-only by default; clicking
// "Edit" on a row reveals input boxes for its 12 months, and "Save" commits
// them and reverts the row back to read-only display.
async function loadRevenueSows() {
  const data = await fetch(`${API}/revenue/sows?fiscal_year=${currentFiscalYear}`).then((r) => r.json());
  revenueTrackedSowIds = new Set(data.rows.map((r) => r.sow_id));
  revenueSowsCache = new Map(data.rows.map((r) => [r.sow_id, r]));

  const filteredRows = data.rows.filter(revenueSowMatchesFilters);

  const tbody = document.getElementById("revenueSowsTableBody");
  tbody.innerHTML = "";
  if (!filteredRows.length) {
    tbody.innerHTML = `<tr><td colspan="32" class="empty-state">${
      data.rows.length ? "No entries match the selected filters." : 'No entries yet. Click "Add Entry" to start tracking revenue for a SOW.'
    }</td></tr>`;
  } else {
    filteredRows.forEach((r) => tbody.appendChild(buildRevenueSowRow(r, false)));
    renumberRevenueRows();
  }
  renderRevenueTypeSummaryTable(filteredRows);
}

// Revenue Type x Month summary table above the detail grid - one row per
// Revenue Type in the master list (even ones no currently-visible row uses,
// so the shape stays stable as filters change), summing Projections for
// each month across the rows passed in (already filtered by whatever the
// grid below is filtered by, so the two stay in sync). A row with no
// Revenue Type assigned (on its Contract for Managed Services, on the
// assignment itself for Time and Material) is grouped under "Unassigned"
// rather than silently dropped, but only shown when at least one visible
// row actually needs it. Shared by both the Managed Services
// (tbodyId="revenueTypeSummaryBody", the default) and Time and Material
// (tbodyId="tmRevenueTypeSummaryBody") sections - both summarize rows by
// revenue_type_name the same way.
function renderRevenueTypeSummaryTable(filteredRows, tbodyId = "revenueTypeSummaryBody") {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  const field = "projection";

  const sumsByType = new Map();
  filteredRows.forEach((r) => {
    const key = r.revenue_type_name || "";
    if (!sumsByType.has(key)) sumsByType.set(key, new Array(12).fill(0));
    const sums = sumsByType.get(key);
    r.months.forEach((m, i) => { sums[i] += m[field] || 0; });
  });

  const labels = currentRevenueTypes.map((rt) => rt.name);
  if (sumsByType.has("")) labels.push("Unassigned");

  tbody.innerHTML = "";
  if (!labels.length) {
    tbody.innerHTML = `<tr class="revenue-type-empty-row"><td colspan="18" class="empty-state">No Revenue Types configured yet - add some under Global Settings.</td></tr>`;
    return;
  }
  labels.forEach((label) => {
    const key = label === "Unassigned" ? "" : label;
    const sums = sumsByType.get(key) || new Array(12).fill(0);
    // sums is fiscal-month order (index 0 = Apr ... 11 = Mar), matching the
    // header's Apr..Mar layout - quarters are fixed 3-month slices of that
    // same order: Q1 = Apr-Jun (0-2), Q2 = Jul-Sep (3-5), Q3 = Oct-Dec (6-8),
    // Q4 = Jan-Mar (9-11).
    const total = sums.reduce((a, v) => a + v, 0);
    const q1 = sums[0] + sums[1] + sums[2];
    const q2 = sums[3] + sums[4] + sums[5];
    const q3 = sums[6] + sums[7] + sums[8];
    const q4 = sums[9] + sums[10] + sums[11];
    // rts-highlight-col matches the same class on the Total/Q1-Q4 <th>s in
    // index.html - gives these aggregate columns a distinct color from the
    // plain monthly detail columns (per explicit instruction) so they're
    // easy to pick out at a glance.
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(label)}</td><td class="rts-highlight-col">${fmtPlain(total)}</td>` +
      `<td>${fmtPlain(sums[0])}</td><td>${fmtPlain(sums[1])}</td><td>${fmtPlain(sums[2])}</td><td class="rts-highlight-col">${fmtPlain(q1)}</td>` +
      `<td>${fmtPlain(sums[3])}</td><td>${fmtPlain(sums[4])}</td><td>${fmtPlain(sums[5])}</td><td class="rts-highlight-col">${fmtPlain(q2)}</td>` +
      `<td>${fmtPlain(sums[6])}</td><td>${fmtPlain(sums[7])}</td><td>${fmtPlain(sums[8])}</td><td class="rts-highlight-col">${fmtPlain(q3)}</td>` +
      `<td>${fmtPlain(sums[9])}</td><td>${fmtPlain(sums[10])}</td><td>${fmtPlain(sums[11])}</td><td class="rts-highlight-col">${fmtPlain(q4)}</td>`;
    tbody.appendChild(tr);
  });
}

// Fills in the leading "Sl. No" cell of every data row (skipping any
// in-progress "Add Entry" draft row) based on current DOM
// order. Re-run after anything that changes the row set or order - a full
// reload (loadRevenueSows()) or splicing in a newly-saved entry - rather
// than baking a fixed number into each row, since edit/cancel toggle a row
// in place (see buildRevenueSowRow()) without knowing its position.
function renumberRevenueRows() {
  const tbody = document.getElementById("revenueSowsTableBody");
  let n = 0;
  tbody.querySelectorAll("tr").forEach((tr) => {
    if (tr.classList.contains("revenue-draft-row")) return;
    const cell = tr.querySelector(".rev-sl-no");
    if (cell) {
      n += 1;
      cell.textContent = n;
    }
  });
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
  // Actions comes first (app-wide convention: wherever a table has both
  // Sl. No and Actions, Actions is column 1 and Sl. No is column 2). Sl. No
  // itself is left blank here and filled in by renumberRevenueRows() based
  // on the row's actual position in the table, since this function rebuilds
  // a single row in place for edit/cancel toggling without knowing its index.
  let cells = editing
    ? `<td class="row-actions">
        <button type="button" class="ghost-btn btn-edit icon-btn rev-save-btn" title="Save">${icon("check")}</button>
        <button type="button" class="ghost-btn icon-btn rev-cancel-btn" title="Cancel">${icon("x")}</button>
      </td>`
    : `<td class="row-actions">
        <button type="button" class="ghost-btn btn-edit icon-btn rev-copy-btn" title="Copy">${icon("copy")}</button>
        <button type="button" class="ghost-btn btn-edit icon-btn rev-edit-btn" title="Edit">${icon("edit")}</button>
        <button type="button" class="ghost-btn btn-danger icon-btn rev-del-btn" title="Delete">${icon("trash")}</button>
      </td>`;
  cells += `<td class="rev-sl-no"></td>`;
  cells += `<td>${escapeHtml(r.customer_name)}</td><td>${escapeHtml(r.sow_title)}</td><td class="rev-tcv-cell">${fmt(r.total_value)}</td><td class="rev-tcv-cell">${fmt(r.acv)}</td><td>${escapeHtml(r.billing_model_name) || "—"}</td>`;
  // Revenue Type and Practice are the two Contract fields this grid lets you
  // change directly (everything else about the Contract still goes through
  // the full SOW form) - editable selects while editing, plain text
  // otherwise. Options are filled in and pre-selected after tr.innerHTML is
  // set below, same as the read-only cells further up render from r's
  // *_name fields.
  cells += editing
    ? `<td><select class="rev-revenue-type-select"></select></td><td><select class="rev-practice-select"></select></td>`
    : `<td>${escapeHtml(r.revenue_type_name) || "—"}</td><td>${escapeHtml(r.practice_name) || "—"}</td>`;
  // Alternating background per month (rev-band-a/rev-band-b) so adjacent
  // months are visually grouped and easy to tell apart - matches the same
  // classes on the header cells.
  r.months.forEach((m, i) => {
    const band = i % 2 === 0 ? "rev-band-a" : "rev-band-b";
    cells += editing
      ? `<td class="${band}"><input type="number" step="0.01" class="rev-cell" data-fiscal-month="${m.fiscal_month}" data-field="projection" value="${m.projection}" /></td>`
      : `<td class="rev-readonly-cell ${band}">${fmtPlain(m.projection)}</td>`;
  });
  tr.innerHTML = cells;

  if (editing) {
    const revenueTypeSelect = tr.querySelector(".rev-revenue-type-select");
    revenueTypeSelect.innerHTML = `<option value="">Select revenue type&hellip;</option>` +
      currentRevenueTypes.map((rt) => `<option value="${rt.id}">${escapeHtml(rt.name)}</option>`).join("");
    revenueTypeSelect.value = r.revenue_type_id ?? "";

    const practiceSelect = tr.querySelector(".rev-practice-select");
    practiceSelect.innerHTML = `<option value="">Select practice&hellip;</option>` +
      currentPractices.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
    practiceSelect.value = r.practice_id ?? "";

    tr.querySelector(".rev-save-btn").addEventListener("click", () => saveRevenueRow(r.sow_id, tr));
    tr.querySelector(".rev-cancel-btn").addEventListener("click", () => {
      const cached = revenueSowsCache.get(r.sow_id) || r;
      replaceRevenueRow(tr, buildRevenueSowRow(cached, false));
    });
  } else {
    tr.querySelector(".rev-copy-btn").addEventListener("click", () => {
      // A SOW can only be tracked once per fiscal year, so "Copy" can't
      // literally duplicate this row (same sow_id, same fiscal_year) - it
      // opens the same Add Entry draft instead, pre-selecting this row's
      // Customer (narrowing the SOW dropdown to that customer's other
      // untracked SOWs) and carrying over the 12 months' figures as a
      // starting point once a SOW is picked. See openRevenueEntryDraft().
      openRevenueEntryDraft({ customerId: r.customer_id, months: r.months });
    });
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

// Collects the 12 months' input values plus the Revenue Type/Practice
// selects from an editing row and saves both (months via the per-cell
// upsert endpoint - there's no bulk-upsert - and Revenue Type/Practice via
// the narrow /classification endpoint, since those two actually live on the
// Contract, not on a revenue_entries row), then reloads the grid so the row
// reverts to read-only display showing the saved values.
async function saveRevenueRow(sowId, tr) {
  const saveBtn = tr.querySelector(".rev-save-btn");
  const cancelBtn = tr.querySelector(".rev-cancel-btn");
  saveBtn.disabled = true;
  cancelBtn.disabled = true;
  const projectionInputs = tr.querySelectorAll('.rev-cell[data-field="projection"]');
  const payloads = Array.from(projectionInputs).map((projectionInput) => {
    const fiscalMonth = parseInt(projectionInput.dataset.fiscalMonth, 10);
    return {
      sow_id: sowId,
      fiscal_year: currentFiscalYear,
      fiscal_month: fiscalMonth,
      projection: parseFloat(projectionInput.value) || 0,
    };
  });
  const revenueTypeVal = tr.querySelector(".rev-revenue-type-select").value;
  const practiceVal = tr.querySelector(".rev-practice-select").value;
  const classificationPayload = {
    revenue_type_id: revenueTypeVal ? parseInt(revenueTypeVal, 10) : null,
    practice_id: practiceVal ? parseInt(practiceVal, 10) : null,
  };
  try {
    const responses = await Promise.all([
      ...payloads.map((payload) =>
        fetch(`${API}/revenue/sows`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      ),
      fetch(`${API}/sows/${sowId}/classification`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(classificationPayload) }),
    ]);
    const failed = responses.find((resp) => !resp.ok);
    if (failed) {
      const err = await failed.json().catch(() => ({}));
      alert(formatApiError(err, "Failed to save this row."));
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

// Shared "Import from Excel" wiring, used by the Time and Material grid
// (SoW Level Detail's own Download template/Import from Excel were removed
// from that toolbar per request - see index.html - so this is only called
// once now, but stays generic/parameterized rather than being inlined,
// in case a future page needs the same pattern). The visible button just
// proxies a click to its paired hidden <input type=file> (see index.html),
// and picking a file uploads it to the given import endpoint for the fiscal
// year currently on screen, then reports back which rows imported and which
// didn't (the {imported, errors} shape import_tm_assignments() in main.py
// returns - each error names the sheet row and why it was skipped, e.g. a
// Customer Name/Contract Title that didn't match anything). A full
// loadRevenueTab() reload afterward is simpler and safer than patching just
// the grid that changed - it also keeps both grids' shared lookups/caches
// (customers, billing hours, tracked-SOW ids, ...) in sync either way.
function wireExcelImport(buttonId, fileInputId, importPath) {
  const button = document.getElementById(buttonId);
  const fileInput = document.getElementById(fileInputId);
  button.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (currentFiscalYear === null) currentFiscalYear = fiscalYearForToday();
    button.disabled = true;
    try {
      const formData = new FormData();
      formData.append("file", file);
      const resp = await fetch(`${API}${importPath}?fiscal_year=${currentFiscalYear}`, { method: "POST", body: formData });
      const result = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        alert(formatApiError(result, "Failed to import this file."));
        return;
      }
      const errorLines = (result.errors || []).map((e) => `Row ${e.row}: ${e.message}`);
      let message = `Imported ${result.imported || 0} row${result.imported === 1 ? "" : "s"}.`;
      if (errorLines.length) {
        message += `\n\n${errorLines.length} row${errorLines.length === 1 ? "" : "s"} skipped:\n${errorLines.join("\n")}`;
      }
      alert(message);
      if (result.imported) await loadRevenueTab();
    } finally {
      button.disabled = false;
      fileInput.value = "";
    }
  });
}
wireExcelImport("importTmBtn", "tmImportFile", "/tm/assignments/import");
wireExcelImport("importRevenueSowsBtn", "revenueSowsImportFile", "/revenue/sows/import");

// Builds the 12 month <td>s (Projections only) for the "Add Entry" draft row
// - read-only "—" placeholders before a SOW is picked, real number inputs
// once one is (see setDraftMonthsEditable() below). Mirrors the same
// fiscal-month/band pattern buildRevenueSowRow() uses for a tracked row, but
// starting from blank/zero values since nothing has been saved yet.
function draftMonthCellsHtml(editable) {
  let html = "";
  for (let fm = 1; fm <= 12; fm++) {
    const band = (fm - 1) % 2 === 0 ? "rev-band-a" : "rev-band-b";
    html += editable
      ? `
        <td class="${band} draft-month-cell">
          <input type="number" step="0.01" class="rev-cell draft-projection-input" data-fiscal-month="${fm}" data-field="projection" value="0" />
        </td>
      `
      : `
        <td class="rev-readonly-cell ${band} draft-month-cell">—</td>
      `;
  }
  return html;
}

// Add Entry - adds a new row directly in the datatable (no popup): a
// Customer dropdown narrows a SOW dropdown to that customer's SOWs. The
// month columns start out read-only ("—") and switch to editable inputs as
// soon as a SOW is chosen, so Save commits everything typed in in one shot
// instead of a separate "register, then edit, then save again" round trip.
// Also the basis for "Copy" on an existing row (see buildRevenueSowRow's
// rev-copy-btn handler above): prefill.customerId pre-selects the Customer
// dropdown (narrowing the SOW dropdown to that customer's other untracked
// SOWs) and prefill.months carries over the source row's 12 figures as a
// starting point once a SOW is actually picked - both are undefined for a
// plain "Add Entry" click, which behaves exactly as before.
async function openRevenueEntryDraft(prefill = {}) {
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
    <td class="draft-tcv rev-tcv-cell">&mdash;</td>
    <td class="draft-acv rev-tcv-cell">&mdash;</td>
    <td class="draft-billing-model">&mdash;</td>
    <td><select class="draft-revenue-type-select" disabled><option value="">Select revenue type&hellip;</option></select></td>
    <td><select class="draft-practice-select" disabled><option value="">Select practice&hellip;</option></select></td>
    ${draftMonthCellsHtml(false)}
  `;
  tbody.insertBefore(tr, tbody.firstChild);

  const accountSelect = tr.querySelector(".draft-account-select");
  const sowSelect = tr.querySelector(".draft-sow-select");
  const tcvCell = tr.querySelector(".draft-tcv");
  const acvCell = tr.querySelector(".draft-acv");
  const billingModelCell = tr.querySelector(".draft-billing-model");
  const revenueTypeSelect = tr.querySelector(".draft-revenue-type-select");
  const practiceSelect = tr.querySelector(".draft-practice-select");
  const saveBtn = tr.querySelector(".draft-save-btn");

  // Options don't depend on the chosen customer/SOW, so fill them in once
  // up front - only the enabled state and the pre-selected value change as
  // a SOW is picked (see the sowSelect/accountSelect handlers below).
  revenueTypeSelect.innerHTML = `<option value="">Select revenue type&hellip;</option>` +
    currentRevenueTypes.map((rt) => `<option value="${rt.id}">${escapeHtml(rt.name)}</option>`).join("");
  practiceSelect.innerHTML = `<option value="">Select practice&hellip;</option>` +
    currentPractices.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");

  function setDraftMonthsEditable(editable) {
    tr.querySelectorAll(".draft-month-cell").forEach((td) => td.remove());
    practiceSelect.closest("td").insertAdjacentHTML("afterend", draftMonthCellsHtml(editable));
    // Copy's starting point: fill the freshly-(re)built inputs with the
    // source row's monthly figures instead of leaving them at 0, so
    // duplicating a row's numbers onto a different SOW doesn't mean
    // retyping all 24 of them. No-op for a plain "Add Entry" (no
    // prefill.months) and while the placeholders are still read-only.
    if (editable && prefill.months) {
      prefill.months.forEach((m) => {
        const projInput = tr.querySelector(`.draft-projection-input[data-fiscal-month="${m.fiscal_month}"]`);
        if (projInput) projInput.value = m.projection;
      });
    }
  }

  accountSelect.addEventListener("change", () => {
    const val = accountSelect.value;
    saveBtn.disabled = true;
    tcvCell.textContent = "—";
    acvCell.textContent = "—";
    billingModelCell.textContent = "—";
    revenueTypeSelect.value = "";
    revenueTypeSelect.disabled = true;
    practiceSelect.value = "";
    practiceSelect.disabled = true;
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
    tcvCell.textContent = selectedSow ? fmt(selectedSow.total_value) : "—";
    acvCell.textContent = selectedSow ? fmt(selectedSow.acv) : "—";
    billingModelCell.textContent = (selectedSow && selectedSow.billing_model_name) || "—";
    revenueTypeSelect.value = (selectedSow && selectedSow.revenue_type_id) ?? "";
    revenueTypeSelect.disabled = !hasSow;
    practiceSelect.value = (selectedSow && selectedSow.practice_id) ?? "";
    practiceSelect.disabled = !hasSow;
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
      return {
        fiscal_month: fiscalMonth,
        projection: parseFloat(projectionInput.value) || 0,
      };
    });

    // Revenue Type/Practice are editable right here too (see the template
    // above), same fields and same narrow /classification endpoint as
    // saveRevenueRow()'s edit mode - so a value changed while adding the
    // entry is written back onto the Contract, not just this fiscal year's
    // tracking row.
    const revenueTypeId = revenueTypeSelect.value ? parseInt(revenueTypeSelect.value, 10) : null;
    const practiceId = practiceSelect.value ? parseInt(practiceSelect.value, 10) : null;

    const responses = await Promise.all([
      ...months.map((m) =>
        fetch(`${API}/revenue/sows`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sow_id: parseInt(sowId, 10), fiscal_year: currentFiscalYear, ...m }),
        })
      ),
      fetch(`${API}/sows/${sowId}/classification`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revenue_type_id: revenueTypeId, practice_id: practiceId }),
      }),
    ]);
    const failed = responses.find((resp) => !resp.ok);
    if (failed) {
      const err = await failed.json().catch(() => ({}));
      alert(formatApiError(err, "Failed to save this entry."));
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
      return;
    }

    const revenueTypeName = (currentRevenueTypes.find((rt) => rt.id === revenueTypeId) || {}).name || null;
    const practiceName = (currentPractices.find((p) => p.id === practiceId) || {}).name || null;
    const newRow = {
      sow_id: selectedSow.id,
      sow_title: selectedSow.title,
      customer_id: selectedSow.customer_id,
      customer_name: selectedSow.customer_name || "Unassigned",
      total_value: selectedSow.total_value,
      duration_months: selectedSow.duration_months,
      acv: selectedSow.acv,
      billing_model_name: selectedSow.billing_model_name,
      revenue_type_name: revenueTypeName,
      practice_name: practiceName,
      months,
    };
    revenueTrackedSowIds.add(newRow.sow_id);
    revenueSowsCache.set(newRow.sow_id, newRow);
    tr.replaceWith(buildRevenueSowRow(newRow, false));
    renumberRevenueRows();
    // Keep the Revenue Type summary table above in sync too, without a full
    // loadRevenueSows() reload (this row was spliced into the DOM directly
    // to preserve the rest of the grid's state) - same Customer/Billing
    // Model filter predicate loadRevenueSows() itself uses, applied to the
    // now up-to-date revenueSowsCache.
    const currentlyFiltered = Array.from(revenueSowsCache.values()).filter(revenueSowMatchesFilters);
    renderRevenueTypeSummaryTable(currentlyFiltered);
  });

  // Copy: pre-select this row's customer so the SOW dropdown is narrowed to
  // its other untracked SOWs immediately, same as if the user had just
  // picked it themselves - accountSelect's own "change" handler above does
  // the rest (populating sowSelect; the month values are filled in by
  // setDraftMonthsEditable() once a SOW is actually chosen). No-op for a
  // plain "Add Entry" (no prefill.customerId) or if that customer has
  // nothing left to copy onto (every one of its SOWs already tracked).
  if (prefill.customerId && Array.from(accountSelect.options).some((o) => o.value === String(prefill.customerId))) {
    accountSelect.value = String(prefill.customerId);
    accountSelect.dispatchEvent(new Event("change"));
  }
}

document.getElementById("newRevenueEntryBtn").addEventListener("click", () => openRevenueEntryDraft());

// ---------- Time and Material (Best Estimates > Time and Material). One
// row per employee assignment to a Contract, not one row per SOW, so the
// same Contract can appear on multiple rows. Mirrors the Managed Services
// grid's inline-edit / inline-draft-row pattern above. --------------------

function computeFinalRate(rateCard, discountPct) {
  const rate = parseFloat(rateCard);
  if (isNaN(rate)) return null;
  const pct = parseFloat(discountPct) || 0;
  return rate * (1 - pct / 100);
}

function tmSowsForCustomer(customerId) {
  if (!customerId) return [];
  return currentAllSows.filter((s) => String(s.customer_id) === String(customerId));
}

// Opportunity ID, Purchase Order # and Contract Code shown on a Time and
// Material row are always the linked SOW's own fields (never edited per
// assignment - see _TM_ASSIGNMENT_SELECT in main.py), so both
// buildTmAssignmentRow's edit form and the Add Entry draft row look them up
// client-side from the already-fetched currentAllSows list for a live
// preview, the same convention as billingHoursFor()'s preview.
function tmSowDerivedFields(sowId) {
  const sow = sowId ? currentAllSows.find((s) => String(s.id) === String(sowId)) : null;
  return {
    opportunity_id: sow ? sow.opportunity_id : null,
    po_number: sow ? sow.po_number : null,
    contract_code: sow ? sow.contract_code : null,
  };
}

async function loadTmAssignments() {
  const data = await fetch(`${API}/tm/assignments?fiscal_year=${currentFiscalYear}`).then((r) => r.json());
  tmAssignmentsCache = new Map(data.rows.map((r) => [r.assignment_id, r]));
  const filteredRows = data.rows.filter(tmRowMatchesFilters);
  const tbody = document.getElementById("tmAssignmentsTableBody");
  tbody.innerHTML = "";
  if (!filteredRows.length) {
    tbody.innerHTML = `<tr><td colspan="40" class="empty-state">${
      data.rows.length ? "No entries match the selected filter." : 'No entries yet. Click "Add Entry" to start tracking a Time and Material assignment.'
    }</td></tr>`;
  } else {
    filteredRows.forEach((r) => tbody.appendChild(buildTmAssignmentRow(r, false)));
    renumberTmRows();
    highlightDuplicateTmEmployeeIds();
  }
  renderRevenueTypeSummaryTable(filteredRows, "tmRevenueTypeSummaryBody");
}

function renumberTmRows() {
  const tbody = document.getElementById("tmAssignmentsTableBody");
  let n = 0;
  tbody.querySelectorAll("tr").forEach((tr) => {
    if (tr.classList.contains("tm-draft-row")) return;
    const cell = tr.querySelector(".tm-sl-no");
    if (cell) { n += 1; cell.textContent = n; }
  });
}

function replaceTmRow(oldTr, newTr) {
  const oldCell = oldTr.querySelector(".tm-sl-no");
  const newCell = newTr.querySelector(".tm-sl-no");
  if (oldCell && newCell) newCell.textContent = oldCell.textContent;
  oldTr.replaceWith(newTr);
}

// Flags every row in the Time and Material grid whose Employee ID matches
// another currently-visible row's (see buildTmAssignmentRow's
// data-employee-id comment), so accidental double-entry of the same person
// is easy to spot at a glance. Recomputed against whatever rows are
// actually in the DOM right now, not the full unfiltered dataset, so it
// naturally follows the Customer filter and always reflects what's on
// screen. Blank Employee IDs are never flagged as duplicates of each other.
function highlightDuplicateTmEmployeeIds() {
  const tbody = document.getElementById("tmAssignmentsTableBody");
  const rows = Array.from(tbody.querySelectorAll("tr[data-employee-id]"));
  const counts = {};
  rows.forEach((tr) => {
    const id = tr.dataset.employeeId;
    if (id) counts[id] = (counts[id] || 0) + 1;
  });
  rows.forEach((tr) => {
    const id = tr.dataset.employeeId;
    const isDup = !!id && counts[id] > 1;
    const cell = tr.querySelector(".tm-employee-id-cell");
    if (cell) cell.classList.toggle("tm-dup-emp-id", isDup);
    tr.querySelectorAll(".tm-employee-id-input").forEach((input) => {
      input.title = isDup ? "Duplicate Employee ID" : "";
    });
  });
}

function buildTmAssignmentRow(r, editing) {
  const tr = document.createElement("tr");
  if (editing) tr.classList.add("tm-editing-row");
  // Actions comes first (app-wide convention: wherever a table has both
  // Sl. No and Actions, Actions is column 1 and Sl. No is column 2). Sl. No
  // itself is left blank here and filled in by renumberTmRows()-equivalent
  // logic based on the row's actual position in the table.
  let cells = editing
    ? `<td class="row-actions">
        <button type="button" class="ghost-btn btn-edit icon-btn tm-save-btn" title="Save">${icon("check")}</button>
        <button type="button" class="ghost-btn icon-btn tm-cancel-btn" title="Cancel">${icon("x")}</button>
      </td>`
    : `<td class="row-actions">
        <button type="button" class="ghost-btn btn-edit icon-btn tm-copy-btn" title="Copy">${icon("copy")}</button>
        <button type="button" class="ghost-btn btn-edit icon-btn tm-edit-btn" title="Edit">${icon("edit")}</button>
        <button type="button" class="ghost-btn btn-danger icon-btn tm-del-btn" title="Delete">${icon("trash")}</button>
      </td>`;
  cells += `<td class="tm-sl-no"></td>`;

  if (editing) {
    cells += `
      <td><select class="tm-revenue-type-select"></select></td>
      <td><select class="tm-customer-select"></select></td>
      <td><select class="tm-sow-select"></select></td>
      <td><input type="text" class="tm-wbs-input" value="${escapeHtml(r.wbs_id || "")}" /></td>
      <td class="tm-opportunity-id-cell">${escapeHtml(r.opportunity_id) || "—"}</td>
      <td class="tm-po-number-cell">${escapeHtml(r.po_number) || "—"}</td>
      <td class="tm-contract-code-cell">${escapeHtml(r.contract_code) || "—"}</td>
      <td class="tm-employee-id-cell"><input type="text" class="tm-employee-id-input" value="${escapeHtml(r.employee_id || "")}" /></td>
      <td><input type="text" class="tm-employee-name-input" value="${escapeHtml(r.employee_name || "")}" /></td>
      <td><select class="tm-location-select"></select></td>
      <td class="tm-billing-hours-cell">${r.billing_hours_per_day != null ? fmtPlain(r.billing_hours_per_day) : "—"}</td>
      <td><select class="tm-practice-select"></select></td>
      <td><input type="text" class="tm-sow-role-input" value="${escapeHtml(r.sow_role || "")}" /></td>
      <td><input type="number" step="0.01" min="0" class="tm-rate-card-input" value="${r.rate_card ?? ""}" /></td>
      <td><input type="number" step="0.01" min="0" max="100" class="tm-discount-input" value="${r.discount_percent ?? ""}" /></td>
      <td class="tm-final-rate-cell tm-final-rate">${r.final_rate_card != null ? fmt(r.final_rate_card) : "—"}</td>
      <td><input type="date" class="tm-start-date-input" value="${r.start_date || ""}" /></td>
      <td><input type="date" class="tm-end-date-input" value="${r.end_date || ""}" /></td>
    `;
  } else {
    cells += `
      <td>${escapeHtml(r.revenue_type_name) || "—"}</td>
      <td>${escapeHtml(r.customer_name) || "—"}</td>
      <td>${escapeHtml(r.sow_title) || "—"}</td>
      <td>${escapeHtml(r.wbs_id) || "—"}</td>
      <td>${escapeHtml(r.opportunity_id) || "—"}</td>
      <td>${escapeHtml(r.po_number) || "—"}</td>
      <td>${escapeHtml(r.contract_code) || "—"}</td>
      <td class="tm-employee-id-cell">${escapeHtml(r.employee_id) || "—"}</td>
      <td>${escapeHtml(r.employee_name) || "—"}</td>
      <td>${escapeHtml(r.location_name) || "—"}</td>
      <td class="tm-billing-hours-cell">${r.billing_hours_per_day != null ? fmtPlain(r.billing_hours_per_day) : "—"}</td>
      <td>${escapeHtml(r.practice_name) || "—"}</td>
      <td>${escapeHtml(r.sow_role) || "—"}</td>
      <td class="rev-tcv-cell">${r.rate_card != null ? fmt(r.rate_card) : "—"}</td>
      <td>${r.discount_percent != null ? r.discount_percent + "%" : "—"}</td>
      <td class="rev-tcv-cell tm-final-rate">${r.final_rate_card != null ? fmt(r.final_rate_card) : "—"}</td>
      <td>${fmtDate(r.start_date)}</td>
      <td>${fmtDate(r.end_date)}</td>
    `;
  }

  // Projections is always auto-calculated (see _compute_tm_projections in
  // main.py - working days between Start/End Date minus Holiday Calendar
  // minus Leave Tracker, times Final Rate Card times Billing Hours per day)
  // and never manually entered, in either read-only or editing mode - there
  // is no manual monthly input anywhere in this grid. Projections shown
  // while editing reflect the row's last-saved values; they recompute from
  // the row's current fields (rate, discount, dates, location, ...) after
  // Save reloads the grid.
  r.months.forEach((m, i) => {
    const band = i % 2 === 0 ? "rev-band-a" : "rev-band-b";
    cells += `<td class="rev-readonly-cell ${band}">${fmtPlain(m.projection)}</td>`;
  });
  tr.innerHTML = cells;
  // Feeds highlightDuplicateTmEmployeeIds() - a plain string comparison
  // against every other visible row's own data-employee-id, trimmed so
  // "E123" and "E123 " (a likely copy/paste artifact) still count as the
  // same id. Kept on the <tr> rather than only the input's value so it
  // stays readable in both editing and read-only mode without re-querying
  // the DOM for it.
  tr.dataset.employeeId = (r.employee_id || "").trim();

  if (editing) {
    // Keep the duplicate-Employee-ID highlight live while typing, not just
    // on the next Save/reload - matters most here since editing is exactly
    // when someone is likely to notice and fix a collision.
    const employeeIdInput = tr.querySelector(".tm-employee-id-input");
    employeeIdInput.addEventListener("input", () => {
      tr.dataset.employeeId = employeeIdInput.value.trim();
      highlightDuplicateTmEmployeeIds();
    });

    const rtSelect = tr.querySelector(".tm-revenue-type-select");
    rtSelect.innerHTML = `<option value="">Select revenue type&hellip;</option>` +
      currentRevenueTypes.map((rt) => `<option value="${rt.id}">${escapeHtml(rt.name)}</option>`).join("");
    rtSelect.value = r.revenue_type_id ?? "";

    const locSelect = tr.querySelector(".tm-location-select");
    locSelect.innerHTML = `<option value="">Select location&hellip;</option>` +
      currentLocations.map((l) => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join("");
    locSelect.value = r.location_id ?? "";

    const practiceSelect = tr.querySelector(".tm-practice-select");
    practiceSelect.innerHTML = `<option value="">Select practice&hellip;</option>` +
      currentPractices.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
    practiceSelect.value = r.practice_id ?? "";

    const customerSelect = tr.querySelector(".tm-customer-select");
    customerSelect.innerHTML = `<option value="">Select customer&hellip;</option>` +
      currentTmCustomers.map((c) => `<option value="${c.id}">${escapeHtml(c.customer_name)}</option>`).join("");
    customerSelect.value = r.customer_id ?? "";

    // Live preview of Billing Hours per day as Customer/Location change -
    // just a preview (see billingHoursFor()); the value that actually
    // drives the Projections formula is looked up server-side on Save.
    const billingHoursCell = tr.querySelector(".tm-billing-hours-cell");
    function refreshBillingHours() {
      const hours = billingHoursFor(customerSelect.value, locSelect.value);
      billingHoursCell.textContent = hours != null ? fmtPlain(hours) : "—";
    }
    locSelect.addEventListener("change", refreshBillingHours);
    customerSelect.addEventListener("change", refreshBillingHours);

    const sowSelect = tr.querySelector(".tm-sow-select");
    function refreshSowOptions(selectedSowId) {
      const matching = tmSowsForCustomer(customerSelect.value);
      if (!customerSelect.value) {
        sowSelect.innerHTML = '<option value="">Select customer first&hellip;</option>';
        sowSelect.disabled = true;
      } else if (!matching.length) {
        sowSelect.innerHTML = '<option value="">No Statements of Work for this customer</option>';
        sowSelect.disabled = true;
      } else {
        sowSelect.disabled = false;
        sowSelect.innerHTML = '<option value="">Select Statement of Work&hellip;</option>' +
          matching.map((s) => `<option value="${s.id}">${escapeHtml(s.title)}</option>`).join("");
      }
      sowSelect.value = selectedSowId ?? "";
    }
    refreshSowOptions(r.sow_id);
    customerSelect.addEventListener("change", () => refreshSowOptions(null));

    const opportunityIdCell = tr.querySelector(".tm-opportunity-id-cell");
    const poNumberCell = tr.querySelector(".tm-po-number-cell");
    const contractCodeCell = tr.querySelector(".tm-contract-code-cell");
    function refreshSowDerivedFields() {
      const fields = tmSowDerivedFields(sowSelect.value);
      opportunityIdCell.textContent = fields.opportunity_id || "—";
      poNumberCell.textContent = fields.po_number || "—";
      contractCodeCell.textContent = fields.contract_code || "—";
    }
    sowSelect.addEventListener("change", refreshSowDerivedFields);
    // customerSelect's own "change" listener above (refreshSowOptions) always
    // clears sowSelect back to no selection, so the derived fields must be
    // cleared right along with it - otherwise they'd keep showing the old
    // Contract's values after switching Customer.
    customerSelect.addEventListener("change", refreshSowDerivedFields);

    const rateInput = tr.querySelector(".tm-rate-card-input");
    const discountInput = tr.querySelector(".tm-discount-input");
    const finalRateCell = tr.querySelector(".tm-final-rate-cell");
    function refreshFinalRate() {
      const final = computeFinalRate(rateInput.value, discountInput.value);
      finalRateCell.textContent = final != null ? fmt(final) : "—";
    }
    rateInput.addEventListener("input", refreshFinalRate);
    discountInput.addEventListener("input", refreshFinalRate);

    tr.querySelector(".tm-save-btn").addEventListener("click", () => saveTmRow(r.assignment_id, tr));
    tr.querySelector(".tm-cancel-btn").addEventListener("click", () => {
      const cached = tmAssignmentsCache.get(r.assignment_id) || r;
      replaceTmRow(tr, buildTmAssignmentRow(cached, false));
      highlightDuplicateTmEmployeeIds();
    });
  } else {
    tr.querySelector(".tm-copy-btn").addEventListener("click", () => {
      // Unlike the SoW Level grid, an assignment has no uniqueness rule -
      // "Copy" opens the same Add Entry draft used above, pre-filled with
      // every one of this row's descriptive fields but no assignment_id, so
      // Save creates a brand-new assignment rather than touching this one.
      // Months aren't copied - Projections is always freshly computed for
      // whatever the new assignment's own fields turn out to be. See
      // openTmEntryDraft().
      openTmEntryDraft({
        customerId: r.customer_id, sowId: r.sow_id, revenueTypeId: r.revenue_type_id,
        employeeId: r.employee_id, employeeName: r.employee_name, locationId: r.location_id,
        practiceId: r.practice_id, wbsId: r.wbs_id, sowRole: r.sow_role, rateCard: r.rate_card,
        discountPercent: r.discount_percent, startDate: r.start_date, endDate: r.end_date,
      });
    });
    tr.querySelector(".tm-edit-btn").addEventListener("click", () => {
      replaceTmRow(tr, buildTmAssignmentRow(r, true));
      highlightDuplicateTmEmployeeIds();
    });
    tr.querySelector(".tm-del-btn").addEventListener("click", async () => {
      if (confirm(`Remove "${r.employee_name || "this assignment"}" (${r.customer_name}) from Time and Material for ${fyLabelText(currentFiscalYear)}? This deletes all of its months for this fiscal year.`)) {
        const resp = await fetch(`${API}/tm/assignments/${r.assignment_id}/${currentFiscalYear}`, { method: "DELETE" });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          alert(formatApiError(err, "Failed to remove this assignment from Time and Material."));
          return;
        }
        loadTmAssignments();
      }
    });
  }
  return tr;
}

async function saveTmRow(assignmentId, tr) {
  const saveBtn = tr.querySelector(".tm-save-btn");
  const cancelBtn = tr.querySelector(".tm-cancel-btn");
  saveBtn.disabled = true;
  cancelBtn.disabled = true;

  // Projections is auto-calculated server-side (see buildTmAssignmentRow's
  // comment) and there's no manual monthly input anywhere in this grid
  // anymore, so there's nothing month-related to collect or save here -
  // only the assignment's own descriptive fields below.
  const customerVal = tr.querySelector(".tm-customer-select").value;
  const sowVal = tr.querySelector(".tm-sow-select").value;
  const revenueTypeVal = tr.querySelector(".tm-revenue-type-select").value;
  const locationVal = tr.querySelector(".tm-location-select").value;
  const practiceVal = tr.querySelector(".tm-practice-select").value;
  const rateCardVal = tr.querySelector(".tm-rate-card-input").value;
  const discountVal = tr.querySelector(".tm-discount-input").value;

  const assignmentPayload = {
    customer_id: customerVal ? parseInt(customerVal, 10) : null,
    sow_id: sowVal ? parseInt(sowVal, 10) : null,
    revenue_type_id: revenueTypeVal ? parseInt(revenueTypeVal, 10) : null,
    employee_id: tr.querySelector(".tm-employee-id-input").value.trim() || null,
    employee_name: tr.querySelector(".tm-employee-name-input").value.trim() || null,
    location_id: locationVal ? parseInt(locationVal, 10) : null,
    practice_id: practiceVal ? parseInt(practiceVal, 10) : null,
    wbs_id: tr.querySelector(".tm-wbs-input").value.trim() || null,
    sow_role: tr.querySelector(".tm-sow-role-input").value.trim() || null,
    rate_card: rateCardVal !== "" ? parseFloat(rateCardVal) : null,
    discount_percent: discountVal !== "" ? parseFloat(discountVal) : null,
    start_date: tr.querySelector(".tm-start-date-input").value || null,
    end_date: tr.querySelector(".tm-end-date-input").value || null,
  };

  try {
    const resp = await fetch(`${API}/tm/assignments/${assignmentId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(assignmentPayload) });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      alert(formatApiError(err, "Failed to save this row."));
      return;
    }
    await loadTmAssignments();
  } finally {
    saveBtn.disabled = false;
    cancelBtn.disabled = false;
  }
}

document.getElementById("exportTmBtn").addEventListener("click", () => {
  if (currentFiscalYear === null) currentFiscalYear = fiscalYearForToday();
  window.location.href = `${API}/tm/assignments/export?fiscal_year=${currentFiscalYear}`;
});

function tmDraftMonthCellsHtml() {
  // Projections has no input, editable or not - it's auto-calculated (see
  // buildTmAssignmentRow's comment) and there's no assignment yet to
  // compute it against until Save, so every month just shows a placeholder
  // here and picks up its real computed value once the row reloads after
  // creation. There is no other monthly figure to enter anymore.
  let html = "";
  for (let fm = 1; fm <= 12; fm++) {
    const band = (fm - 1) % 2 === 0 ? "rev-band-a" : "rev-band-b";
    html += `<td class="rev-readonly-cell ${band} tm-draft-month-cell">—</td>`;
  }
  return html;
}

// Add Entry - adds a new row directly in the datatable (no popup). Also the
// basis for "Copy" on an existing row (see buildTmAssignmentRow's
// tm-copy-btn handler above): prefill carries over every one of the source
// row's descriptive fields (customerId/sowId/revenueTypeId/employeeId/
// employeeName/locationId/practiceId/wbsId/rateCard/discountPercent/
// startDate/endDate), all undefined for a plain "Add Entry" click, which behaves
// exactly as before.
async function openTmEntryDraft(prefill = {}) {
  if (currentFiscalYear === null) currentFiscalYear = fiscalYearForToday();

  const existingDraft = document.querySelector(".tm-draft-row");
  if (existingDraft) existingDraft.remove();

  const tbody = document.getElementById("tmAssignmentsTableBody");
  const emptyRow = tbody.querySelector(".empty-state");
  if (emptyRow) emptyRow.closest("tr").remove();

  const tr = document.createElement("tr");
  tr.className = "tm-draft-row";
  tr.innerHTML = `
    <td class="row-actions">
      <button type="button" class="ghost-btn btn-edit icon-btn tm-draft-save-btn" disabled title="Save">${icon("check")}</button>
      <button type="button" class="ghost-btn icon-btn tm-draft-cancel-btn" title="Cancel">${icon("x")}</button>
    </td>
    <td></td>
    <td><select class="tm-draft-revenue-type-select"></select></td>
    <td><select class="tm-draft-customer-select"><option value="">Select customer&hellip;</option></select></td>
    <td><select class="tm-draft-sow-select" disabled><option value="">Select customer first&hellip;</option></select></td>
    <td><input type="text" class="tm-draft-wbs-input" value="${escapeHtml(prefill.wbsId || "")}" /></td>
    <td class="tm-draft-opportunity-id-cell">&mdash;</td>
    <td class="tm-draft-po-number-cell">&mdash;</td>
    <td class="tm-draft-contract-code-cell">&mdash;</td>
    <td><input type="text" class="tm-draft-employee-id-input" value="${escapeHtml(prefill.employeeId || "")}" /></td>
    <td><input type="text" class="tm-draft-employee-name-input" value="${escapeHtml(prefill.employeeName || "")}" /></td>
    <td><select class="tm-draft-location-select"></select></td>
    <td class="tm-draft-billing-hours-cell">&mdash;</td>
    <td><select class="tm-draft-practice-select"></select></td>
    <td><input type="text" class="tm-draft-sow-role-input" value="${escapeHtml(prefill.sowRole || "")}" /></td>
    <td><input type="number" step="0.01" min="0" class="tm-draft-rate-card-input" value="${prefill.rateCard ?? ""}" /></td>
    <td><input type="number" step="0.01" min="0" max="100" class="tm-draft-discount-input" value="${prefill.discountPercent ?? ""}" /></td>
    <td class="tm-draft-final-rate-cell tm-final-rate">&mdash;</td>
    <td><input type="date" class="tm-draft-start-date-input" value="${prefill.startDate || ""}" /></td>
    <td><input type="date" class="tm-draft-end-date-input" value="${prefill.endDate || ""}" /></td>
    ${tmDraftMonthCellsHtml()}
  `;
  tbody.insertBefore(tr, tbody.firstChild);

  const revenueTypeSelect = tr.querySelector(".tm-draft-revenue-type-select");
  revenueTypeSelect.innerHTML = `<option value="">Select revenue type&hellip;</option>` +
    currentRevenueTypes.map((rt) => `<option value="${rt.id}">${escapeHtml(rt.name)}</option>`).join("");
  revenueTypeSelect.value = prefill.revenueTypeId ?? "";

  const locationSelect = tr.querySelector(".tm-draft-location-select");
  locationSelect.innerHTML = `<option value="">Select location&hellip;</option>` +
    currentLocations.map((l) => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join("");
  locationSelect.value = prefill.locationId ?? "";

  const practiceSelect = tr.querySelector(".tm-draft-practice-select");
  practiceSelect.innerHTML = `<option value="">Select practice&hellip;</option>` +
    currentPractices.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  practiceSelect.value = prefill.practiceId ?? "";

  const customerSelect = tr.querySelector(".tm-draft-customer-select");
  customerSelect.innerHTML = '<option value="">Select customer&hellip;</option>' +
    currentTmCustomers.map((c) => `<option value="${c.id}">${escapeHtml(c.customer_name)}</option>`).join("");
  customerSelect.value = prefill.customerId ?? "";

  const sowSelect = tr.querySelector(".tm-draft-sow-select");
  const rateInput = tr.querySelector(".tm-draft-rate-card-input");
  const discountInput = tr.querySelector(".tm-draft-discount-input");
  const finalRateCell = tr.querySelector(".tm-draft-final-rate-cell");
  const billingHoursCell = tr.querySelector(".tm-draft-billing-hours-cell");
  const opportunityIdCell = tr.querySelector(".tm-draft-opportunity-id-cell");
  const poNumberCell = tr.querySelector(".tm-draft-po-number-cell");
  const contractCodeCell = tr.querySelector(".tm-draft-contract-code-cell");
  const saveBtn = tr.querySelector(".tm-draft-save-btn");

  function refreshFinalRate() {
    const final = computeFinalRate(rateInput.value, discountInput.value);
    finalRateCell.textContent = final != null ? fmt(final) : "—";
  }
  rateInput.addEventListener("input", refreshFinalRate);
  discountInput.addEventListener("input", refreshFinalRate);

  // Live preview of Billing Hours per day, same as the edit-row version -
  // see billingHoursFor()'s comment.
  function refreshBillingHours() {
    const hours = billingHoursFor(customerSelect.value, locationSelect.value);
    billingHoursCell.textContent = hours != null ? fmtPlain(hours) : "—";
  }
  locationSelect.addEventListener("change", refreshBillingHours);

  // Opportunity ID/Purchase Order (#)/Contract Code are always the linked
  // SOW's own fields (see tmSowDerivedFields's comment) - never entered
  // directly on this draft row.
  function refreshSowDerivedFields() {
    const fields = tmSowDerivedFields(sowSelect.value);
    opportunityIdCell.textContent = fields.opportunity_id || "—";
    poNumberCell.textContent = fields.po_number || "—";
    contractCodeCell.textContent = fields.contract_code || "—";
  }
  sowSelect.addEventListener("change", refreshSowDerivedFields);

  function updateSaveEnabled() {
    saveBtn.disabled = !tr.querySelector(".tm-draft-employee-name-input").value.trim() || !customerSelect.value;
  }
  tr.querySelector(".tm-draft-employee-name-input").addEventListener("input", updateSaveEnabled);

  customerSelect.addEventListener("change", () => {
    const val = customerSelect.value;
    const matching = tmSowsForCustomer(val);
    if (!val) {
      sowSelect.disabled = true;
      sowSelect.innerHTML = '<option value="">Select customer first&hellip;</option>';
    } else if (!matching.length) {
      sowSelect.disabled = true;
      sowSelect.innerHTML = '<option value="">No Statements of Work for this customer</option>';
    } else {
      sowSelect.disabled = false;
      sowSelect.innerHTML = '<option value="">Select Statement of Work&hellip;</option>' +
        matching.map((s) => `<option value="${s.id}">${escapeHtml(s.title)}</option>`).join("");
    }
    updateSaveEnabled();
    refreshBillingHours();
    refreshSowDerivedFields();
  });

  tr.querySelector(".tm-draft-cancel-btn").addEventListener("click", () => {
    tr.remove();
    if (!tbody.querySelector("tr")) loadTmAssignments();
  });

  saveBtn.addEventListener("click", async () => {
    const cancelBtn = tr.querySelector(".tm-draft-cancel-btn");
    saveBtn.disabled = true;
    cancelBtn.disabled = true;

    const customerVal = customerSelect.value;
    const sowVal = sowSelect.value;
    const revenueTypeVal = revenueTypeSelect.value;
    const locationVal = locationSelect.value;
    const practiceVal = practiceSelect.value;
    const rateCardVal = rateInput.value;
    const discountVal = discountInput.value;

    const createPayload = {
      customer_id: customerVal ? parseInt(customerVal, 10) : null,
      sow_id: sowVal ? parseInt(sowVal, 10) : null,
      revenue_type_id: revenueTypeVal ? parseInt(revenueTypeVal, 10) : null,
      employee_id: tr.querySelector(".tm-draft-employee-id-input").value.trim() || null,
      employee_name: tr.querySelector(".tm-draft-employee-name-input").value.trim() || null,
      location_id: locationVal ? parseInt(locationVal, 10) : null,
      practice_id: practiceVal ? parseInt(practiceVal, 10) : null,
      wbs_id: tr.querySelector(".tm-draft-wbs-input").value.trim() || null,
      sow_role: tr.querySelector(".tm-draft-sow-role-input").value.trim() || null,
      rate_card: rateCardVal !== "" ? parseFloat(rateCardVal) : null,
      discount_percent: discountVal !== "" ? parseFloat(discountVal) : null,
      start_date: tr.querySelector(".tm-draft-start-date-input").value || null,
      end_date: tr.querySelector(".tm-draft-end-date-input").value || null,
      fiscal_year: currentFiscalYear,
    };

    const createResp = await fetch(`${API}/tm/assignments`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(createPayload),
    });
    if (!createResp.ok) {
      const err = await createResp.json().catch(() => ({}));
      alert(formatApiError(err, "Failed to create this assignment."));
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
      return;
    }
    const created = await createResp.json();

    // created.months already carries the server's freshly computed
    // Projections (from _tm_row_dict) - nothing else to merge in, since
    // there's no other monthly figure to enter for Time and Material.
    tmAssignmentsCache.set(created.assignment_id, created);
    tr.replaceWith(buildTmAssignmentRow(created, false));
    renumberTmRows();
    highlightDuplicateTmEmployeeIds();
    const currentlyFiltered = Array.from(tmAssignmentsCache.values()).filter(tmRowMatchesFilters);
    renderRevenueTypeSummaryTable(currentlyFiltered, "tmRevenueTypeSummaryBody");
  });

  updateSaveEnabled();

  // Copy: dispatching "change" runs customerSelect's own listener above
  // (populating sowSelect's options and refreshing the Billing Hours
  // preview) exactly as if the user had just picked this customer
  // themselves; sowSelect's value is then set directly since its own
  // options aren't tied to a change listener, so refreshSowDerivedFields()
  // (which that same customerSelect listener already ran, against the
  // not-yet-set sowSelect.value) is called again explicitly afterward, same
  // reasoning as refreshFinalRate() below for Rate Card/Discount. Every
  // piece here is a no-op for a plain "Add Entry" click (prefill fields all
  // undefined).
  if (prefill.customerId) {
    customerSelect.dispatchEvent(new Event("change"));
    if (prefill.sowId) sowSelect.value = String(prefill.sowId);
  }
  refreshSowDerivedFields();
  refreshFinalRate();
}

document.getElementById("newTmEntryBtn").addEventListener("click", () => openTmEntryDraft());

// ---------- Configuration: generic simple-list helper (Locations, Billing
// Models, Statuses, Employee Types, Bands, Opportunity Types) ----------
// Inline-edit table - no modal. Same toggle-in-place approach as the
// Customer Management table (buildCustomerRow()) and Revenue Management's
// grid: an Edit icon swaps a row into text inputs with Save/Cancel, and the
// "Add X" button prepends a blank row in that same editable state.
function makeInlineListManager(opts) {
  const { apiPath, tableBodyId, newBtnId, hasDetails, itemLabel, onChange, lockNameOnEdit } = opts;
  const tbody = document.getElementById(tableBodyId);
  const colCount = hasDetails ? 4 : 3;

  function buildRow(item, editing) {
    const tr = document.createElement("tr");
    if (editing) tr.classList.add("inline-editing-row");

    // Actions leads every row, with Sl. No right after it (app-wide
    // convention: wherever a table has both Sl. No and Actions, Actions is
    // column 1 and Sl. No is column 2).
    const actionsTd = document.createElement("td");
    actionsTd.className = "row-actions";
    actionsTd.innerHTML = editing
      ? `<button type="button" class="ghost-btn btn-edit icon-btn inline-save-btn" title="Save">${icon("check")}</button>
         <button type="button" class="ghost-btn icon-btn inline-cancel-btn" title="Cancel">${icon("x")}</button>`
      : `<button type="button" class="ghost-btn btn-edit icon-btn inline-edit-btn" title="Edit">${icon("edit")}</button>
         <button type="button" class="ghost-btn btn-danger icon-btn inline-del-btn" title="Delete">${icon("trash")}</button>`;
    tr.appendChild(actionsTd);

    const slTd = document.createElement("td");
    slTd.className = "sl-no-cell inline-sl-no";
    tr.appendChild(slTd);

    // When lockNameOnEdit is set (Locations, Revenue Types - both now fixed
    // master lists per explicit instruction), the name is only ever
    // editable for a brand-new (id-less) draft row; editing an existing row
    // shows the name as readonly text so only Details can change.
    const nameLocked = editing && lockNameOnEdit && item.id;
    const nameTd = document.createElement("td");
    if (editing && !nameLocked) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "inline-cell";
      input.dataset.field = "name";
      input.value = item.name || "";
      input.required = true;
      nameTd.appendChild(input);
    } else if (nameLocked) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "inline-cell form-field-readonly";
      input.dataset.field = "name";
      input.value = item.name || "";
      input.readOnly = true;
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

  // Locations has no "Add Location" button in the DOM at all (per explicit
  // instruction - it's a fixed three-value list), so this lookup is guarded
  // rather than assumed to always find an element.
  const newBtn = document.getElementById(newBtnId);
  if (newBtn) {
    newBtn.addEventListener("click", () => {
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
  }

  return { load };
}

const locationManager = makeInlineListManager({
  apiPath: "locations",
  tableBodyId: "locationTableBody",
  newBtnId: "newLocationBtn",
  hasDetails: true,
  itemLabel: "Location",
  lockNameOnEdit: true,
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
  itemLabel: "Employee Band",
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
  lockNameOnEdit: true,
});

// Another simple master list, managed under Settings exactly like Locations -
// which practice (delivery group/department) a SOW belongs to. See the
// Practice column on Revenue Management's SoW Level Detail grid.
const practiceManager = makeInlineListManager({
  apiPath: "practices",
  tableBodyId: "practiceTableBody",
  newBtnId: "newPracticeBtn",
  hasDetails: true,
  itemLabel: "Practice",
});

function loadLocations() { locationManager.load(); }
function loadBillingModels() { billingModelManager.load(); }
function loadOperatingModels() { operatingModelManager.load(); }
function loadStatuses() { statusManager.load(); }
function loadEmployeeTypes() { employeeTypeManager.load(); }
function loadBands() { bandManager.load(); }
function loadOpportunityTypes() { opportunityTypeManager.load(); }
function loadRevenueTypes() { revenueTypeManager.load(); }
function loadPractices() { practiceManager.load(); }

// ---------- init ----------
// Every load always starts on the Dashboard/landing page. SOW-page-specific
// setup (status/customer filter options) is cheap and harmless to run up
// front so the SOWs tab is ready whenever it's opened.
try {
  localStorage.removeItem("trakerz_last_tab");
} catch (e) {}
showTab("landing");
refreshStatusFilterOptions();
refreshSowCustomerFilterOptions();
refreshSowBillingModelFilterOptions();
