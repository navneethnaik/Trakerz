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
  info: '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>',
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
  // Page header's title (see .page-header in index.html) follows which
  // Best Estimates menu leaf was last clicked, same as the section toggle
  // above - "Time and Material" or "Managed Services" per explicit
  // instruction, rather than a fixed "Best Estimates".
  const pageHeaderTitle = document.getElementById("revenuePageHeaderTitle");
  if (pageHeaderTitle) {
    pageHeaderTitle.textContent = category === "time-material" ? "Time and Material" : "Managed Services";
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
  if (name === "customers") {
    populateCustomerFilterOptions();
    loadCustomers();
  }
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
  if (name === "sow-report") loadSowReport();
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
  "Reports — KPIs, resource and status breakdowns at a glance",
  "Statement of Work — every SOW, sortable and searchable",
  "Best Estimates | Managed Services — monthly revenue projections, SOW by SOW",
  "Best Estimates | Time and Material — employee assignments, projected automatically",
  "Customer Configuration — your own customers and delivery contacts",
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
  sows.forEach((s) => tbody.appendChild(buildSowRow(s, false)));
  renumberSowRows();
}

// Fills in every row's "Sl. No" cell based on current DOM order, skipping any
// in-progress "New SOW"/Copy draft row (see .sow-draft-row) - same pattern as
// renumberRevenueRows()/renumberLeaveRows-equivalent elsewhere in this file.
function renumberSowRows() {
  const tbody = document.getElementById("sowTableBody");
  let n = 0;
  tbody.querySelectorAll("tr").forEach((tr) => {
    if (tr.classList.contains("sow-draft-row") || tr.classList.contains("milestone-subrow")) return;
    const cell = tr.querySelector(".sow-sl-no");
    if (cell) { n += 1; cell.textContent = n; }
  });
}

// Swaps a row for a rebuilt version of itself (toggling between read-only and
// editing) while preserving its already-assigned Sl. No - same pattern as
// replaceRevenueRow()/replaceLeaveRow-equivalent elsewhere in this file.
function replaceSowRow(oldTr, newTr) {
  const oldCell = oldTr.querySelector(".sow-sl-no");
  const newCell = newTr.querySelector(".sow-sl-no");
  if (oldCell && newCell) newCell.textContent = oldCell.textContent;
  oldTr.replaceWith(newTr);
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

// ---------- SOW inline edit (replaces the old New SOW/Edit/Copy popup) ----------
// Every field the old modal captured is now edited directly in the grid -
// Save/Cancel icons swap in for Copy/Edit/Delete on the row being edited,
// exactly like Leave Management/Resource Management/Revenue Management
// already work (see buildLeaveRow/buildRevenueSowRow). "New SOW" and "Copy"
// both insert a draft row at the top of the table (see openSowEntryDraft())
// instead of opening a form; "Edit" toggles the existing row in place
// (buildSowRow(s, true)); Cancel toggles it back. The one thing this
// deliberately leaves out is Revenue Type/Practice - those were on the old
// modal but were never columns on THIS grid (they're set from Revenue
// Outlook > Best Estimates instead, via the same /classification endpoint),
// so they're carried through unchanged on every save (see the
// revenue_type_id/practice_id lines in the Save handler below) rather than
// exposed here or silently wiped. Milestones (Fixed Price SOWs only) are
// also unaffected - they're still added/edited one at a time through their
// own small popup on the SOW Detail page (see openMilestoneModal below),
// since a milestone can't be attached to a SOW that doesn't exist in the
// database yet.
let sowFormLookups = { customers: [], billingModels: [], operatingModels: [], statuses: [], opportunityTypes: [] };

async function loadSowFormLookups() {
  const [customers, billingModels, operatingModels, statuses, opportunityTypes] = await Promise.all([
    fetch(`${API}/customers`).then((r) => r.json()),
    fetch(`${API}/billing-models`).then((r) => r.json()),
    fetch(`${API}/operating-models`).then((r) => r.json()),
    fetch(`${API}/statuses`).then((r) => r.json()),
    fetch(`${API}/opportunity-types`).then((r) => r.json()),
  ]);
  sowFormLookups = { customers, billingModels, operatingModels, statuses, opportunityTypes };
}

function fillSelect(selectId, items, valueKey, labelKey, placeholder) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    items.map((i) => `<option value="${i[valueKey]}">${escapeHtml(i[labelKey])}</option>`).join("");
}

// <option> list for one of the per-row selects above, with whichever value
// matches selectedValue pre-selected - same shape fillSelect() renders into a
// fixed-id <select>, just returned as a string for use inside a template
// literal instead of assigned to one element's innerHTML.
function sowSelectOptionsHtml(items, valueKey, labelKey, placeholder, selectedValue) {
  const selectedStr = selectedValue === null || selectedValue === undefined ? "" : String(selectedValue);
  const opts = [`<option value="">${placeholder}</option>`].concat(
    items.map((i) => `<option value="${i[valueKey]}"${String(i[valueKey]) === selectedStr ? " selected" : ""}>${escapeHtml(i[labelKey])}</option>`)
  );
  return opts.join("");
}

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

// Statement of Work Duration (Months) is derived from Start Date/End Date
// (read-only in both modes - see index.html's original f_duration_months
// comment) - inclusive day count between the two dates divided by the
// average length of a calendar month (365.2425 / 12), rounded to one
// decimal, so a Jan 1-Dec 31 SOW comes out to a clean 12.0 rather than the
// 11 a raw calendar-month subtraction would give. Returns fallback (whatever
// Duration is already on record) if either date is missing/invalid, so a SOW
// that predates Start/End Date - or simply has neither set - keeps showing
// its stored Duration instead of being blanked just by entering edit mode.
function computeSowDurationMonths(startVal, endVal, fallback) {
  if (!startVal || !endVal) return fallback ?? "";
  const start = new Date(`${startVal}T00:00:00`);
  const end = new Date(`${endVal}T00:00:00`);
  if (isNaN(start) || isNaN(end) || end < start) return fallback ?? "";
  const inclusiveDays = Math.round((end - start) / 86400000) + 1;
  return Math.round((inclusiveDays / 30.4368) * 10) / 10;
}

// ACV (USD) mirrors the server's own _enrich_sow() formula - monthly value
// (TCV / Contract Duration (Months)) times however many of those months
// count toward one fiscal year (capped at 12) - so the row shows the number
// that will actually be saved/displayed without a round trip. Read-only in
// both modes, never itself sent to the backend, just recomputed live
// whenever TCV or Duration changes (see wireSowRowFormulas() below).
function computeSowAcv(tcv, months) {
  if (!(months > 0)) return 0;
  const monthlyValue = tcv / months;
  const monthsInFiscalYear = Math.min(months, 12);
  return Number((monthlyValue * monthsInFiscalYear).toFixed(2)) || 0;
}

// Wires up Duration/ACV/Customer Code's live recompute for one editing row -
// same formulas as computeSowDurationMonths()/computeSowAcv() above, just
// scoped to this row's own inputs instead of the old modal's fixed ids.
function wireSowRowFormulas(tr) {
  const startInput = tr.querySelector(".sow-f-start");
  const endInput = tr.querySelector(".sow-f-end");
  const durationInput = tr.querySelector(".sow-f-duration");
  const tcvInput = tr.querySelector(".sow-f-value");
  const acvInput = tr.querySelector(".sow-f-acv");
  const customerSelect = tr.querySelector(".sow-f-customer");
  const customerCodeInput = tr.querySelector(".sow-f-customer-code");

  function refreshAcv() {
    const tcv = parseFloat(tcvInput.value) || 0;
    const months = parseFloat(durationInput.value) || 0;
    acvInput.value = computeSowAcv(tcv, months);
  }
  function refreshDuration() {
    durationInput.value = computeSowDurationMonths(startInput.value, endInput.value, durationInput.value);
    refreshAcv();
  }
  startInput.addEventListener("change", refreshDuration);
  endInput.addEventListener("change", refreshDuration);
  tcvInput.addEventListener("input", refreshAcv);
  customerSelect.addEventListener("change", () => {
    const match = sowFormLookups.customers.find((c) => String(c.id) === customerSelect.value);
    customerCodeInput.value = match ? match.customer_code : "";
  });
}

// Reference Documents upload wiring for one editing row's Statement of
// Work/Purchase Order/Deal Sheet field - same /api/uploads round trip the
// old modal used (see the original wireSowDocUpload()), just scoped by
// class name within this <tr> instead of fixed modal element ids, since
// several rows worth of these elements can exist in the DOM shape at once
// (only one is ever actually in edit mode, but ids would still collide).
function wireSowDocUploadRow(tr, btnClass, fileClass, linkClass) {
  const btn = tr.querySelector(`.${btnClass}`);
  const fileInput = tr.querySelector(`.${fileClass}`);
  const linkInput = tr.querySelector(`.${linkClass}`);
  btn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const prevHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = "<span>Uploading&hellip;</span>";
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
      linkInput.value = result.path;
    } finally {
      btn.disabled = false;
      btn.innerHTML = prevHtml;
      e.target.value = "";
    }
  });
}

// Same inline "Upload" button markup the old modal used for all three
// Reference Documents fields (raw SVG, not the icon() helper - this one was
// never added to ICON_PATHS).
const SOW_UPLOAD_BTN_ICON = '<svg class="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>';

