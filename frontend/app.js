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
// Footer "N rows returned" message (bottom-left of the app-wide footer,
// see #footerRowCount in index.html) - reflects how many rows the
// *currently active* filter(s) on whichever page is open left in view.
// Every filterable page's load/render function calls this at its tail with
// either a row count (when at least one of its filters/search box is set to
// something other than "All"/blank) or null (to clear the message - no
// active filter, or a page this feature doesn't cover). showTab() also
// clears it up front on every navigation, so a count never lingers over
// from whatever page was open before.
function setFooterRowCount(count) {
  const el = document.getElementById("footerRowCount");
  if (!el) return;
  el.textContent = count === null || count === undefined ? "" : `${count} row${count === 1 ? "" : "s"} returned`;
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
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>',
};
function icon(name, size) {
  size = size || 14;
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] || ""}</svg>`;
}

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
  // Cleared up front so the footer's "N rows returned" message never shows a
  // count left over from whatever page was open before - each page's own
  // load function (dispatched below) re-sets it once its data arrives, only
  // if that page actually has an active filter.
  setFooterRowCount(null);
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

  // The SOWs, Staffing, Revenue Management, Resource and Leave, Customer,
  // Billing Hours and Holiday Calendar pages freeze their stat tiles/toolbar
  // and table header in place and scroll only the table body (see
  // .scroll-locked rules in style.css) - toggled here rather than left on
  // permanently so every other page keeps its normal whole-page scrolling.
  document.body.classList.toggle(
    "scroll-locked",
    ["sows", "resources", "revenue", "config-leaves", "customers", "config-billing-hours", "config-holidays"].includes(name)
  );

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
  if (name === "resource-hub") loadResourceReport();
  if (name === "revenue-hub") loadRevenueReport();
  if (name === "billing-days-report") loadBillingDaysReport();
}

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
// the currently-filtered SOW list by loadSows() every time the
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

// Drives the overdue/expiring/over-budget banner below the table from
// whatever the search box / status filter / customer filter currently narrow
// the table down to - each row already carries alerts from the backend's
// _enrich_sow(), so this is derived from the already-fetched list directly
// instead of a separate unfiltered /api/dashboard call. (The stat tiles that
// used to sit above the table and feed off this same filtered list have been
// removed per an explicit request - this banner is a separate, still-wanted
// element and keeps working unchanged.)
function updateSowAlertBanner(sows) {
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
  // Banner reflects this same filtered list, so it stays in sync with
  // whatever the search box / status filter / customer filter narrowed the
  // table down to.
  updateSowAlertBanner(currentSows);
  setFooterRowCount(q || status || customerId || billingModelId ? currentSows.length : null);
}

function renderSowsTable(sowsIn) {
  const sows = sortSows(sowsIn);
  updateSortArrows();
  const tbody = document.getElementById("sowTableBody");
  tbody.innerHTML = "";
  if (!sows.length) {
    tbody.innerHTML = '<tr><td colspan="23" class="empty-state">No SOWs yet. Click "New SOW" to add one.</td></tr>';
    return;
  }
  sows.forEach((s) => tbody.appendChild(buildSowRow(s)));
  renumberSowRows();
}

// Fills in every row's "Sl. No" cell based on current DOM order, skipping the
// milestone-subrow a Fixed Price row's expand-btn may have injected below it
// (see toggleMilestoneSubrow) - same pattern as renumberRevenueRows()/
// renumberLeaveRows-equivalent elsewhere in this file.
function renumberSowRows() {
  const tbody = document.getElementById("sowTableBody");
  let n = 0;
  tbody.querySelectorAll("tr").forEach((tr) => {
    if (tr.classList.contains("milestone-subrow")) return;
    const cell = tr.querySelector(".sow-sl-no");
    if (cell) { n += 1; cell.textContent = n; }
  });
}

// Milestone status is a fixed 2-value set (see MilestoneIn in backend/
// main.py) rather than the free-text master lists most other statuses in
// this app use, so both the badge color and the human-readable label are
// simple lookups keyed off the raw stored value.
const MILESTONE_BADGE_CLASS = { invoiced: "active", to_be_invoiced: "draft" };
const MILESTONE_STATUS_LABEL = { invoiced: "Invoiced", to_be_invoiced: "To be invoiced" };
function milestoneStatusLabel(status) {
  return MILESTONE_STATUS_LABEL[status] || capitalize((status || "").replace(/_/g, " "));
}

function renderMilestoneSubtable(milestones) {
  if (!milestones.length) {
    return '<div class="empty-state empty-state-tight">No milestones yet.</div>';
  }
  const rows = milestones.map((m) => `
    <tr>
      <td>${escapeHtml(m.description)}</td>
      <td>${fmtDate(m.due_date)}</td>
      <td>${fmt(m.amount)}</td>
      <td><span class="badge badge-${MILESTONE_BADGE_CLASS[m.status] || "draft"}">${escapeHtml(milestoneStatusLabel(m.status))}</span></td>
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
  subTr.innerHTML = `<td colspan="23">${renderMilestoneSubtable(milestones)}</td>`;
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

// ---------- New/Edit SOW popup ----------
// Per an explicit request this went back to being a real modal (#sowFormModal
// in index.html) instead of the inline-editable-row approach used before -
// New SOW/Edit/Copy all call openSowModal() now. Fields are grouped into
// labeled sections (.form-section-title) matching the same grouping the read-
// only table below uses: Opportunity Details / Billing and Operating Model /
// Duration Details / Financial Details / BTP Details / Reference Documents /
// Additional Information, plus a standalone Customer Name field and a
// Milestones section (Fixed Price SOWs only). Billing Model (.sow-f-billing)
// lives only under Billing and Operating Model - it used to also be shown a
// second time under Financial Details, removed per explicit request.
// Revenue Type/Practice aren't on this form (same as before the modal
// existed) - they're set from Revenue Outlook > Best Estimates instead via
// the separate /classification endpoint, so they're carried through
// unchanged on every save (see the revenue_type_id/practice_id lines in the
// submit handler below) rather than exposed here or silently wiped.
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

