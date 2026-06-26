const API_ROOT = "https://ll.thespacedevs.com/2.3.0/launches";
const CURRENT_YEAR = new Date().getFullYear();
const UPCOMING_URL = `${API_ROOT}/upcoming/?search=SpaceX&limit=18&ordering=net`;
const PREVIOUS_URL = `${API_ROOT}/previous/?search=SpaceX&limit=150&ordering=-net&net__gte=${CURRENT_YEAR}-01-01T00:00:00Z`;
const CACHE_KEY = "spacex-tracker-cache-v1";
const FAVORITES_KEY = "spacex-tracker-favorites";
const TZ_KEY = "spacex-tracker-timezone";
const VIEW_ORDER = ["home", "launches", "stats", "fleet"];
const SWIPE_THRESHOLD = 58;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const state = {
  upcoming: [],
  previous: [],
  launches: [],
  stats: {},
  source: "loading",
  lastUpdated: null,
  activeFilter: "all",
  search: "",
  timeZoneMode: localStorage.getItem(TZ_KEY) || "local",
  favorites: new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]")),
  deferredInstallPrompt: null,
  swipeStart: null,
};

const els = {
  main: document.querySelector("main"),
  navBars: document.querySelectorAll(".nav-tabs"),
  navTabs: document.querySelectorAll(".nav-tab"),
  jumpButtons: document.querySelectorAll("[data-view-jump]"),
  refreshButton: document.getElementById("refreshButton"),
  installButton: document.getElementById("installButton"),
  sourceLabel: document.getElementById("sourceLabel"),
  statusDot: document.getElementById("statusDot"),
  heroMetrics: document.getElementById("heroMetrics"),
  nextMissionCard: document.getElementById("nextMissionCard"),
  nextMissionName: document.getElementById("nextMissionName"),
  nextMissionTime: document.getElementById("nextMissionTime"),
  nextMissionPad: document.getElementById("nextMissionPad"),
  nextMissionStatus: document.getElementById("nextMissionStatus"),
  countdown: document.getElementById("countdown"),
  signalGrid: document.getElementById("signalGrid"),
  launchSearch: document.getElementById("launchSearch"),
  filterRow: document.getElementById("filterRow"),
  launchList: document.getElementById("launchList"),
  statGrid: document.getElementById("statGrid"),
  monthlyChart: document.getElementById("monthlyChart"),
  monthlyTotal: document.getElementById("monthlyTotal"),
  rocketMix: document.getElementById("rocketMix"),
  padGrid: document.getElementById("padGrid"),
  fleetOverview: document.getElementById("fleetOverview"),
  fleetGrid: document.getElementById("fleetGrid"),
  dataTimestamp: document.getElementById("dataTimestamp"),
  fleetTimestamp: document.getElementById("fleetTimestamp"),
  dialog: document.getElementById("missionDialog"),
  dialogContent: document.getElementById("dialogContent"),
  dialogClose: document.getElementById("dialogClose"),
  timeOptions: document.querySelectorAll(".time-option"),
};

init();

function init() {
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  bindUi();
  setTimeZoneButtons();
  setView(getInitialView(), { replace: true, scroll: false });
  window.scrollTo(0, 0);
  window.addEventListener("load", () => window.scrollTo(0, 0), { once: true });
  primeInitialData();
  loadData();
  window.setInterval(renderCountdown, 1000);
  registerServiceWorker();
}

function bindUi() {
  els.navTabs.forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  els.jumpButtons.forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.viewJump));
  });

  els.refreshButton.addEventListener("click", () => loadData({ force: true }));
  bindSwipeNavigation();

  els.launchSearch.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderLaunchList();
  });

  els.filterRow.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    state.activeFilter = button.dataset.filter;
    els.filterRow.querySelectorAll(".filter-chip").forEach((chip) => {
      chip.classList.toggle("is-active", chip === button);
    });
    renderLaunchList();
  });

  els.timeOptions.forEach((button) => {
    button.addEventListener("click", () => {
      state.timeZoneMode = button.dataset.zone;
      localStorage.setItem(TZ_KEY, state.timeZoneMode);
      setTimeZoneButtons();
      renderAll();
    });
  });

  els.dialogClose.addEventListener("click", () => els.dialog.close());
  els.dialog.addEventListener("click", (event) => {
    if (event.target === els.dialog) els.dialog.close();
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    els.installButton.hidden = false;
  });

  window.addEventListener("hashchange", () => {
    setView(getInitialView(), { replace: true, scroll: false });
  });

  els.installButton.addEventListener("click", async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    els.installButton.hidden = true;
  });
}