// Builds one <tr> for the SOW grid. editing=false renders the normal
// read-only row (unchanged from before - Copy/Edit/Delete actions, the
// Fixed Price milestones expand-btn, doc links as clickable text). editing=
// true renders every field as an input/select instead (Copy/Edit/Delete
// swap for Save/Cancel), used for "Edit" on an existing row and, via a blank
// or pre-filled stub object, for "New SOW"/"Copy" too - see
// openSowEntryDraft() below, which is the only other caller that ever
// passes editing=true.
function buildSowRow(s, editing) {
  const isFixedPrice = (s.billing_model_name || "").toLowerCase().includes("fixed price");
  const tr = document.createElement("tr");
  tr.dataset.sowId = s.id ?? "";
  // Generic "row is open for inline editing" highlight + input/select
  // styling, shared with Customers/Resources/etc. (see .inline-editing-row
  // in style.css) rather than a SOW-specific class.
  if (editing) tr.classList.add("inline-editing-row");
  // Highlight rows by how soon the SOW's end date is coming up: 0-15 days
  // out in red, 16-50 days out in amber. Independent of status - it's a
  // visual "check this date" cue, not a replacement for the Status badge.
  // Read-only rows only - an editing row already has its own highlight
  // (.inline-editing-row above).
  if (!editing && s.days_to_end !== null && s.days_to_end !== undefined) {
    if (s.days_to_end >= 0 && s.days_to_end <= 15) tr.classList.add("expiry-red");
    else if (s.days_to_end >= 16 && s.days_to_end <= 50) tr.classList.add("expiry-amber");
  }

  const actionsHtml = editing
    ? `<td class="row-actions">
        <button type="button" class="ghost-btn btn-edit icon-btn sow-save-btn" title="Save">${icon("check")}</button>
        <button type="button" class="ghost-btn icon-btn sow-cancel-btn" title="Cancel">${icon("x")}</button>
      </td>`
    : `<td class="row-actions">
        <button class="ghost-btn btn-edit icon-btn copy-btn" title="Copy">${icon("copy")}</button>
        <button class="ghost-btn btn-edit icon-btn edit-btn" title="Edit">${icon("edit")}</button>
        <button class="ghost-btn btn-danger icon-btn del-btn" title="Delete">${icon("trash")}</button>
      </td>`;

  const customerCodeVal = (sowFormLookups.customers.find((c) => c.id === s.customer_id) || {}).customer_code ?? s.customer_code ?? "";

  const bodyHtml = editing ? `
    <td class="sl-no-cell sow-sl-no"></td>
    <td><input type="text" class="sow-cell sow-f-opportunity" value="${escapeHtml(s.opportunity_id ?? "")}" /></td>
    <td><select class="sow-cell sow-f-opportunity-type">${sowSelectOptionsHtml(sowFormLookups.opportunityTypes, "id", "name", "Select opportunity type&hellip;", s.opportunity_type_id)}</select></td>
    <td><input class="sow-cell sow-f-title" required value="${escapeHtml(s.title ?? "")}" /></td>
    <td><select class="sow-cell sow-f-customer" required>${sowSelectOptionsHtml(sowFormLookups.customers, "id", "customer_name", "Select customer&hellip;", s.customer_id)}</select></td>
    <td><input type="text" class="sow-cell sow-f-po" value="${escapeHtml(s.po_number ?? "")}" /></td>
    <td><input type="date" class="sow-cell sow-f-start" value="${s.start_date ?? ""}" /></td>
    <td><input type="date" class="sow-cell sow-f-end" value="${s.end_date ?? ""}" /></td>
    <td><input type="number" step="0.01" min="0" class="sow-cell sow-f-value" value="${s.total_value ?? 0}" /></td>
    <td><input type="number" step="0.1" class="sow-cell sow-f-duration form-field-readonly" readonly value="${s.duration_months ?? ""}" /></td>
    <td><input type="number" step="0.01" class="sow-cell sow-f-acv form-field-readonly" readonly value="${s.acv ?? 0}" /></td>
    <td><input type="number" step="0.01" min="0" max="100" class="sow-cell sow-f-gm" value="${s.gm_percent ?? ""}" /></td>
    <td><select class="sow-cell sow-f-status">${sowFormLookups.statuses.map((st) => `<option value="${escapeHtml(st.name)}"${st.name === (s.status || "draft") ? " selected" : ""}>${escapeHtml(capitalize(st.name))}</option>`).join("")}</select></td>
    <td><select class="sow-cell sow-f-billing">${sowSelectOptionsHtml(sowFormLookups.billingModels, "id", "name", "Select billing model&hellip;", s.billing_model_id)}</select></td>
    <td><select class="sow-cell sow-f-operating">${sowSelectOptionsHtml(sowFormLookups.operatingModels, "id", "name", "Select operating model&hellip;", s.operating_model_id)}</select></td>
    <td><input type="text" class="sow-cell sow-f-customer-code form-field-readonly" readonly value="${escapeHtml(customerCodeVal)}" /></td>
    <td><input type="text" class="sow-cell sow-f-project-title" value="${escapeHtml(s.project_title ?? "")}" /></td>
    <td><input type="text" class="sow-cell sow-f-contract-code" value="${escapeHtml(s.contract_code ?? "")}" /></td>
    <td><input type="text" class="sow-cell sow-f-project-code" value="${escapeHtml(s.project_code ?? "")}" /></td>
    <td>
      <div class="doclink-row">
        <input type="text" class="sow-cell sow-f-doclink" value="${escapeHtml(s.doc_link ?? "")}" />
        <button type="button" class="ghost-btn sow-upload-doc-btn" title="Upload">${SOW_UPLOAD_BTN_ICON}<span>Upload</span></button>
        <input type="file" class="sow-doc-file" hidden />
      </div>
    </td>
    <td>
      <div class="doclink-row">
        <input type="text" class="sow-cell sow-f-po-doclink" value="${escapeHtml(s.po_doc_link ?? "")}" />
        <button type="button" class="ghost-btn sow-upload-po-btn" title="Upload">${SOW_UPLOAD_BTN_ICON}<span>Upload</span></button>
        <input type="file" class="sow-po-doc-file" hidden />
      </div>
    </td>
    <td>
      <div class="doclink-row">
        <input type="text" class="sow-cell sow-f-deal-sheet-link" value="${escapeHtml(s.deal_sheet_link ?? "")}" />
        <button type="button" class="ghost-btn sow-upload-deal-btn" title="Upload">${SOW_UPLOAD_BTN_ICON}<span>Upload</span></button>
        <input type="file" class="sow-deal-file" hidden />
      </div>
    </td>
    <td><input type="text" class="sow-cell sow-f-notes" value="${escapeHtml(s.notes ?? "")}" /></td>
  ` : `
    <td class="sl-no-cell sow-sl-no"></td>
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
  tr.innerHTML = actionsHtml + bodyHtml;

  if (editing) {
    wireSowRowFormulas(tr);
    wireSowDocUploadRow(tr, "sow-upload-doc-btn", "sow-doc-file", "sow-f-doclink");
    wireSowDocUploadRow(tr, "sow-upload-po-btn", "sow-po-doc-file", "sow-f-po-doclink");
    wireSowDocUploadRow(tr, "sow-upload-deal-btn", "sow-deal-file", "sow-f-deal-sheet-link");

    tr.querySelector(".sow-cancel-btn").addEventListener("click", () => {
      // s.id tells a real existing row (Cancel reverts to its read-only
      // display) apart from a "New SOW"/Copy draft (Cancel just removes it -
      // there's nothing on record yet to revert to).
      if (s.id) {
        replaceSowRow(tr, buildSowRow(s, false));
      } else {
        tr.remove();
        if (!document.querySelector("#sowTableBody tr")) loadSows();
      }
    });

    tr.querySelector(".sow-save-btn").addEventListener("click", async () => {
      const customerVal = tr.querySelector(".sow-f-customer").value;
      if (!customerVal) { alert("Please select a customer."); return; }
      const titleVal = tr.querySelector(".sow-f-title").value.trim();
      if (!titleVal) { alert("Please enter a Statement of Work title."); return; }
      const saveBtn = tr.querySelector(".sow-save-btn");
      const cancelBtn = tr.querySelector(".sow-cancel-btn");
      saveBtn.disabled = true;
      cancelBtn.disabled = true;
      const opportunityTypeVal = tr.querySelector(".sow-f-opportunity-type").value;
      const billingVal = tr.querySelector(".sow-f-billing").value;
      const operatingVal = tr.querySelector(".sow-f-operating").value;
      const durationVal = tr.querySelector(".sow-f-duration").value;
      const gmVal = tr.querySelector(".sow-f-gm").value;
      const payload = {
        customer_id: parseInt(customerVal, 10),
        title: titleVal,
        project_title: tr.querySelector(".sow-f-project-title").value || null,
        project_code: tr.querySelector(".sow-f-project-code").value || null,
        contract_code: tr.querySelector(".sow-f-contract-code").value || null,
        opportunity_id: tr.querySelector(".sow-f-opportunity").value || null,
        opportunity_type_id: opportunityTypeVal ? parseInt(opportunityTypeVal, 10) : null,
        po_number: tr.querySelector(".sow-f-po").value || null,
        start_date: tr.querySelector(".sow-f-start").value || null,
        end_date: tr.querySelector(".sow-f-end").value || null,
        total_value: parseFloat(tr.querySelector(".sow-f-value").value) || 0,
        duration_months: durationVal !== "" ? parseFloat(durationVal) : null,
        gm_percent: gmVal !== "" ? parseFloat(gmVal) : null,
        billing_model_id: billingVal ? parseInt(billingVal, 10) : null,
        operating_model_id: operatingVal ? parseInt(operatingVal, 10) : null,
        // Not editable on this grid (see the comment above buildSowRow) -
        // carried through unchanged from whatever this SOW already had, so a
        // save here never clobbers a classification set from Revenue
        // Outlook. Both are simply null for a brand new SOW, same as before.
        revenue_type_id: s.revenue_type_id ?? null,
        practice_id: s.practice_id ?? null,
        status: tr.querySelector(".sow-f-status").value,
        doc_link: tr.querySelector(".sow-f-doclink").value || null,
        po_doc_link: tr.querySelector(".sow-f-po-doclink").value || null,
        deal_sheet_link: tr.querySelector(".sow-f-deal-sheet-link").value || null,
        notes: tr.querySelector(".sow-f-notes").value || null,
      };
      const url = s.id ? `${API}/sows/${s.id}` : `${API}/sows`;
      const method = s.id ? "PUT" : "POST";
      const resp = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        alert(formatApiError(err, "Failed to save SOW."));
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
        return;
      }
      await loadSows();
    });
  } else {
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
    tr.querySelector(".edit-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      await loadSowFormLookups();
      replaceSowRow(tr, buildSowRow(s, true));
    });
    // Copy: opens a "New SOW"-style draft row at the top of the table,
    // pre-filled with this row's own values (title gets a "(Copy)" suffix)
    // and no id, so Save creates a new record instead of overwriting the
    // original - same distinction the old modal's Copy made, just via a
    // draft row instead of a form. Milestones are deliberately not copied
    // (see the comment above buildSowRow) - add them on the new SOW's own
    // Detail page once it exists.
    tr.querySelector(".copy-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      await openSowEntryDraft({ ...s, id: null, title: `${s.title} (Copy)` });
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
  }

  return tr;
}

// "New SOW"/Copy - inserts an editable draft row at the top of the table
// instead of opening a form (see the comment above buildSowRow). prefill is
// undefined for a plain "New SOW" click (blank stub, status defaults to
// "draft" same as the old modal) or a sow-shaped object with no id for Copy.
async function openSowEntryDraft(prefill) {
  await loadSowFormLookups();
  const existingDraft = document.querySelector(".sow-draft-row");
  if (existingDraft) existingDraft.remove();
  const tbody = document.getElementById("sowTableBody");
  const emptyRow = tbody.querySelector(".empty-state");
  if (emptyRow) emptyRow.closest("tr").remove();

  const stub = prefill || {
    id: null, opportunity_id: "", opportunity_type_id: "", title: "", customer_id: "",
    po_number: "", start_date: "", end_date: "", total_value: 0, duration_months: "",
    acv: 0, gm_percent: "", status: "draft", billing_model_id: "", operating_model_id: "",
    revenue_type_id: null, practice_id: null, customer_code: "", project_title: "",
    contract_code: "", project_code: "", doc_link: "", po_doc_link: "", deal_sheet_link: "", notes: "",
  };
  const tr = buildSowRow(stub, true);
  tr.classList.add("sow-draft-row");
  tbody.insertBefore(tr, tbody.firstChild);
  tr.scrollIntoView({ block: "center" });
  tr.querySelector(".sow-f-title")?.focus();
}
document.getElementById("newSowBtn").addEventListener("click", () => openSowEntryDraft());

// Edit SOW from the Detail page (see renderDetail()'s editSowBtn below) -
// there's no form to open any more, so this instead switches back to the SOW
// list and puts that same row into inline edit, scrolled into view, exactly
// as if the user had clicked its own Edit icon there.
async function editSowFromDetail(sowId) {
  showTab("sows");
  await loadSows();
  const tr = document.querySelector(`#sowTableBody tr[data-sow-id="${sowId}"]`);
  if (tr) tr.querySelector(".edit-btn")?.click();
}

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
  // Milestones/Invoices only make sense for Fixed Price SOWs - same "Fixed
  // Price" substring check used elsewhere (e.g. buildSowRow's own
  // expand-btn) to decide whether a SOW has milestones at all.
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
    <p><strong>Project Title:</strong> ${escapeHtml(s.project_title) || "—"} &nbsp;&middot;&nbsp; <strong>Project Code:</strong> ${escapeHtml(s.project_code) || "—"} &nbsp;&middot;&nbsp; <strong>Contract Code:</strong> ${escapeHtml(s.contract_code) || "—"}</p>
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

  document.getElementById("editSowBtn").addEventListener("click", () => editSowFromDetail(s.id));
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
// "Add Customer" prepends a blank row in that same editable state. Mirrors
// the toggle-in-place approach Revenue Management's grid uses
// (buildRevenueSowRow()/replaceRevenueRow()) rather than opening a form.
document.getElementById("customerSearchInput").addEventListener("input", debounce(loadCustomers, 250));