// Wires up Duration/Customer Code's live recompute inside the SOW form
// popup - ACV (USD) used to be computed the same way here for a live
// on-screen preview, but per an explicit request ACV is no longer shown
// anywhere on this form or the table below it, so only Duration and Customer
// Code remain. ACV is still computed server-side (_enrich_sow() in
// backend/main.py) for anything else in the app that reads it from the API.
function wireSowFormFormulas(container) {
  const startInput = container.querySelector(".sow-f-start");
  const endInput = container.querySelector(".sow-f-end");
  const durationInput = container.querySelector(".sow-f-duration");
  const customerSelect = container.querySelector(".sow-f-customer");
  const customerCodeInput = container.querySelector(".sow-f-customer-code");

  function refreshDuration() {
    durationInput.value = computeSowDurationMonths(startInput.value, endInput.value, durationInput.value);
  }
  startInput.addEventListener("change", refreshDuration);
  endInput.addEventListener("change", refreshDuration);
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

// Builds one read-only <tr> for the SOW grid (Copy/Edit/Delete actions, the
// Fixed Price milestones expand-btn, doc links as clickable text). Column
// order mirrors the table's own two-row grouped header in index.html -
// Customer Name, then Opportunity Details / Billing and Operating Model /
// Duration Details / Financial Details / BTP Details / Reference Documents /
// Additional Information. Editing now happens in the New/Edit SOW popup (see
// openSowModal() below) rather than in place, so this only ever renders the
// display form of a row.
function buildSowRow(s) {
  const isFixedPrice = (s.billing_model_name || "").toLowerCase().includes("fixed price");
  const tr = document.createElement("tr");
  tr.dataset.sowId = s.id ?? "";
  // Highlight rows by how soon the SOW's end date is coming up: 0-15 days
  // out in red, 16-50 days out in amber. Independent of status - it's a
  // visual "check this date" cue, not a replacement for the Status badge.
  if (s.days_to_end !== null && s.days_to_end !== undefined) {
    if (s.days_to_end >= 0 && s.days_to_end <= 15) tr.classList.add("expiry-red");
    else if (s.days_to_end >= 16 && s.days_to_end <= 50) tr.classList.add("expiry-amber");
  }

  const actionsHtml = `<td class="row-actions">
        <button class="ghost-btn btn-edit icon-btn copy-btn" title="Copy">${icon("copy")}</button>
        <button class="ghost-btn btn-edit icon-btn edit-btn" title="Edit">${icon("edit")}</button>
        <button class="ghost-btn btn-danger icon-btn del-btn" title="Delete">${icon("trash")}</button>
      </td>`;

  const bodyHtml = `
    <td class="sl-no-cell sow-sl-no"></td>
    <td>${escapeHtml(s.customer_name)}</td>
    <td>${escapeHtml(s.opportunity_id) || "—"}</td>
    <td>${escapeHtml(s.opportunity_type_name) || "—"}</td>
    <td>${escapeHtml(s.title)}${isFixedPrice ? `<button type="button" class="expand-btn" title="Show milestones">${icon("chevron")}</button>` : ""}</td>
    <td><span class="badge badge-${slugify(s.status)}">${escapeHtml(s.status)}</span></td>
    <td>${escapeHtml(s.billing_model_name) || "—"}</td>
    <td>${escapeHtml(s.operating_model_name) || "—"}</td>
    <td>${fmtDate(s.start_date)}</td>
    <td>${fmtDate(s.end_date)}</td>
    <td>${s.duration_months !== null && s.duration_months !== undefined ? s.duration_months : "—"}</td>
    <td>${fmt(s.total_value)}</td>
    <td>${s.gm_percent !== null && s.gm_percent !== undefined ? Number(s.gm_percent.toFixed(2)) + "%" : "—"}</td>
    <td>${escapeHtml(s.po_number) || "—"}</td>
    <td>${escapeHtml(s.customer_code) || "—"}</td>
    <td>${escapeHtml(s.contract_code) || "—"}</td>
    <td>${escapeHtml(s.project_title) || "—"}</td>
    <td>${escapeHtml(s.project_code) || "—"}</td>
    <td>${s.doc_link ? `<span class="truncate-cell">${renderDocLink(s.doc_link)}</span>` : "—"}</td>
    <td>${s.deal_sheet_link ? `<span class="truncate-cell">${renderDocLink(s.deal_sheet_link)}</span>` : "—"}</td>
    <td>${s.po_doc_link ? `<span class="truncate-cell">${renderDocLink(s.po_doc_link)}</span>` : "—"}</td>
    <td>${s.notes ? `<span class="notes-cell" title="${escapeHtml(s.notes)}">${escapeHtml(s.notes)}</span>` : "—"}</td>
  `;
  tr.innerHTML = actionsHtml + bodyHtml;

  if (isFixedPrice) {
    tr.querySelector(".expand-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      await toggleMilestoneSubrow(tr, s);
    });
  }
  tr.querySelector(".edit-btn").addEventListener("click", async (e) => {
    e.stopPropagation();
    await openSowModal(s);
  });
  // Copy: opens the New/Edit SOW popup pre-filled with this row's own values
  // (title gets a "(Copy)" suffix) and no id, so Save creates a new record
  // instead of overwriting the original. Milestones are deliberately not
  // copied - add them on the new SOW once it's saved.
  tr.querySelector(".copy-btn").addEventListener("click", async (e) => {
    e.stopPropagation();
    await openSowModal({ ...s, id: null, title: `${s.title} (Copy)`, milestones: [] });
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

  return tr;
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

// ---------- New/Edit SOW popup ----------
const sowFormModal = document.getElementById("sowFormModal");
wireModalCancel(sowFormModal, "cancelSowBtn", "cancelSowBtnTop");

// The SOW currently open in the popup - null for "New SOW"/Copy (a POST on
// Save), an id for "Edit" (a PUT). Also what any newly-added milestone rows
// get attached to once the SOW itself has been saved.
let sowModalId = null;
// Snapshot of whatever milestones the popup opened with (empty for New SOW/
// Copy), used purely to diff against on Save so a milestone row the user
// removed from the form gets deleted, rather than just left alone.
let sowModalOriginalMilestones = [];
// Revenue Type/Practice aren't fields on this form (see the comment above)
// but still need to be carried through unchanged on every save so a Save
// here never clobbers a classification set from Revenue Outlook - captured
// when the popup opens rather than re-fetched on submit.
let sowModalRevenueTypeId = null;
let sowModalPracticeId = null;

function sowIsFixedPrice(billingModelId) {
  const match = sowFormLookups.billingModels.find((b) => String(b.id) === String(billingModelId));
  return (match?.name || "").toLowerCase().includes("fixed price");
}

function refreshSowModalMilestonesVisibility() {
  const billingVal = document.querySelector(".sow-f-billing").value;
  document.getElementById("sowMilestonesSection").hidden = !sowIsFixedPrice(billingVal);
}

function renderSowMilestoneRow(m) {
  const row = document.createElement("div");
  row.className = "milestone-row";
  row.dataset.milestoneId = m?.id ?? "";
  row.innerHTML = `
    <input type="text" class="ms-description" placeholder="Description" value="${escapeHtml(m?.description ?? "")}" />
    <input type="number" step="0.01" min="0" class="ms-amount" placeholder="Amount ($)" value="${m?.amount ?? ""}" />
    <select class="ms-status">
      <option value="to_be_invoiced"${(m?.status ?? "to_be_invoiced") === "to_be_invoiced" ? " selected" : ""}>To be invoiced</option>
      <option value="invoiced"${m?.status === "invoiced" ? " selected" : ""}>Invoiced</option>
    </select>
    <input type="date" class="ms-due" value="${m?.due_date ?? ""}" title="Due date" />
    <input type="date" class="ms-billed" value="${m?.billed_date ?? ""}" title="Billed date" />
    <button type="button" class="ghost-btn icon-btn remove-ms-row" title="Remove milestone">${icon("x")}</button>
  `;
  row.querySelector(".remove-ms-row").addEventListener("click", () => {
    // Only prompt when removing an already-saved milestone (has a real
    // data-milestone-id) - a still-blank/just-added row can be dropped
    // without friction. This is a safety net after a live-data investigation
    // found a milestone had been permanently deleted from a SOW with no
    // trace of a code bug - the most likely explanation is an accidental
    // click on this button followed by Save, since unlike deleting a whole
    // SOW, removing one milestone row here had no confirmation at all.
    if (row.dataset.milestoneId) {
      if (!confirm("Remove this milestone? This cannot be undone once you save.")) return;
    }
    row.remove();
  });
  return row;
}

function renderSowMilestoneRows(milestones) {
  const container = document.getElementById("sowMilestoneRows");
  container.innerHTML = "";
  (milestones || []).forEach((m) => container.appendChild(renderSowMilestoneRow(m)));
}

document.getElementById("addMilestoneRowBtn").addEventListener("click", () => {
  document.getElementById("sowMilestoneRows").appendChild(renderSowMilestoneRow());
});

// Opens the popup for New SOW (s undefined), Edit (s = the row's own already-
// fetched summary object) or Copy (s = a stub with id:null). Edit re-fetches
// GET /api/sows/{id} to get that SOW's full milestone list, since the list
// endpoint buildSowRow's s came from doesn't embed milestones per row.
async function openSowModal(s) {
  await loadSowFormLookups();
  const isNew = !s || !s.id;
  sowModalId = s?.id ?? null;
  const full = s?.id ? await fetch(`${API}/sows/${s.id}`).then((r) => r.json()) : (s || {});
  sowModalOriginalMilestones = full.milestones || [];
  sowModalRevenueTypeId = full.revenue_type_id ?? null;
  sowModalPracticeId = full.practice_id ?? null;

  document.getElementById("sowFormModalTitle").textContent = isNew ? "New SOW" : "Edit SOW";
  const box = sowFormModal;
  box.querySelector(".sow-f-customer").innerHTML = sowSelectOptionsHtml(sowFormLookups.customers, "id", "customer_name", "Select customer&hellip;", full.customer_id);
  box.querySelector(".sow-f-opportunity").value = full.opportunity_id ?? "";
  box.querySelector(".sow-f-opportunity-type").innerHTML = sowSelectOptionsHtml(sowFormLookups.opportunityTypes, "id", "name", "Select opportunity type&hellip;", full.opportunity_type_id);
  box.querySelector(".sow-f-title").value = full.title ?? "";
  box.querySelector(".sow-f-status").innerHTML = sowFormLookups.statuses.map((st) => `<option value="${escapeHtml(st.name)}"${st.name === (full.status || "draft") ? " selected" : ""}>${escapeHtml(capitalize(st.name))}</option>`).join("");
  box.querySelector(".sow-f-billing").innerHTML = sowSelectOptionsHtml(sowFormLookups.billingModels, "id", "name", "Select billing model&hellip;", full.billing_model_id);
  box.querySelector(".sow-f-operating").innerHTML = sowSelectOptionsHtml(sowFormLookups.operatingModels, "id", "name", "Select operating model&hellip;", full.operating_model_id);
  box.querySelector(".sow-f-start").value = full.start_date ?? "";
  box.querySelector(".sow-f-end").value = full.end_date ?? "";
  box.querySelector(".sow-f-duration").value = full.duration_months ?? "";
  box.querySelector(".sow-f-value").value = full.total_value ?? 0;
  box.querySelector(".sow-f-gm").value = full.gm_percent ?? "";
  box.querySelector(".sow-f-po").value = full.po_number ?? "";
  const customerCodeVal = (sowFormLookups.customers.find((c) => c.id === full.customer_id) || {}).customer_code ?? full.customer_code ?? "";
  box.querySelector(".sow-f-customer-code").value = customerCodeVal;
  box.querySelector(".sow-f-contract-code").value = full.contract_code ?? "";
  box.querySelector(".sow-f-project-title").value = full.project_title ?? "";
  box.querySelector(".sow-f-project-code").value = full.project_code ?? "";
  box.querySelector(".sow-f-doclink").value = full.doc_link ?? "";
  box.querySelector(".sow-f-deal-sheet-link").value = full.deal_sheet_link ?? "";
  box.querySelector(".sow-f-po-doclink").value = full.po_doc_link ?? "";
  box.querySelector(".sow-f-notes").value = full.notes ?? "";

  renderSowMilestoneRows(sowModalOriginalMilestones);
  refreshSowModalMilestonesVisibility();
  sowFormModal.hidden = false;
}
document.getElementById("newSowBtn").addEventListener("click", () => openSowModal());

wireSowFormFormulas(sowFormModal);
sowFormModal.querySelector(".sow-f-billing").addEventListener("change", refreshSowModalMilestonesVisibility);
wireSowDocUploadRow(sowFormModal, "sow-upload-doc-btn", "sow-doc-file", "sow-f-doclink");
wireSowDocUploadRow(sowFormModal, "sow-upload-po-btn", "sow-po-doc-file", "sow-f-po-doclink");
wireSowDocUploadRow(sowFormModal, "sow-upload-deal-btn", "sow-deal-file", "sow-f-deal-sheet-link");

document.getElementById("sowForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const box = sowFormModal;
  const customerVal = box.querySelector(".sow-f-customer").value;
  if (!customerVal) { alert("Please select a customer."); return; }
  const titleVal = box.querySelector(".sow-f-title").value.trim();
  if (!titleVal) { alert("Please enter an Opportunity Title."); return; }
  const saveButtons = box.querySelectorAll('button[type="submit"]');
  saveButtons.forEach((b) => (b.disabled = true));
  try {
    const opportunityTypeVal = box.querySelector(".sow-f-opportunity-type").value;
    const billingVal = box.querySelector(".sow-f-billing").value;
    const operatingVal = box.querySelector(".sow-f-operating").value;
    const durationVal = box.querySelector(".sow-f-duration").value;
    const gmVal = box.querySelector(".sow-f-gm").value;
    const payload = {
      customer_id: parseInt(customerVal, 10),
      title: titleVal,
      project_title: box.querySelector(".sow-f-project-title").value || null,
      project_code: box.querySelector(".sow-f-project-code").value || null,
      contract_code: box.querySelector(".sow-f-contract-code").value || null,
      opportunity_id: box.querySelector(".sow-f-opportunity").value || null,
      opportunity_type_id: opportunityTypeVal ? parseInt(opportunityTypeVal, 10) : null,
      po_number: box.querySelector(".sow-f-po").value || null,
      start_date: box.querySelector(".sow-f-start").value || null,
      end_date: box.querySelector(".sow-f-end").value || null,
      total_value: parseFloat(box.querySelector(".sow-f-value").value) || 0,
      duration_months: durationVal !== "" ? parseFloat(durationVal) : null,
      gm_percent: gmVal !== "" ? parseFloat(gmVal) : null,
      billing_model_id: billingVal ? parseInt(billingVal, 10) : null,
      operating_model_id: operatingVal ? parseInt(operatingVal, 10) : null,
      // Not editable on this form - Revenue Type/Practice are set from
      // Revenue Outlook > Best Estimates instead, via the same
      // /classification endpoint, so a brand new SOW gets nulls (same as
      // before) and an existing one keeps whatever it already had (captured
      // in openSowModal() when the popup opened).
      revenue_type_id: sowModalRevenueTypeId,
      practice_id: sowModalPracticeId,
      status: box.querySelector(".sow-f-status").value,
      doc_link: box.querySelector(".sow-f-doclink").value || null,
      po_doc_link: box.querySelector(".sow-f-po-doclink").value || null,
      deal_sheet_link: box.querySelector(".sow-f-deal-sheet-link").value || null,
      notes: box.querySelector(".sow-f-notes").value || null,
    };
    const url = sowModalId ? `${API}/sows/${sowModalId}` : `${API}/sows`;
    const method = sowModalId ? "PUT" : "POST";
    const resp = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      alert(formatApiError(err, "Failed to save SOW."));
      return;
    }
    const savedSow = await resp.json();

    // Reconcile milestones only if the section is actually shown (Fixed
    // Price) - never touch milestones just because the billing model was
    // switched away from Fixed Price mid-edit; they're simply left as they
    // are on record.
    if (!document.getElementById("sowMilestonesSection").hidden) {
      const rows = Array.from(document.querySelectorAll("#sowMilestoneRows .milestone-row"));
      const keptIds = new Set();
      for (const row of rows) {
        const description = row.querySelector(".ms-description").value.trim();
        if (!description) continue; // silently drop a still-blank row
        const mid = row.dataset.milestoneId;
        const mPayload = {
          description,
          amount: parseFloat(row.querySelector(".ms-amount").value) || 0,
          status: row.querySelector(".ms-status").value,
          due_date: row.querySelector(".ms-due").value || null,
          billed_date: row.querySelector(".ms-billed").value || null,
        };
        if (mid) {
          keptIds.add(mid);
          await fetch(`${API}/milestones/${mid}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mPayload) });
        } else {
          await fetch(`${API}/sows/${savedSow.id}/milestones`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mPayload) });
        }
      }
      for (const orig of sowModalOriginalMilestones) {
        if (!keptIds.has(String(orig.id))) {
          await fetch(`${API}/milestones/${orig.id}`, { method: "DELETE" });
        }
      }
    }

    sowFormModal.hidden = true;
    await loadSows();
  } finally {
    saveButtons.forEach((b) => (b.disabled = false));
  }
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
  setFooterRowCount(Array.from(params.keys()).length ? customers.length : null);

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

// ---------- Reports > Billing Days ----------
// Location-wise Working Days/Holidays/Billing Days, for whichever single
// customer is selected in this page's own Customer filter (there's no
// single "selected customer" to compute this for while that filter is "All
// customers"). Originally lived above Holiday Calendar's own table, moved
// out onto its own Reports page per explicit request. Working Days is every
// Mon-Fri in the calendar month a fiscal month falls in (see
// fiscalMonthCalendarRange, the same Apr-Mar mapping used by the Resource
// report); Holidays counts this customer's Holiday Calendar rows flagged
// for that Location whose date both falls in that month and is itself a
// weekday - matching the backend's own _compute_tm_projections convention
// (a holiday landing on a weekend is already not a working day, so it's
// never subtracted twice). Billing Days is Working Days minus Holidays -
// there's no per-employee Leave to subtract at this customer+location
// level, unlike the Time and Material projection calculation.
function isWeekdayIso(iso) {
  const day = new Date(`${iso}T00:00:00`).getDay();
  return day !== 0 && day !== 6;
}

function countWeekdaysInRange(startIso, endIso) {
  let count = 0;
  const cursor = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  while (cursor <= end) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

// Renders one metric's Total/Apr..Mar/Q1..Q4 cells - a plain-integer,
// day-count analog of the Revenue report's revenueReportRowCellsHtml (no
// currency formatting, since these are day counts, not money).
function holidaySummaryRowCellsHtml(values) {
  const total = values.reduce((a, v) => a + v, 0);
  const q1 = values[0] + values[1] + values[2];
  const q2 = values[3] + values[4] + values[5];
  const q3 = values[6] + values[7] + values[8];
  const q4 = values[9] + values[10] + values[11];
  return `<td class="rts-highlight-col">${total}</td>` +
    `<td>${values[0]}</td><td>${values[1]}</td><td>${values[2]}</td><td class="rts-highlight-col">${q1}</td>` +
    `<td>${values[3]}</td><td>${values[4]}</td><td>${values[5]}</td><td class="rts-highlight-col">${q2}</td>` +
    `<td>${values[6]}</td><td>${values[7]}</td><td>${values[8]}</td><td class="rts-highlight-col">${q3}</td>` +
    `<td>${values[9]}</td><td>${values[10]}</td><td>${values[11]}</td><td class="rts-highlight-col">${q4}</td>`;
}

let billingDaysReportCustomerFilter = "";
document.getElementById("billingDaysReportCustomerFilter").addEventListener("change", (e) => {
  billingDaysReportCustomerFilter = e.target.value;
  loadBillingDaysReport();
});

async function loadBillingDaysReport() {
  const [items, customers, locations] = await Promise.all([
    fetch(`${API}/holidays`).then((r) => r.json()),
    fetch(`${API}/customers`).then((r) => r.json()),
    fetch(`${API}/locations`).then((r) => r.json()),
  ]);
  // No "All customers" option here (each customer has its own Holiday
  // Calendar, so there's no meaningful combined view) - populate always
  // lands the select on a real customer, and this page's own filter
  // variable is kept in sync with whatever it picked (including its very
  // first auto-selected default).
  populateCustomerFilterSelect(customers, "billingDaysReportCustomerFilter", { includeAll: false });
  billingDaysReportCustomerFilter = document.getElementById("billingDaysReportCustomerFilter").value;
  renderBillingDaysReport(items, locations);
}

function renderBillingDaysReport(items, locations) {
  const tbody = document.getElementById("billingDaysReportBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!billingDaysReportCustomerFilter) {
    tbody.innerHTML = `<tr><td colspan="18" class="empty-state">No customers configured yet - add one under Global Settings.</td></tr>`;
    setFooterRowCount(null);
    return;
  }

  const fy = fiscalYearForToday();
  const customerHolidays = items.filter((item) => String(item.customer_id) === billingDaysReportCustomerFilter);
  setFooterRowCount(customerHolidays.length);
  const locationBySlug = {};
  locations.forEach((loc) => { locationBySlug[(loc.name || "").trim().toLowerCase()] = loc; });

  // Fixed Onsite/Offshore/Nearshore order (same as HOLIDAY_LOCATION_FIELDS
  // and the main table's own column order below), not an alphabetical sort.
  HOLIDAY_LOCATION_FIELDS.forEach((slug) => {
    const loc = locationBySlug[slug];
    const displayName = loc ? loc.name : slug.charAt(0).toUpperCase() + slug.slice(1);

    const working = [];
    const holidays = [];
    const billing = [];
    for (let fm = 1; fm <= 12; fm++) {
      const [monthFirst, monthLast] = fiscalMonthCalendarRange(fy, fm);
      const w = countWeekdaysInRange(monthFirst, monthLast);
      const h = customerHolidays.filter(
        (item) => item[slug] && item.holiday_date >= monthFirst && item.holiday_date <= monthLast && isWeekdayIso(item.holiday_date)
      ).length;
      working.push(w);
      holidays.push(h);
      billing.push(Math.max(w - h, 0));
    }

    const billingTr = document.createElement("tr");
    billingTr.className = "holiday-location-row";
    billingTr.innerHTML = `<td>${escapeHtml(displayName)} (Billing Days)</td>` + holidaySummaryRowCellsHtml(billing);
    tbody.appendChild(billingTr);

    const workingTr = document.createElement("tr");
    workingTr.className = "rev-type-child-row";
    workingTr.innerHTML = `<td class="rev-type-child-label">Working Days</td>` + holidaySummaryRowCellsHtml(working);
    tbody.appendChild(workingTr);

    const holidaysTr = document.createElement("tr");
    holidaysTr.className = "rev-type-child-row";
    holidaysTr.innerHTML = `<td class="rev-type-child-label">Holidays</td>` + holidaySummaryRowCellsHtml(holidays);
    tbody.appendChild(holidaysTr);
  });
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
  setFooterRowCount(holidayCustomerFilter || holidayLocationFilter ? filteredItems.length : null);
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
  // Trailing Total row - per explicit request, counts how many of the
  // currently-filtered holidays are observed at each of the three locations
  // (there's no numeric amount to sum here the way Leave sums days, so
  // "total" means how many rows have that location's checkbox ticked). Same
  // .table-total-row styling as the Leave/SOW Status/Billing Model summary
  // rows elsewhere in the app (see style.css).
  const totalTr = document.createElement("tr");
  totalTr.className = "table-total-row";
  const locationCounts = HOLIDAY_LOCATION_FIELDS.map((field) =>
    filteredItems.reduce((count, item) => count + (item[field] ? 1 : 0), 0)
  );
  totalTr.innerHTML =
    `<td colspan="4">Total</td>` +
    locationCounts.map((count) => `<td class="center-cell">${count}</td>`).join("") +
    `<td></td>`;
  tbody.appendChild(totalTr);
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
// Free-text search - Customer Name, Employee ID and Employee Name - sits
// before the Customer filter in the toolbar (see index.html), same
// debounced "input" event convention as the Time and Material/Managed
// Services grids' own search boxes (tmSearchInput/revenueSearchInput). Runs
// through the same loadLeaves() re-fetch as the four dropdown filters
// above rather than a separate cached-render path, since every leave
// filter already works that way here.
let leaveSearchQuery = "";
document.getElementById("leaveSearchInput").addEventListener("input", debounce((e) => {
  leaveSearchQuery = e.target.value.trim().toLowerCase();
  loadLeaves();
}, 250));
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

// Shared predicate for the four dropdown filters plus the search box above -
// matches the Time and Material grid's own tmRowMatchesFilters() pattern.
function leaveRowMatchesFilters(item) {
  return (
    (!leaveCustomerFilter || String(item.customer_id) === leaveCustomerFilter) &&
    (!leaveBandFilter || String(item.band_id) === leaveBandFilter) &&
    (!leaveLocationFilter || String(item.location_id) === leaveLocationFilter) &&
    (!leaveEmployeeTypeFilter || String(item.employee_type_id) === leaveEmployeeTypeFilter) &&
    leaveRowMatchesSearch(item)
  );
}

// leaveSearchQuery is already lowercased when it's set (see the input
// listener above), so this only needs to lowercase each row's own field
// values - mirrors tmRowMatchesSearch()/revenueSowMatchesSearch().
function leaveRowMatchesSearch(item) {
  if (!leaveSearchQuery) return true;
  return (
    (item.customer_name || "").toLowerCase().includes(leaveSearchQuery) ||
    (item.employee_name || "").toLowerCase().includes(leaveSearchQuery) ||
    (item.employee_id || "").toLowerCase().includes(leaveSearchQuery)
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
  // assignment at all - tagged_to_tm, computed server-side in list_leaves by
  // cross-referencing tm_assignments (regardless of whether that assignment
  // is itself linked to a Statement of Work - a leave record itself carries
  // no SOW/WBS ID). Not applied to the inline-editing/draft row, since its
  // employee_id can still change before it's saved.
  const isUntagged = !editing && item.tagged_to_tm === false;
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
      empIdTd.innerHTML += `<span class="info-icon-wrap" tabindex="0">${icon("info")}<span class="info-tooltip-text">This employee is not currently tagged to any account in Time and Material.</span></span>`;
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
  setFooterRowCount(
    leaveCustomerFilter || leaveBandFilter || leaveLocationFilter || leaveEmployeeTypeFilter || leaveSearchQuery
      ? filteredItems.length
      : null
  );
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
  // Trailing Total row - per explicit request, sums each of the 12 leave-day
  // columns across every currently-filtered row (same
  // sum-what's-visible-not-everything convention as the Revenue Type
  // summary table). Same .table-total-row styling as the SOW Status/Billing
  // Model breakdown tables elsewhere in the app (see style.css).
  const totalTr = document.createElement("tr");
  totalTr.className = "table-total-row";
  const monthSums = LEAVE_MONTH_FIELDS.map((field) =>
    filteredItems.reduce((sum, item) => sum + (item[field] || 0), 0)
  );
  totalTr.innerHTML = `<td colspan="8">Total</td>` +
    monthSums.map((sum) => `<td style="text-align:right">${fmtPlain(sum)}</td>`).join("");
  tbody.appendChild(totalTr);
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
  setFooterRowCount(q ? resources.length : null);

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
// picking an account on one page never affects the other. Status and
// Billing Model filters sit alongside it and narrow the same underlying
// SOW list (see loadSowReport) together with the customer filter.
let sowReportCustomerId = "";
let sowReportStatusFilter = "";
let sowReportBillingModelFilter = "";
document.getElementById("sowReportCustomerFilter").addEventListener("change", (e) => {
  sowReportCustomerId = e.target.value;
  loadSowReport();
});
document.getElementById("sowReportStatusFilter").addEventListener("change", (e) => {
  sowReportStatusFilter = e.target.value;
  loadSowReport();
});
document.getElementById("sowReportBillingModelFilter").addEventListener("change", (e) => {
  sowReportBillingModelFilter = e.target.value;
  loadSowReport();
});

// Rebuilds a customer filter <select>'s option list from the current
// customers, keeping whatever is currently selected - shared by the
// Dashboard's own filter and every Reports page's own Customer filter (each
// page re-fetches customers and calls this on every load rather than once,
// so a newly-added customer shows up without a full page refresh).
function populateCustomerFilterSelect(customers, selectId, opts = {}) {
  const { includeAll = true } = opts;
  const select = document.getElementById(selectId);
  const current = select.value;
  select.innerHTML = (includeAll ? '<option value="">All customers</option>' : "") +
    customers.map((c) => `<option value="${c.id}">${escapeHtml(c.customer_name)}</option>`).join("");
  select.value = current;
  // Pages that opt out of "All customers" (there's no sensible "combined"
  // view for them) always need exactly one customer selected - if nothing
  // matched (blank/removed previous selection), selectedIndex lands on -1;
  // fall back to the first customer rather than leaving the select showing
  // nothing selected.
  if (!includeAll && select.selectedIndex === -1) {
    select.value = customers.length ? String(customers[0].id) : "";
  }
}

// Same idea as populateCustomerFilterSelect, generalized for any lookup
// list shaped like [{id, name}] (Locations, Billing Models, Employee
// Types, Bands, Revenue Types, ...) - value is the numeric id, matched
// against the row's own *_id field by the caller.
function populateIdFilterSelect(items, selectId, allLabel) {
  const select = document.getElementById(selectId);
  const current = select.value;
  select.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>` +
    items.map((it) => `<option value="${it.id}">${escapeHtml(it.name)}</option>`).join("");
  select.value = current;
}

// Same as populateIdFilterSelect, but for fields that are stored as free
// text rather than a foreign key (SOW Status is a plain string column on
// sows, not a status_id) - value is the name itself.
function populateNameFilterSelect(items, selectId, allLabel) {
  const select = document.getElementById(selectId);
  const current = select.value;
  select.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>` +
    items.map((it) => `<option value="${escapeHtml(it.name)}">${escapeHtml(it.name)}</option>`).join("");
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
// renderExpiringTable above), scoped to this page's own Customer/Status/
// Billing Model filters rather than sharing state with loadHome() (that
// page's own customer filter shouldn't affect this one). The two breakdown
// tables get a trailing Total row here (includeTotal:true) that the
// Dashboard's own copies don't. This page previously also showed TCV/ACV
// cards; removed per explicit request. The count next to each heading is a
// button styled as a link (see .count-link in style.css) that opens the SOW
// details popup (openSowDetailsModal below) listing the SOWs behind that
// count - re-wired with .onclick (not addEventListener) each time this runs
// so repeated loads (e.g. changing a filter) don't stack up duplicate
// handlers pointing at stale data.
async function loadSowReport() {
  // Same server-side customer_id scoping as loadHome() - sows.customer_id
  // is a real column, so that part of the filtering happens in the query.
  // Status and Billing Model are applied client-side below since they need
  // to narrow the same already-fetched list the charts also read from.
  const sowsUrl = sowReportCustomerId ? `${API}/sows?customer_id=${sowReportCustomerId}` : `${API}/sows`;
  const [customers, sows, statuses, billingModels] = await Promise.all([
    fetch(`${API}/customers`).then((r) => r.json()),
    fetch(sowsUrl).then((r) => r.json()),
    fetch(`${API}/statuses`).then((r) => r.json()),
    fetch(`${API}/billing-models`).then((r) => r.json()),
  ]);
  populateCustomerFilterSelect(customers, "sowReportCustomerFilter");
  populateNameFilterSelect(statuses, "sowReportStatusFilter", "All Statuses");
  populateIdFilterSelect(billingModels, "sowReportBillingModelFilter", "All Billing Models");

  let filteredSows = sows;
  if (sowReportStatusFilter) {
    filteredSows = filteredSows.filter((s) => (s.status || "").toLowerCase() === sowReportStatusFilter.toLowerCase());
  }
  if (sowReportBillingModelFilter) {
    filteredSows = filteredSows.filter((s) => String(s.billing_model_id) === sowReportBillingModelFilter);
  }

  const statusCounts = {};
  filteredSows.forEach((s) => { statusCounts[s.status] = (statusCounts[s.status] || 0) + 1; });
  renderSowStatusTable(statuses, statusCounts, "sowReportStatusTableBody", "sowReportStatusCount", true);
  renderBillingModelTable(filteredSows, billingModels, "sowReportBillingModelTableBody", "sowReportBillingModelCount", true);
  const activeSows = filteredSows.filter((s) => (s.status || "").toLowerCase() === "active");
  const expiringSows = filteredSows.filter((s) => (s.alerts || []).includes("expiring_soon"));
  renderExpiringTable(expiringSows, "sowReportExpiringTableBody", "sowReportExpiringCount");

  document.getElementById("sowReportStatusCount").onclick = () =>
    openSowDetailsModal("Statement of Work Details – All SOWs", filteredSows);
  document.getElementById("sowReportBillingModelCount").onclick = () =>
    openSowDetailsModal("Statement of Work Details – Active SOWs", activeSows);
  document.getElementById("sowReportExpiringCount").onclick = () =>
    openSowDetailsModal("Statement of Work Details – Expiring in 30 Days", expiringSows);

  setFooterRowCount(sowReportCustomerId || sowReportStatusFilter || sowReportBillingModelFilter ? filteredSows.length : null);
}

// ---------- Reports > Resource ----------
// Per explicit request, this report is scoped to Time and Material resources
// only (one row per /api/tm/assignments assignment, for the current fiscal
// year) - Managed Services headcount (the onsite/offshore/nearshore counts
// on the Managed Services grid) is a different, account-level number and is
// deliberately not part of this report. Filters: Customer and Location -
// Employee Type/Band aren't tracked on a Time and Material assignment, so
// unlike the old /api/resources-backed version of this page, those two
// filters no longer apply here.
let resourceReportCustomerFilter = "";
let resourceReportLocationFilter = "";
let resourceReportFiscalYear = null;
document.getElementById("resourceReportCustomerFilter").addEventListener("change", (e) => {
  resourceReportCustomerFilter = e.target.value;
  loadResourceReport();
});
document.getElementById("resourceReportLocationFilter").addEventListener("change", (e) => {
  resourceReportLocationFilter = e.target.value;
  loadResourceReport();
});

// The (first_day, last_day) calendar-month range [inclusive] a fiscal month
// (1=Apr..12=Mar) falls in for a fiscal year that runs Apr(fy)-Mar(fy+1) -
// a JS-side mirror of the backend's _fiscal_month_calendar_range, returning
// ISO "YYYY-MM-DD" strings (safe to compare lexicographically against
// start_date/end_date, which are stored the same way).
function fiscalMonthCalendarRange(fy, fm) {
  const calYear = fm <= 9 ? fy : fy + 1;
  const calMonth = fm <= 9 ? fm + 3 : fm - 9;
  const firstDay = `${calYear}-${String(calMonth).padStart(2, "0")}-01`;
  const lastDayNum = new Date(calYear, calMonth, 0).getDate();
  const lastDay = `${calYear}-${String(calMonth).padStart(2, "0")}-${String(lastDayNum).padStart(2, "0")}`;
  return [firstDay, lastDay];
}

// Whether a Time and Material assignment overlaps a given fiscal month at
// all - same overlap test as the backend's _compute_tm_projections (an
// assignment with no start_date can never be placed in a month; one with no
// end_date is treated as still ongoing).
function tmAssignmentActiveInFiscalMonth(row, fy, fm) {
  if (!row.start_date) return false;
  const [monthFirst, monthLast] = fiscalMonthCalendarRange(fy, fm);
  const rangeStart = row.start_date > monthFirst ? row.start_date : monthFirst;
  const rangeEnd = row.end_date && row.end_date < monthLast ? row.end_date : monthLast;
  return rangeStart <= rangeEnd;
}

async function loadResourceReport() {
  if (resourceReportFiscalYear === null) resourceReportFiscalYear = fiscalYearForToday();

  const [customers, locations, tmData, msData] = await Promise.all([
    fetch(`${API}/customers`).then((r) => r.json()),
    fetch(`${API}/locations`).then((r) => r.json()),
    fetch(`${API}/tm/assignments?fiscal_year=${resourceReportFiscalYear}`).then((r) => r.json()),
    // Every Managed Services Resource across every SOW for this fiscal year
    // (see list_all_ms_resources in main.py) - both this page's tables now
    // show Time and Material alongside Managed Services, per explicit
    // request, rather than Time and Material only.
    fetch(`${API}/revenue/ms-resources/all?fiscal_year=${resourceReportFiscalYear}`).then((r) => r.json()),
  ]);
  populateCustomerFilterSelect(customers, "resourceReportCustomerFilter");
  populateIdFilterSelect(locations, "resourceReportLocationFilter", "All Locations");

  // Same Customer/Location filters applied to both sources - a Managed
  // Services Resource row carries customer_id/location_id in the same shape
  // as a Time and Material assignment row (see list_all_ms_resources), so
  // one filter function covers both.
  function applyReportFilters(rows) {
    let out = rows;
    if (resourceReportCustomerFilter) {
      out = out.filter((r) => String(r.customer_id) === resourceReportCustomerFilter);
    }
    if (resourceReportLocationFilter) {
      out = out.filter((r) => String(r.location_id) === resourceReportLocationFilter);
    }
    return out;
  }
  const tmFiltered = applyReportFilters(tmData.rows || []);
  const msFiltered = applyReportFilters(msData.rows || []);

  document.getElementById("resourceReportCount").textContent = tmFiltered.length;
  document.getElementById("resourceReportMsCount").textContent = msFiltered.length;
  setFooterRowCount(resourceReportCustomerFilter || resourceReportLocationFilter ? tmFiltered.length + msFiltered.length : null);

  renderResourceReportLocationMonthTable(tmFiltered, msFiltered, resourceReportFiscalYear, "resourceReportLocationMonthBody");
  renderResourceRampTables(tmFiltered, msFiltered, resourceReportFiscalYear);
}

// Ramp Up / Ramp Down: back to months-as-columns (Apr-Mar), per explicit
// request - Time and Material is named in the table's own header row (see
// index.html), with its Ramp Up/Ramp Down as the first two body rows, then
// a "Managed Services" divider row introduces that group's own Ramp Up/Ramp
// Down rows below it. Built from the same Time and Material assignments and
// Managed Services Resources already loaded/filtered by loadResourceReport(),
// split by whether start_date (Ramp Up) or end_date (Ramp Down) falls inside
// the selected fiscal year - a row merely *tracked* for this fiscal year
// doesn't count as onboarded/released in it unless the actual date lands
// here (e.g. staff/resources carried over from a prior fiscal year
// shouldn't show up as a fresh ramp-up). A month with any activity is a
// count-link (same "click a number, see a details popup" convention as the
// SOW Report's stat cards - see openSowDetailsModal) that opens
// resourceRampModal with that month's rows.
function resourceRampMonthRows(rows, dateField, fiscalYear, fm) {
  const [monthFirst, monthLast] = fiscalMonthCalendarRange(fiscalYear, fm);
  return rows
    .filter((r) => r[dateField] && r[dateField] >= monthFirst && r[dateField] <= monthLast)
    .slice()
    .sort((a, b) => a[dateField].localeCompare(b[dateField]));
}

function buildResourceRampMetricRow(rowLabel, rows, dateField, fiscalYear, groupLabel) {
  const monthRowsByFm = [];
  for (let fm = 1; fm <= 12; fm++) {
    monthRowsByFm.push(resourceRampMonthRows(rows, dateField, fiscalYear, fm));
  }

  // Bug fix: a month with a zero count doesn't get a <button> (see the
  // ternary below), so querySelectorAll(".ramp-month-count") only ever
  // finds the buttons for the NON-zero months - its forEach index is a
  // position among those buttons, not the actual fiscal month, and using
  // that index as "fm" silently opened the wrong month's popup (or an
  // empty one) whenever an earlier month in the row had a zero count. Each
  // button now carries its real fiscal month in a data-fm attribute, set
  // at creation time from the same loop that built monthRowsByFm, so the
  // click handler below reads the month back rather than re-deriving it
  // from button position.
  const cellsHtml = monthRowsByFm.map((monthRows, idx) => {
    const fm = idx + 1;
    return monthRows.length
      ? `<td><button type="button" class="count-link ramp-month-count" data-fm="${fm}">${monthRows.length}</button></td>`
      : "<td>0</td>";
  }).join("");

  const tr = document.createElement("tr");
  tr.innerHTML = `<td>${escapeHtml(rowLabel)}</td>${cellsHtml}`;

  tr.querySelectorAll(".ramp-month-count").forEach((btn) => {
    const fm = parseInt(btn.dataset.fm, 10);
    btn.addEventListener("click", () => {
      const action = dateField === "start_date" ? "Onboarded" : "Released";
      const monthLabel = `${FY_MONTH_LABELS[fm - 1]} FY${fiscalYear}`;
      openResourceRampModal(`${groupLabel} Resources ${action} – ${monthLabel}`, monthRowsByFm[fm - 1], dateField);
    });
  });

  return tr;
}

function renderResourceRampTables(tmRows, msRows, fiscalYear) {
  const tbody = document.getElementById("resourceReportRampBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  // Divider row introducing the Time and Material rows below it - per
  // explicit request the table's header column is now generic ("Months"),
  // so both billing models get their own labeled divider row here (mirrors
  // the Headcount by Month table's "Time and Material (A)"/"Managed
  // Services (B)" dividers, see renderResourceReportLocationMonthTable
  // below).
  const tmDividerTr = document.createElement("tr");
  tmDividerTr.className = "ramp-group-row";
  tmDividerTr.innerHTML = `<td>Time and Material</td>${"<td></td>".repeat(12)}`;
  tbody.appendChild(tmDividerTr);

  tbody.appendChild(buildResourceRampMetricRow("Ramp Up", tmRows, "start_date", fiscalYear, "Time and Material"));
  tbody.appendChild(buildResourceRampMetricRow("Ramp Down", tmRows, "end_date", fiscalYear, "Time and Material"));

  // Divider row introducing the Managed Services rows below it.
  const msDividerTr = document.createElement("tr");
  msDividerTr.className = "ramp-group-row";
  msDividerTr.innerHTML = `<td>Managed Services</td>${"<td></td>".repeat(12)}`;
  tbody.appendChild(msDividerTr);

  tbody.appendChild(buildResourceRampMetricRow("Ramp Up", msRows, "start_date", fiscalYear, "Managed Services"));
  tbody.appendChild(buildResourceRampMetricRow("Ramp Down", msRows, "end_date", fiscalYear, "Managed Services"));
}

// Details popup behind a Ramp Up/Ramp Down month's count-link - same
// read-only "table in a modal" shape as openSowDetailsModal above, just for
// resource rows instead of SOWs, and with its date column's header swapped
// between Start Date/End Date depending on which of the two tables opened it.
// Its own free-text search (Employee Name, Location, Practice, Customer,
// SOW) filters the already-passed-in rows client-side, same debounced
// "input" event convention as revenueSearchQuery/tmSearchQuery above -
// resourceRampModalRows/resourceRampModalDateField hold the full unfiltered
// set for the currently-open popup so the search box can re-render without
// needing to re-fetch or re-derive them.
const resourceRampModal = document.getElementById("resourceRampModal");
wireModalCancel(resourceRampModal, "closeResourceRampModalBtn", "closeResourceRampModalBtnTop");
let resourceRampModalRows = [];
let resourceRampModalDateField = "start_date";
let resourceRampModalSearchQuery = "";

function openResourceRampModal(title, rows, dateField) {
  document.getElementById("resourceRampModalTitle").textContent = title;
  document.getElementById("resourceRampModalDateHeader").textContent =
    dateField === "start_date" ? "Start Date" :
    dateField === "end_date" ? "End Date" :
    // "active_range" - the Headcount by Month table's counts (per explicit
    // request, same click-to-see-who popup as Ramp Up/Ramp Down) open this
    // same modal, but a headcount count is "active sometime in the month",
    // not a single onboarded/released date, so both dates are shown per
    // row instead of picking one field (see the dateField === "active_range"
    // branch below).
    "Active Dates";
  resourceRampModalRows = rows;
  resourceRampModalDateField = dateField;
  resourceRampModalSearchQuery = "";
  document.getElementById("resourceRampModalSearch").value = "";
  renderResourceRampModalTable();
  resourceRampModal.hidden = false;
}

function renderResourceRampModalTable() {
  const q = resourceRampModalSearchQuery;
  const rows = !q ? resourceRampModalRows : resourceRampModalRows.filter((r) =>
    (r.employee_name || "").toLowerCase().includes(q) ||
    (r.location_name || "").toLowerCase().includes(q) ||
    (r.practice_name || "").toLowerCase().includes(q) ||
    (r.customer_name || "").toLowerCase().includes(q) ||
    (r.sow_title || "").toLowerCase().includes(q)
  );
  const dateField = resourceRampModalDateField;
  const tbody = document.getElementById("resourceRampModalTableBody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">${
      resourceRampModalRows.length ? "No resources match your search." : "No resources to show."
    }</td></tr>`;
  } else {
    tbody.innerHTML = rows.map((r) => `
      <tr>
        <td>${escapeHtml(r.employee_name) || "—"}</td>
        <td>${escapeHtml(r.location_name) || "—"}</td>
        <td>${escapeHtml(r.practice_name) || "—"}</td>
        <td>${escapeHtml(r.customer_name) || "—"}</td>
        <td>${escapeHtml(r.sow_title) || "—"}</td>
        <td>${
          dateField === "active_range"
            ? `${fmtDate(r.start_date)} – ${r.end_date ? fmtDate(r.end_date) : "Ongoing"}`
            : fmtDate(r[dateField])
        }</td>
      </tr>
    `).join("");
  }
}

document.getElementById("resourceRampModalSearch").addEventListener("input", debounce((e) => {
  resourceRampModalSearchQuery = e.target.value.trim().toLowerCase();
  renderResourceRampModalTable();
}, 250));

// Month-wise headcount, months as columns (Apr-Mar) - per explicit request,
// same shape as the Ramp Up/Ramp Down table beside it: a "Time and Material
// (A)" divider row introduces that group's own Onsite/Offshore/Nearshore
// rows, a "Managed Services (B)" divider row introduces that group's own
// rows, and a final Total (A+B) row sums every resource/assignment active
// that month across both groups regardless of Location - not just the sum
// of the six named rows above it - so it still reads as a true total even
// if Locations beyond Onsite/Offshore/Nearshore are configured. A Location
// name is matched case/whitespace-insensitively, same convention as the
// backend's _ms_location_counts_by_sow. A resource/assignment is counted in
// every fiscal month its [start_date, end_date] overlaps at all
// (tmAssignmentActiveInFiscalMonth is generic despite the name - both Time
// and Material assignments and Managed Services Resources share the same
// start_date/end_date shape - see list_all_ms_resources in main.py).
function resourceHeadcountMonthRows(rows, fiscalYear, slug) {
  const monthRowsByFm = [];
  for (let fm = 1; fm <= 12; fm++) {
    const active = rows.filter((r) => tmAssignmentActiveInFiscalMonth(r, fiscalYear, fm));
    monthRowsByFm.push(
      slug === "total" ? active : active.filter((r) => (r.location_name || "").trim().toLowerCase() === slug)
    );
  }
  return monthRowsByFm;
}

// Per explicit request, every count in the Headcount by Month table opens
// the same click-to-see-who popup as a Ramp Up/Ramp Down count (see
// buildResourceRampMetricRow/openResourceRampModal above) - a headcount
// count is "active sometime in the month" rather than a single onboarded/
// released date, so the popup opens with dateField "active_range" (shows
// both Start Date and End Date per row) instead of "start_date"/"end_date".
// Each button carries its real fiscal month in a data-fm attribute rather
// than relying on its position among only the non-zero months' buttons -
// see the matching bug fix/comment on buildResourceRampMetricRow above.
function buildResourceCountCellsHtml(monthRowsByFm) {
  return monthRowsByFm.map((monthRows, idx) => {
    const fm = idx + 1;
    return monthRows.length
      ? `<td><button type="button" class="count-link resource-headcount-month-count" data-fm="${fm}">${monthRows.length}</button></td>`
      : "<td>0</td>";
  }).join("");
}

function wireResourceCountCellClicks(tr, monthRowsByFm, fiscalYear, titlePrefix) {
  tr.querySelectorAll(".resource-headcount-month-count").forEach((btn) => {
    const fm = parseInt(btn.dataset.fm, 10);
    btn.addEventListener("click", (e) => {
      // Buttons live inside the group divider/Total rows too, which have
      // their own row-level click listener (collapse/expand toggle) -
      // without this, clicking a count would also toggle that group.
      e.stopPropagation();
      const monthLabel = `${FY_MONTH_LABELS[fm - 1]} FY${fiscalYear}`;
      openResourceRampModal(`${titlePrefix} – ${monthLabel}`, monthRowsByFm[fm - 1], "active_range");
    });
  });
}

function appendResourceReportDataRow(tbody, label, monthRowsByFm, fiscalYear, titlePrefix) {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td>${escapeHtml(label)}</td>${buildResourceCountCellsHtml(monthRowsByFm)}`;
  wireResourceCountCellClicks(tr, monthRowsByFm, fiscalYear, titlePrefix);
  tbody.appendChild(tr);
  return tr;
}

// Collapsed/expanded state for the Headcount by Month table's "Time and
// Material (A)"/"Managed Services (B)" group rows (per explicit request) -
// kept at module scope, rather than reset on every render, so toggling a
// group stays collapsed across fiscal-year/filter changes and re-fetches.
const resourceHeadcountGroupCollapsed = { tm: false, ms: false };

function appendResourceReportDividerRow(tbody, label, monthRowsByFm, collapseOpts, fiscalYear, titlePrefix) {
  // monthRowsByFm is optional - when passed (Headcount by Month table's
  // "Time and Material"/"Managed Services" rows, per explicit request), the
  // divider row itself shows that group's Onsite+Offshore+Nearshore sum per
  // month, as a count-link like every other count in this table, instead of
  // blank cells. The Ramp Up/Ramp Down table's "Time and Material"/"Managed
  // Services" dividers (renderResourceRampTables below) don't pass this and
  // stay blank, since a sum of Ramp Up/Ramp Down counts wouldn't mean
  // anything.
  //
  // collapseOpts is also optional - { groupKey, subRows } makes this row an
  // expand/collapse toggle for the Headcount table's two groups: clicking
  // it hides/shows the location rows in subRows (populated by the caller
  // after this row is created - the click handler reads it live, so a push
  // after the fact is still picked up) and flips the row's own ▾/▸ icon.
  // The Ramp table's dividers don't pass this and stay plain, non-clickable
  // rows.
  const tr = document.createElement("tr");
  tr.className = "ramp-group-row";
  const cellsHtml = monthRowsByFm ? buildResourceCountCellsHtml(monthRowsByFm) : "<td></td>".repeat(12);
  if (collapseOpts) {
    const { groupKey, subRows } = collapseOpts;
    const collapsed = !!resourceHeadcountGroupCollapsed[groupKey];
    tr.classList.add("resource-group-toggle-row");
    tr.innerHTML =
      `<td><span class="resource-group-toggle-icon">${collapsed ? "▸" : "▾"}</span>${escapeHtml(label)}</td>${cellsHtml}`;
    tr.addEventListener("click", () => {
      const nowCollapsed = !resourceHeadcountGroupCollapsed[groupKey];
      resourceHeadcountGroupCollapsed[groupKey] = nowCollapsed;
      subRows.forEach((subTr) => {
        subTr.style.display = nowCollapsed ? "none" : "";
      });
      tr.querySelector(".resource-group-toggle-icon").textContent = nowCollapsed ? "▸" : "▾";
    });
  } else {
    tr.innerHTML = `<td>${escapeHtml(label)}</td>${cellsHtml}`;
  }
  if (monthRowsByFm) wireResourceCountCellClicks(tr, monthRowsByFm, fiscalYear, titlePrefix);
  tbody.appendChild(tr);
  return tr;
}

function renderResourceReportLocationMonthTable(tmRows, msRows, fiscalYear, tbodyId) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = "";

  const tmTotalRows = resourceHeadcountMonthRows(tmRows, fiscalYear, "total");
  const msTotalRows = resourceHeadcountMonthRows(msRows, fiscalYear, "total");

  const tmSubRows = [];
  appendResourceReportDividerRow(tbody, "Time and Material", tmTotalRows, { groupKey: "tm", subRows: tmSubRows }, fiscalYear, "Time and Material Resources Active");
  tmSubRows.push(appendResourceReportDataRow(tbody, "Onsite", resourceHeadcountMonthRows(tmRows, fiscalYear, "onsite"), fiscalYear, "Time and Material Onsite Resources Active"));
  tmSubRows.push(appendResourceReportDataRow(tbody, "Offshore", resourceHeadcountMonthRows(tmRows, fiscalYear, "offshore"), fiscalYear, "Time and Material Offshore Resources Active"));
  tmSubRows.push(appendResourceReportDataRow(tbody, "Nearshore", resourceHeadcountMonthRows(tmRows, fiscalYear, "nearshore"), fiscalYear, "Time and Material Nearshore Resources Active"));
  if (resourceHeadcountGroupCollapsed.tm) tmSubRows.forEach((r) => (r.style.display = "none"));

  const msSubRows = [];
  appendResourceReportDividerRow(tbody, "Managed Services", msTotalRows, { groupKey: "ms", subRows: msSubRows }, fiscalYear, "Managed Services Resources Active");
  msSubRows.push(appendResourceReportDataRow(tbody, "Onsite", resourceHeadcountMonthRows(msRows, fiscalYear, "onsite"), fiscalYear, "Managed Services Onsite Resources Active"));
  msSubRows.push(appendResourceReportDataRow(tbody, "Offshore", resourceHeadcountMonthRows(msRows, fiscalYear, "offshore"), fiscalYear, "Managed Services Offshore Resources Active"));
  msSubRows.push(appendResourceReportDataRow(tbody, "Nearshore", resourceHeadcountMonthRows(msRows, fiscalYear, "nearshore"), fiscalYear, "Managed Services Nearshore Resources Active"));
  if (resourceHeadcountGroupCollapsed.ms) msSubRows.forEach((r) => (r.style.display = "none"));

  const combinedTotalRows = tmTotalRows.map((rows, i) => rows.concat(msTotalRows[i]));
  const totalTr = document.createElement("tr");
  totalTr.className = "table-total-row";
  totalTr.innerHTML = `<td>Total</td>${buildResourceCountCellsHtml(combinedTotalRows)}`;
  wireResourceCountCellClicks(totalTr, combinedTotalRows, fiscalYear, "Total Resources Active");
  tbody.appendChild(totalTr);
}

// ---------- Reports > Revenue ----------
// Filters for Customer, Revenue Type, Practice and Fiscal Year - both the
// Managed Services (/api/revenue/sows) and Time and Material
// (/api/tm/assignments) grids are fetched for the selected fiscal year and
// combined below, since "Revenue" here means projected revenue from either
// source.
let revenueReportCustomerFilter = "";
let revenueReportRevenueTypeFilter = "";
let revenueReportPracticeFilter = "";
let revenueReportFiscalYear = null;
document.getElementById("revenueReportCustomerFilter").addEventListener("change", (e) => {
  revenueReportCustomerFilter = e.target.value;
  loadRevenueReport();
});
document.getElementById("revenueReportRevenueTypeFilter").addEventListener("change", (e) => {
  revenueReportRevenueTypeFilter = e.target.value;
  loadRevenueReport();
});
document.getElementById("revenueReportPracticeFilter").addEventListener("change", (e) => {
  revenueReportPracticeFilter = e.target.value;
  loadRevenueReport();
});

// Fiscal Year filter removed from this page for now per explicit request
// (see the matching index.html comment) - revenueReportFiscalYear still
// exists and still drives which fiscal year's /api/revenue/sows and
// /api/tm/assignments data this page fetches, it's just always
// fiscalYearForToday() below rather than user-selectable right now.
// Shared by the current and previous fiscal year's data (the QoQ table
// below needs both, to compare this fiscal year's Q1 against the prior
// year's Q4) so the same three filters never drift out of sync between them.
function applyRevenueReportFilters(msRows, tmRows) {
  let ms = msRows;
  let tm = tmRows;
  if (revenueReportCustomerFilter) {
    ms = ms.filter((r) => String(r.customer_id) === revenueReportCustomerFilter);
    tm = tm.filter((r) => String(r.customer_id) === revenueReportCustomerFilter);
  }
  if (revenueReportRevenueTypeFilter) {
    ms = ms.filter((r) => String(r.revenue_type_id) === revenueReportRevenueTypeFilter);
    tm = tm.filter((r) => String(r.revenue_type_id) === revenueReportRevenueTypeFilter);
  }
  if (revenueReportPracticeFilter) {
    ms = ms.filter((r) => String(r.practice_id) === revenueReportPracticeFilter);
    tm = tm.filter((r) => String(r.practice_id) === revenueReportPracticeFilter);
  }
  return [ms, tm];
}

async function loadRevenueReport() {
  if (revenueReportFiscalYear === null) revenueReportFiscalYear = fiscalYearForToday();

  const [customers, revenueTypes, practices, msData, tmData, locations, holidays] = await Promise.all([
    fetch(`${API}/customers`).then((r) => r.json()),
    fetch(`${API}/revenue-types`).then((r) => r.json()),
    fetch(`${API}/practices`).then((r) => r.json()),
    fetch(`${API}/revenue/sows?fiscal_year=${revenueReportFiscalYear}`).then((r) => r.json()),
    fetch(`${API}/tm/assignments?fiscal_year=${revenueReportFiscalYear}`).then((r) => r.json()),
    fetch(`${API}/locations`).then((r) => r.json()),
    fetch(`${API}/holidays`).then((r) => r.json()),
  ]);
  populateCustomerFilterSelect(customers, "revenueReportCustomerFilter");
  populateIdFilterSelect(revenueTypes, "revenueReportRevenueTypeFilter", "All Revenue Types");
  populateIdFilterSelect(practices, "revenueReportPracticeFilter", "All Practices");
  currentRevenueTypes = revenueTypes;

  const [msRows, tmRows] = applyRevenueReportFilters(msData.rows || [], tmData.rows || []);
  // Billing Days needs a holiday calendar - when a single customer is
  // selected, use exactly that customer's calendar (same as Reports >
  // Billing Days); with no customer filter, there's no one calendar to use
  // for a report spanning every account, so fall back to the union of every
  // customer's holidays (a date counts as a holiday for a location if any
  // customer observes it there), deduplicated by date so multiple customers
  // sharing a holiday don't get it subtracted twice.
  const holidaysInScope = revenueReportCustomerFilter
    ? holidays.filter((h) => String(h.customer_id) === revenueReportCustomerFilter)
    : holidays;

  renderRevenueReportSummaryTable(msRows, tmRows, "revenueReportSummaryBody");
  renderQoQRevenueTable(msRows, tmRows, revenueReportFiscalYear, locations, holidaysInScope);
  setFooterRowCount(
    revenueReportCustomerFilter || revenueReportRevenueTypeFilter || revenueReportPracticeFilter
      ? msRows.length + tmRows.length
      : null
  );
}

// Reports > Revenue's table - one row per Revenue Type, prefixed with an
// expand arrow (same .expand-btn/.expanded convention as the SOW table's
// milestone expand button - see toggleMilestoneSubrow above - just prefixed
// before the label instead of appended after it) that reveals two child
// rows underneath: that Revenue Type's own Time and Material total and its
// own Managed Services total, per explicit request. The collapsed parent
// row still shows the combined (both sources added together) Total/Apr-Mar/
// Q1-Q4 figures, same numbers this table showed before the breakdown was
// added. Deliberately a separate function from Revenue Outlook's own
// renderRevenueTypeSummaryTable (used by the Managed Services/Time and
// Material grids' own single-source summary tables) rather than a shared
// one, since those two need one flat number per Revenue Type/month and have
// no source to split - this page's whole point is keeping that split
// visible, not collapsing it. Shares that function's fixed REVENUE_TYPE_ORDER/
// revenueTypeOrderKey ordering and currentRevenueTypes label list, and the
// same table-total-row styling for its own trailing Total row, so the two
// pages still look and order themselves consistently.
function revenueReportSumsByType(rows) {
  const sums = new Map();
  rows.forEach((r) => {
    const key = r.revenue_type_name || "";
    if (!sums.has(key)) sums.set(key, new Array(12).fill(0));
    const arr = sums.get(key);
    (r.months || []).forEach((m, i) => { arr[i] += m.projection || 0; });
  });
  return sums;
}

// Renders one row's worth of <td> cells (Total, Apr-Mar, Q1-Q4) from a
// 12-element fiscal-month sums array - shared by the parent row (combined)
// and both child rows (Time and Material only / Managed Services only)
// below, same column layout and rts-highlight-col convention as
// renderRevenueTypeSummaryTable's own row-building code.
function revenueReportRowCellsHtml(sums) {
  const total = sums.reduce((a, v) => a + v, 0);
  const q1 = sums[0] + sums[1] + sums[2];
  const q2 = sums[3] + sums[4] + sums[5];
  const q3 = sums[6] + sums[7] + sums[8];
  const q4 = sums[9] + sums[10] + sums[11];
  return `<td class="rts-highlight-col">${fmtPlain(total)}</td>` +
    `<td>${fmtPlain(sums[0])}</td><td>${fmtPlain(sums[1])}</td><td>${fmtPlain(sums[2])}</td><td class="rts-highlight-col">${fmtPlain(q1)}</td>` +
    `<td>${fmtPlain(sums[3])}</td><td>${fmtPlain(sums[4])}</td><td>${fmtPlain(sums[5])}</td><td class="rts-highlight-col">${fmtPlain(q2)}</td>` +
    `<td>${fmtPlain(sums[6])}</td><td>${fmtPlain(sums[7])}</td><td>${fmtPlain(sums[8])}</td><td class="rts-highlight-col">${fmtPlain(q3)}</td>` +
    `<td>${fmtPlain(sums[9])}</td><td>${fmtPlain(sums[10])}</td><td>${fmtPlain(sums[11])}</td><td class="rts-highlight-col">${fmtPlain(q4)}</td>`;
}

function renderRevenueReportSummaryTable(msRows, tmRows, tbodyId) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;

  const msSums = revenueReportSumsByType(msRows);
  const tmSums = revenueReportSumsByType(tmRows);
  const typeKeys = new Set([...msSums.keys(), ...tmSums.keys()]);

  // Same fixed display order as renderRevenueTypeSummaryTable (Contracted -
  // Staffed, Contracted - Not staffed, Renewals, Pipeline, then anything
  // else, then Unassigned last), matched via the same normalized
  // revenueTypeOrderKey() comparison for the same reason (real Revenue Type
  // names have been seen stored with different spacing/casing than this
  // list's own spelling).
  let labels = currentRevenueTypes.map((rt) => rt.name);
  const orderKeys = REVENUE_TYPE_ORDER.map(revenueTypeOrderKey);
  labels = labels.slice().sort((a, b) => {
    const ai = orderKeys.indexOf(revenueTypeOrderKey(a));
    const bi = orderKeys.indexOf(revenueTypeOrderKey(b));
    return (ai === -1 ? orderKeys.length : ai) - (bi === -1 ? orderKeys.length : bi);
  });
  if (typeKeys.has("")) labels.push("Unassigned");

  tbody.innerHTML = "";
  if (!labels.length) {
    tbody.innerHTML = `<tr class="revenue-type-empty-row"><td colspan="18" class="empty-state">No Revenue Types configured yet - add some under Global Settings.</td></tr>`;
    return;
  }

  const grandTotals = new Array(12).fill(0);
  labels.forEach((label) => {
    const key = label === "Unassigned" ? "" : label;
    const tm = tmSums.get(key) || new Array(12).fill(0);
    const ms = msSums.get(key) || new Array(12).fill(0);
    const combined = tm.map((v, i) => v + ms[i]);
    combined.forEach((v, i) => { grandTotals[i] += v; });

    const parentTr = document.createElement("tr");
    parentTr.className = "rev-type-parent-row";
    parentTr.innerHTML = `<td><button type="button" class="expand-btn rev-type-expand-btn" title="Show Time and Material / Managed Services breakdown">${icon("chevron")}</button>${escapeHtml(label)}</td>` +
      revenueReportRowCellsHtml(combined);
    tbody.appendChild(parentTr);

    const tmTr = document.createElement("tr");
    tmTr.className = "rev-type-child-row";
    tmTr.hidden = true;
    tmTr.innerHTML = `<td class="rev-type-child-label">Time and Material</td>` + revenueReportRowCellsHtml(tm);
    tbody.appendChild(tmTr);

    const msTr = document.createElement("tr");
    msTr.className = "rev-type-child-row";
    msTr.hidden = true;
    msTr.innerHTML = `<td class="rev-type-child-label">Managed Services</td>` + revenueReportRowCellsHtml(ms);
    tbody.appendChild(msTr);

    parentTr.querySelector(".rev-type-expand-btn").addEventListener("click", (e) => {
      const expanding = tmTr.hidden;
      tmTr.hidden = !expanding;
      msTr.hidden = !expanding;
      e.currentTarget.classList.toggle("expanded", expanding);
    });
  });

  const totalTr = document.createElement("tr");
  totalTr.className = "table-total-row";
  totalTr.innerHTML = `<td>Total</td>${revenueReportRowCellsHtml(grandTotals)}`;
  tbody.appendChild(totalTr);
}

// QoQ Revenue & Variance - reuses revenueReportSumsByType (already summing
// each source's rows into a 12-element fiscal-month array) to get one
// combined Apr-Mar array, then buckets that into the four quarters of the
// current fiscal year only (Q1's variance has nothing to compare against,
// same as before a Fiscal Year picker existed anywhere else on this page -
// showing the prior year's Q4 just for that one comparison wasn't worth
// carrying an extra fiscal year of data for). Two "possible contributing
// factors" are computed alongside every variance, per explicit request for
// examples like working-day count and headcount changes: Billing Days is
// the same Working Days-minus-Holidays calculation as Reports > Billing
// Days, broken out per Location (Onsite/Offshore/Nearshore) since different
// locations can have different holiday calendars; TM Resource Count is the
// number of distinct Time and Material assignments active in any month of
// that quarter (Managed Services has no per-resource data to count the
// same way - see Reports > Resource's own TM-only scoping for the same
// reason). These are offered as data points to help judge a likely driver,
// not a definitive cause - the table says so in its own description, and
// the Contributing Factors column spells them out as plain sentences
// rather than the terser "label +N (a→b)" notation used in the Billing
// Days/TM Resource Count cells themselves.
// One source's (Time and Material's, or Managed Services') 12-element
// fiscal-month array, summed across every revenue type - per explicit
// request, the QoQ table's Revenue column is split into Time and
// Material/Managed Services/Total sub-columns, so callers need each
// source's own monthly totals, not just the combined figure
// combinedMonthlyRevenueTotals below used to return directly.
function monthlyTotalsForRows(rows) {
  const totals = new Array(12).fill(0);
  for (const arr of revenueReportSumsByType(rows).values()) {
    arr.forEach((v, i) => { totals[i] += v; });
  }
  return totals;
}

function combinedMonthlyRevenueTotals(msRows, tmRows) {
  const ms = monthlyTotalsForRows(msRows);
  const tm = monthlyTotalsForRows(tmRows);
  return ms.map((v, i) => v + tm[i]);
}

function qoqFiscalMonthsForQuarter(q) {
  return [(q - 1) * 3 + 1, (q - 1) * 3 + 2, (q - 1) * 3 + 3];
}

function qoqQuarterRevenue(monthlyTotals, q) {
  const [a, b, c] = qoqFiscalMonthsForQuarter(q);
  return monthlyTotals[a - 1] + monthlyTotals[b - 1] + monthlyTotals[c - 1];
}

// Billing Days per Location for a quarter - Working Days (Mon-Fri) across
// the quarter's three calendar months, minus that Location's distinct
// holiday dates in scope (already deduplicated/filtered to the right
// customer(s) by the caller - see loadRevenueReport). Same convention as
// Reports > Billing Days' own per-month calculation, just summed over a
// quarter instead of shown month by month.
function qoqQuarterBillingDaysByLocation(fiscalYear, q, locations, holidaysInScope) {
  const months = qoqFiscalMonthsForQuarter(q);
  const [firstDay] = fiscalMonthCalendarRange(fiscalYear, months[0]);
  const [, lastDay] = fiscalMonthCalendarRange(fiscalYear, months[2]);
  const workingDays = countWeekdaysInRange(firstDay, lastDay);

  const locationBySlug = {};
  locations.forEach((loc) => { locationBySlug[(loc.name || "").trim().toLowerCase()] = loc; });

  return HOLIDAY_LOCATION_FIELDS.map((slug) => {
    const loc = locationBySlug[slug];
    const displayName = loc ? loc.name : slug.charAt(0).toUpperCase() + slug.slice(1);
    const holidayDates = new Set(
      holidaysInScope
        .filter((h) => h[slug] && h.holiday_date >= firstDay && h.holiday_date <= lastDay && isWeekdayIso(h.holiday_date))
        .map((h) => h.holiday_date)
    );
    return { slug, name: displayName, billingDays: Math.max(workingDays - holidayDates.size, 0) };
  });
}

function qoqQuarterHeadcount(tmRows, fiscalYear, q) {
  const months = qoqFiscalMonthsForQuarter(q);
  const activeIds = new Set();
  tmRows.forEach((r) => {
    if (months.some((fm) => tmAssignmentActiveInFiscalMonth(r, fiscalYear, fm))) activeIds.add(r.assignment_id);
  });
  return activeIds.size;
}

function qoqBillingDaysTotal(byLocation) {
  return byLocation.reduce((sum, l) => sum + l.billingDays, 0);
}

function renderQoQRevenueTable(msRows, tmRows, fiscalYear, locations, holidaysInScope) {
  const tbody = document.getElementById("revenueReportQoQBody");
  if (!tbody) return;

  // Per explicit request, the Revenue column is split into Time and
  // Material/Managed Services/Total sub-columns (see the group-header-row
  // in index.html) - Variance ($)/Variance (%) and the "Possible
  // Contributing Factors" sentences below are unaffected and still track
  // the Total (combined) figure only, same as before the split.
  const tmMonthlyTotals = monthlyTotalsForRows(tmRows);
  const msMonthlyTotals = monthlyTotalsForRows(msRows);
  const combinedMonthlyTotals = tmMonthlyTotals.map((v, i) => v + msMonthlyTotals[i]);

  const quarters = [1, 2, 3, 4].map((q) => ({
    label: `Q${q} FY${fiscalYear}`,
    tmRevenue: qoqQuarterRevenue(tmMonthlyTotals, q),
    msRevenue: qoqQuarterRevenue(msMonthlyTotals, q),
    revenue: qoqQuarterRevenue(combinedMonthlyTotals, q),
    billingDaysByLocation: qoqQuarterBillingDaysByLocation(fiscalYear, q, locations, holidaysInScope),
    headcount: qoqQuarterHeadcount(tmRows, fiscalYear, q),
  }));

  const billingDaysCellHtml = (byLocation, total, deltaHtml) => `
    <div>${total}${deltaHtml ? ` <span class="qoq-delta">${deltaHtml}</span>` : ""}</div>
    <div class="qoq-location-breakdown">${byLocation.map((l) => `${escapeHtml(l.name)} ${l.billingDays}`).join(" &middot; ")}</div>
  `;

  tbody.innerHTML = quarters.map((cur, i) => {
    const curTotal = qoqBillingDaysTotal(cur.billingDaysByLocation);

    const prev = i > 0 ? quarters[i - 1] : null;
    if (!prev) {
      return `
        <tr>
          <td>${escapeHtml(cur.label)}</td>
          <td>${fmtPlain(cur.tmRevenue)}</td>
          <td>${fmtPlain(cur.msRevenue)}</td>
          <td class="qoq-revenue-total-col">${fmtPlain(cur.revenue)}</td>
          <td>—</td><td>—</td>
          <td>${billingDaysCellHtml(cur.billingDaysByLocation, curTotal, "")}</td>
          <td>${cur.headcount}</td>
          <td>—</td>
        </tr>
      `;
    }

    const prevTotal = qoqBillingDaysTotal(prev.billingDaysByLocation);
    const varAmount = cur.revenue - prev.revenue;
    const varPct = prev.revenue !== 0 ? (varAmount / Math.abs(prev.revenue)) * 100 : null;
    const bdDelta = curTotal - prevTotal;
    const hcDelta = cur.headcount - prev.headcount;
    const dirClass = varAmount > 0 ? "qoq-up" : varAmount < 0 ? "qoq-down" : "";

    // Per-location Billing Days deltas, in plain sentences, folded into the
    // same simple-text summary as the headcount factor below - only the
    // locations that actually changed are named, so a quarter where just
    // Offshore lost a holiday doesn't drag Onsite/Nearshore into the
    // sentence too.
    const changedLocations = cur.billingDaysByLocation
      .map((l, idx) => ({ ...l, delta: l.billingDays - prev.billingDaysByLocation[idx].billingDays, prevDays: prev.billingDaysByLocation[idx].billingDays }))
      .filter((l) => l.delta !== 0);

    const sentences = [];
    if (bdDelta !== 0) {
      const direction = bdDelta > 0 ? "increased" : "decreased";
      let sentence = `Billing days ${direction} by ${Math.abs(bdDelta)} (from ${prevTotal} to ${curTotal})`;
      if (changedLocations.length) {
        const detail = changedLocations
          .map((l) => `${l.name} ${l.delta > 0 ? "up" : "down"} ${Math.abs(l.delta)} (${l.prevDays} to ${l.billingDays})`)
          .join(", ");
        sentence += `, driven by ${detail}`;
      }
      sentences.push(sentence + ".");
    }
    if (hcDelta !== 0) {
      const direction = hcDelta > 0 ? "increased" : "decreased";
      sentences.push(`Time and Material resource count ${direction} by ${Math.abs(hcDelta)} (from ${prev.headcount} to ${cur.headcount}).`);
    }

    let factorsHtml;
    if (varAmount === 0) {
      factorsHtml = "—";
    } else if (!sentences.length) {
      factorsHtml = "No change in billing days or Time and Material headcount &ndash; check rate cards, discounts or Managed Services billing.";
    } else {
      factorsHtml = escapeHtml(sentences.join(" "));
    }

    return `
      <tr>
        <td>${escapeHtml(cur.label)}</td>
        <td>${fmtPlain(cur.tmRevenue)}</td>
        <td>${fmtPlain(cur.msRevenue)}</td>
        <td class="qoq-revenue-total-col">${fmtPlain(cur.revenue)}</td>
        <td><span class="${dirClass}">${varAmount >= 0 ? "+" : ""}${fmtPlain(varAmount)}</span></td>
        <td>${varPct === null ? "—" : `<span class="${dirClass}">${varPct >= 0 ? "+" : ""}${varPct.toFixed(1)}%</span>`}</td>
        <td>${billingDaysCellHtml(cur.billingDaysByLocation, curTotal, `(${bdDelta >= 0 ? "+" : ""}${bdDelta})`)}</td>
        <td>${cur.headcount} <span class="qoq-delta">(${hcDelta >= 0 ? "+" : ""}${hcDelta})</span></td>
        <td>${factorsHtml}</td>
      </tr>
    `;
  }).join("");
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

// Managed Services' own free-text search - Customer Name, Contract Title and
// Additional Information - sits before the Customer filter in the toolbar
// (see index.html) and, like Time and Material's own #tmSearchInput, runs on
// a debounced "input" event against the already-fetched revenueSowsCache
// rather than re-fetching (see renderRevenueSowsTable()).
let revenueSearchQuery = "";
document.getElementById("revenueSearchInput").addEventListener("input", debounce(() => {
  revenueSearchQuery = document.getElementById("revenueSearchInput").value.trim().toLowerCase();
  renderRevenueSowsTable();
}, 250));

// Time and Material assignment ids already tracked on the currently-loaded
// fiscal year's grid, and the last-loaded data for each (by assignment_id) -
// same purpose as revenueTrackedSowIds/revenueSowsCache above, but unlike
// those, Time and Material doesn't need a "keep the Add Entry row from
// offering this again" set: several assignments can share one Contract, so
// the Contract Title dropdown never excludes already-tracked ones.
let tmAssignmentsCache = new Map();
// Time and Material's own free-text search - Customer Name, Employee
// Name/ID, Contract Title and WBS ID - sits before the Customer filter in
// the toolbar (see index.html) and, like the SOW list's own #searchInput,
// runs on a debounced "input" event rather than waiting for change/blur.
let tmSearchQuery = "";
document.getElementById("tmSearchInput").addEventListener("input", debounce(() => {
  tmSearchQuery = document.getElementById("tmSearchInput").value.trim().toLowerCase();
  // Re-render from the already-fetched tmAssignmentsCache rather than
  // re-fetching - search/sort only change which of the already-loaded rows
  // are shown, unlike the Customer/Revenue Type/Location/Practice filters
  // above (which still call the full loadTmAssignments()).
  renderTmAssignmentsTable();
}, 250));

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
    revenueSowMatchesSearch(r)
  );
}

// revenueSearchQuery is already lowercased when it's set (see the input
// listener above), so this only needs to lowercase each row's own field
// values - mirrors tmRowMatchesSearch() below.
function revenueSowMatchesSearch(r) {
  if (!revenueSearchQuery) return true;
  return (
    (r.customer_name || "").toLowerCase().includes(revenueSearchQuery) ||
    (r.sow_title || "").toLowerCase().includes(revenueSearchQuery) ||
    (r.additional_info || "").toLowerCase().includes(revenueSearchQuery)
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
    (!tmPracticeFilter || String(r.practice_id) === tmPracticeFilter) &&
    tmRowMatchesSearch(r)
  );
}

// tmSearchQuery is already lowercased when it's set (see the input listener
// above), so this only needs to lowercase each row's own field values.
function tmRowMatchesSearch(r) {
  if (!tmSearchQuery) return true;
  return (
    (r.customer_name || "").toLowerCase().includes(tmSearchQuery) ||
    (r.employee_name || "").toLowerCase().includes(tmSearchQuery) ||
    (r.employee_id || "").toLowerCase().includes(tmSearchQuery) ||
    (r.sow_title || "").toLowerCase().includes(tmSearchQuery) ||
    (r.wbs_id || "").toLowerCase().includes(tmSearchQuery)
  );
}

// Footer row count for Revenue Management (#tab-revenue) - only one of the
// Managed Services/Time and Material grids is visible at a time (see
// revenueCategory/setRevenueCategory above), so this always reflects
// whichever one currently is, recomputed from that grid's own cache and
// filter predicate. Called from the tail of both loadRevenueSows() and
// renderTmAssignmentsTable() - whichever runs, the result is the same,
// since revenueCategory doesn't change between the two.
function revenueMsFilterActive() {
  return !!(revenueCustomerFilter || revenueBillingModelFilter || revenueRevenueTypeFilter || revenueSearchQuery);
}
function revenueTmFilterActive() {
  return !!(tmCustomerFilter || tmRevenueTypeFilter || tmLocationFilter || tmPracticeFilter || tmSearchQuery);
}
function updateRevenueTabFooterRowCount() {
  if (revenueCategory === "managed-services") {
    const rows = Array.from(revenueSowsCache.values()).filter(revenueSowMatchesFilters);
    setFooterRowCount(revenueMsFilterActive() ? rows.length : null);
  } else {
    const rows = Array.from(tmAssignmentsCache.values()).filter(tmRowMatchesFilters);
    setFooterRowCount(revenueTmFilterActive() ? rows.length : null);
  }
}

// Column sorting for the Time and Material grid - Start Date/End Date only,
// per explicit request (every other column stays in its existing, unsorted
// order). Client-side, same tmSort-state/sortable-th/sort-arrow convention
// as the SOW table's sowSort (see sortSows/updateSortArrows above), scoped
// to #tab-revenue .tm-table so it doesn't pick up the SOW table's own
// sortable-th click handlers.
let tmSort = { key: null, dir: 1 };

function sortTmRows(rows) {
  if (!tmSort.key) return rows;
  const key = tmSort.key;
  const dir = tmSort.dir;
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    // Rows with no date sort to the end regardless of direction.
    if (!av && !bv) return 0;
    if (!av) return 1;
    if (!bv) return -1;
    return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
  });
}

function updateTmSortArrows() {
  document.querySelectorAll("#tab-revenue .tm-table thead th.sortable-th").forEach((th) => {
    const arrow = th.querySelector(".sort-arrow");
    if (th.dataset.sortKey === tmSort.key) {
      th.classList.add("sorted");
      arrow.textContent = tmSort.dir === 1 ? "▲" : "▼";
    } else {
      th.classList.remove("sorted");
      arrow.textContent = "";
    }
  });
}

document.querySelectorAll("#tab-revenue .tm-table thead th.sortable-th").forEach((th) => {
  th.addEventListener("click", () => {
    const key = th.dataset.sortKey;
    if (tmSort.key === key) {
      tmSort.dir *= -1;
    } else {
      tmSort = { key, dir: 1 };
    }
    renderTmAssignmentsTable();
  });
});

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
let currentBands = [];
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
  const [customers, billingModels, revenueTypes, practices, locations, bands, allSows, billingHourConfigs] = await Promise.all([
    fetch(`${API}/customers`).then((r) => r.json()),
    fetch(`${API}/billing-models`).then((r) => r.json()),
    fetch(`${API}/revenue-types`).then((r) => r.json()),
    fetch(`${API}/practices`).then((r) => r.json()),
    fetch(`${API}/locations`).then((r) => r.json()),
    fetch(`${API}/bands`).then((r) => r.json()),
    fetch(`${API}/sows`).then((r) => r.json()),
    fetch(`${API}/billing-hours`).then((r) => r.json()),
  ]);
  populateRevenueCustomerFilter(customers);
  populateRevenueBillingModelFilter(billingModels);
  populateRevenueRevenueTypeFilter(revenueTypes);
  populateTmCustomerFilter(customers);
  populateTmRevenueTypeFilter(revenueTypes);
  populateTmLocationFilter(locations);
  populateTmPracticeFilter(practices);
  currentRevenueTypes = revenueTypes;
  currentPractices = practices;
  currentLocations = locations;
  currentBands = bands;
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
  // all (see openRevenueEntryModal) - excluded here so it can't wrongly mark
  // a real SOW as already-tracked. account_id (the revenue_sow_accounts
  // row's own id) is set on every row either way, so it - not sow_id - is
  // what the cache below and Edit/Copy/Delete/Save key off of uniformly.
  revenueTrackedSowIds = new Set(data.rows.filter((r) => r.sow_id != null).map((r) => r.sow_id));
  revenueSowsCache = new Map(data.rows.map((r) => [r.account_id, r]));
  renderRevenueSowsTable();
}

// Re-renders the Managed Services grid from the already-fetched
// revenueSowsCache rather than re-fetching - mirrors Time and Material's own
// loadTmAssignments()/renderTmAssignmentsTable() split, needed here so the
// free-text search (#revenueSearchInput) can re-render on every keystroke
// without a network round trip.
function renderRevenueSowsTable() {
  const allRows = Array.from(revenueSowsCache.values());
  const filteredRows = allRows.filter(revenueSowMatchesFilters);

  const tbody = document.getElementById("revenueSowsTableBody");
  tbody.innerHTML = "";
  if (!filteredRows.length) {
    tbody.innerHTML = `<tr><td colspan="26" class="empty-state">${
      allRows.length ? "No entries match the selected filters." : 'No entries yet. Click "Add Entry" to start tracking revenue for a SOW.'
    }</td></tr>`;
  } else {
    filteredRows.forEach((r) => tbody.appendChild(buildRevenueSowRow(r)));
    renumberRevenueRows();
  }
  renderRevenueTypeSummaryTable(filteredRows);
  updateRevenueTabFooterRowCount();
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

// Fixed display order for both Revenue Type summary tables (Managed
// Services and Time and Material alike), per explicit request - see
// renderRevenueTypeSummaryTable() below. Followed by the trailing Total row
// it always appends, regardless of this order. Matched against the actual
// Revenue Type names via revenueTypeOrderKey() below rather than an exact
// string match - real data has been seen stored as "Contracted-Staffed"/
// "Contracted-Not Staffed" (no spaces around the hyphen, "Staffed"
// capitalized both times), not this comment's own spacing/casing, so a
// case- and whitespace-sensitive match would silently fail to reorder
// anything.
const REVENUE_TYPE_ORDER = ["Contracted - Staffed", "Contracted - Not staffed", "Renewals", "Pipeline"];
// Normalizes a Revenue Type name for matching against REVENUE_TYPE_ORDER
// above - lowercased with all whitespace stripped, so "Contracted - Staffed"
// and "Contracted-Staffed" (or any other spacing/casing variant) compare
// equal.
function revenueTypeOrderKey(name) {
  return (name || "").toLowerCase().replace(/\s+/g, "");
}

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

  // Both summary tables (Managed Services and Time and Material) show rows
  // in a fixed, explicitly requested sequence - Contracted - Staffed,
  // Contracted - Not staffed, Renewals, Pipeline, then the trailing Total
  // row appended below - rather than /api/revenue-types' alphabetical order.
  // Any revenue type not in this list (e.g. one added later) still shows,
  // just appended after these four in whatever order currentRevenueTypes
  // already has them, still ahead of the Total row.
  let labels = currentRevenueTypes.map((rt) => rt.name);
  const orderKeys = REVENUE_TYPE_ORDER.map(revenueTypeOrderKey);
  labels = labels.slice().sort((a, b) => {
    const ai = orderKeys.indexOf(revenueTypeOrderKey(a));
    const bi = orderKeys.indexOf(revenueTypeOrderKey(b));
    return (ai === -1 ? orderKeys.length : ai) - (bi === -1 ? orderKeys.length : bi);
  });
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
  // Trailing Total row - per explicit request, sums each column (Total,
  // Apr-Mar, Q1-Q4) down every revenue-type row just rendered above. Same
  // .table-total-row styling as the Leave/Holiday Calendar total rows
  // elsewhere in the app (see style.css). Shared by both the Managed
  // Services and Time and Material summary tables, same as the rest of this
  // function.
  const colTotals = new Array(17).fill(0); // Total, Apr..Mar(12), Q1..Q4
  labels.forEach((label) => {
    const key = label === "Unassigned" ? "" : label;
    const sums = sumsByType.get(key) || new Array(12).fill(0);
    const total = sums.reduce((a, v) => a + v, 0);
    const q1 = sums[0] + sums[1] + sums[2];
    const q2 = sums[3] + sums[4] + sums[5];
    const q3 = sums[6] + sums[7] + sums[8];
    const q4 = sums[9] + sums[10] + sums[11];
    const rowValues = [total, ...sums, q1, q2, q3, q4];
    rowValues.forEach((v, i) => { colTotals[i] += v; });
  });
  const totalTr = document.createElement("tr");
  totalTr.className = "table-total-row";
  totalTr.innerHTML = `<td>Total</td><td class="rts-highlight-col">${fmtPlain(colTotals[0])}</td>` +
    `<td>${fmtPlain(colTotals[1])}</td><td>${fmtPlain(colTotals[2])}</td><td>${fmtPlain(colTotals[3])}</td><td class="rts-highlight-col">${fmtPlain(colTotals[13])}</td>` +
    `<td>${fmtPlain(colTotals[4])}</td><td>${fmtPlain(colTotals[5])}</td><td>${fmtPlain(colTotals[6])}</td><td class="rts-highlight-col">${fmtPlain(colTotals[14])}</td>` +
    `<td>${fmtPlain(colTotals[7])}</td><td>${fmtPlain(colTotals[8])}</td><td>${fmtPlain(colTotals[9])}</td><td class="rts-highlight-col">${fmtPlain(colTotals[15])}</td>` +
    `<td>${fmtPlain(colTotals[10])}</td><td>${fmtPlain(colTotals[11])}</td><td>${fmtPlain(colTotals[12])}</td><td class="rts-highlight-col">${fmtPlain(colTotals[16])}</td>`;
  tbody.appendChild(totalTr);
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

// Builds one <tr> for the SoW-level grid - always read-only now (Add and
// Edit both open #revenueEntryModal instead of toggling a row in place; see
// openRevenueEntryModal()). Practice removed entirely per explicit
// instruction (front end and back end - see db.py/main.py).
function buildRevenueSowRow(r) {
  const tr = document.createElement("tr");
  // Actions comes first (app-wide convention: wherever a table has both
  // Sl. No and Actions, Actions is column 1 and Sl. No is column 2). Sl. No
  // itself is left blank here and filled in by renumberRevenueRows() based
  // on the row's actual position in the table.
  let cells = `<td class="row-actions">
        <button type="button" class="ghost-btn btn-edit icon-btn rev-view-btn" title="View">${icon("eye")}</button>
        <button type="button" class="ghost-btn btn-edit icon-btn rev-copy-btn" title="Copy">${icon("copy")}</button>
        <button type="button" class="ghost-btn btn-edit icon-btn rev-edit-btn" title="Edit">${icon("edit")}</button>
        <button type="button" class="ghost-btn btn-danger icon-btn rev-del-btn" title="Delete">${icon("trash")}</button>
      </td>`;
  cells += `<td class="rev-sl-no"></td>`;
  // Column order here (Revenue Type, Customer Name, SOW, Start Date, End
  // Date, Billing Model, TCV, Onsite #/Offshore #/Nearshore #) matches the
  // grouped thead in index.html.
  cells += `<td>${escapeHtml(r.revenue_type_name) || "—"}</td>`;
  // Resources expansion removed from this main table per explicit request -
  // Managed Services Resources are only ever added/viewed inside the
  // View/Edit/Add popup now (see openRevenueEntryModal()'s Managed Services
  // Resources section), not via an expand-chevron on this row.
  cells += `<td>${escapeHtml(r.customer_name)}</td><td>${escapeHtml(r.sow_title) || "—"}</td>`;
  cells += `<td>${fmtDate(r.start_date)}</td><td>${fmtDate(r.end_date)}</td>`;
  cells += `<td>${escapeHtml(r.billing_model_name) || "—"}</td>`;
  cells += `<td class="rev-tcv-cell">${fmt(r.total_value)}</td>`;
  cells += `<td class="rev-tcv-cell rev-onsite-cell">${r.onsite_count ?? 0}</td><td class="rev-tcv-cell rev-offshore-cell">${r.offshore_count ?? 0}</td><td class="rev-tcv-cell rev-nearshore-cell">${r.nearshore_count ?? 0}</td>`;
  // Total is always read-only (sum of the 12 months' Projections, Apr
  // through Mar).
  const totalProjection = r.months.reduce((sum, m) => sum + (m.projection || 0), 0);
  cells += `<td class="rev-tcv-cell rev-total-cell">${fmtPlain(totalProjection)}</td>`;
  // Alternating background per month (rev-band-a/rev-band-b) so adjacent
  // months are visually grouped and easy to tell apart - matches the same
  // classes on the header cells.
  r.months.forEach((m, i) => {
    const band = i % 2 === 0 ? "rev-band-a" : "rev-band-b";
    cells += `<td class="rev-readonly-cell ${band}">${fmtPlain(m.projection)}</td>`;
  });
  // Additional Information - last column, after Mar. Optional for a
  // SOW-backed row, but mandatory when saving a row with no SOW at all (see
  // openRevenueEntryModal()'s validation) - per explicit request.
  cells += `<td>${escapeHtml(r.additional_info) || "—"}</td>`;
  tr.innerHTML = cells;

  tr.querySelector(".rev-view-btn").addEventListener("click", () => {
    openRevenueEntryModal(r, {}, true);
  });
  tr.querySelector(".rev-copy-btn").addEventListener("click", () => {
    // A SOW can only be tracked once per fiscal year, and a SOW-less row can
    // be duplicated any number of times but still starts blank rather than
    // literally cloning itself - either way "Copy" opens the same Add popup
    // instead, pre-selecting this row's Customer (narrowing the SOW dropdown
    // to that customer's other untracked SOWs). The 12 months' figures are no
    // longer carried over here - they're always the sum of whichever
    // Managed Services Resources end up added to the new row (see
    // openRevenueEntryModal()'s applyResourceSums()), not something to
    // pre-fill directly.
    openRevenueEntryModal(null, { customerId: r.customer_id });
  });
  tr.querySelector(".rev-edit-btn").addEventListener("click", () => {
    openRevenueEntryModal(r);
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

  return tr;
}

// ---------- Managed Services per-resource revenue (Revenue Outlook >
// Best Estimates > Managed Services) ----------
// Per explicit request, a SOW row's popup (see openRevenueEntryModal()'s
// Managed Services Resources section) can add named resources (ID/Name/
// Location/Practice/Start/End date), each with its own Apr-Mar revenue - and
// the popup's own Revenue Projections and Monthly Breakdown is now always
// the read-only sum of these resources' monthly figures (see
// applyResourceSums() in openRevenueEntryModal), not a separate flat number
// typed directly into the row.

// Builds one <tr> for a single resource under a SOW's Resources subtable.
// res is null for a brand-new "Add resource" draft row (always opened
// editing=true - Cancel on that one removes the row entirely rather than
// reverting it, since there's nothing saved to revert to). refresh() is
// renderMsResourceSubtable's own re-fetch-and-rebuild closure - every
// mutation (save/delete) just calls it and lets the whole subtable rebuild,
// the same "reload rather than patch" approach loadSows()/loadRevenueTab()
// use elsewhere in the app, since a resource list is always small.
function buildMsResourceRow(res, sowId, fiscalYear, editing, refresh) {
  const tr = document.createElement("tr");
  tr.dataset.resourceId = res?.id ?? "";

  let cells = editing
    ? `<td class="row-actions">
        <button type="button" class="ghost-btn btn-edit icon-btn ms-res-save-btn" title="Save">${icon("check")}</button>
        <button type="button" class="ghost-btn icon-btn ms-res-cancel-btn" title="Cancel">${icon("x")}</button>
      </td>`
    : `<td class="row-actions">
        <button type="button" class="ghost-btn btn-edit icon-btn ms-res-edit-btn" title="Edit">${icon("edit")}</button>
        <button type="button" class="ghost-btn btn-danger icon-btn ms-res-del-btn" title="Delete">${icon("trash")}</button>
      </td>`;
  cells += editing
    ? `<td><input type="text" class="ms-res-code" placeholder="ID" value="${escapeHtml(res?.employee_id ?? "")}" /></td>
       <td><input type="text" class="ms-res-name" placeholder="Name" value="${escapeHtml(res?.employee_name ?? "")}" /></td>
       <td><select class="ms-res-location">${sowSelectOptionsHtml(currentLocations, "id", "name", "Select location&hellip;", res?.location_id)}</select></td>
       <td><select class="ms-res-practice">${sowSelectOptionsHtml(currentPractices, "id", "name", "Select practice&hellip;", res?.practice_id)}</select></td>
       <td><select class="ms-res-band">${sowSelectOptionsHtml(currentBands, "id", "name", "Select band&hellip;", res?.band_id)}</select></td>
       <td><input type="date" class="ms-res-start" value="${res?.start_date ?? ""}" /></td>
       <td><input type="date" class="ms-res-end" value="${res?.end_date ?? ""}" /></td>
       <td><input type="number" step="0.01" min="0" class="ms-res-rate-card" placeholder="Rate Card" value="${res?.rate_card ?? ""}" /></td>
       <td class="rev-tcv-cell ms-res-total-cell">${fmtPlain(res?.total_revenue ?? 0)}</td>`
    : `<td>${escapeHtml(res.employee_id) || "—"}</td>
       <td>${escapeHtml(res.employee_name)}</td>
       <td>${escapeHtml(res.location_name) || "—"}</td>
       <td>${escapeHtml(res.practice_name) || "—"}</td>
       <td>${escapeHtml(res.band_name) || "—"}</td>
       <td>${fmtDate(res.start_date)}</td>
       <td>${fmtDate(res.end_date)}</td>
       <td class="rev-tcv-cell">${res.rate_card != null ? fmt(res.rate_card) : "—"}</td>
       <td class="rev-tcv-cell ms-res-total-cell">${fmtPlain(res.total_revenue)}</td>`;
  // Apr-Mar monthly revenue - editable per resource while editing (each an
  // <input>, saved cell-by-cell via PUT /api/revenue/ms-resources/cell on
  // Save below, mirroring the SOW-level grid's old per-cell save), always
  // read-only otherwise. This is what openRevenueEntryModal's
  // applyResourceSums() sums back up into the popup's own (now read-only)
  // Revenue Projections and Monthly Breakdown fields.
  const revenueByMonth = {};
  (res?.months || []).forEach((m) => { revenueByMonth[m.fiscal_month] = m.revenue; });
  for (let fm = 1; fm <= 12; fm++) {
    const band = (fm - 1) % 2 === 0 ? "rev-band-a" : "rev-band-b";
    const val = revenueByMonth[fm] ?? 0;
    cells += editing
      ? `<td class="${band}"><input type="number" step="0.01" min="0" class="ms-res-month" data-fiscal-month="${fm}" value="${val}" /></td>`
      : `<td class="rev-readonly-cell ${band}">${fmtPlain(val)}</td>`;
  }
  tr.innerHTML = cells;

  if (editing) {
    const monthInputs = tr.querySelectorAll(".ms-res-month");
    const totalCell = tr.querySelector(".ms-res-total-cell");
    function refreshResourceTotal() {
      const sum = Array.from(monthInputs).reduce((acc, input) => acc + (parseFloat(input.value) || 0), 0);
      totalCell.textContent = fmtPlain(sum);
    }
    monthInputs.forEach((input) => input.addEventListener("input", refreshResourceTotal));

    tr.querySelector(".ms-res-cancel-btn").addEventListener("click", () => {
      if (res?.id) {
        tr.replaceWith(buildMsResourceRow(res, sowId, fiscalYear, false, refresh));
      } else {
        tr.remove();
      }
    });

    tr.querySelector(".ms-res-save-btn").addEventListener("click", async () => {
      const employeeName = tr.querySelector(".ms-res-name").value.trim();
      if (!employeeName) { alert("Please enter a resource name."); return; }
      const saveBtn = tr.querySelector(".ms-res-save-btn");
      const cancelBtn = tr.querySelector(".ms-res-cancel-btn");
      saveBtn.disabled = true;
      cancelBtn.disabled = true;
      try {
        const locationVal = tr.querySelector(".ms-res-location").value;
        const practiceVal = tr.querySelector(".ms-res-practice").value;
        const bandVal = tr.querySelector(".ms-res-band").value;
        const rateCardVal = tr.querySelector(".ms-res-rate-card").value;
        const payload = {
          employee_id: tr.querySelector(".ms-res-code").value.trim() || null,
          employee_name: employeeName,
          location_id: locationVal ? parseInt(locationVal, 10) : null,
          practice_id: practiceVal ? parseInt(practiceVal, 10) : null,
          band_id: bandVal ? parseInt(bandVal, 10) : null,
          start_date: tr.querySelector(".ms-res-start").value || null,
          end_date: tr.querySelector(".ms-res-end").value || null,
          rate_card: rateCardVal !== "" ? parseFloat(rateCardVal) : null,
        };
        let resourceId = res?.id;
        if (resourceId) {
          const resp = await fetch(`${API}/revenue/ms-resources/${resourceId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            alert(formatApiError(err, "Failed to save this resource."));
            return;
          }
        } else {
          const resp = await fetch(`${API}/revenue/ms-resources`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, sow_id: sowId, fiscal_year: fiscalYear }),
          });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            alert(formatApiError(err, "Failed to add this resource."));
            return;
          }
          resourceId = (await resp.json()).id;
        }

        // Each month is its own cell, upserted via PUT
        // /api/revenue/ms-resources/cell (mirrors the SOW-level grid's old
        // per-cell save) - one call per month, in parallel, after the
        // resource itself is known to exist (so a brand-new resource has a
        // real resourceId to save months against).
        const monthResponses = await Promise.all(
          Array.from(monthInputs).map((input) => {
            const fm = parseInt(input.dataset.fiscalMonth, 10);
            const revenue = parseFloat(input.value) || 0;
            return fetch(`${API}/revenue/ms-resources/cell`, {
              method: "PUT", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ resource_id: resourceId, fiscal_month: fm, revenue }),
            });
          })
        );
        if (monthResponses.some((r) => !r.ok)) {
          alert("Resource saved, but one or more monthly revenue figures could not be saved.");
        }
        await refresh();
      } finally {
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    });
  } else {
    tr.querySelector(".ms-res-edit-btn").addEventListener("click", () => {
      tr.replaceWith(buildMsResourceRow(res, sowId, fiscalYear, true, refresh));
    });
    tr.querySelector(".ms-res-del-btn").addEventListener("click", async () => {
      if (confirm(`Remove resource "${res.employee_name}"? This cannot be undone.`)) {
        const resp = await fetch(`${API}/revenue/ms-resources/${res.id}`, { method: "DELETE" });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          alert(formatApiError(err, "Failed to remove this resource."));
          return;
        }
        await refresh();
      }
    });
  }

  return tr;
}