function getInitialView() {
  const viewName = window.location.hash.replace("#", "");
  return VIEW_ORDER.includes(viewName) && document.getElementById(viewName)?.classList.contains("view") ? viewName : "home";
}

function setView(viewName, options = {}) {
  const nextView = VIEW_ORDER.includes(viewName) ? viewName : "home";
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("is-active", view.id === nextView);
  });
  els.navTabs.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === nextView);
  });
  updateNavFlight(nextView);
  if (options.replace) {
    history.replaceState(null, "", `#${nextView}`);
  } else if (window.location.hash !== `#${nextView}`) {
    history.pushState(null, "", `#${nextView}`);
  }
  if (options.scroll !== false) {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function updateNavFlight(viewName) {
  const index = Math.max(0, VIEW_ORDER.indexOf(viewName));
  els.navBars.forEach((nav) => {
    nav.style.setProperty("--nav-index", index);
  });
}

function bindSwipeNavigation() {
  if (!els.main) return;

  els.main.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length !== 1 || shouldIgnoreSwipe(event.target)) {
        state.swipeStart = null;
        return;
      }
      const touch = event.touches[0];
      state.swipeStart = {
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now(),
      };
    },
    { passive: true },
  );

  els.main.addEventListener(
    "touchend",
    (event) => {
      if (!state.swipeStart || event.changedTouches.length !== 1) return;
      const touch = event.changedTouches[0];
      const deltaX = touch.clientX - state.swipeStart.x;
      const deltaY = touch.clientY - state.swipeStart.y;
      const duration = Date.now() - state.swipeStart.time;
      state.swipeStart = null;

      if (duration > 900) return;
      if (Math.abs(deltaX) < SWIPE_THRESHOLD) return;
      if (Math.abs(deltaX) < Math.abs(deltaY) * 1.35) return;

      setAdjacentView(deltaX < 0 ? 1 : -1);
    },
    { passive: true },
  );

  els.main.addEventListener(
    "touchcancel",
    () => {
      state.swipeStart = null;
    },
    { passive: true },
  );
}

function shouldIgnoreSwipe(target) {
  return Boolean(target.closest("a, button, input, textarea, select, dialog, .mission-dialog"));
}

function setAdjacentView(direction) {
  const activeView = document.querySelector(".view.is-active")?.id || getInitialView();
  const activeIndex = Math.max(0, VIEW_ORDER.indexOf(activeView));
  const nextIndex = (activeIndex + direction + VIEW_ORDER.length) % VIEW_ORDER.length;
  setView(VIEW_ORDER[nextIndex]);
}

function setRefreshState(isRefreshing) {
  els.refreshButton.classList.toggle("is-refreshing", isRefreshing);
  els.refreshButton.toggleAttribute("aria-busy", isRefreshing);
}

async function loadData({ force = false } = {}) {
  setRefreshState(true);
  setSourceState("loading");
  try {
    try {
      const [upcomingPayload, previousPayload] = await Promise.all([
        fetchJson(addCacheBust(UPCOMING_URL, force)),
        fetchJson(addCacheBust(PREVIOUS_URL, force)),
      ]);

      state.upcoming = cleanLaunches(upcomingPayload.results || []);
      state.previous = cleanLaunches(previousPayload.results || []);
      state.source = "live";
      state.lastUpdated = new Date().toISOString();
      writeCachedData();
    } catch (error) {
      const cached = readCachedData();
      if (cached) {
        state.upcoming = cached.upcoming;
        state.previous = cached.previous;
        state.lastUpdated = cached.lastUpdated;
        state.source = "cached";
      } else {
        const sample = buildSampleData();
        state.upcoming = sample.upcoming;
        state.previous = sample.previous;
        state.lastUpdated = sample.lastUpdated;
        state.source = "sample";
      }
    }

    state.launches = mergeLaunches(state.upcoming, state.previous);
    state.stats = deriveStats();
    renderAll();
  } finally {
    setRefreshState(false);
  }
}