// Field order/required-ness shared between the editable inputs and the
// payload sent to the API - keeps buildCustomerRow() and saveCustomerRow()
// in sync, and matches the table's header column order.
const CUSTOMER_FIELDS = [
  { key: "customer_code", label: "Customer code", required: true },
  { key: "customer_name", label: "Customer name", required: true },
  { key: "delivery_director", label: "Delivery director" },
  { key: "delivery_head", label: "Delivery head" },
  { key: "client_partner", label: "Client partner" },
  { key: "sales_head", label: "Sales head" },
  { key: "industry", label: "Industry" },
  { key: "headquarters", label: "Headquarters" },
  { key: "geo", label: "Geo" },
];

// The 4 fields the Customer page's toolbar offers as "All X" dropdown
// filters (see populateCustomerFilterOptions below for their options, and
// loadCustomers for how a selected value is sent to GET /api/customers) - a
// subset of CUSTOMER_FIELDS, in the order requested, not every field.
const CUSTOMER_FILTER_FIELDS = [
  { key: "delivery_director", selectId: "custDeliveryDirectorFilter", allLabel: "All delivery directors" },
  { key: "delivery_head", selectId: "custDeliveryHeadFilter", allLabel: "All delivery heads" },
  { key: "client_partner", selectId: "custClientPartnerFilter", allLabel: "All client partners" },
  { key: "sales_head", selectId: "custSalesHeadFilter", allLabel: "All sales heads" },
];
CUSTOMER_FILTER_FIELDS.forEach(({ selectId }) => {
  document.getElementById(selectId).addEventListener("change", loadCustomers);
});

// Builds each CUSTOMER_FILTER_FIELDS dropdown's option list from the
// distinct non-blank values actually present across every customer (an
// unfiltered fetch, independent of the search box/other filters currently
// applied - so picking one filter never hides the options for another).
// Options are DOM-built (not innerHTML'd), same reasoning as buildCustomerRow
// above: free-text values could contain quotes/"&"/etc. Re-run after tab
// open and after any save/delete, so newly-typed values show up as filter
// options right away.
async function populateCustomerFilterOptions() {
  const allCustomers = await fetch(`${API}/customers`).then((r) => r.json());
  CUSTOMER_FILTER_FIELDS.forEach(({ key, selectId, allLabel }) => {
    const select = document.getElementById(selectId);
    const current = select.value;
    const distinct = Array.from(new Set(allCustomers.map((c) => c[key]).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b)
    );
    select.innerHTML = "";
    const allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = allLabel;
    select.appendChild(allOpt);
    distinct.forEach((value) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = value;
      select.appendChild(opt);
    });
    if (current && distinct.includes(current)) select.value = current;
  });
}