// Renders the Resources subtable into `container` (openRevenueEntryModal's
// own Managed Services Resources section) for one SOW+fiscal year - own
// header row (ID/Name/Location/Practice/Start/End/Rate Card/Total/Apr..Mar).
// The "+ Add resource" button lives in the popup's own static "Managed
// Services Resources" heading row (see index.html, right-aligned next to
// it), not inside this dynamically-rebuilt container - so it's grabbed by id
// and re-wired via .onclick (not addEventListener, which would stack a new
// listener on top of the last one each time this is called - see the
// .onchange convention used elsewhere in this file) rather than recreated
// every time this function runs. refresh() re-fetches and rebuilds this
// subtable's tbody in place, then hands the freshly-fetched resources list
// to onResourcesChange (openRevenueEntryModal's applyResourceSums()), so the
// popup's own Revenue Projections and Monthly Breakdown - always the
// read-only sum of these resources' own monthly revenue, per explicit
// request - stays in sync with every add/edit/delete here, not just on next
// reload.
async function renderMsResourceSubtable(container, sowId, fiscalYear, onResourcesChange) {
  container.innerHTML = `
    <div class="table-scroll">
      <table class="sow-table ms-resource-table">
        <thead>
          <tr>
            <th>Actions</th><th class="ms-res-col-id">ID</th><th class="ms-res-col-name">Name</th>
            <th class="ms-res-col-location">Location</th><th class="ms-res-col-practice">Practice</th>
            <th class="ms-res-col-band">Band</th>
            <th>Start Date</th><th>End Date</th><th>Rate Card ($)</th><th>Total</th>
            <th class="rev-band-a">Apr</th><th class="rev-band-b">May</th><th class="rev-band-a">Jun</th>
            <th class="rev-band-b">Jul</th><th class="rev-band-a">Aug</th><th class="rev-band-b">Sep</th>
            <th class="rev-band-a">Oct</th><th class="rev-band-b">Nov</th><th class="rev-band-a">Dec</th>
            <th class="rev-band-b">Jan</th><th class="rev-band-a">Feb</th><th class="rev-band-b">Mar</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
  `;
  const tbody = container.querySelector("tbody");
  const addBtn = document.getElementById("msAddResourceBtn");

  async function refresh() {
    const resources = await fetch(`${API}/revenue/ms-resources?sow_id=${sowId}&fiscal_year=${fiscalYear}`).then((r) => r.json());
    tbody.innerHTML = "";
    if (!resources.length) {
      tbody.innerHTML = '<tr><td colspan="22" class="empty-state empty-state-tight">No resources added yet.</td></tr>';
    } else {
      resources.forEach((res) => tbody.appendChild(buildMsResourceRow(res, sowId, fiscalYear, false, refresh)));
    }
    if (onResourcesChange) onResourcesChange(resources);
  }

  addBtn.onclick = () => {
    if (tbody.querySelector(".empty-state")) tbody.innerHTML = "";
    tbody.appendChild(buildMsResourceRow(null, sowId, fiscalYear, true, refresh));
  };

  await refresh();
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

// ---------- Managed Services Add/Edit/View popup (#revenueEntryModal) ----------
// Replaces the grid's previous inline "Add Entry" draft-row and inline
// "Edit" row-toggle flows with one shared modal, mirroring the SOW page's
// own #sowFormModal/openSowModal() pattern (per explicit request - both Add
// and Edit now open this same popup). Customer/Statement of Work can only be
// chosen when creating a new row - same rule the old inline edit already
// followed (only Revenue Type, the 12 months and Additional Information are
// ever editable on an existing row) - so both selects stay disabled once
// editing an existing row. Onsite #/Offshore #/Nearshore # are always
// read-only here too, per explicit request - computed server-side from that
// SOW's Managed Services Resources (see _ms_location_counts_by_sow in
// main.py) rather than typed in. Practice removed entirely per explicit
// instruction (front end and back end - see db.py/main.py).
//
// The grid's new "View" icon (rev-view-btn in buildRevenueSowRow) opens this
// same popup read-only (viewOnly=true below): every otherwise-editable field
// is disabled/readonly, the header/footer Save button is swapped for an
// Edit button, and Cancel just closes the popup (already wired below via
// wireModalCancel). Clicking that Edit button flips the already-open popup
// into the normal Edit mode in place (re-enabling the editable fields and
// swapping Edit back for Save) rather than closing and reopening it.
const revenueEntryModal = document.getElementById("revenueEntryModal");
wireModalCancel(revenueEntryModal, "cancelRevenueEntryBtn", "cancelRevenueEntryBtnTop");
const editRevenueEntryBtnTop = document.getElementById("editRevenueEntryBtnTop");
const editRevenueEntryBtn = document.getElementById("editRevenueEntryBtn");
const saveRevenueEntryBtnTop = document.getElementById("saveRevenueEntryBtnTop");
const saveRevenueEntryBtn = document.getElementById("saveRevenueEntryBtn");
const cancelRevenueEntryBtnTop = document.getElementById("cancelRevenueEntryBtnTop");
const cancelRevenueEntryBtn = document.getElementById("cancelRevenueEntryBtn");

// r is null for "Add Entry" (a POST/creation flow on Save), or the row's own
// already-fetched summary object for "Edit"/"View" (a PUT on Save, or no
// write at all for View). prefill mirrors the old openRevenueEntryDraft()'s
// own prefill shape - {customerId, months} - used by "Copy" on an existing
// row (see buildRevenueSowRow's rev-copy-btn handler): pre-selects the
// Customer (narrowing the SOW dropdown to that customer's other untracked
// SOWs) and carries over the 12 months' figures as a starting point. Both
// are undefined/null for a plain "Add Entry" click, which opens a fully
// blank popup. viewOnly (see buildRevenueSowRow's rev-view-btn handler)
// opens an existing row read-only, with Edit/Cancel instead of Save/Cancel -
// never true together with a null r.
async function openRevenueEntryModal(r = null, prefill = {}, viewOnly = false) {
  if (currentFiscalYear === null) currentFiscalYear = fiscalYearForToday();
  const [customers, sows] = await Promise.all([
    fetch(`${API}/customers`).then((x) => x.json()),
    fetch(`${API}/sows`).then((x) => x.json()),
  ]);

  const isEditing = !!r;
  const box = revenueEntryModal;
  box.dataset.editing = isEditing ? "true" : "";
  box.dataset.accountId = (r && r.account_id != null) ? String(r.account_id) : "";
  // Captured once here rather than re-read from the (disabled, but still
  // JS-readable) Statement of Work select at Save time - the select's
  // options depend on a freshly-fetched sows list that, in some unlikely
  // edge case (e.g. the SOW was deleted elsewhere in the meantime), might not
  // include this row's own SOW; falling back to re-deriving it from the DOM
  // there would risk silently treating an edit as SOW-less. Customer/SOW
  // are immutable once a row exists (see the disabled selects below), so the
  // value captured here when the popup opened is the only one Save ever
  // needs for an existing row.
  box.dataset.sowId = (r && r.sow_id != null) ? String(r.sow_id) : "";

  const revenueTypeSelect = box.querySelector(".rev-f-revenue-type");
  const customerSelect = box.querySelector(".rev-f-customer");
  const sowSelect = box.querySelector(".rev-f-sow");
  const startDateInput = box.querySelector(".rev-f-start-date");
  const endDateInput = box.querySelector(".rev-f-end-date");
  const billingModelInput = box.querySelector(".rev-f-billing-model");
  const tcvInput = box.querySelector(".rev-f-tcv");
  const notesInput = box.querySelector(".rev-f-notes");
  const monthInputs = box.querySelectorAll(".rev-f-month");
  const totalEl = document.getElementById("revenueEntryModalTotal");

  revenueTypeSelect.innerHTML = `<option value="">Select revenue type&hellip;</option>` +
    currentRevenueTypes.map((rt) => `<option value="${rt.id}">${escapeHtml(rt.name)}</option>`).join("");
  revenueTypeSelect.value = r ? (r.revenue_type_id ?? "") : "";

  customerSelect.innerHTML = '<option value="">Select customer&hellip;</option>' +
    customers.map((c) => `<option value="${c.id}">${escapeHtml(c.customer_name)}</option>`).join("");
  customerSelect.value = r ? String(r.customer_id ?? "") : String(prefill.customerId ?? "");
  customerSelect.disabled = isEditing;

  // Time and Material SOWs are excluded here - this grid (Best Estimates >
  // Managed Services) is for Non-Time and Material SOWs only, per explicit
  // request; Time and Material SOWs are tracked on their own grid instead.
  // A SOW already tracked elsewhere is excluded too, except the row's own
  // current SOW when editing (it's tracked by this very row).
  function refreshSowOptions() {
    const custVal = customerSelect.value;
    if (!custVal) {
      sowSelect.innerHTML = '<option value="">Select customer first&hellip;</option>';
      sowSelect.disabled = true;
      return;
    }
    const matching = sows.filter((s) =>
      s.customer_id === parseInt(custVal, 10) &&
      (!revenueTrackedSowIds.has(s.id) || (r && s.id === r.sow_id)) &&
      (s.billing_model_name || "") !== "Time and Material"
    );
    if (!matching.length) {
      sowSelect.innerHTML = '<option value="">No available SOWs for this customer</option>';
      sowSelect.disabled = true;
    } else {
      sowSelect.innerHTML = '<option value="">Select SOW&hellip;</option>' +
        matching.map((s) => `<option value="${s.id}">${escapeHtml(s.title)}</option>`).join("");
      sowSelect.disabled = isEditing;
    }
    sowSelect.value = (r && r.sow_id != null) ? String(r.sow_id) : "";
  }
  refreshSowOptions();

  function refreshSowDependentFields() {
    const selectedSow = sows.find((s) => String(s.id) === sowSelect.value);
    startDateInput.value = selectedSow ? fmtDate(selectedSow.start_date) : "—";
    endDateInput.value = selectedSow ? fmtDate(selectedSow.end_date) : "—";
    billingModelInput.value = (selectedSow && selectedSow.billing_model_name) || "—";
    tcvInput.value = selectedSow ? fmt(selectedSow.total_value) : "—";
  }

  function refreshTotal() {
    const sum = Array.from(monthInputs).reduce((acc, input) => acc + (parseFloat(input.value) || 0), 0);
    totalEl.textContent = fmtPlain(sum);
  }

  // Revenue Projections and Monthly Breakdown is always read-only now, per
  // explicit request - it's the sum of this SOW's Managed Services
  // Resources' own monthly revenue (ms_resource_entries), not a flat number
  // typed directly here. applyResourceSums() is renderMsResourceSubtable's
  // onResourcesChange callback below, so it re-runs after every resource
  // add/edit/delete, not just when the popup first opens - 0 for every
  // month whenever there are no resources yet (no SOW selected, or a SOW
  // with none added), even if this row previously had manually-entered
  // figures; those are only actually overwritten once Save is clicked.
  function applyResourceSums(resources) {
    const sums = {};
    (resources || []).forEach((res) => {
      (res.months || []).forEach((m) => {
        sums[m.fiscal_month] = (sums[m.fiscal_month] || 0) + (m.revenue || 0);
      });
    });
    monthInputs.forEach((input) => {
      const fm = parseInt(input.dataset.fiscalMonth, 10);
      input.value = sums[fm] || 0;
    });
    refreshTotal();
  }

  // Managed Services Resources - reuses the exact same
  // renderMsResourceSubtable() used to live inline in the main grid, just
  // targeting this popup's own container. A resource only ever belongs to a
  // sow_id (see ms_resources in db.py), never to a bare Customer, so this
  // stays hidden behind its own hint until a SOW is actually selected -
  // which, for "Add Entry", may not happen until the user picks one after
  // opening the popup. The grid's own Onsite/Offshore/Nearshore counts
  // simply pick up whatever was added here on the next loadRevenueSows()
  // reload, same as Save always triggers.
  const resourcesSection = document.getElementById("revenueEntryResourcesSection");
  const resourcesHint = document.getElementById("revenueEntryResourcesHint");
  const resourcesContainer = document.getElementById("revenueEntryResourcesContainer");
  const addResourceBtn = document.getElementById("msAddResourceBtn");
  // Every SOW a not-yet-saved "Add Entry" popup's dropdown was set to while
  // open, so Cancel (see the wiring right after setMode() below) can clean
  // up resources added to any of them, not just whichever one happens to be
  // selected at the moment Cancel is clicked (the user may pick SOW A, add a
  // resource, then switch to SOW B before abandoning the popup).
  const touchedSowIds = new Set();
  function refreshResourcesSection() {
    const selectedSowId = sowSelect.value ? parseInt(sowSelect.value, 10) : null;
    if (selectedSowId) {
      // A resource's own Save (buildMsResourceRow) is immediate and
      // independent of this popup's outer Save button below, so for a
      // brand-new ("Add Entry") row - never for editing an existing one,
      // whose resources are already legitimately tracked - every SOW picked
      // here while resources might get added to it is remembered, so
      // Cancel can clean up anything left orphaned if this popup is
      // abandoned without ever completing Save (see the Cancel wiring
      // below and delete_ms_resources_by_sow in main.py).
      if (!isEditing) touchedSowIds.add(selectedSowId);
      resourcesSection.hidden = false;
      resourcesHint.hidden = true;
      addResourceBtn.hidden = false;
      renderMsResourceSubtable(resourcesContainer, selectedSowId, currentFiscalYear, applyResourceSums);
    } else {
      resourcesSection.hidden = true;
      resourcesHint.hidden = false;
      addResourceBtn.hidden = true;
      resourcesContainer.innerHTML = "";
      applyResourceSums([]);
    }
  }

  // Excel upload/download for this popup's own Managed Services Resources
  // subtable (see index.html's ms-resources-toolbar) - scoped to whichever
  // SOW + fiscal year is currently selected, unlike the main grids'
  // Export/Import which work off currentFiscalYear alone. Assigned via
  // .onclick/.onchange (not addEventListener), same reasoning as
  // customerSelect/sowSelect above - these elements persist across every
  // open of this modal. Export/Import are only ever clickable while
  // resourcesSection itself is visible (a SOW is selected), since the
  // buttons live inside it - see refreshResourcesSection() above.
  const msExportBtn = document.getElementById("msExportResourcesBtn");
  const msImportBtn = document.getElementById("msImportResourcesBtn");
  const msImportFile = document.getElementById("msResourcesImportFile");
  msExportBtn.onclick = () => {
    const selectedSowId = sowSelect.value ? parseInt(sowSelect.value, 10) : null;
    if (!selectedSowId) return;
    window.location.href = `${API}/revenue/ms-resources/export?sow_id=${selectedSowId}&fiscal_year=${currentFiscalYear}`;
  };
  msImportBtn.onclick = () => msImportFile.click();
  // Unlike wireExcelImport()'s full loadRevenueTab() reload, a successful
  // import here just re-renders this popup's own resource subtable (and, via
  // its onResourcesChange callback, re-sums Revenue Projections and Monthly
  // Breakdown) - refreshResourcesSection() already does exactly that.
  msImportFile.onchange = async () => {
    const file = msImportFile.files[0];
    if (!file) return;
    const selectedSowId = sowSelect.value ? parseInt(sowSelect.value, 10) : null;
    if (!selectedSowId) { msImportFile.value = ""; return; }
    msImportBtn.disabled = true;
    try {
      const formData = new FormData();
      formData.append("file", file);
      const resp = await fetch(
        `${API}/revenue/ms-resources/import?sow_id=${selectedSowId}&fiscal_year=${currentFiscalYear}`,
        { method: "POST", body: formData }
      );
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
      if (result.imported) refreshResourcesSection();
    } finally {
      msImportBtn.disabled = false;
      msImportFile.value = "";
    }
  };

  // Seeded from this row's own last-saved r.months first (or all zeros for a
  // brand-new/copied row) so there's no flash to zero while the resources
  // fetch triggered by refreshResourcesSection() below is still in flight -
  // converges to the true resource sum as soon as it resolves.
  const monthValues = {};
  (r ? r.months : []).forEach((m) => { monthValues[m.fiscal_month] = m.projection; });
  monthInputs.forEach((input) => {
    const fm = parseInt(input.dataset.fiscalMonth, 10);
    input.value = monthValues[fm] ?? 0;
  });
  refreshTotal();
  refreshResourcesSection();
  // For an existing row, show its own already-known figures (from r) rather
  // than re-deriving them from the sows list - exactly what's on screen
  // right now, and correct even if this SOW is somehow missing from the
  // freshly-fetched sows list. For a new/copied row, derive from whichever
  // SOW ends up selected.
  if (isEditing) {
    startDateInput.value = fmtDate(r.start_date);
    endDateInput.value = fmtDate(r.end_date);
    billingModelInput.value = r.billing_model_name || "—";
    tcvInput.value = r.total_value != null ? fmt(r.total_value) : "—";
  } else {
    refreshSowDependentFields();
  }

  notesInput.value = (r ? r.additional_info : "") || "";

  // Assigned via .onchange (not addEventListener) since these same <select>
  // elements persist across every open of this modal - addEventListener
  // would stack a new listener on top of the last one each time. Revenue
  // Type is never touched by either handler below (per explicit request -
  // it used to be reset to blank on Customer change and then re-derived
  // from the selected SOW's own revenue_type_id on SOW change, which
  // clobbered whatever the user had already picked depending on the order
  // they filled the popup in). Whatever the user selects for Revenue Type -
  // in any order relative to Customer/SOW - is left exactly as they set it.
  customerSelect.onchange = () => {
    refreshSowOptions();
    refreshSowDependentFields();
    refreshResourcesSection();
  };
  sowSelect.onchange = () => {
    refreshSowDependentFields();
    refreshResourcesSection();
  };

  // View mode disables/read-onlys every field that's otherwise editable for
  // an existing row (Revenue Type, Additional Information - Customer/SOW are
  // already always disabled for an existing row above, and the 12 months/
  // Onsite #/Offshore #/Nearshore # are always readonly regardless of mode,
  // per explicit request) and swaps the Save button for an Edit button.
  // Clicking that Edit button re-enters this same function's edit mode in
  // place, without closing/reopening the popup. Not offered at all for a
  // brand-new ("Add Entry") row, which has no view mode to begin with.
  function setMode(isViewOnly) {
    document.getElementById("revenueEntryModalTitle").textContent = isViewOnly
      ? "View Managed Services Entry"
      : (isEditing ? "Edit Managed Services Entry" : "Add Managed Services Entry");
    revenueTypeSelect.disabled = isViewOnly;
    notesInput.readOnly = isViewOnly;
    editRevenueEntryBtnTop.hidden = !isViewOnly;
    editRevenueEntryBtn.hidden = !isViewOnly;
    saveRevenueEntryBtnTop.hidden = isViewOnly;
    saveRevenueEntryBtn.hidden = isViewOnly;
  }
  editRevenueEntryBtnTop.onclick = () => setMode(false);
  editRevenueEntryBtn.onclick = () => setMode(false);
  setMode(isEditing && viewOnly);

  // Cancelling a not-yet-saved "Add Entry" (never for Edit/View, where every
  // resource change is already immediately persisted by design - see
  // touchedSowIds above) cleans up any resource added to any SOW this
  // session touched, so nothing orphaned is left behind with no tracked row
  // to ever delete it via - it would otherwise resurface, already filled
  // in, the next time that same SOW was picked again (see explicit bug
  // report and delete_ms_resources_by_sow in main.py). Assigned via
  // .onclick (overwriting, not stacking) alongside wireModalCancel's own
  // addEventListener-based hide, which still runs every time regardless.
  const cleanupUnsavedResourcesOnCancel = () => {
    if (isEditing) return;
    touchedSowIds.forEach((sowIdToClean) => {
      fetch(`${API}/revenue/ms-resources/by-sow?sow_id=${sowIdToClean}&fiscal_year=${currentFiscalYear}`, { method: "DELETE" }).catch(() => {});
    });
  };
  cancelRevenueEntryBtnTop.onclick = cleanupUnsavedResourcesOnCancel;
  cancelRevenueEntryBtn.onclick = cleanupUnsavedResourcesOnCancel;

  revenueEntryModal.hidden = false;
}

document.getElementById("revenueEntryForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const box = revenueEntryModal;
  const isEditing = box.dataset.editing === "true";
  const existingAccountId = box.dataset.accountId ? parseInt(box.dataset.accountId, 10) : null;
  const existingSowId = box.dataset.sowId ? parseInt(box.dataset.sowId, 10) : null;
  const customerSelect = box.querySelector(".rev-f-customer");
  const sowSelect = box.querySelector(".rev-f-sow");
  const notesInput = box.querySelector(".rev-f-notes");

  const customerVal = customerSelect.value;
  if (!isEditing && !customerVal) { alert("Please select a customer."); return; }
  // Customer/SOW are immutable once a row exists (see openRevenueEntryModal's
  // comment on box.dataset.sowId) - an edit always uses the row's own
  // already-known sow_id rather than re-reading the (disabled) select.
  const sowId = isEditing ? existingSowId : (sowSelect.value ? parseInt(sowSelect.value, 10) : null);
  const additionalInfo = notesInput.value;
  // Additional Information is mandatory only for a row with no SOW (per
  // explicit request) - checked before anything is sent.
  if (!sowId && !additionalInfo.trim()) {
    alert("Please fill in the Additional Information column before saving a row with no SOW.");
    return;
  }

  const saveButtons = box.querySelectorAll('button[type="submit"]');
  saveButtons.forEach((b) => (b.disabled = true));
  try {
    const revenueTypeVal = box.querySelector(".rev-f-revenue-type").value;
    const revenueTypeId = revenueTypeVal ? parseInt(revenueTypeVal, 10) : null;
    const months = Array.from(box.querySelectorAll(".rev-f-month")).map((input) => ({
      fiscal_month: parseInt(input.dataset.fiscalMonth, 10),
      projection: parseFloat(input.value) || 0,
    }));

    let effectiveAccountId = existingAccountId;
    if (!isEditing && !sowId) {
      // A SOW-less row has no (sow_id, fiscal_year) style natural key to
      // implicitly create itself via the month/classification PUTs below the
      // way a SOW-backed row does - it has to be created explicitly first to
      // get back a real account_id, then every other write below is keyed on
      // that. See create_revenue_account in main.py.
      const createResp = await fetch(`${API}/revenue/accounts`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: parseInt(customerVal, 10), fiscal_year: currentFiscalYear, additional_info: additionalInfo }),
      });
      if (!createResp.ok) {
        const err = await createResp.json().catch(() => ({}));
        alert(formatApiError(err, "Failed to save this entry."));
        return;
      }
      effectiveAccountId = (await createResp.json()).account_id;
    }

    const cellUrl = sowId ? `${API}/revenue/sows` : `${API}/revenue/accounts/cell`;
    const classificationUrl = sowId ? `${API}/sows/${sowId}/classification` : `${API}/revenue/accounts/${effectiveAccountId}/classification`;

    const responses = await Promise.all([
      ...months.map((m) =>
        fetch(cellUrl, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sowId ? { sow_id: sowId, fiscal_year: currentFiscalYear, ...m } : { account_id: effectiveAccountId, ...m }),
        })
      ),
      // Revenue Type is the one Contract field this popup still lets you
      // change directly for a SOW-backed row (everything else about the
      // Contract still goes through the full SOW form) - saved via the
      // narrow /classification endpoint, same as before Practice was removed
      // from it (see main.py's RevenueAccountClassificationIn/
      // SowClassificationIn).
      fetch(classificationUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revenue_type_id: revenueTypeId }) }),
    ]);
    const failed = responses.find((resp) => !resp.ok);
    if (failed) {
      const err = await failed.json().catch(() => ({}));
      alert(formatApiError(err, "Failed to save this entry."));
      return;
    }

    if (sowId) revenueTrackedSowIds.add(sowId);

    // Additional Information is always saved via its own universal endpoint
    // once the account_id is known - already known for an existing row or a
    // brand-new SOW-less row, but not yet for a brand-new SOW-backed row
    // (created implicitly by the PUTs above), which needs a reload first to
    // learn it. Skipped only when there's nothing to save and no account_id
    // to save it against yet (a blank-notes brand-new SOW-backed row).
    if (isEditing || additionalInfo.trim()) {
      if (!effectiveAccountId && sowId) {
        await loadRevenueSows();
        const savedRow = Array.from(revenueSowsCache.values()).find((row) => row.sow_id === sowId);
        effectiveAccountId = savedRow ? savedRow.account_id : null;
      }
      if (effectiveAccountId) {
        const infoResp = await fetch(`${API}/revenue/accounts/${effectiveAccountId}/additional-info`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ additional_info: additionalInfo }),
        });
        if (!infoResp.ok) {
          const err = await infoResp.json().catch(() => ({}));
          alert(formatApiError(err, "Entry saved, but Additional Information could not be saved."));
        }
      }
    }

    revenueEntryModal.hidden = true;
    await loadRevenueSows();
  } finally {
    saveButtons.forEach((b) => (b.disabled = false));
  }
});