function primeInitialData() {
  const cached = readCachedData();
  const initial = cached || buildSampleData();
  state.upcoming = initial.upcoming;
  state.previous = initial.previous;
  state.lastUpdated = initial.lastUpdated;
  state.source = cached ? "cached" : "sample";
  state.launches = mergeLaunches(state.upcoming, state.previous);
  state.stats = deriveStats();
  renderAll();
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 12000);
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: controller.signal,
  });
  window.clearTimeout(timeoutId);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

function addCacheBust(url, force) {
  if (!force) return url;
  return `${url}&_=${Date.now()}`;
}

function readCachedData() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (!cached || !Array.isArray(cached.upcoming) || !Array.isArray(cached.previous)) return null;
    return cached;
  } catch {
    return null;
  }
}

function writeCachedData() {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        upcoming: state.upcoming,
        previous: state.previous,
        lastUpdated: state.lastUpdated,
      }),
    );
  } catch {
    localStorage.removeItem(CACHE_KEY);
  }
}

function cleanLaunches(launches) {
  const seen = new Set();
  return launches
    .filter((launch) => launch && launch.id && launch.net)
    .filter((launch) => {
      if (seen.has(launch.id)) return false;
      seen.add(launch.id);
      return providerName(launch).toLowerCase().includes("spacex") || launch.name.toLowerCase().includes("spacex") || launch.name.toLowerCase().includes("falcon") || launch.name.toLowerCase().includes("starship");
    })
    .map(simplifyLaunch);
}

function simplifyLaunch(launch) {
  const agency = (launch.mission?.agencies || []).find((item) => item?.name === "SpaceX") || {};
  return {
    id: launch.id,
    name: launch.name,
    net: launch.net,
    status: pick(launch.status, ["name", "abbrev"]),
    agency_launch_attempt_count_year: launch.agency_launch_attempt_count_year,
    launch_service_provider: pick(launch.launch_service_provider, ["name", "abbrev"]),
    rocket: {
      configuration: pick(launch.rocket?.configuration, ["name", "full_name", "variant"]),
    },
    mission: {
      name: launch.mission?.name,
      type: launch.mission?.type,
      description: launch.mission?.description,
      orbit: pick(launch.mission?.orbit, ["name", "abbrev"]),
      agencies: [
        pick(agency, [
          "name",
          "total_launch_count",
          "successful_launches",
          "failed_launches",
          "pending_launches",
          "successful_landings",
          "attempted_landings",
          "consecutive_successful_launches",
          "consecutive_successful_landings",
        ]),
      ],
    },
    pad: {
      name: launch.pad?.name,
      location: pick(launch.pad?.location, ["name"]),
    },
    image: pick(launch.image, ["thumbnail_url", "image_url", "credit"]),
    info_urls: normalizeLinks(launch.info_urls),
    vid_urls: normalizeLinks(launch.vid_urls),
  };
}

function pick(source, keys) {
  if (!source) return {};
  return keys.reduce((result, key) => {
    if (source[key] !== undefined && source[key] !== null) result[key] = source[key];
    return result;
  }, {});
}

function normalizeLinks(links = []) {
  return links
    .map((link) => {
      if (typeof link === "string") return { url: link };
      return pick(link, ["url", "name"]);
    })
    .filter((link) => link.url)
    .slice(0, 3);
}

function mergeLaunches(upcoming, previous) {
  const byId = new Map();
  [...upcoming, ...previous].forEach((launch) => byId.set(launch.id, launch));
  return Array.from(byId.values()).sort((a, b) => new Date(b.net) - new Date(a.net));
}

function deriveStats() {
  const now = new Date();
  const all = state.launches;
  const agencyStats = findAgencyStats(all);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const previousCurrentYear = state.previous.filter((launch) => new Date(launch.net).getFullYear() === currentYear);
  const previousCurrentMonth = previousCurrentYear.filter((launch) => new Date(launch.net).getMonth() === currentMonth);
  const maxYearCount = Math.max(0, ...state.previous.map((launch) => Number(launch.agency_launch_attempt_count_year) || 0));
  const upcomingFuture = getFutureLaunches();
  const totalLaunches = Number(agencyStats.total_launch_count) || Math.max(0, state.previous.length);
  const successfulLaunches = Number(agencyStats.successful_launches) || state.previous.filter(isSuccess).length;
  const failedLaunches = Number(agencyStats.failed_launches) || state.previous.filter(isFailure).length;
  const attemptedLandings = Number(agencyStats.attempted_landings) || 0;
  const successfulLandings = Number(agencyStats.successful_landings) || 0;
  const yearLaunches = Math.max(maxYearCount, previousCurrentYear.length);

  return {
    totalLaunches,
    successfulLaunches,
    failedLaunches,
    pendingLaunches: Number(agencyStats.pending_launches) || upcomingFuture.length,
    yearLaunches,
    monthLaunches: previousCurrentMonth.length,
    upcomingCount: upcomingFuture.length,
    consecutiveSuccesses: Number(agencyStats.consecutive_successful_launches) || 0,
    consecutiveLandings: Number(agencyStats.consecutive_successful_landings) || 0,
    landingRate: attemptedLandings ? successfulLandings / attemptedLandings : 0,
    successRate: totalLaunches ? successfulLaunches / totalLaunches : 0,
    monthlyAverage: yearLaunches ? yearLaunches / (currentMonth + 1) : 0,
  };
}