async function loadCustomers() {
  const q = document.getElementById("customerSearchInput").value.trim();
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  CUSTOMER_FILTER_FIELDS.forEach(({ key, selectId }) => {
    const val = document.getElementById(selectId).value;
    if (val) params.set(key, val);
  });
  const customers = await fetch(`${API}/customers?${params}`).then((r) => r.json());

  const tbody = document.getElementById("customerTableBody");
  tbody.innerHTML = "";
  if (!customers.length) {
    tbody.innerHTML = '<tr><td colspan="11" class="empty-state">No customers yet. Click "Add Customer" to add one.</td></tr>';
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
        populateCustomerFilterOptions();
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
    populateCustomerFilterOptions();
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
  CUSTOMER_FILTER_FIELDS.forEach(({ key, selectId }) => {
    const val = document.getElementById(selectId).value;
    if (val) params.set(key, val);
  });
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
      td.innerHTML = item[field] ? '<span class="hol-tick">&check;</span>' : "—";
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

// Customer Name/Band/Location/Employee Type filters for the Resource and
// Leave grid - same id-based client-side filtering approach as the Time and
// Material grid's own filters (see tmRowMatchesFilters/populateTmCustomerFilter
// above), each independent of the others and re-applied by loadLeaves()
// whenever any of them changes.
let leaveCustomerFilter = "";
let leaveBandFilter = "";
let leaveLocationFilter = "";
let leaveEmployeeTypeFilter = "";
document.getElementById("leaveCustomerFilter").addEventListener("change", (e) => {
  leaveCustomerFilter = e.target.value;
  loadLeaves();
});
document.getElementById("leaveBandFilter").addEventListener("change", (e) => {
  leaveBandFilter = e.target.value;
  loadLeaves();
});
document.getElementById("leaveLocationFilter").addEventListener("change", (e) => {
  leaveLocationFilter = e.target.value;
  loadLeaves();
});
document.getElementById("leaveEmployeeTypeFilter").addEventListener("change", (e) => {
  leaveEmployeeTypeFilter = e.target.value;
  loadLeaves();
});

// Shared predicate for the four filters above - matches the Time and
// Material grid's own tmRowMatchesFilters() pattern.
function leaveRowMatchesFilters(item) {
  return (
    (!leaveCustomerFilter || String(item.customer_id) === leaveCustomerFilter) &&
    (!leaveBandFilter || String(item.band_id) === leaveBandFilter) &&
    (!leaveLocationFilter || String(item.location_id) === leaveLocationFilter) &&
    (!leaveEmployeeTypeFilter || String(item.employee_type_id) === leaveEmployeeTypeFilter)
  );
}

function populateLeaveCustomerFilter(customers) {
  const select = document.getElementById("leaveCustomerFilter");
  const current = leaveCustomerFilter;
  select.innerHTML = '<option value="">All customers</option>' +
    customers.map((c) => `<option value="${c.id}">${escapeHtml(c.customer_name)}</option>`).join("");
  select.value = current;
}

function populateLeaveBandFilter(bands) {
  const select = document.getElementById("leaveBandFilter");
  const current = leaveBandFilter;
  select.innerHTML = '<option value="">All bands</option>' +
    bands.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("");
  select.value = current;
}

function populateLeaveLocationFilter(locations) {
  const select = document.getElementById("leaveLocationFilter");
  const current = leaveLocationFilter;
  select.innerHTML = '<option value="">All locations</option>' +
    locations.map((l) => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join("");
  select.value = current;
}

function populateLeaveEmployeeTypeFilter(employeeTypes) {
  const select = document.getElementById("leaveEmployeeTypeFilter");
  const current = leaveEmployeeTypeFilter;
  select.innerHTML = '<option value="">All employee types</option>' +
    employeeTypes.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");
  select.value = current;
}

function buildLeaveRow(item, editing, customers, locations, employeeTypes, bands) {
  const tr = document.createElement("tr");
  if (editing) tr.classList.add("inline-editing-row");
  // Flag a saved leave record whose employee has no Time and Material
  // assignment against any Statement of Work (tagged_to_sow, computed
  // server-side in list_leaves by cross-referencing tm_assignments - a leave
  // record itself carries no SOW/WBS ID, see the tab-config-leaves comment
  // in index.html). Not applied to the inline-editing/draft row, since its
  // employee_id can still change before it's saved.
  const isUntagged = !editing && item.tagged_to_sow === false;
  if (isUntagged) tr.classList.add("row-untagged");

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
    if (isUntagged) {
      empIdTd.innerHTML += `<span class="info-icon-wrap" tabindex="0">${icon("info")}<span class="info-tooltip-text">This employee is not currently tagged to any Statement of Work (no Time and Material assignment found).</span></span>`;
    }
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
  populateLeaveCustomerFilter(customers);
  populateLeaveBandFilter(bands);
  populateLeaveLocationFilter(locations);
  populateLeaveEmployeeTypeFilter(employeeTypes);

  const filteredItems = items.filter(leaveRowMatchesFilters);
  const tbody = document.getElementById("leaveTableBody");
  tbody.innerHTML = "";
  if (!filteredItems.length) {
    tbody.innerHTML = `<tr><td colspan="20" class="empty-state">${
      items.length ? "No leave records match the selected filter." : 'No leave records yet. Click "Add Leave Record" to add one.'
    }</td></tr>`;
    return;
  }
  filteredItems.forEach((item, idx) => {
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

document.getElementById("exportLeaveBtn").addEventListener("click", () => {
  window.location.href = `${API}/leaves/export`;
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

// Reports > Statement of Work has its own, independent account filter -
// separate state from the dashboard's dashboardCustomerFilter above, so
// picking an account on one page never affects the other.
let sowReportCustomerId = "";
document.getElementById("sowReportCustomerFilter").addEventListener("change", (e) => {
  sowReportCustomerId = e.target.value;
  loadSowReport();
});

// Rebuilds a customer filter <select>'s option list from the current
// customers, keeping whatever is currently selected - shared by the
// Dashboard's own filter and Reports > Statement of Work's filter (each
// page re-fetches customers and calls this on every load rather than once,
// so a newly-added customer shows up without a full page refresh).
function populateCustomerFilterSelect(customers, selectId) {
  const select = document.getElementById(selectId);
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
// tbodyId/countId default to the main Reports/Dashboard page's own element
// ids so every existing call site is unaffected; Reports > Statement of
// Work (see loadSowReport) passes its own distinct ids to reuse this same
// computation against a second, independent copy of the table, plus
// includeTotal:true for a trailing Total row that page's tables get and the
// Dashboard's own copy doesn't (unrequested there).
function renderBillingModelTable(sows, billingModels, tbodyId, countId, includeTotal) {
  const tbody = document.getElementById(tbodyId || "homeBillingModelTableBody");
  const activeCounts = {};
  let totalActive = 0;
  sows.forEach((s) => {
    if ((s.status || "").toLowerCase() !== "active") return;
    const key = s.billing_model_name || "Unspecified";
    activeCounts[key] = (activeCounts[key] || 0) + 1;
    totalActive += 1;
  });
  document.getElementById(countId || "homeBillingModelCount").textContent = totalActive;
  const names = billingModels.map((b) => b.name);
  Object.keys(activeCounts).forEach((k) => { if (!names.includes(k)) names.push(k); });
  names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!names.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-state">No billing models yet.</td></tr>';
    return;
  }
  let rowsHtml = names.map((name) => {
    const count = activeCounts[name] || 0;
    return `<tr><td>${escapeHtml(name)}</td><td>${count}</td><td>${pctOf(count, totalActive)}%</td></tr>`;
  }).join("");
  if (includeTotal) {
    rowsHtml += `<tr class="table-total-row"><td>Total</td><td>${totalActive}</td><td>${pctOf(totalActive, totalActive)}%</td></tr>`;
  }
  tbody.innerHTML = rowsHtml;
}

// SOW Status breakdown - one row per configured status (Configuration > SOW
// Status), even ones with zero SOWs currently, grouped into a single table
// alongside the Billing Models / Expiring cards rather than as separate
// stat tiles. Matched against dashboard.status_counts case-insensitively
// since SOW Status is free-text, user-editable master data. tbodyId/countId
// default to the main Reports/Dashboard page's own ids, and includeTotal
// adds a trailing Total row - see renderBillingModelTable above for why/how
// a second page can reuse this with its own ids/total row.
function renderSowStatusTable(statuses, statusCounts, tbodyId, countId, includeTotal) {
  const tbody = document.getElementById(tbodyId || "homeSowStatusTableBody");
  const names = (statuses || []).map((s) => s.name);
  if (!names.length) {
    document.getElementById(countId || "homeSowStatusCount").textContent = 0;
    tbody.innerHTML = '<tr><td colspan="3" class="empty-state">No statuses yet.</td></tr>';
    return;
  }
  const counts = {};
  names.forEach((name) => { counts[name] = countStatusCI(statusCounts, name); });
  const total = Object.values(counts).reduce((sum, c) => sum + c, 0);
  document.getElementById(countId || "homeSowStatusCount").textContent = total;
  let rowsHtml = names.map((name) => {
    const count = counts[name];
    return `<tr><td>${escapeHtml(name)}</td><td>${count}</td><td>${pctOf(count, total)}%</td></tr>`;
  }).join("");
  if (includeTotal) {
    rowsHtml += `<tr class="table-total-row"><td>Total</td><td>${total}</td><td>${pctOf(total, total)}%</td></tr>`;
  }
  tbody.innerHTML = rowsHtml;
}

// Reports > Statement of Work - a dedicated page for the SOW breakdown
// tables and Expiring in 30 Days list also shown on the main Reports/
// Dashboard page (see renderSowStatusTable/renderBillingModelTable/
// renderExpiringTable above), scoped to this page's own account filter
// (sowReportCustomerId) rather than sharing state with loadHome() (that
// page's own customer filter shouldn't affect this one). The two breakdown
// tables get a trailing Total row here (includeTotal:true) that the
// Dashboard's own copies don't. This page previously also showed TCV/ACV
// cards; removed per explicit request. The count next to each heading is a
// button styled as a link (see .count-link in style.css) that opens the SOW
// details popup (openSowDetailsModal below) listing the SOWs behind that
// count - re-wired with .onclick (not addEventListener) each time this runs
// so repeated loads (e.g. changing the account filter) don't stack up
// duplicate handlers pointing at stale data.
async function loadSowReport() {
  // Same server-side customer_id scoping as loadHome() - sows.customer_id
  // is a real column, so filtering happens in the query rather than
  // client-side, and every widget below (the two breakdown tables,
  // Expiring in 30 Days) is derived from this one already-scoped list.
  const sowsUrl = sowReportCustomerId ? `${API}/sows?customer_id=${sowReportCustomerId}` : `${API}/sows`;
  const [customers, sows, statuses, billingModels] = await Promise.all([
    fetch(`${API}/customers`).then((r) => r.json()),
    fetch(sowsUrl).then((r) => r.json()),
    fetch(`${API}/statuses`).then((r) => r.json()),
    fetch(`${API}/billing-models`).then((r) => r.json()),
  ]);
  populateCustomerFilterSelect(customers, "sowReportCustomerFilter");

  const statusCounts = {};
  sows.forEach((s) => { statusCounts[s.status] = (statusCounts[s.status] || 0) + 1; });
  renderSowStatusTable(statuses, statusCounts, "sowReportStatusTableBody", "sowReportStatusCount", true);
  renderBillingModelTable(sows, billingModels, "sowReportBillingModelTableBody", "sowReportBillingModelCount", true);
  const activeSows = sows.filter((s) => (s.status || "").toLowerCase() === "active");
  const expiringSows = sows.filter((s) => (s.alerts || []).includes("expiring_soon"));
  renderExpiringTable(expiringSows, "sowReportExpiringTableBody", "sowReportExpiringCount");

  document.getElementById("sowReportStatusCount").onclick = () =>
    openSowDetailsModal("Statement of Work Details – All SOWs", sows);
  document.getElementById("sowReportBillingModelCount").onclick = () =>
    openSowDetailsModal("Statement of Work Details – Active SOWs", activeSows);
  document.getElementById("sowReportExpiringCount").onclick = () =>
    openSowDetailsModal("Statement of Work Details – Expiring in 30 Days", expiringSows);
}

// SOW details popup - shows the full list of SOWs behind whichever count on
// Reports > Statement of Work was clicked, with the columns none of that
// page's compact tables show on their own (Billing Model, Revenue Type, TCV,
// ACV, Expiring In) alongside Account Name/SoW Name. Read-only, closed via
// the Close button (see wireModalCancel call below).
const sowDetailsModal = document.getElementById("sowDetailsModal");
wireModalCancel(sowDetailsModal, "closeSowDetailsBtn");
function openSowDetailsModal(title, sows) {
  document.getElementById("sowDetailsModalTitle").textContent = title;
  const tbody = document.getElementById("sowDetailsModalTableBody");
  if (!sows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No SOWs to show.</td></tr>';
  } else {
    const sorted = [...sows].sort((a, b) => (a.customer_name || "").localeCompare(b.customer_name || ""));
    tbody.innerHTML = sorted.map((s) => `
      <tr>
        <td>${escapeHtml(s.customer_name) || "—"}</td>
        <td>${escapeHtml(s.title)}</td>
        <td>${escapeHtml(s.billing_model_name) || "—"}</td>
        <td>${escapeHtml(s.revenue_type_name) || "—"}</td>
        <td>${fmt(s.total_value)}</td>
        <td>${fmt(s.acv)}</td>
        <td>${s.days_to_end === null || s.days_to_end === undefined ? "—" : `${s.days_to_end}d`}</td>
      </tr>
    `).join("");
  }
  sowDetailsModal.hidden = false;
}

// SOWs expiring within 30 days - Account Name / SOW Name / days remaining,
// soonest first. Same underlying data as the SOWs page's "Expiring in 30
// days" card (GET /api/dashboard), just shown as a table here. tbodyId/
// countId default to the main Reports/Dashboard page's own ids - see
// renderBillingModelTable above for why/how a second page can reuse this.
function renderExpiringTable(items, tbodyId, countId) {
  const tbody = document.getElementById(tbodyId || "homeExpiringTableBody");
  document.getElementById(countId || "homeExpiringCount").textContent = items.length;
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

  populateCustomerFilterSelect(customers, "dashboardCustomerFilter");

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

// Revenue Type/Location/Employee Practice filters for the Time and Material
// grid - same id-based client-side filtering approach as tmCustomerFilter
// above, each independent of the others. (Billing Model filter removed per
// explicit request - it never actually matched anything anyway, since
// /api/tm/assignments rows don't carry a billing_model_id field.)
let tmRevenueTypeFilter = "";
let tmLocationFilter = "";
let tmPracticeFilter = "";
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
  // This grid is exclusively Managed Services, so "Time and Material" is
  // excluded from its own Billing Model filter per explicit request - it
  // stays selectable on the Statement of Work list and the Time and
  // Material grid's own Billing Model filter, both of which cover more
  // than one Billing Model.
  const options = models.filter((m) => m.name !== "Time and Material");
  select.innerHTML = '<option value="">All billing models</option>' +
    options.map((m) => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}</option>`).join("");
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

// Revenue Type/Location/Employee Practice filters for Time and Material -
// same pattern as populateTmCustomerFilter() above.
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
  // sow_id is null for a row tracked against just a Customer with no SOW at
  // all (see openRevenueEntryDraft) - excluded here so it can't wrongly mark
  // a real SOW as already-tracked. account_id (the revenue_sow_accounts
  // row's own id) is set on every row either way, so it - not sow_id - is
  // what the cache below and Edit/Copy/Delete/Save key off of uniformly.
  revenueTrackedSowIds = new Set(data.rows.filter((r) => r.sow_id != null).map((r) => r.sow_id));
  revenueSowsCache = new Map(data.rows.map((r) => [r.account_id, r]));

  const filteredRows = data.rows.filter(revenueSowMatchesFilters);

  const tbody = document.getElementById("revenueSowsTableBody");
  tbody.innerHTML = "";
  if (!filteredRows.length) {
    tbody.innerHTML = `<tr><td colspan="33" class="empty-state">${
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

// Fixed display order for Time and Material's Revenue Type summary table,
// per explicit request - see renderRevenueTypeSummaryTable() below.
const TM_REVENUE_TYPE_ORDER = ["Contracted - Staffed", "Contracted - Not staffed", "Renewals", "Pipeline"];

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

  let labels = currentRevenueTypes.map((rt) => rt.name);
  // Time and Material's own summary table shows rows in a fixed, explicitly
  // requested sequence rather than /api/revenue-types' alphabetical order
  // (Managed Services keeps the alphabetical order unchanged) - any revenue
  // type not in this list (e.g. one added later) still shows, just appended
  // after these four in whatever order currentRevenueTypes already has them.
  if (tbodyId === "tmRevenueTypeSummaryBody") {
    const known = TM_REVENUE_TYPE_ORDER.filter((name) => labels.includes(name));
    const rest = labels.filter((name) => !TM_REVENUE_TYPE_ORDER.includes(name));
    labels = [...known, ...rest];
  }
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
  // Revenue Type and Practice are the two Contract fields this grid lets you
  // change directly (everything else about the Contract still goes through
  // the full SOW form) - editable selects while editing, plain text
  // otherwise. Options are filled in and pre-selected after tr.innerHTML is
  // set below, same as the read-only cells further up render from r's
  // *_name fields. Column order here (Revenue Type, Customer Name, SOW,
  // Billing Model, Practice, TCV, ACV) matches the thead in index.html.
  cells += editing
    ? `<td><select class="rev-revenue-type-select"></select></td>`
    : `<td>${escapeHtml(r.revenue_type_name) || "—"}</td>`;
  cells += `<td>${escapeHtml(r.customer_name)}</td><td>${escapeHtml(r.sow_title) || "—"}</td><td>${escapeHtml(r.billing_model_name) || "—"}</td>`;
  cells += editing
    ? `<td><select class="rev-practice-select"></select></td>`
    : `<td>${escapeHtml(r.practice_name) || "—"}</td>`;
  // Onsite #/Offshore #/Nearshore # are directly user-editable per explicit
  // request (previously always read-only, server-computed headcounts of
  // Time and Material assignments tied to the SOW - see
  // upsert_revenue_sow_location_counts in main.py, which now persists
  // whatever's typed here).
  cells += editing
    ? `<td><input type="number" step="1" min="0" class="rev-cell rev-onsite-input" value="${r.onsite_count ?? 0}" /></td>
       <td><input type="number" step="1" min="0" class="rev-cell rev-offshore-input" value="${r.offshore_count ?? 0}" /></td>
       <td><input type="number" step="1" min="0" class="rev-cell rev-nearshore-input" value="${r.nearshore_count ?? 0}" /></td>`
    : `<td class="rev-tcv-cell">${r.onsite_count ?? 0}</td><td class="rev-tcv-cell">${r.offshore_count ?? 0}</td><td class="rev-tcv-cell">${r.nearshore_count ?? 0}</td>`;
  cells += `<td class="rev-tcv-cell">${fmt(r.total_value)}</td><td class="rev-tcv-cell">${fmt(r.acv)}</td>`;
  // Monthly Revenue is the SOW's own monthly run rate (TCV / Contract
  // Duration (Months)) - the same "monthly_value" _compute_acv in main.py
  // derives ACV from - always read-only, never varies month to month.
  const monthlyRevenue = r.duration_months ? (r.total_value || 0) / r.duration_months : 0;
  cells += `<td class="rev-tcv-cell">${fmt(monthlyRevenue)}</td>`;
  // Total is always read-only (sum of the 12 months' Projections, Apr
  // through Mar) - in editing mode it recomputes live as the month inputs
  // change (see the rev-cell "input" wiring below), unlike Monthly Revenue/
  // TCV/ACV just above which don't depend on the months at all.
  const totalProjection = r.months.reduce((sum, m) => sum + (m.projection || 0), 0);
  cells += `<td class="rev-tcv-cell rev-total-cell">${fmtPlain(totalProjection)}</td>`;
  // Alternating background per month (rev-band-a/rev-band-b) so adjacent
  // months are visually grouped and easy to tell apart - matches the same
  // classes on the header cells.
  r.months.forEach((m, i) => {
    const band = i % 2 === 0 ? "rev-band-a" : "rev-band-b";
    cells += editing
      ? `<td class="${band}"><input type="number" step="0.01" class="rev-cell rev-month-input" data-fiscal-month="${m.fiscal_month}" data-field="projection" value="${m.projection}" /></td>`
      : `<td class="rev-readonly-cell ${band}">${fmtPlain(m.projection)}</td>`;
  });
  // Additional Information - last column, after Mar. Optional for a
  // SOW-backed row, but mandatory when saving a row with no SOW at all (see
  // saveRevenueRow()'s validation below, and openRevenueEntryDraft()'s for a
  // brand-new row) - per explicit request.
  cells += editing
    ? `<td><input type="text" class="rev-cell rev-additional-info-input" value="${escapeHtml(r.additional_info)}" /></td>`
    : `<td>${escapeHtml(r.additional_info) || "—"}</td>`;
  tr.innerHTML = cells;

  if (editing) {
    // Keep the Total cell live as the 12 month inputs change, not just after
    // Save reloads the grid - same reasoning as ACV's live preview elsewhere
    // in the app (e.g. wireSowRowFormulas).
    const totalCell = tr.querySelector(".rev-total-cell");
    const monthInputs = tr.querySelectorAll(".rev-month-input");
    function refreshTotal() {
      const sum = Array.from(monthInputs).reduce((acc, input) => acc + (parseFloat(input.value) || 0), 0);
      totalCell.textContent = fmtPlain(sum);
    }
    monthInputs.forEach((input) => input.addEventListener("input", refreshTotal));

    const revenueTypeSelect = tr.querySelector(".rev-revenue-type-select");
    revenueTypeSelect.innerHTML = `<option value="">Select revenue type&hellip;</option>` +
      currentRevenueTypes.map((rt) => `<option value="${rt.id}">${escapeHtml(rt.name)}</option>`).join("");
    revenueTypeSelect.value = r.revenue_type_id ?? "";

    const practiceSelect = tr.querySelector(".rev-practice-select");
    practiceSelect.innerHTML = `<option value="">Select practice&hellip;</option>` +
      currentPractices.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
    practiceSelect.value = r.practice_id ?? "";

    tr.querySelector(".rev-save-btn").addEventListener("click", () => saveRevenueRow(r, tr));
    tr.querySelector(".rev-cancel-btn").addEventListener("click", () => {
      const cached = revenueSowsCache.get(r.account_id) || r;
      replaceRevenueRow(tr, buildRevenueSowRow(cached, false));
    });
  } else {
    tr.querySelector(".rev-copy-btn").addEventListener("click", () => {
      // A SOW can only be tracked once per fiscal year, and a SOW-less row
      // can be duplicated any number of times but still starts blank rather
      // than literally cloning itself - either way "Copy" opens the same Add
      // Entry draft instead, pre-selecting this row's Customer (narrowing the
      // SOW dropdown to that customer's other untracked SOWs) and carrying
      // over the 12 months' figures as a starting point. See
      // openRevenueEntryDraft().
      openRevenueEntryDraft({ customerId: r.customer_id, months: r.months });
    });
    tr.querySelector(".rev-edit-btn").addEventListener("click", () => {
      replaceRevenueRow(tr, buildRevenueSowRow(r, true));
    });
    tr.querySelector(".rev-del-btn").addEventListener("click", async () => {
      const label = r.sow_id ? `"${r.sow_title}" (${r.customer_name})` : `this row for "${r.customer_name}" (no SOW)`;
      if (confirm(`Remove ${label} from Revenue Management for ${fyLabelText(currentFiscalYear)}? This deletes all of its months for this fiscal year.`)) {
        // A SOW-less row has no (sow_id, fiscal_year) to delete by - it's
        // removed by its own account_id instead. See create_revenue_account/
        // delete_revenue_account in main.py.
        const resp = r.sow_id
          ? await fetch(`${API}/revenue/sows/${r.sow_id}/${currentFiscalYear}`, { method: "DELETE" })
          : await fetch(`${API}/revenue/accounts/${r.account_id}`, { method: "DELETE" });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          alert(formatApiError(err, "Failed to remove this row from Revenue Management."));
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
// upsert endpoint - there's no bulk-upsert), then reloads the grid so the
// row reverts to read-only display showing the saved values. r is the row
// being edited (its already-known sow_id/account_id say which set of
// endpoints to use): a SOW-backed row (r.sow_id set) saves Revenue
// Type/Practice via the narrow Contract /classification endpoint, since
// those two actually live on the Contract, not on a revenue_entries row -
// completely unchanged from before this row could ever be SOW-less. A
// SOW-less row (r.sow_id null) has no Contract to hold them, so it uses the
// parallel account-level endpoints instead, keyed by its own (already
// existing) account_id.
async function saveRevenueRow(r, tr) {
  const saveBtn = tr.querySelector(".rev-save-btn");
  const cancelBtn = tr.querySelector(".rev-cancel-btn");
  saveBtn.disabled = true;
  cancelBtn.disabled = true;
  const sowId = r.sow_id;
  const accountId = r.account_id;
  const additionalInfo = tr.querySelector(".rev-additional-info-input").value;
  // Additional Information is mandatory only for a row with no SOW (per
  // explicit request) - checked before anything is sent, same as
  // openRevenueEntryDraft()'s own check for a brand-new row.
  if (!sowId && !additionalInfo.trim()) {
    alert("Please fill in the Additional Information column before saving a row with no SOW.");
    saveBtn.disabled = false;
    cancelBtn.disabled = false;
    return;
  }
  const projectionInputs = tr.querySelectorAll('.rev-cell[data-field="projection"]');
  const monthPayloads = Array.from(projectionInputs).map((projectionInput) => {
    const fiscalMonth = parseInt(projectionInput.dataset.fiscalMonth, 10);
    return sowId
      ? { sow_id: sowId, fiscal_year: currentFiscalYear, fiscal_month: fiscalMonth, projection: parseFloat(projectionInput.value) || 0 }
      : { account_id: accountId, fiscal_month: fiscalMonth, projection: parseFloat(projectionInput.value) || 0 };
  });
  const revenueTypeVal = tr.querySelector(".rev-revenue-type-select").value;
  const practiceVal = tr.querySelector(".rev-practice-select").value;
  const classificationPayload = {
    revenue_type_id: revenueTypeVal ? parseInt(revenueTypeVal, 10) : null,
    practice_id: practiceVal ? parseInt(practiceVal, 10) : null,
  };
  // Onsite #/Offshore #/Nearshore # are directly editable now too (see
  // buildRevenueSowRow) - saved via their own narrow upsert endpoint,
  // same "one endpoint per Contract-vs-tracking-row concern" split as
  // classificationPayload above.
  const locationCounts = {
    onsite_count: parseInt(tr.querySelector(".rev-onsite-input").value, 10) || 0,
    offshore_count: parseInt(tr.querySelector(".rev-offshore-input").value, 10) || 0,
    nearshore_count: parseInt(tr.querySelector(".rev-nearshore-input").value, 10) || 0,
  };
  const cellUrl = sowId ? `${API}/revenue/sows` : `${API}/revenue/accounts/cell`;
  const classificationUrl = sowId ? `${API}/sows/${sowId}/classification` : `${API}/revenue/accounts/${accountId}/classification`;
  const locationCountsUrl = sowId ? `${API}/revenue/sows/location-counts` : `${API}/revenue/accounts/${accountId}/location-counts`;
  const locationCountsPayload = sowId
    ? { sow_id: sowId, fiscal_year: currentFiscalYear, ...locationCounts }
    : locationCounts;
  try {
    const responses = await Promise.all([
      ...monthPayloads.map((payload) =>
        fetch(cellUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      ),
      fetch(classificationUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(classificationPayload) }),
      fetch(locationCountsUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(locationCountsPayload) }),
      // account_id is always already known for an existing row (SOW-backed
      // or not), so Additional Information can always be saved via its one
      // universal endpoint here, unlike the classification/location-counts
      // split above.
      fetch(`${API}/revenue/accounts/${accountId}/additional-info`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ additional_info: additionalInfo }),
      }),
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

// Builds the 12 month <td>s (Projections only) for the "Add Entry" draft row.
// Mirrors the same fiscal-month/band pattern buildRevenueSowRow() uses for a tracked row, but
// starting from blank/zero values since nothing has been saved yet. Always
// called with editable:true now (see openRevenueEntryDraft() - the 12 month
// inputs are enabled from the moment the draft row appears, not gated behind
// picking a SOW first) - the read-only "—" branch is kept only because
// buildRevenueSowRow's own read-only rendering is a separate code path and
// this helper has no other caller left to need it, not because anything
// still passes false.
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
// Customer dropdown narrows a SOW dropdown to that customer's SOWs (Time and
// Material SOWs are excluded - see the accountSelect change handler below -
// since Time and Material projections are tracked on their own grid, not
// here). Revenue Type, Practice and the 12 month inputs are all enabled from
// the moment this row appears (per explicit request) rather than waiting
// for a SOW to be picked, so a user can start typing before deciding which
// SOW (if any) they're logging against - per explicit request, a row can be
// saved with a Customer chosen and no SOW at all (see saveBtn's click
// handler below), so Save is gated only on Customer being chosen (see
// accountSelect's change handler), not on a SOW. Also the basis for "Copy" on an existing row (see buildRevenueSowRow's
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
    <td><select class="draft-revenue-type-select"><option value="">Select revenue type&hellip;</option></select></td>
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
    <td><select class="draft-practice-select"><option value="">Select practice&hellip;</option></select></td>
    <!-- Onsite #/Offshore #/Nearshore # are directly user-editable (see
         buildRevenueSowRow's own comment) - enabled from the start, same as
         the month inputs below, independent of a SOW being picked. -->
    <td><input type="number" step="1" min="0" class="rev-cell draft-onsite-input" value="0" /></td>
    <td><input type="number" step="1" min="0" class="rev-cell draft-offshore-input" value="0" /></td>
    <td><input type="number" step="1" min="0" class="rev-cell draft-nearshore-input" value="0" /></td>
    <td class="draft-tcv rev-tcv-cell">&mdash;</td>
    <td class="draft-acv rev-tcv-cell">&mdash;</td>
    <td class="draft-monthly-revenue rev-tcv-cell">&mdash;</td>
    <td class="rev-tcv-cell draft-total-cell">0.00</td>
    ${draftMonthCellsHtml(true)}
    <!-- Additional Information - last column, after Mar. Mandatory only when
         saving with no SOW picked (per explicit request) - see the
         saveBtn click handler below. -->
    <td><input type="text" class="rev-cell draft-additional-info-input" value="" /></td>
  `;
  tbody.insertBefore(tr, tbody.firstChild);

  const accountSelect = tr.querySelector(".draft-account-select");
  const sowSelect = tr.querySelector(".draft-sow-select");
  const tcvCell = tr.querySelector(".draft-tcv");
  const acvCell = tr.querySelector(".draft-acv");
  const monthlyRevenueCell = tr.querySelector(".draft-monthly-revenue");
  const billingModelCell = tr.querySelector(".draft-billing-model");
  const revenueTypeSelect = tr.querySelector(".draft-revenue-type-select");
  const practiceSelect = tr.querySelector(".draft-practice-select");
  const saveBtn = tr.querySelector(".draft-save-btn");

  // Options don't depend on the chosen customer/SOW, so fill them in once
  // up front. Revenue Type is enabled from the start (per explicit request -
  // it no longer waits on a SOW being picked, unlike Practice just below,
  // which still does); its pre-selected value still follows whichever SOW
  // ends up chosen (see the sowSelect handler below), so picking a SOW that
  // already has a Revenue Type on its Contract still auto-fills it, but the
  // user is free to set/change it beforehand or override it after.
  revenueTypeSelect.innerHTML = `<option value="">Select revenue type&hellip;</option>` +
    currentRevenueTypes.map((rt) => `<option value="${rt.id}">${escapeHtml(rt.name)}</option>`).join("");
  practiceSelect.innerHTML = `<option value="">Select practice&hellip;</option>` +
    currentPractices.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");

  // Copy's starting point: fill the (already-editable) inputs with the
  // source row's monthly figures instead of leaving them at 0, so
  // duplicating a row's numbers onto a different SOW doesn't mean retyping
  // all 12 of them. No-op for a plain "Add Entry" (no prefill.months).
  // Applied once up front (nothing here depends on a SOW being chosen first
  // any more) and re-applied when a SOW is picked below, in case the row was
  // rebuilt in between - harmless either way since it just re-sets the same
  // values.
  function fillDraftMonthsFromPrefill() {
    if (!prefill.months) return;
    prefill.months.forEach((m) => {
      const projInput = tr.querySelector(`.draft-projection-input[data-fiscal-month="${m.fiscal_month}"]`);
      if (projInput) projInput.value = m.projection;
    });
    refreshDraftTotal();
  }
  // Total is always read-only (sum of the 12 months' Projections) and, like
  // buildRevenueSowRow's own editing-mode Total, recomputes live as the
  // month inputs change - here that's true from the moment the draft row
  // appears, since the month inputs are editable from the start too.
  const draftTotalCell = tr.querySelector(".draft-total-cell");
  function refreshDraftTotal() {
    const inputs = tr.querySelectorAll(".draft-projection-input");
    const sum = Array.from(inputs).reduce((acc, input) => acc + (parseFloat(input.value) || 0), 0);
    draftTotalCell.textContent = fmtPlain(sum);
  }
  tr.querySelectorAll(".draft-projection-input").forEach((input) => input.addEventListener("input", refreshDraftTotal));
  fillDraftMonthsFromPrefill();

  accountSelect.addEventListener("change", () => {
    const val = accountSelect.value;
    // Save needs a Customer, but - per explicit request - not a SOW: once a
    // Customer is chosen the row can be saved as-is (SOW-less), so Save is
    // gated on Customer alone, not re-gated by the SOW dropdown below.
    saveBtn.disabled = !val;
    tcvCell.textContent = "—";
    acvCell.textContent = "—";
    monthlyRevenueCell.textContent = "—";
    billingModelCell.textContent = "—";
    revenueTypeSelect.value = "";
    practiceSelect.value = "";
    if (!val) {
      sowSelect.disabled = true;
      sowSelect.innerHTML = '<option value="">Select customer first&hellip;</option>';
      return;
    }
    // Time and Material SOWs are excluded here - this grid (Best Estimates >
    // Managed Services) is for Non-Time and Material SOWs only, per explicit
    // request; Time and Material SOWs are tracked on their own grid (Best
    // Estimates > Time and Material) instead.
    const matching = sows.filter((s) => {
      return (
        s.customer_id === parseInt(val, 10) &&
        !revenueTrackedSowIds.has(s.id) &&
        (s.billing_model_name || "") !== "Time and Material"
      );
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
    // Save itself no longer depends on a SOW being picked (see
    // accountSelect's change handler above) - picking or clearing a SOW here
    // only affects which figures/classification get auto-filled below.
    const selectedSow = sows.find((s) => String(s.id) === sowSelect.value);
    // TCV/ACV/Monthly Revenue are always the selected SOW's own figures,
    // shown plain (never an <input>) - auto-populated here and read-only by
    // construction. Monthly Revenue mirrors the same TCV / Contract
    // Duration (Months) formula buildRevenueSowRow uses.
    tcvCell.textContent = selectedSow ? fmt(selectedSow.total_value) : "—";
    acvCell.textContent = selectedSow ? fmt(selectedSow.acv) : "—";
    monthlyRevenueCell.textContent = selectedSow && selectedSow.duration_months
      ? fmt((selectedSow.total_value || 0) / selectedSow.duration_months)
      : "—";
    billingModelCell.textContent = (selectedSow && selectedSow.billing_model_name) || "—";
    revenueTypeSelect.value = (selectedSow && selectedSow.revenue_type_id) ?? "";
    practiceSelect.value = (selectedSow && selectedSow.practice_id) ?? "";
    fillDraftMonthsFromPrefill();
  });

  tr.querySelector(".draft-cancel-btn").addEventListener("click", () => {
    tr.remove();
    if (!tbody.querySelector("tr")) loadRevenueSows();
  });

  saveBtn.addEventListener("click", async () => {
    // Save needs a Customer (accountSelect's change handler gates the button
    // on that alone - see its comment), but per explicit request a SOW is
    // optional: sowId empty means this saves as a SOW-less row against just
    // the chosen Customer instead.
    const customerId = accountSelect.value;
    if (!customerId) return;
    const sowId = sowSelect.value;
    const selectedSow = sows.find((s) => String(s.id) === sowId);
    const additionalInfo = tr.querySelector(".draft-additional-info-input").value;
    // Additional Information is mandatory only for a row with no SOW (per
    // explicit request) - checked before anything is sent, same as
    // saveRevenueRow()'s own check for an existing row's edit.
    if (!sowId && !additionalInfo.trim()) {
      alert("Please fill in the Additional Information column before saving a row with no SOW.");
      return;
    }
    const cancelBtn = tr.querySelector(".draft-cancel-btn");
    saveBtn.disabled = true;
    cancelBtn.disabled = true;

    // Collect whatever was typed into the (now-editable) month inputs.
    const projectionInputs = tr.querySelectorAll(".draft-projection-input");
    const months = Array.from(projectionInputs).map((projectionInput) => {
      const fiscalMonth = parseInt(projectionInput.dataset.fiscalMonth, 10);
      return {
        fiscal_month: fiscalMonth,
        projection: parseFloat(projectionInput.value) || 0,
      };
    });

    // Revenue Type/Practice are editable right here too (see the template
    // above) - for a SOW-backed row these are written back onto the
    // Contract via the same narrow /classification endpoint saveRevenueRow()
    // uses for an existing row's edit; for a SOW-less row there's no
    // Contract to hold them, so they're written onto the tracking row itself
    // instead (see create_revenue_account/update_revenue_account_classification
    // in main.py).
    const revenueTypeId = revenueTypeSelect.value ? parseInt(revenueTypeSelect.value, 10) : null;
    const practiceId = practiceSelect.value ? parseInt(practiceSelect.value, 10) : null;

    // Onsite #/Offshore #/Nearshore # are editable right here too (see the
    // template above).
    const onsiteCount = parseInt(tr.querySelector(".draft-onsite-input").value, 10) || 0;
    const offshoreCount = parseInt(tr.querySelector(".draft-offshore-input").value, 10) || 0;
    const nearshoreCount = parseInt(tr.querySelector(".draft-nearshore-input").value, 10) || 0;

    let accountId = null;
    if (!sowId) {
      // A SOW-less row has no (sow_id, fiscal_year) style natural key to
      // implicitly create itself via the month/classification/location-count
      // PUTs below the way a SOW-backed row does - unlimited SOW-less rows
      // per Customer are explicitly allowed, so there's nothing to
      // INSERT OR IGNORE against. It has to be created explicitly first to
      // get back a real account_id, then every other write below is keyed on
      // that - unlike the SOW-backed path, these can't all fire concurrently.
      const createResp = await fetch(`${API}/revenue/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: parseInt(customerId, 10), fiscal_year: currentFiscalYear, additional_info: additionalInfo }),
      });
      if (!createResp.ok) {
        const err = await createResp.json().catch(() => ({}));
        alert(formatApiError(err, "Failed to save this entry."));
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
        return;
      }
      accountId = (await createResp.json()).account_id;
    }

    const cellUrl = sowId ? `${API}/revenue/sows` : `${API}/revenue/accounts/cell`;
    const classificationUrl = sowId ? `${API}/sows/${sowId}/classification` : `${API}/revenue/accounts/${accountId}/classification`;
    const locationCountsUrl = sowId ? `${API}/revenue/sows/location-counts` : `${API}/revenue/accounts/${accountId}/location-counts`;
    const locationCountsPayload = sowId
      ? { sow_id: parseInt(sowId, 10), fiscal_year: currentFiscalYear, onsite_count: onsiteCount, offshore_count: offshoreCount, nearshore_count: nearshoreCount }
      : { onsite_count: onsiteCount, offshore_count: offshoreCount, nearshore_count: nearshoreCount };

    const responses = await Promise.all([
      ...months.map((m) =>
        fetch(cellUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sowId ? { sow_id: parseInt(sowId, 10), fiscal_year: currentFiscalYear, ...m } : { account_id: accountId, ...m }),
        })
      ),
      fetch(classificationUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revenue_type_id: revenueTypeId, practice_id: practiceId }),
      }),
      fetch(locationCountsUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(locationCountsPayload),
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

    // Additional Information for a brand-new SOW-backed row (optional here,
    // unlike the no-SOW path just above where it was already sent with the
    // create call): its account_id isn't known client-side yet (created
    // implicitly server-side by the PUTs above, same as always) - reload to
    // learn it, then save Additional Information via its own endpoint. Only
    // done when the field was actually filled in - left blank (the common
    // case) falls through to the same no-reload splice as before.
    if (sowId && additionalInfo.trim()) {
      revenueTrackedSowIds.add(selectedSow.id);
      await loadRevenueSows();
      const savedRow = Array.from(revenueSowsCache.values()).find((row) => row.sow_id === selectedSow.id);
      if (savedRow) {
        const infoResp = await fetch(`${API}/revenue/accounts/${savedRow.account_id}/additional-info`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ additional_info: additionalInfo }),
        });
        if (infoResp.ok) {
          await loadRevenueSows();
        } else {
          const err = await infoResp.json().catch(() => ({}));
          alert(formatApiError(err, "Entry saved, but Additional Information could not be saved."));
        }
      }
      return;
    }

    const revenueTypeName = (currentRevenueTypes.find((rt) => rt.id === revenueTypeId) || {}).name || null;
    const practiceName = (currentPractices.find((p) => p.id === practiceId) || {}).name || null;
    const selectedCustomer = customers.find((c) => String(c.id) === customerId);
    const newRow = selectedSow
      ? {
          account_id: accountId, // unused when a SOW backs this row - resolved on next full reload
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
          onsite_count: onsiteCount,
          offshore_count: offshoreCount,
          nearshore_count: nearshoreCount,
          additional_info: null, // only reached here when left blank - see the reload-then-set branch above
          months,
        }
      : {
          account_id: accountId,
          sow_id: null,
          sow_title: null,
          customer_id: parseInt(customerId, 10),
          customer_name: (selectedCustomer && selectedCustomer.customer_name) || "Unassigned",
          total_value: null,
          duration_months: null,
          acv: 0,
          billing_model_name: null,
          revenue_type_id: revenueTypeId,
          revenue_type_name: revenueTypeName,
          practice_id: practiceId,
          practice_name: practiceName,
          onsite_count: onsiteCount,
          offshore_count: offshoreCount,
          nearshore_count: nearshoreCount,
          additional_info: additionalInfo,
          months,
        };
    if (sowId) revenueTrackedSowIds.add(newRow.sow_id);
    // newRow.account_id is only really known here for a SOW-less row (just
    // handed back by the explicit create call above) - a SOW-backed row's
    // account_id was created implicitly server-side by the PUTs above the
    // same way it always has been, so it's left unset here and only becomes
    // known on the next real reload (loadRevenueSows()). That's harmless:
    // the only place this cache is read back before then is Cancel (see
    // buildRevenueSowRow), which already falls back to the row itself on a
    // cache miss.
    revenueSowsCache.set(newRow.account_id, newRow);
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
  // fillDraftMonthsFromPrefill(), called once up front and again once a SOW
  // is actually chosen). No-op for a plain "Add Entry" (no
  // prefill.customerId) or if that customer has nothing left to copy onto
  // (every one of its SOWs already tracked).
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
  // Time and Material assignments only ever belong to a Time and Material
  // Contract - narrowed here per explicit request, mirroring the opposite
  // exclusion the Managed Services grid's own SOW matching already applies
  // (see openRevenueEntryDraft's accountSelect handler).
  return currentAllSows.filter((s) => String(s.customer_id) === String(customerId) && (s.billing_model_name || "") === "Time and Material");
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
      <td class="tm-employee-id-cell"><input type="text" class="tm-employee-id-input" value="${escapeHtml(r.employee_id || "")}" /></td>
      <td><input type="text" class="tm-employee-name-input" value="${escapeHtml(r.employee_name || "")}" /></td>
      <td><select class="tm-location-select"></select></td>
      <td class="tm-billing-hours-cell">${r.billing_hours_per_day != null ? fmtPlain(r.billing_hours_per_day) : "—"}</td>
      <td><select class="tm-practice-select"></select></td>
      <td><input type="text" class="tm-sow-role-input" value="${escapeHtml(r.sow_role || "")}" /></td>
      <td><input type="text" class="tm-wbs-input" value="${escapeHtml(r.wbs_id || "")}" /></td>
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
      <td class="tm-employee-id-cell">${escapeHtml(r.employee_id) || "—"}</td>
      <td>${escapeHtml(r.employee_name) || "—"}${r.leave_details_missing ? `<span class="info-icon-wrap" tabindex="0">${icon("info")}<span class="info-tooltip-text">Leave details are missing</span></span>` : ""}</td>
      <td>${escapeHtml(r.location_name) || "—"}</td>
      <td class="tm-billing-hours-cell">${r.billing_hours_per_day != null ? fmtPlain(r.billing_hours_per_day) : "—"}</td>
      <td>${escapeHtml(r.practice_name) || "—"}</td>
      <td>${escapeHtml(r.sow_role) || "—"}</td>
      <td>${escapeHtml(r.wbs_id) || "—"}</td>
      <td class="rev-tcv-cell">${r.rate_card != null ? fmt(r.rate_card) : "—"}</td>
      <td>${r.discount_percent != null ? r.discount_percent + "%" : "—"}</td>
      <td class="rev-tcv-cell tm-final-rate">${r.final_rate_card != null ? fmt(r.final_rate_card) : "—"}</td>
      <td>${fmtDate(r.start_date)}</td>
      <td>${fmtDate(r.end_date)}</td>
    `;
  }

  // Total is always read-only (sum of the 12 months' Projections, Apr
  // through Mar) in both read-only and editing mode - there's nothing to
  // input, same reasoning as Projections itself just below.
  const totalProjection = r.months.reduce((sum, m) => sum + (m.projection || 0), 0);
  cells += `<td class="rev-tcv-cell tm-total-cell">${fmtPlain(totalProjection)}</td>`;

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
    <td><input type="text" class="tm-draft-employee-id-input" value="${escapeHtml(prefill.employeeId || "")}" /></td>
    <td><input type="text" class="tm-draft-employee-name-input" value="${escapeHtml(prefill.employeeName || "")}" /></td>
    <td><select class="tm-draft-location-select"></select></td>
    <td class="tm-draft-billing-hours-cell">&mdash;</td>
    <td><select class="tm-draft-practice-select"></select></td>
    <td><input type="text" class="tm-draft-sow-role-input" value="${escapeHtml(prefill.sowRole || "")}" /></td>
    <td><input type="text" class="tm-draft-wbs-input" value="${escapeHtml(prefill.wbsId || "")}" /></td>
    <td><input type="number" step="0.01" min="0" class="tm-draft-rate-card-input" value="${prefill.rateCard ?? ""}" /></td>
    <td><input type="number" step="0.01" min="0" max="100" class="tm-draft-discount-input" value="${prefill.discountPercent ?? ""}" /></td>
    <td class="tm-draft-final-rate-cell tm-final-rate">&mdash;</td>
    <td><input type="date" class="tm-draft-start-date-input" value="${prefill.startDate || ""}" /></td>
    <td><input type="date" class="tm-draft-end-date-input" value="${prefill.endDate || ""}" /></td>
    <td class="rev-tcv-cell tm-total-cell">&mdash;</td>
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
  // options aren't tied to a change listener. refreshFinalRate() is called
  // once explicitly since the Rate Card/Discount inputs were only prefilled
  // via their initial value attribute, which doesn't fire the "input"
  // event that normally keeps Discounted Rate Card in sync. Every piece
  // here is a no-op for a plain "Add Entry" click (prefill fields all
  // undefined).
  if (prefill.customerId) {
    customerSelect.dispatchEvent(new Event("change"));
    if (prefill.sowId) sowSelect.value = String(prefill.sowId);
  }
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