document.getElementById("newRevenueEntryBtn").addEventListener("click", () => openRevenueEntryModal());

// ---------- Time and Material (Best Estimates > Time and Material). One
// row per employee assignment to a Contract, not one row per SOW, so the
// same Contract can appear on multiple rows. Still its own inline-edit /
// inline-draft-row pattern (unlike Managed Services above, which now opens
// #revenueEntryModal for both Add and Edit instead). --------------------

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
  // (see openRevenueEntryModal's refreshSowOptions()).
  return currentAllSows.filter((s) => String(s.customer_id) === String(customerId) && (s.billing_model_name || "") === "Time and Material");
}

async function loadTmAssignments() {
  const data = await fetch(`${API}/tm/assignments?fiscal_year=${currentFiscalYear}`).then((r) => r.json());
  tmAssignmentsCache = new Map(data.rows.map((r) => [r.assignment_id, r]));
  renderTmAssignmentsTable();
}

// Renders the grid from tmAssignmentsCache - split out from loadTmAssignments
// so the search box and the Start Date/End Date column sort (see
// tmSearchQuery/tmSort above) can re-filter/re-sort the already-fetched rows
// without a network round trip; loadTmAssignments still calls this after
// fetching fresh data (a new fiscal year, or the Customer/Revenue Type/
// Location/Practice filters, which stay on the full reload).
function renderTmAssignmentsTable() {
  const allRows = Array.from(tmAssignmentsCache.values());
  const filteredRows = sortTmRows(allRows.filter(tmRowMatchesFilters));
  const tbody = document.getElementById("tmAssignmentsTableBody");
  tbody.innerHTML = "";
  if (!filteredRows.length) {
    tbody.innerHTML = `<tr><td colspan="31" class="empty-state">${
      allRows.length ? "No entries match the selected filter." : 'No entries yet. Click "Add Entry" to start tracking a Time and Material assignment.'
    }</td></tr>`;
  } else {
    filteredRows.forEach((r) => tbody.appendChild(buildTmAssignmentRow(r)));
    renumberTmRows();
    highlightDuplicateTmEmployeeIds();
  }
  renderRevenueTypeSummaryTable(filteredRows, "tmRevenueTypeSummaryBody");
  updateTmSortArrows();
  updateRevenueTabFooterRowCount();
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

// Builds one <tr> for the Time and Material grid - always read-only now
// (Add, Edit and View all open #tmEntryModal instead of toggling a row in
// place; see openTmEntryModal()).
function buildTmAssignmentRow(r) {
  const tr = document.createElement("tr");
  // Actions comes first (app-wide convention: wherever a table has both
  // Sl. No and Actions, Actions is column 1 and Sl. No is column 2). Sl. No
  // itself is left blank here and filled in by renumberTmRows() based on the
  // row's actual position in the table.
  let cells = `<td class="row-actions">
        <button type="button" class="ghost-btn btn-edit icon-btn tm-view-btn" title="View">${icon("eye")}</button>
        <button type="button" class="ghost-btn btn-edit icon-btn tm-copy-btn" title="Copy">${icon("copy")}</button>
        <button type="button" class="ghost-btn btn-edit icon-btn tm-edit-btn" title="Edit">${icon("edit")}</button>
        <button type="button" class="ghost-btn btn-danger icon-btn tm-del-btn" title="Delete">${icon("trash")}</button>
      </td>`;
  cells += `<td class="tm-sl-no"></td>`;

  cells += `
    <td>${escapeHtml(r.revenue_type_name) || "—"}</td>
    <td>${escapeHtml(r.customer_name) || "—"}</td>
    <td>${escapeHtml(r.sow_title) || "—"}</td>
    <td class="tm-employee-id-cell">${escapeHtml(r.employee_id) || "—"}</td>
    <td>${escapeHtml(r.employee_name) || "—"}${r.leave_details_missing ? `<span class="info-icon-wrap" tabindex="0">${icon("info")}<span class="info-tooltip-text">Leave details are missing</span></span>` : ""}</td>
    <td>${escapeHtml(r.location_name) || "—"}</td>
    <td>${escapeHtml(r.practice_name) || "—"}</td>
    <td>${escapeHtml(r.sow_role) || "—"}</td>
    <td>${escapeHtml(r.wbs_id) || "—"}</td>
    <td class="tm-billing-hours-cell">${r.billing_hours_per_day != null ? fmtPlain(r.billing_hours_per_day) : "—"}</td>
    <td class="rev-tcv-cell">${r.rate_card != null ? fmt(r.rate_card) : "—"}</td>
    <td>${r.discount_percent != null ? r.discount_percent + "%" : "—"}</td>
    <td class="rev-tcv-cell tm-final-rate">${r.final_rate_card != null ? fmt(r.final_rate_card) : "—"}</td>
    <td>${fmtDate(r.start_date)}</td>
    <td>${fmtDate(r.end_date)}</td>
  `;

  // Total is always read-only (sum of the 12 months' Projections, Apr
  // through Mar) - there's nothing to input, same reasoning as Projections
  // itself just below.
  const totalProjection = r.months.reduce((sum, m) => sum + (m.projection || 0), 0);
  cells += `<td class="rev-tcv-cell tm-total-cell">${fmtPlain(totalProjection)}</td>`;

  // Projections is always auto-calculated (see _compute_tm_projections in
  // main.py - working days between Start/End Date minus Holiday Calendar
  // minus Leave Tracker, times Final Rate Card times Billing Hours per day)
  // and never manually entered - there is no manual monthly input anywhere
  // in this grid or its popup.
  r.months.forEach((m, i) => {
    const band = i % 2 === 0 ? "rev-band-a" : "rev-band-b";
    cells += `<td class="rev-readonly-cell ${band}">${fmtPlain(m.projection)}</td>`;
  });

  cells += `<td>${r.additional_info ? `<span class="notes-cell" title="${escapeHtml(r.additional_info)}">${escapeHtml(r.additional_info)}</span>` : "—"}</td>`;

  tr.innerHTML = cells;
  // Feeds highlightDuplicateTmEmployeeIds() - a plain string comparison
  // against every other visible row's own data-employee-id, trimmed so
  // "E123" and "E123 " (a likely copy/paste artifact) still count as the
  // same id.
  tr.dataset.employeeId = (r.employee_id || "").trim();

  tr.querySelector(".tm-view-btn").addEventListener("click", () => {
    openTmEntryModal(r, {}, true);
  });
  tr.querySelector(".tm-copy-btn").addEventListener("click", () => {
    // Unlike the SoW Level grid, an assignment has no uniqueness rule -
    // "Copy" opens the same Add Entry popup used below, pre-filled with
    // every one of this row's descriptive fields but no assignment_id, so
    // Save creates a brand-new assignment rather than touching this one.
    // Months aren't copied - Projections is always freshly computed for
    // whatever the new assignment's own fields turn out to be. See
    // openTmEntryModal().
    openTmEntryModal(null, {
      customerId: r.customer_id, sowId: r.sow_id, revenueTypeId: r.revenue_type_id,
      employeeId: r.employee_id, employeeName: r.employee_name, locationId: r.location_id,
      practiceId: r.practice_id, wbsId: r.wbs_id, sowRole: r.sow_role, rateCard: r.rate_card,
      discountPercent: r.discount_percent, startDate: r.start_date, endDate: r.end_date,
      additionalInfo: r.additional_info,
    });
  });
  tr.querySelector(".tm-edit-btn").addEventListener("click", () => {
    openTmEntryModal(r);
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

  return tr;
}

document.getElementById("exportTmBtn").addEventListener("click", () => {
  if (currentFiscalYear === null) currentFiscalYear = fiscalYearForToday();
  window.location.href = `${API}/tm/assignments/export?fiscal_year=${currentFiscalYear}`;
});

// ---------- Time and Material Add/Edit/View popup (#tmEntryModal) ----------
// Replaces the grid's previous inline "Add Entry" draft-row and inline
// "Edit" row-toggle flows with one shared modal, mirroring the Managed
// Services #revenueEntryModal/openRevenueEntryModal() pattern above. Unlike
// Managed Services, Customer/Statement of Work/Revenue Type stay editable
// even on an existing row here (matching the old inline-edit behavior
// exactly - an assignment has no uniqueness rule tying it to one Customer/
// SOW the way a Managed Services row does). Billing Hours (per day) and
// Discounted Rate are always read-only previews (see billingHoursFor()/
// computeFinalRate()) and the 12 months + Total are always read-only too -
// Projections is auto-calculated server-side (see
// buildTmAssignmentRow's comment) and there's no manual monthly input
// anywhere, editable or not.
const tmEntryModal = document.getElementById("tmEntryModal");
wireModalCancel(tmEntryModal, "cancelTmEntryBtn", "cancelTmEntryBtnTop");
const editTmEntryBtnTop = document.getElementById("editTmEntryBtnTop");
const editTmEntryBtn = document.getElementById("editTmEntryBtn");
const saveTmEntryBtnTop = document.getElementById("saveTmEntryBtnTop");
const saveTmEntryBtn = document.getElementById("saveTmEntryBtn");

// r is null for "Add Entry" (a POST/creation flow on Save), or the row's own
// already-fetched summary object for "Edit"/"View" (a PUT on Save, or no
// write at all for View). prefill mirrors the old openTmEntryDraft()'s own
// prefill shape - used by "Copy" on an existing row (see
// buildTmAssignmentRow's tm-copy-btn handler): every one of the source
// row's descriptive fields, no assignment_id. Both undefined/null for a
// plain "Add Entry" click, which opens a fully blank popup. viewOnly (see
// buildTmAssignmentRow's tm-view-btn handler) opens an existing row
// read-only, with Edit/Cancel instead of Save/Cancel - never true together
// with a null r.
function openTmEntryModal(r = null, prefill = {}, viewOnly = false) {
  if (currentFiscalYear === null) currentFiscalYear = fiscalYearForToday();

  const isEditing = !!r;
  const box = tmEntryModal;
  box.dataset.editing = isEditing ? "true" : "";
  box.dataset.assignmentId = (r && r.assignment_id != null) ? String(r.assignment_id) : "";

  const revenueTypeSelect = box.querySelector(".tm-f-revenue-type");
  const customerSelect = box.querySelector(".tm-f-customer");
  const sowSelect = box.querySelector(".tm-f-sow");
  const employeeIdInput = box.querySelector(".tm-f-employee-id");
  const employeeNameInput = box.querySelector(".tm-f-employee-name");
  const locationSelect = box.querySelector(".tm-f-location");
  const practiceSelect = box.querySelector(".tm-f-practice");
  const sowRoleInput = box.querySelector(".tm-f-sow-role");
  const wbsInput = box.querySelector(".tm-f-wbs");
  const rateInput = box.querySelector(".tm-f-rate-card");
  const discountInput = box.querySelector(".tm-f-discount");
  const billingHoursInput = box.querySelector(".tm-f-billing-hours");
  const finalRateInput = box.querySelector(".tm-f-final-rate");
  const startDateInput = box.querySelector(".tm-f-start-date");
  const endDateInput = box.querySelector(".tm-f-end-date");
  const notesInput = box.querySelector(".tm-f-notes");
  const monthInputs = box.querySelectorAll(".tm-f-month");
  const totalEl = document.getElementById("tmEntryModalTotal");

  revenueTypeSelect.innerHTML = `<option value="">Select revenue type&hellip;</option>` +
    currentRevenueTypes.map((rt) => `<option value="${rt.id}">${escapeHtml(rt.name)}</option>`).join("");
  revenueTypeSelect.value = r ? (r.revenue_type_id ?? "") : (prefill.revenueTypeId ?? "");

  customerSelect.innerHTML = '<option value="">Select customer&hellip;</option>' +
    currentTmCustomers.map((c) => `<option value="${c.id}">${escapeHtml(c.customer_name)}</option>`).join("");
  customerSelect.value = r ? String(r.customer_id ?? "") : String(prefill.customerId ?? "");

  function refreshSowOptions(selectedSowId) {
    const custVal = customerSelect.value;
    const matching = tmSowsForCustomer(custVal);
    if (!custVal) {
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
  refreshSowOptions(r ? r.sow_id : prefill.sowId);

  employeeIdInput.value = r ? (r.employee_id || "") : (prefill.employeeId || "");
  employeeNameInput.value = r ? (r.employee_name || "") : (prefill.employeeName || "");

  locationSelect.innerHTML = `<option value="">Select location&hellip;</option>` +
    currentLocations.map((l) => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join("");
  locationSelect.value = r ? (r.location_id ?? "") : (prefill.locationId ?? "");

  practiceSelect.innerHTML = `<option value="">Select practice&hellip;</option>` +
    currentPractices.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  practiceSelect.value = r ? (r.practice_id ?? "") : (prefill.practiceId ?? "");

  sowRoleInput.value = r ? (r.sow_role || "") : (prefill.sowRole || "");
  wbsInput.value = r ? (r.wbs_id || "") : (prefill.wbsId || "");
  rateInput.value = r ? (r.rate_card ?? "") : (prefill.rateCard ?? "");
  discountInput.value = r ? (r.discount_percent ?? "") : (prefill.discountPercent ?? "");
  startDateInput.value = r ? (r.start_date || "") : (prefill.startDate || "");
  endDateInput.value = r ? (r.end_date || "") : (prefill.endDate || "");
  notesInput.value = r ? (r.additional_info || "") : (prefill.additionalInfo || "");

  // Live preview of Billing Hours per day as Customer/Location change - just
  // a preview (see billingHoursFor()); the value that actually drives the
  // Projections formula is looked up server-side on Save.
  function refreshBillingHours() {
    const hours = billingHoursFor(customerSelect.value, locationSelect.value);
    billingHoursInput.value = hours != null ? fmtPlain(hours) : "—";
  }
  refreshBillingHours();

  function refreshFinalRate() {
    const final = computeFinalRate(rateInput.value, discountInput.value);
    finalRateInput.value = final != null ? fmt(final) : "—";
  }
  refreshFinalRate();

  // Seeded from this row's own last-saved r.months first (or "—" for a
  // brand-new/copied row) so there's no flash to zero while the live preview
  // fetch below is still in flight - refreshProjectionsPreview() then
  // immediately re-derives the true current figures from whatever's in the
  // fields right now, converging on the same numbers for an untouched
  // existing row.
  const monthValues = {};
  (r ? r.months : []).forEach((m) => { monthValues[m.fiscal_month] = m.projection; });
  let totalProjection = 0;
  monthInputs.forEach((input) => {
    const fm = parseInt(input.dataset.fiscalMonth, 10);
    if (r) {
      const v = monthValues[fm] ?? 0;
      input.value = fmtPlain(v);
      totalProjection += v;
    } else {
      input.value = "—";
    }
  });
  totalEl.textContent = r ? fmtPlain(totalProjection) : "—";

  // Live preview of Projections as soon as enough fields are filled in
  // (Customer, Location, Rate Card, Start Date, End Date), per explicit
  // request - previously this only updated after Save reloaded the grid.
  // Calls the same _compute_tm_projections/_billing_hours_per_day the real
  // Save uses (see POST /api/tm/assignments/preview in main.py), just
  // against whatever the popup's fields currently hold rather than a saved
  // row, so it always matches what Save is about to persist. previewSeq
  // guards against an earlier, slower request overwriting a later one if two
  // fire close together (e.g. typing Rate Card quickly).
  let previewSeq = 0;
  let previewDebounceTimer = null;
  async function refreshProjectionsPreview() {
    const seq = ++previewSeq;
    const customerVal = customerSelect.value;
    const locationVal = locationSelect.value;
    const startVal = startDateInput.value;
    const endVal = endDateInput.value;
    const rateVal = rateInput.value;
    if (!customerVal || !locationVal || !startVal || !endVal || rateVal === "") {
      monthInputs.forEach((input) => { input.value = "—"; });
      totalEl.textContent = "—";
      return;
    }
    let data;
    try {
      const resp = await fetch(`${API}/tm/assignments/preview`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: parseInt(customerVal, 10),
          location_id: parseInt(locationVal, 10),
          employee_id: employeeIdInput.value.trim() || null,
          rate_card: parseFloat(rateVal),
          discount_percent: discountInput.value !== "" ? parseFloat(discountInput.value) : null,
          start_date: startVal,
          end_date: endVal,
          fiscal_year: currentFiscalYear,
        }),
      });
      if (!resp.ok) return;
      data = await resp.json();
    } catch {
      return;
    }
    if (seq !== previewSeq) return; // a newer request has since started - discard this stale one
    const previewValues = {};
    data.months.forEach((m) => { previewValues[m.fiscal_month] = m.revenue; });
    let total = 0;
    monthInputs.forEach((input) => {
      const fm = parseInt(input.dataset.fiscalMonth, 10);
      const v = previewValues[fm] ?? 0;
      input.value = fmtPlain(v);
      total += v;
    });
    totalEl.textContent = fmtPlain(total);
  }
  function schedulePreviewRefresh() {
    clearTimeout(previewDebounceTimer);
    previewDebounceTimer = setTimeout(refreshProjectionsPreview, 250);
  }
  refreshProjectionsPreview();

  // Assigned via .onchange/.oninput (not addEventListener) since these same
  // elements persist across every open of this modal - addEventListener
  // would stack a new listener on top of the last one each time.
  customerSelect.onchange = () => {
    refreshSowOptions(null);
    refreshBillingHours();
    schedulePreviewRefresh();
  };
  locationSelect.onchange = () => {
    refreshBillingHours();
    schedulePreviewRefresh();
  };
  rateInput.oninput = () => {
    refreshFinalRate();
    schedulePreviewRefresh();
  };
  discountInput.oninput = () => {
    refreshFinalRate();
    schedulePreviewRefresh();
  };
  startDateInput.onchange = schedulePreviewRefresh;
  endDateInput.onchange = schedulePreviewRefresh;
  employeeIdInput.onchange = schedulePreviewRefresh;

  // View mode disables/read-onlys every field that's otherwise editable
  // (Billing Hours (per day), Discounted Rate and the monthly breakdown are
  // always read-only regardless of mode, per their own comments above) and
  // swaps the Save button for an Edit button. Clicking that Edit button
  // re-enters this same function's edit mode in place, without closing/
  // reopening the popup. Not offered at all for a brand-new ("Add Entry")
  // row, which has no view mode to begin with.
  function setMode(isViewOnly) {
    document.getElementById("tmEntryModalTitle").textContent = isViewOnly
      ? "View Time and Material Entry"
      : (isEditing ? "Edit Time and Material Entry" : "Add Time and Material Entry");
    revenueTypeSelect.disabled = isViewOnly;
    customerSelect.disabled = isViewOnly;
    locationSelect.disabled = isViewOnly;
    practiceSelect.disabled = isViewOnly;
    employeeIdInput.readOnly = isViewOnly;
    employeeNameInput.readOnly = isViewOnly;
    sowRoleInput.readOnly = isViewOnly;
    wbsInput.readOnly = isViewOnly;
    rateInput.readOnly = isViewOnly;
    discountInput.readOnly = isViewOnly;
    startDateInput.readOnly = isViewOnly;
    endDateInput.readOnly = isViewOnly;
    notesInput.readOnly = isViewOnly;
    refreshSowOptions(sowSelect.value || (r ? r.sow_id : prefill.sowId));
    if (isViewOnly) sowSelect.disabled = true;
    editTmEntryBtnTop.hidden = !isViewOnly;
    editTmEntryBtn.hidden = !isViewOnly;
    saveTmEntryBtnTop.hidden = isViewOnly;
    saveTmEntryBtn.hidden = isViewOnly;
  }
  editTmEntryBtnTop.onclick = () => setMode(false);
  editTmEntryBtn.onclick = () => setMode(false);
  setMode(isEditing && viewOnly);

  tmEntryModal.hidden = false;
}

document.getElementById("tmEntryForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const box = tmEntryModal;
  const isEditing = box.dataset.editing === "true";
  const assignmentId = box.dataset.assignmentId ? parseInt(box.dataset.assignmentId, 10) : null;

  const customerVal = box.querySelector(".tm-f-customer").value;
  const employeeNameVal = box.querySelector(".tm-f-employee-name").value.trim();
  if (!customerVal) { alert("Please select a customer."); return; }
  if (!employeeNameVal) { alert("Please enter an employee name."); return; }

  const sowVal = box.querySelector(".tm-f-sow").value;
  const revenueTypeVal = box.querySelector(".tm-f-revenue-type").value;
  const locationVal = box.querySelector(".tm-f-location").value;
  const practiceVal = box.querySelector(".tm-f-practice").value;
  const rateCardVal = box.querySelector(".tm-f-rate-card").value;
  const discountVal = box.querySelector(".tm-f-discount").value;

  const payload = {
    customer_id: parseInt(customerVal, 10),
    sow_id: sowVal ? parseInt(sowVal, 10) : null,
    revenue_type_id: revenueTypeVal ? parseInt(revenueTypeVal, 10) : null,
    employee_id: box.querySelector(".tm-f-employee-id").value.trim() || null,
    employee_name: employeeNameVal,
    location_id: locationVal ? parseInt(locationVal, 10) : null,
    practice_id: practiceVal ? parseInt(practiceVal, 10) : null,
    wbs_id: box.querySelector(".tm-f-wbs").value.trim() || null,
    sow_role: box.querySelector(".tm-f-sow-role").value.trim() || null,
    rate_card: rateCardVal !== "" ? parseFloat(rateCardVal) : null,
    discount_percent: discountVal !== "" ? parseFloat(discountVal) : null,
    start_date: box.querySelector(".tm-f-start-date").value || null,
    end_date: box.querySelector(".tm-f-end-date").value || null,
    additional_info: box.querySelector(".tm-f-notes").value.trim() || null,
  };
  if (!isEditing) payload.fiscal_year = currentFiscalYear;

  const saveButtons = box.querySelectorAll('button[type="submit"]');
  saveButtons.forEach((b) => (b.disabled = true));
  try {
    const url = isEditing ? `${API}/tm/assignments/${assignmentId}` : `${API}/tm/assignments`;
    const method = isEditing ? "PUT" : "POST";
    const resp = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      alert(formatApiError(err, "Failed to save this entry."));
      return;
    }
    tmEntryModal.hidden = true;
    await loadTmAssignments();
  } finally {
    saveButtons.forEach((b) => (b.disabled = false));
  }
});

document.getElementById("newTmEntryBtn").addEventListener("click", () => openTmEntryModal());

// ---------- Configuration: generic simple-list helper (Locations, Billing
// Models, Statuses, Employee Types, Bands, Opportunity Types) ----------
// Inline-edit table - no modal. Same toggle-in-place approach as the
// Customer Management table (buildCustomerRow()) and Revenue Management's
// grid: an Edit icon swaps a row into text inputs with Save/Cancel, and the
// "Add X" button prepends a blank row in that same editable state.
function makeInlineListManager(opts) {
  const { apiPath, tableBodyId, newBtnId, hasDetails, itemLabel, onChange, lockNameOnEdit, hideDelete } = opts;
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
         ${hideDelete ? "" : `<button type="button" class="ghost-btn btn-danger icon-btn inline-del-btn" title="Delete">${icon("trash")}</button>`}`;
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
      const delBtn = actionsTd.querySelector(".inline-del-btn");
      if (delBtn) {
        delBtn.addEventListener("click", async () => {
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
  hideDelete: true,
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
  hideDelete: true,
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