function findAgencyStats(launches) {
  for (const launch of launches) {
    const agencies = launch.mission?.agencies || [];
    const match = agencies.find((agency) => agency?.name === "SpaceX" && agency.total_launch_count);
    if (match) return match;
  }
  return {};
}

function renderAll() {
  renderSource();
  renderHeroMetrics();
  renderNextMission();
  renderSignals();
  renderLaunchList();
  renderStats();
  renderFleet();
  renderTimestamps();
}

function renderSource() {
  const labels = {
    loading: "Preparing feed",
    live: "Live Launch Library feed",
    cached: "Cached launch feed",
    sample: "Offline sample feed",
  };
  els.sourceLabel.textContent = labels[state.source] || labels.sample;
  els.statusDot.className = "status-dot";
  if (state.source === "live") els.statusDot.classList.add("live");
  if (state.source === "cached") els.statusDot.classList.add("cached");
  if (state.source === "sample") els.statusDot.classList.add("offline");
}

function setSourceState(source) {
  state.source = source;
  renderSource();
}

function renderHeroMetrics() {
  const metrics = [
    ["Total launches", formatNumber(state.stats.totalLaunches), "累計打ち上げ回数"],
    ["This year", formatNumber(state.stats.yearLaunches), `${state.stats.monthlyAverage.toFixed(1)} / month pace`],
    ["Pending", formatNumber(state.stats.pendingLaunches), "予定ミッション"],
    ["Success rate", formatPercent(state.stats.successRate), `${formatNumber(state.stats.consecutiveSuccesses)} consecutive`],
  ];

  els.heroMetrics.innerHTML = metrics
    .map(
      ([label, value, foot]) => `
        <article class="metric-card">
          <div class="metric-label">${escapeHtml(label)}</div>
          <div class="metric-value">${escapeHtml(value)}</div>
          <div class="metric-foot">${escapeHtml(foot)}</div>
        </article>
      `,
    )
    .join("");
}

function renderNextMission() {
  const next = getNextLaunch();
  if (!next) {
    els.nextMissionName.textContent = "次回打ち上げは未取得";
    els.nextMissionTime.textContent = "--";
    els.nextMissionPad.textContent = "--";
    els.nextMissionStatus.textContent = "--";
    renderCountdown();
    return;
  }

  els.nextMissionName.textContent = shortLaunchName(next.name);
  els.nextMissionTime.textContent = formatDate(next.net);
  els.nextMissionPad.textContent = padName(next);
  els.nextMissionStatus.textContent = statusName(next);
  renderCountdown();
}

function renderCountdown() {
  const next = getNextLaunch();
  if (!next) {
    setLaunchUrgency(null);
    setCountdown(["--", "--", "--", "--"]);
    return;
  }
  const diff = new Date(next.net).getTime() - Date.now();
  setLaunchUrgency(diff);
  if (diff <= 0) {
    setCountdown(["00", "00", "00", "00"]);
    return;
  }
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  setCountdown([days, hours, minutes, seconds].map((part) => String(part).padStart(2, "0")));
}

function setCountdown(parts) {
  const labels = ["DAYS", "HRS", "MIN", "SEC"];
  if (els.countdown.children.length !== labels.length) {
    els.countdown.innerHTML = labels.map((label) => `<span><strong>--</strong><small>${label}</small></span>`).join("");
  }

  Array.from(els.countdown.children).forEach((cell, index) => {
    cell.querySelector("strong").textContent = parts[index];
    cell.querySelector("small").textContent = labels[index];
  });
}

function setLaunchUrgency(diff) {
  const isCounting = typeof diff === "number" && diff > 0;
  const isLaunchDay = isCounting && diff <= 86400000;
  const isFinalHour = isCounting && diff <= 3600000;
  els.nextMissionCard.classList.toggle("is-launch-day", isLaunchDay);
  els.nextMissionCard.classList.toggle("is-final-hour", isFinalHour);
}

function renderSignals() {
  const nextThree = getFutureLaunches().slice(0, 3);
  const recent = state.previous.slice(0, 3);
  const cards = [...nextThree, ...recent].slice(0, 6);

  if (!cards.length) {
    els.signalGrid.innerHTML = `<div class="empty-state">表示できる打ち上げデータがありません。</div>`;
    return;
  }

  els.signalGrid.innerHTML = cards
    .map((launch) => {
      const future = new Date(launch.net) > new Date();
      return `
        <article class="signal-card">
          <div class="signal-track">
            <span>${future ? "Upcoming" : "Recent"}</span>
            <span>${escapeHtml(statusName(launch))}</span>
          </div>
          <h3>${escapeHtml(shortLaunchName(launch.name))}</h3>
          <p>${escapeHtml(formatDate(launch.net))}</p>
          <p>${escapeHtml(rocketName(launch))} / ${escapeHtml(padName(launch))}</p>
        </article>
      `;
    })
    .join("");
}

function renderLaunchList() {
  const launches = filteredLaunches();
  if (!launches.length) {
    els.launchList.innerHTML = `<div class="empty-state">条件に合うミッションがありません。</div>`;
    return;
  }

  els.launchList.innerHTML = launches
    .map((launch) => {
      const image = imageUrl(launch);
      const active = state.favorites.has(launch.id);
      return `
        <article class="launch-card">
          <div class="launch-thumb">
            ${image ? `<img src="${escapeAttribute(image)}" alt="" loading="lazy" />` : ""}
          </div>
          <div class="launch-body">
            <div class="launch-meta">${escapeHtml(formatDate(launch.net))}</div>
            <h3>${escapeHtml(shortLaunchName(launch.name))}</h3>
            <div class="launch-line">
              <span class="pill ${statusClass(launch)}">${escapeHtml(statusName(launch))}</span>
              <span>${escapeHtml(rocketName(launch))}</span>
              <span>${escapeHtml(orbitName(launch))}</span>
              <span>${escapeHtml(padName(launch))}</span>
            </div>
          </div>
          <div class="launch-actions">
            <button class="favorite-button ${active ? "is-active" : ""}" type="button" aria-label="お気に入り" data-favorite="${escapeAttribute(launch.id)}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.8 2.5 5.1 5.6.8-4 3.9.9 5.5-5-2.6-5 2.6.9-5.5-4-3.9 5.6-.8z" /></svg>
            </button>
            <button class="ghost-button" type="button" data-detail="${escapeAttribute(launch.id)}">Details</button>
          </div>
        </article>
      `;
    })
    .join("");

  els.launchList.querySelectorAll("[data-favorite]").forEach((button) => {
    button.addEventListener("click", () => toggleFavorite(button.dataset.favorite));
  });

  els.launchList.querySelectorAll("[data-detail]").forEach((button) => {
    button.addEventListener("click", () => showMissionDetail(button.dataset.detail));
  });
}

function filteredLaunches() {
  const now = new Date();
  const query = state.search;
  return state.launches
    .filter((launch) => {
      if (state.activeFilter === "upcoming") return new Date(launch.net) > now;
      if (state.activeFilter === "starlink") return launchText(launch).includes("starlink");
      if (state.activeFilter === "falcon9") return launchText(launch).includes("falcon 9");
      if (state.activeFilter === "starship") return launchText(launch).includes("starship");
      if (state.activeFilter === "favorites") return state.favorites.has(launch.id);
      return true;
    })
    .filter((launch) => (query ? launchText(launch).includes(query) : true))
    .sort((a, b) => {
      const aFuture = new Date(a.net) > now;
      const bFuture = new Date(b.net) > now;
      if (aFuture && bFuture) return new Date(a.net) - new Date(b.net);
      if (aFuture) return -1;
      if (bFuture) return 1;
      return new Date(b.net) - new Date(a.net);
    })
    .slice(0, 60);
}

function renderStats() {
  const statCards = [
    ["累計打ち上げ", formatNumber(state.stats.totalLaunches), "Launch Library agency total"],
    ["今年の打ち上げ", formatNumber(state.stats.yearLaunches), `${new Date().getFullYear()} completed`],
    ["今月", formatNumber(state.stats.monthLaunches), "completed launches"],
    ["着陸成功率", formatPercent(state.stats.landingRate), `${formatNumber(state.stats.consecutiveLandings)} consecutive landings`],
  ];

  els.statGrid.innerHTML = statCards
    .map(
      ([label, value, foot]) => `
        <article class="stat-card">
          <div class="stat-label">${escapeHtml(label)}</div>
          <div class="stat-value">${escapeHtml(value)}</div>
          <div class="stat-foot">${escapeHtml(foot)}</div>
        </article>
      `,
    )
    .join("");

  renderMonthlyChart();
  renderRocketMix();
  renderPadGrid();
}

function renderMonthlyChart() {
  const now = new Date();
  const year = now.getFullYear();
  const counts = Array.from({ length: 12 }, () => ({ actual: 0, planned: 0 }));
  state.previous.forEach((launch) => {
    const date = new Date(launch.net);
    if (date.getFullYear() === year) counts[date.getMonth()].actual += 1;
  });
  getFutureLaunches().forEach((launch) => {
    const date = new Date(launch.net);
    if (date.getFullYear() === year) counts[date.getMonth()].planned += 1;
  });

  const max = Math.max(1, ...counts.map((item) => item.actual + item.planned));
  const totalActual = counts.reduce((sum, item) => sum + item.actual, 0);
  const totalPlanned = counts.reduce((sum, item) => sum + item.planned, 0);
  els.monthlyTotal.textContent = `${totalActual} done / ${totalPlanned} planned`;
  els.monthlyChart.innerHTML = counts
    .map((item, index) => {
      const total = item.actual + item.planned;
      const actualWidth = (item.actual / max) * 100;
      const plannedWidth = (item.planned / max) * 100;
      return `
        <div class="bar-row">
          <span class="bar-label">${MONTH_LABELS[index]}</span>
          <span class="bar-track">
            <span class="bar-fill ${item.actual ? "" : "is-empty"}" style="width: ${actualWidth}%"></span>
            <span class="bar-fill is-planned ${item.planned ? "" : "is-empty"}" style="width: ${plannedWidth}%"></span>
          </span>
          <span class="bar-value">${total}</span>
        </div>
      `;
    })
    .join("");
}

function renderRocketMix() {
  const groups = groupBy(state.launches, rocketName);
  const rows = Object.entries(groups)
    .map(([name, items]) => ({ name, count: items.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 7);
  const max = Math.max(1, ...rows.map((row) => row.count));
  els.rocketMix.innerHTML = rows
    .map(
      (row) => `
        <div class="mix-row">
          <span class="mix-label">${escapeHtml(compactName(row.name))}</span>
          <span class="mix-track"><span class="mix-fill ${row.count ? "" : "is-empty"}" style="width: ${(row.count / max) * 100}%"></span></span>
          <span class="mix-value">${row.count}</span>
        </div>
      `,
    )
    .join("");
}

function renderPadGrid() {
  const groups = groupBy(state.launches, padName);
  const pads = Object.entries(groups)
    .map(([name, items]) => ({ name, count: items.length, last: items[0] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  els.padGrid.innerHTML = pads
    .map(
      (pad) => `
        <article class="pad-item">
          <strong>${escapeHtml(compactName(pad.name))}</strong>
          <span>${pad.count} launches in loaded window</span>
          <span>${escapeHtml(pad.last?.pad?.location?.name || "")}</span>
        </article>
      `,
    )
    .join("");
}

function renderFleet() {
  const overviewCards = [
    ["Launch success", formatPercent(state.stats.successRate), `${formatNumber(state.stats.successfulLaunches)} successful launches`],
    ["Landing success", formatPercent(state.stats.landingRate), "booster and spacecraft landings"],
    ["Pending manifest", formatNumber(state.stats.pendingLaunches), "future SpaceX launches"],
  ];

  els.fleetOverview.innerHTML = overviewCards
    .map(
      ([title, value, foot]) => `
        <article class="fleet-overview-card">
          <div class="fleet-meta">${escapeHtml(title)}</div>
          <h3>${escapeHtml(value)}</h3>
          <p class="metric-foot">${escapeHtml(foot)}</p>
        </article>
      `,
    )
    .join("");

  const groups = groupBy(state.launches, rocketName);
  const rows = Object.entries(groups)
    .map(([name, launches]) => {
      const successes = launches.filter(isSuccess).length;
      const rate = launches.length ? successes / launches.length : 0;
      const latest = launches.sort((a, b) => new Date(b.net) - new Date(a.net))[0];
      return { name, launches, successes, rate, latest };
    })
    .sort((a, b) => b.launches.length - a.launches.length)
    .slice(0, 6);

  els.fleetGrid.innerHTML = rows
    .map(
      (row) => `
        <article class="fleet-card">
          <div class="fleet-meta">${row.launches.length} loaded launches</div>
          <h3>${escapeHtml(row.name)}</h3>
          <p class="metric-foot">Latest: ${escapeHtml(shortLaunchName(row.latest?.name || "--"))}</p>
          <p class="metric-foot">${escapeHtml(formatDate(row.latest?.net))}</p>
          <div class="fleet-meter" aria-label="Success share"><span style="width: ${Math.max(5, row.rate * 100)}%"></span></div>
        </article>
      `,
    )
    .join("");
}

function renderTimestamps() {
  const label = state.lastUpdated ? `Updated ${formatDate(state.lastUpdated)}` : "--";
  els.dataTimestamp.textContent = label;
  els.fleetTimestamp.textContent = label;
}

function setTimeZoneButtons() {
  els.timeOptions.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.zone === state.timeZoneMode);
  });
}

function getNextLaunch() {
  return getFutureLaunches()[0] || null;
}

function getFutureLaunches() {
  const now = new Date();
  return state.upcoming
    .filter((launch) => new Date(launch.net) > now)
    .sort((a, b) => new Date(a.net) - new Date(b.net));
}

function toggleFavorite(id) {
  if (state.favorites.has(id)) {
    state.favorites.delete(id);
  } else {
    state.favorites.add(id);
  }
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(state.favorites)));
  renderLaunchList();
}

function showMissionDetail(id) {
  const launch = state.launches.find((item) => item.id === id);
  if (!launch) return;
  const image = imageUrl(launch) || "assets/launch-hero.png";
  const infoLinks = [...(launch.info_urls || []), ...(launch.vid_urls || [])];
  els.dialogContent.innerHTML = `
    <div class="dialog-hero" style="--dialog-image: url('${escapeAttribute(image)}')"></div>
    <div class="dialog-body">
      <span class="pill ${statusClass(launch)}">${escapeHtml(statusName(launch))}</span>
      <h2>${escapeHtml(shortLaunchName(launch.name))}</h2>
      <div class="dialog-meta">${escapeHtml(formatDate(launch.net))}</div>
      <p>${escapeHtml(launch.mission?.description || "ミッション概要はまだ登録されていません。")}</p>
      <div class="dialog-grid">
        <div><dt>Rocket</dt><dd>${escapeHtml(rocketName(launch))}</dd></div>
        <div><dt>Orbit</dt><dd>${escapeHtml(orbitName(launch))}</dd></div>
        <div><dt>Pad</dt><dd>${escapeHtml(padName(launch))}</dd></div>
        <div><dt>Provider</dt><dd>${escapeHtml(providerName(launch))}</dd></div>
      </div>
      ${
        infoLinks.length
          ? `<p><a href="${escapeAttribute(infoLinks[0].url)}" target="_blank" rel="noreferrer">関連リンクを開く</a></p>`
          : ""
      }
    </div>
  `;
  els.dialog.showModal();
}

function buildSampleData() {
  const now = Date.now();
  const days = 86400000;
  const makeLaunch = (id, offset, name, status, rocket, pad, missionType = "Communications") => ({
    id,
    name,
    net: new Date(now + offset * days).toISOString(),
    status,
    launch_service_provider: { name: "SpaceX" },
    rocket: { configuration: { name: rocket, full_name: rocket } },
    mission: {
      name: name.split("|")[1]?.trim() || name,
      type: missionType,
      description: "SpaceXミッションのサンプルデータです。オンラインになるとLaunch Library 2の実データに置き換わります。",
      orbit: { name: "Low Earth Orbit", abbrev: "LEO" },
      agencies: [
        {
          name: "SpaceX",
          total_launch_count: 695,
          successful_launches: 680,
          failed_launches: 15,
          pending_launches: 134,
          successful_landings: 640,
          attempted_landings: 667,
          consecutive_successful_launches: 180,
          consecutive_successful_landings: 16,
        },
      ],
    },
    pad: { name: pad, location: { name: "USA" } },
    agency_launch_attempt_count_year: 76,
  });

  return {
    lastUpdated: new Date().toISOString(),
    upcoming: [
      makeLaunch("sample-up-1", 2, "Falcon 9 Block 5 | Starlink Group 17-40", { name: "Go for Launch", abbrev: "Go" }, "Falcon 9 Block 5", "Space Launch Complex 4E"),
      makeLaunch("sample-up-2", 7, "Falcon 9 Block 5 | Commercial Mission", { name: "To Be Confirmed", abbrev: "TBC" }, "Falcon 9 Block 5", "Space Launch Complex 40"),
      makeLaunch("sample-up-3", 16, "Starship | Flight Test", { name: "To Be Determined", abbrev: "TBD" }, "Starship", "Orbital Launch Mount A", "Test Flight"),
    ],
    previous: [
      makeLaunch("sample-prev-1", -1, "Falcon 9 Block 5 | Starlink Group 17-45", { name: "Launch Successful", abbrev: "Success" }, "Falcon 9 Block 5", "Space Launch Complex 4E"),
      makeLaunch("sample-prev-2", -5, "Falcon 9 Block 5 | Starlink Group 10-50", { name: "Launch Successful", abbrev: "Success" }, "Falcon 9 Block 5", "Space Launch Complex 40"),
      makeLaunch("sample-prev-3", -9, "Falcon 9 Block 5 | Cargo Dragon", { name: "Launch Successful", abbrev: "Success" }, "Falcon 9 Block 5", "Launch Complex 39A", "Resupply"),
      makeLaunch("sample-prev-4", -16, "Falcon Heavy | National Security Mission", { name: "Launch Successful", abbrev: "Success" }, "Falcon Heavy", "Launch Complex 39A", "Government"),
    ],
  };
}

function groupBy(items, getter) {
  return items.reduce((groups, item) => {
    const key = getter(item) || "Unknown";
    groups[key] ||= [];
    groups[key].push(item);
    return groups;
  }, {});
}

function launchText(launch) {
  return [
    launch.name,
    rocketName(launch),
    padName(launch),
    orbitName(launch),
    statusName(launch),
    launch.mission?.type,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function shortLaunchName(name = "") {
  return name.replace(/^Falcon 9 Block 5 \| /, "Falcon 9 | ").replace(/^Falcon Heavy \| /, "Falcon Heavy | ");
}

function compactName(name = "") {
  return name.replace("Space Launch Complex", "SLC").replace("Launch Complex", "LC").replace("Falcon 9 Block 5", "Falcon 9");
}

function providerName(launch) {
  return launch.launch_service_provider?.name || launch.mission?.agencies?.[0]?.name || "SpaceX";
}

function rocketName(launch) {
  return launch.rocket?.configuration?.full_name || launch.rocket?.configuration?.name || "Unknown rocket";
}

function padName(launch) {
  return launch.pad?.name || launch.pad?.location?.name || "Pad TBD";
}

function orbitName(launch) {
  return launch.mission?.orbit?.abbrev || launch.mission?.orbit?.name || launch.mission?.type || "Orbit TBD";
}

function statusName(launch) {
  return launch.status?.abbrev || launch.status?.name || "TBD";
}

function statusClass(launch) {
  const text = statusName(launch).toLowerCase();
  if (text.includes("success")) return "success";
  if (text.includes("go")) return "go";
  if (text.includes("fail")) return "failure";
  return "tbd";
}

function isSuccess(launch) {
  return statusName(launch).toLowerCase().includes("success");
}

function isFailure(launch) {
  return statusName(launch).toLowerCase().includes("fail");
}

function imageUrl(launch) {
  return launch.image?.thumbnail_url || launch.image?.image_url || launch.mission?.image?.thumbnail_url || "";
}

function formatDate(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  const options = {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };
  if (date.getFullYear() !== new Date().getFullYear()) options.year = "numeric";
  if (state.timeZoneMode === "jst") options.timeZone = "Asia/Tokyo";
  if (state.timeZoneMode === "utc") options.timeZone = "UTC";
  options.timeZoneName = "short";
  return new Intl.DateTimeFormat("ja-JP", options).format(date);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Math.round(Number(value) || 0));
}

function formatPercent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
  });
}
