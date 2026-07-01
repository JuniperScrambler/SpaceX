const API_ROOT = "https://ll.thespacedevs.com/2.3.0/launches";
const CURRENT_YEAR = new Date().getFullYear();
const UPCOMING_URL = `${API_ROOT}/upcoming/?search=SpaceX&limit=18&ordering=net`;
const PREVIOUS_URL = `${API_ROOT}/previous/?search=SpaceX&limit=150&ordering=-net&net__gte=${CURRENT_YEAR}-01-01T00:00:00Z`;
const CACHE_KEY = "spacex-tracker-cache-v1";
const FAVORITES_KEY = "spacex-tracker-favorites";
const TZ_KEY = "spacex-tracker-timezone";
const SNAPSHOT_KEY = "spacex-tracker-launch-snapshot-v1";
const CHANGE_EVENTS_KEY = "spacex-tracker-change-events-v1";
const NOTIFICATIONS_KEY = "spacex-tracker-notifications";
const NOTIFIED_KEY = "spacex-tracker-notified-events-v1";
const VIEW_ORDER = ["home", "launches", "stats", "fleet"];
const SWIPE_THRESHOLD = 58;
const PAGE_SIZE = 10;
const MONTH_LABELS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

const state = {
  upcoming: [],
  previous: [],
  launches: [],
  stats: {},
  source: "loading",
  lastUpdated: null,
  activeFilter: "upcoming",
  search: "",
  visibleLaunchCount: PAGE_SIZE,
  changes: readStoredChanges(),
  timeZoneMode: localStorage.getItem(TZ_KEY) || "local",
  favorites: new Set(readStoredArray(FAVORITES_KEY)),
  notificationsEnabled: localStorage.getItem(NOTIFICATIONS_KEY) === "enabled",
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
  headerFreshness: document.getElementById("headerFreshness"),
  sourceLabel: document.getElementById("sourceLabel"),
  statusDot: document.getElementById("statusDot"),
  heroMetrics: document.getElementById("heroMetrics"),
  nextMissionCard: document.getElementById("nextMissionCard"),
  nextMissionName: document.getElementById("nextMissionName"),
  nextMissionTime: document.getElementById("nextMissionTime"),
  nextMissionPad: document.getElementById("nextMissionPad"),
  nextMissionStatus: document.getElementById("nextMissionStatus"),
  nextMissionLinks: document.getElementById("nextMissionLinks"),
  countdown: document.getElementById("countdown"),
  changeList: document.getElementById("changeList"),
  changesUpdatedAt: document.getElementById("changesUpdatedAt"),
  ackChangesButton: document.getElementById("ackChangesButton"),
  upcomingWeekGrid: document.getElementById("upcomingWeekGrid"),
  recentResultGrid: document.getElementById("recentResultGrid"),
  notificationButton: document.getElementById("notificationButton"),
  notificationNote: document.getElementById("notificationNote"),
  launchSearch: document.getElementById("launchSearch"),
  filterRow: document.getElementById("filterRow"),
  launchList: document.getElementById("launchList"),
  launchListSummary: document.getElementById("launchListSummary"),
  loadMoreButton: document.getElementById("loadMoreButton"),
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
  updateNotificationUi();
  setView(getInitialView(), { replace: true, scroll: false });
  window.scrollTo(0, 0);
  window.addEventListener("load", () => window.scrollTo(0, 0), { once: true });
  primeInitialData();
  loadData();
  window.setInterval(renderCountdown, 1000);
  window.setInterval(checkFavoriteNotifications, 60000);
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

  els.filterRow.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.setAttribute("aria-pressed", String(chip.dataset.filter === state.activeFilter));
  });

  els.launchSearch.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    state.visibleLaunchCount = PAGE_SIZE;
    renderLaunchList();
  });

  els.filterRow.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    state.activeFilter = button.dataset.filter;
    state.visibleLaunchCount = PAGE_SIZE;
    els.filterRow.querySelectorAll(".filter-chip").forEach((chip) => {
      chip.classList.toggle("is-active", chip === button);
      chip.setAttribute("aria-pressed", String(chip === button));
    });
    renderLaunchList();
  });

  els.loadMoreButton.addEventListener("click", () => {
    state.visibleLaunchCount += PAGE_SIZE;
    renderLaunchList();
  });

  els.ackChangesButton.addEventListener("click", acknowledgeChanges);
  els.notificationButton.addEventListener("click", enableNotifications);

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
    const isActive = button.dataset.view === nextView;
    button.classList.toggle("is-active", isActive);
    if (isActive) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
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
  
  // スワイプ方向（前進/後退）を検出して main 要素にクラスを付与
  const mainEl = document.querySelector("main");
  if (mainEl) {
    mainEl.classList.remove("swipe-left", "swipe-right");
    // direction > 0 は左スワイプ（次のビュー、右から入る）
    if (direction > 0) {
      mainEl.classList.add("swipe-left");
    } else {
      mainEl.classList.add("swipe-right");
    }
  }

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
      console.error("SpaceX Tracker load failed:", error);
      const isRateLimit = error.message && error.message.includes("429");
      const cached = readCachedData();
      if (cached) {
        state.upcoming = cached.upcoming;
        state.previous = cached.previous;
        state.lastUpdated = cached.lastUpdated;
        state.source = isRateLimit ? "rate-limited-cache" : "cached";
      } else {
        const sample = buildSampleData();
        state.upcoming = sample.upcoming;
        state.previous = sample.previous;
        state.lastUpdated = sample.lastUpdated;
        state.source = isRateLimit ? "rate-limited-sample" : "sample";
      }
    }

    state.launches = mergeLaunches(state.upcoming, state.previous);
    if (state.source === "live") processLaunchChanges();
    state.stats = deriveStats();
    renderAll();
    checkFavoriteNotifications();
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

function readStoredArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function readStoredChanges() {
  const oldest = Date.now() - 7 * 86400000;
  return readStoredArray(CHANGE_EVENTS_KEY).filter((change) => new Date(change.detectedAt).getTime() >= oldest);
}

function readLaunchSnapshot() {
  return readStoredArray(SNAPSHOT_KEY);
}

function writeLaunchSnapshot(launches) {
  const snapshot = launches.map((launch) => ({
    id: launch.id,
    name: launch.name,
    net: launch.net,
    status: rawStatusName(launch),
  }));
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
}

function processLaunchChanges() {
  const previousSnapshot = readLaunchSnapshot();
  const detected = previousSnapshot.length ? detectLaunchChanges(previousSnapshot, state.launches) : [];
  if (detected.length) {
    state.changes = detected;
    localStorage.setItem(CHANGE_EVENTS_KEY, JSON.stringify(detected));
    notifyFavoriteChanges(detected);
  }
  writeLaunchSnapshot(state.launches);
}

function detectLaunchChanges(previousSnapshot, currentLaunches) {
  const previousById = new Map(previousSnapshot.map((launch) => [launch.id, launch]));
  const now = Date.now();
  const newMissionLimit = now + 30 * 86400000;
  const detectedAt = new Date().toISOString();
  const changes = [];

  currentLaunches.forEach((launch) => {
    const previous = previousById.get(launch.id);
    const launchTime = new Date(launch.net).getTime();
    if (!previous) {
      if (launchTime > now && launchTime <= newMissionLimit) {
        changes.push({ id: launch.id, type: "new", label: "新規", name: launch.name, after: launch.net, detectedAt });
      }
      return;
    }

    const beforeTime = new Date(previous.net).getTime();
    if (Number.isFinite(beforeTime) && Number.isFinite(launchTime) && Math.abs(launchTime - beforeTime) >= 60000) {
      changes.push({ id: launch.id, type: "time", label: "時刻変更", name: launch.name, before: previous.net, after: launch.net, detectedAt });
    }

    const beforeStatus = String(previous.status || "").toLowerCase();
    const afterStatus = rawStatusName(launch);
    if (beforeStatus && afterStatus && beforeStatus !== afterStatus.toLowerCase()) {
      changes.push({ id: launch.id, type: "status", label: "状態更新", name: launch.name, before: previous.status, after: afterStatus, detectedAt });
    }
  });

  return changes
    .sort((a, b) => changePriority(a.type) - changePriority(b.type))
    .slice(0, 12);
}

function changePriority(type) {
  if (type === "status") return 0;
  if (type === "time") return 1;
  return 2;
}

function changeDetail(change) {
  if (change.type === "time") return `${formatDate(change.before)} → ${formatDate(change.after)}`;
  if (change.type === "status") return `${statusLabel(change.before)} → ${statusLabel(change.after)}`;
  if (change.type === "new") return `${formatDate(change.after)}の予定として追加`;
  return "情報が更新されました";
}

function acknowledgeChanges() {
  state.changes = [];
  localStorage.removeItem(CHANGE_EVENTS_KEY);
  renderChanges();
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
      const item = typeof link === "string" ? { url: link } : pick(link, ["url", "name"]);
      return { ...item, url: safeExternalUrl(item.url) };
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
  renderChanges();
  renderActivity();
  renderLaunchList();
  renderStats();
  renderFleet();
  renderTimestamps();
  updateNotificationUi();
}

function renderSource() {
  const labels = {
    loading: "データ取得中",
    live: "Launch Libraryから取得済み",
    cached: "保存済みデータを表示中",
    sample: "サンプルデータを表示中",
    "rate-limited-cache": "API制限中 (キャッシュ表示)",
    "rate-limited-sample": "API制限中 (サンプル表示)",
  };
  const sourceText = labels[state.source] || labels.sample;
  const updatedText = state.lastUpdated ? `・最終更新 ${formatDate(state.lastUpdated)}` : "";
  els.sourceLabel.textContent = `${sourceText}${updatedText}`;
  els.statusDot.className = "status-dot";
  els.headerFreshness.className = "header-freshness";
  if (state.source === "live") els.statusDot.classList.add("live");
  if (state.source === "cached" || state.source === "rate-limited-cache") {
    els.statusDot.classList.add("cached");
    els.headerFreshness.classList.add("is-cached");
  }
  if (state.source === "sample" || state.source === "rate-limited-sample") {
    els.statusDot.classList.add("offline");
    els.headerFreshness.classList.add("is-offline");
  }
  if (state.source === "loading") els.headerFreshness.classList.add("is-loading");

  const freshnessLabels = {
    loading: "データ取得中",
    live: state.lastUpdated ? `ライブ・${formatClock(state.lastUpdated)}` : "ライブデータ",
    cached: state.lastUpdated ? `保存データ・${formatAge(state.lastUpdated)}` : "保存データ",
    sample: "サンプル表示",
    "rate-limited-cache": "API制限・保存データ",
    "rate-limited-sample": "API制限・サンプル",
  };
  els.headerFreshness.textContent = freshnessLabels[state.source] || "状態不明";
}

function setSourceState(source) {
  state.source = source;
  renderSource();
}

function renderHeroMetrics() {
  const metrics = [
    ["累計打ち上げ", formatNumber(state.stats.totalLaunches), "SpaceXの累計実績"],
    ["今年の打ち上げ", formatNumber(state.stats.yearLaunches), `月平均 ${state.stats.monthlyAverage.toFixed(1)} 回ペース`],
    ["予定ミッション", formatNumber(state.stats.pendingLaunches), "今後の登録済み打ち上げ"],
    ["成功率", formatPercent(state.stats.successRate), `${formatNumber(state.stats.consecutiveSuccesses)}回連続成功`],
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
    els.nextMissionLinks.innerHTML = "";
    renderCountdown();
    return;
  }

  els.nextMissionName.textContent = shortLaunchName(next.name);
  els.nextMissionTime.textContent = formatDate(next.net);
  els.nextMissionPad.textContent = padName(next);
  els.nextMissionStatus.textContent = statusName(next);
  renderNextMissionLinks(next);
  renderCountdown();
}

function renderNextMissionLinks(launch) {
  const video = launch.vid_urls?.[0];
  const info = launch.info_urls?.find((link) => link.url !== video?.url) || launch.info_urls?.[0];
  const links = [];
  if (video?.url) links.push(`<a class="mission-link primary" href="${escapeAttribute(video.url)}" target="_blank" rel="noopener noreferrer">配信を見る</a>`);
  if (info?.url) links.push(`<a class="mission-link" href="${escapeAttribute(info.url)}" target="_blank" rel="noopener noreferrer">公式・関連情報</a>`);
  links.push(`<button class="mission-link" type="button" data-next-detail="${escapeAttribute(launch.id)}">ミッション詳細</button>`);
  els.nextMissionLinks.innerHTML = links.join("");
  els.nextMissionLinks.querySelector("[data-next-detail]")?.addEventListener("click", () => showMissionDetail(launch.id));
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
  const labels = ["日", "時間", "分", "秒"];
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

function renderChanges() {
  const changes = state.changes || [];
  els.ackChangesButton.hidden = changes.length === 0;
  els.changesUpdatedAt.textContent = changes[0]?.detectedAt ? `検出 ${formatAge(changes[0].detectedAt)}` : "現在まで";
  if (!changes.length) {
    els.changeList.innerHTML = `<div class="empty-state">前回の確認以降、大きな変更はありません。</div>`;
    return;
  }

  els.changeList.innerHTML = changes
    .slice(0, 8)
    .map(
      (change) => `
        <article class="change-item">
          <span class="change-type ${escapeAttribute(change.type)}">${escapeHtml(change.label)}</span>
          <div class="change-copy">
            <strong>${escapeHtml(shortLaunchName(change.name))}</strong>
            <span>${escapeHtml(changeDetail(change))}</span>
          </div>
          <span class="change-detected">${escapeHtml(formatAge(change.detectedAt))}</span>
        </article>
      `,
    )
    .join("");
}

function renderActivity() {
  const now = Date.now();
  const sevenDays = now + 7 * 86400000;
  const upcomingWeek = getFutureLaunches().filter((launch) => new Date(launch.net).getTime() <= sevenDays).slice(0, 4);
  const recentResults = [...state.previous].sort((a, b) => new Date(b.net) - new Date(a.net)).slice(0, 4);
  els.upcomingWeekGrid.innerHTML = renderActivityCards(upcomingWeek, "7日以内に登録された打ち上げはありません。");
  els.recentResultGrid.innerHTML = renderActivityCards(recentResults, "最近の打ち上げ結果を取得できませんでした。");
}

function renderActivityCards(launches, emptyMessage) {
  if (!launches.length) return `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
  return launches
    .map((launch) => {
      const future = new Date(launch.net) > new Date();
      return `
        <article class="signal-card">
          <div class="signal-track">
            <span>${future ? "予定" : "実績"}</span>
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
  const filtered = filteredLaunches();
  const launches = filtered.slice(0, state.visibleLaunchCount);
  els.launchListSummary.textContent = `${filtered.length}件中 ${launches.length}件を表示`;
  els.loadMoreButton.hidden = launches.length >= filtered.length;
  if (!filtered.length) {
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
            <button class="ghost-button" type="button" data-detail="${escapeAttribute(launch.id)}">詳細</button>
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
      if (state.activeFilter === "completed") return new Date(launch.net) <= now;
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
    });
}

function renderStats() {
  const statCards = [
    ["累計打ち上げ", formatNumber(state.stats.totalLaunches), "Launch LibraryのSpaceX集計"],
    ["今年の打ち上げ", formatNumber(state.stats.yearLaunches), `${new Date().getFullYear()}年の完了数`],
    ["今月", formatNumber(state.stats.monthLaunches), "今月の完了済み打ち上げ"],
    ["着陸成功率", formatPercent(state.stats.landingRate), `${formatNumber(state.stats.consecutiveLandings)}回連続着陸成功`],
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
  els.monthlyTotal.textContent = `${totalActual}回完了 / ${totalPlanned}回予定`;
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
          <span>取得範囲で${pad.count}回</span>
          <span>${escapeHtml(pad.last?.pad?.location?.name || "")}</span>
        </article>
      `,
    )
    .join("");
}

function renderFleet() {
  const overviewCards = [
    ["打ち上げ成功率", formatPercent(state.stats.successRate), `${formatNumber(state.stats.successfulLaunches)}回の成功実績`],
    ["着陸成功率", formatPercent(state.stats.landingRate), "ブースター/宇宙船の着陸実績"],
    ["予定ミッション", formatNumber(state.stats.pendingLaunches), "今後のSpaceX打ち上げ"],
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
          <div class="fleet-meta">取得範囲 ${row.launches.length}件</div>
          <h3>${escapeHtml(row.name)}</h3>
          <p class="metric-foot">最新: ${escapeHtml(shortLaunchName(row.latest?.name || "--"))}</p>
          <p class="metric-foot">${escapeHtml(formatDate(row.latest?.net))}</p>
          <div class="fleet-meter" aria-label="成功割合"><span style="width: ${Math.max(5, row.rate * 100)}%"></span></div>
        </article>
      `,
    )
    .join("");
}

function renderTimestamps() {
  const label = state.lastUpdated ? `更新 ${formatDate(state.lastUpdated)}` : "--";
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

async function enableNotifications() {
  if (!notificationsAvailable()) {
    els.notificationNote.textContent = "このブラウザでは通知を利用できません。iPhoneではホーム画面に追加したPWAから設定してください。";
    updateNotificationUi();
    return;
  }

  if (state.notificationsEnabled) {
    state.notificationsEnabled = false;
    localStorage.removeItem(NOTIFICATIONS_KEY);
    updateNotificationUi();
    return;
  }

  const permission = await Notification.requestPermission();
  state.notificationsEnabled = permission === "granted";
  if (state.notificationsEnabled) {
    localStorage.setItem(NOTIFICATIONS_KEY, "enabled");
    els.notificationNote.textContent = "通知を有効にしました。お気に入りの24時間前・1時間前と予定変更を確認します。";
    checkFavoriteNotifications();
  } else {
    localStorage.removeItem(NOTIFICATIONS_KEY);
    els.notificationNote.textContent = "通知が許可されていません。端末の設定から変更できます。";
  }
  updateNotificationUi();
}

function notificationsAvailable() {
  return "Notification" in window && "serviceWorker" in navigator;
}

function updateNotificationUi() {
  const available = notificationsAvailable();
  const granted = available && Notification.permission === "granted";
  if (state.notificationsEnabled && !granted) {
    state.notificationsEnabled = false;
    localStorage.removeItem(NOTIFICATIONS_KEY);
  }
  els.notificationButton.disabled = !available;
  els.notificationButton.classList.toggle("is-enabled", state.notificationsEnabled);
  els.notificationButton.textContent = !available
    ? "通知はPWAで利用できます"
    : state.notificationsEnabled
      ? "お気に入り通知を停止"
      : "お気に入り通知を有効化";
}

async function checkFavoriteNotifications() {
  if (!state.notificationsEnabled || !notificationsAvailable() || Notification.permission !== "granted") return;
  const now = Date.now();
  const notified = new Set(readStoredArray(NOTIFIED_KEY));
  const upcomingFavorites = getFutureLaunches().filter((launch) => state.favorites.has(launch.id));

  for (const launch of upcomingFavorites) {
    const remaining = new Date(launch.net).getTime() - now;
    if (remaining <= 0 || remaining > 86400000) continue;
    const threshold = remaining <= 3600000 ? "1h" : "24h";
    const key = `${launch.id}:${threshold}:${launch.net}`;
    if (notified.has(key)) continue;
    const timing = threshold === "1h" ? "1時間以内" : "24時間以内";
    await displayNotification(`SpaceX打ち上げ ${timing}`, `${shortLaunchName(launch.name)}\n${formatDate(launch.net)}`, key);
    notified.add(key);
  }

  localStorage.setItem(NOTIFIED_KEY, JSON.stringify(Array.from(notified).slice(-100)));
}

async function notifyFavoriteChanges(changes) {
  if (!state.notificationsEnabled || !notificationsAvailable() || Notification.permission !== "granted") return;
  const notified = new Set(readStoredArray(NOTIFIED_KEY));
  for (const change of changes.filter((item) => state.favorites.has(item.id)).slice(0, 3)) {
    const key = `change:${change.id}:${change.type}:${change.after}`;
    if (notified.has(key)) continue;
    await displayNotification(`お気に入りの${change.label}`, `${shortLaunchName(change.name)}\n${changeDetail(change)}`, key);
    notified.add(key);
  }
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify(Array.from(notified).slice(-100)));
}

async function displayNotification(title, body, tag) {
  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, {
      body,
      tag,
      icon: "assets/icon.svg",
      badge: "assets/icon.svg",
      data: { url: "./#launches" },
    });
  } catch (error) {
    console.warn("Notification failed:", error);
  }
}

function toggleFavorite(id) {
  if (state.favorites.has(id)) {
    state.favorites.delete(id);
  } else {
    state.favorites.add(id);
  }
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(state.favorites)));
  renderLaunchList();
  checkFavoriteNotifications();
}

function showMissionDetail(id) {
  const launch = state.launches.find((item) => item.id === id);
  if (!launch) return;
  const image = imageUrl(launch) || "assets/launch-hero.png";
  const infoLink = launch.info_urls?.[0];
  const videoLink = launch.vid_urls?.[0];
  const originalDescription = launch.mission?.description;
  els.dialogContent.innerHTML = `
    <div class="dialog-hero" style="--dialog-image: url('${escapeAttribute(image)}')"></div>
    <div class="dialog-body">
      <span class="pill ${statusClass(launch)}">${escapeHtml(statusName(launch))}</span>
      <h2>${escapeHtml(shortLaunchName(launch.name))}</h2>
      <div class="dialog-meta">${escapeHtml(formatDate(launch.net))}</div>
      <p class="dialog-summary">${escapeHtml(japaneseMissionSummary(launch))}</p>
      <div class="dialog-grid">
        <div><dt>ロケット</dt><dd>${escapeHtml(rocketName(launch))}</dd></div>
        <div><dt>軌道</dt><dd>${escapeHtml(orbitName(launch))}</dd></div>
        <div><dt>射場</dt><dd>${escapeHtml(padName(launch))}</dd></div>
        <div><dt>状態</dt><dd>${escapeHtml(statusName(launch))}</dd></div>
        <div><dt>ミッション分類</dt><dd>${escapeHtml(missionTypeName(launch))}</dd></div>
        <div><dt>事業者</dt><dd>${escapeHtml(providerName(launch))}</dd></div>
      </div>
      ${
        originalDescription
          ? `<details class="dialog-original">
              <summary>英語の原文を表示</summary>
              <p>${escapeHtml(originalDescription)}</p>
            </details>`
          : `<p class="dialog-note">Launch Libraryには、詳しい英語説明がまだ登録されていません。</p>`
      }
      <div class="mission-actions dialog-actions">
        ${videoLink?.url ? `<a class="mission-link primary" href="${escapeAttribute(videoLink.url)}" target="_blank" rel="noopener noreferrer">配信を見る</a>` : ""}
        ${infoLink?.url ? `<a class="mission-link" href="${escapeAttribute(infoLink.url)}" target="_blank" rel="noopener noreferrer">公式・関連情報</a>` : ""}
      </div>
    </div>
  `;
  els.dialog.showModal();
}

function japaneseMissionSummary(launch) {
  const future = new Date(launch.net) > new Date();
  const timing = future ? "予定されています" : isSuccess(launch) ? "実施されました" : "記録されています";
  const purpose = missionPurposeText(launch);
  const parts = [
    purpose,
    `使用ロケットは${rocketName(launch)}、ミッション分類は${missionTypeName(launch)}です。`,
    `目標軌道は${orbitName(launch)}、射場は${padName(launch)}です。`,
    `打ち上げ時刻は${formatDate(launch.net)}で、現在の状態は「${statusName(launch)}」として${timing}。`,
  ];
  return parts.join(" ");
}

function missionPurposeText(launch) {
  const text = launchText(launch);
  if (text.includes("starlink")) return "Starlink衛星群を軌道へ投入するSpaceXのミッションです。";
  if (text.includes("cargo dragon") || text.includes("resupply")) return "Dragon宇宙船による補給・輸送に関わるミッションです。";
  if (text.includes("crew dragon") || text.includes("crew-")) return "Crew Dragonによる有人宇宙飛行ミッションです。";
  if (text.includes("starship") || text.includes("flight test")) return "Starshipの飛行試験、またはStarship関連のミッションです。";
  if (text.includes("transporter") || text.includes("rideshare")) return "複数の小型衛星をまとめて運ぶライドシェアミッションです。";
  if (text.includes("sxm") || text.includes("sirius") || text.includes("communications")) return "通信衛星を軌道へ投入するミッションです。";
  if (text.includes("national security") || text.includes("government")) return "政府・安全保障分野に関わるミッションです。";
  if (text.includes("commercial")) return "商業衛星や顧客ペイロードを運ぶミッションです。";
  return "SpaceXによる打ち上げミッションです。";
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
    rawStatusName(launch),
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
  return name
    .replace("Space Launch Complex", "SLC")
    .replace("Launch Complex", "LC")
    .replace("Falcon 9 Block 5", "Falcon 9")
    .replace("Orbital Launch Mount", "軌道発射マウント");
}

function providerName(launch) {
  return launch.launch_service_provider?.name || launch.mission?.agencies?.[0]?.name || "SpaceX";
}

function rocketName(launch) {
  return launch.rocket?.configuration?.full_name || launch.rocket?.configuration?.name || "ロケット未定";
}

function padName(launch) {
  return compactName(launch.pad?.name || launch.pad?.location?.name || "射場未定");
}

function orbitName(launch) {
  const abbrev = launch.mission?.orbit?.abbrev;
  const name = launch.mission?.orbit?.name;
  const key = String(abbrev || name || "").toLowerCase();
  const orbitLabels = {
    leo: "地球低軌道",
    meo: "中軌道",
    geo: "静止軌道",
    gto: "静止トランスファ軌道",
    sso: "太陽同期軌道",
    iss: "国際宇宙ステーション",
    heo: "高楕円軌道",
    po: "極軌道",
    polar: "極軌道",
    lunar: "月遷移軌道",
    suborbital: "サブオービタル",
  };
  if (orbitLabels[key]) return orbitLabels[key];
  if (key.includes("low earth")) return "地球低軌道";
  if (key.includes("geostationary transfer")) return "静止トランスファ軌道";
  if (key.includes("sun-synchronous")) return "太陽同期軌道";
  if (key.includes("polar")) return "極軌道";
  return missionTypeName(launch) || "軌道未定";
}

function statusName(launch) {
  return statusLabel(rawStatusName(launch));
}

function rawStatusName(launch) {
  return launch.status?.abbrev || launch.status?.name || "TBD";
}

function statusLabel(value) {
  const text = String(value || "TBD").toLowerCase();
  if (text.includes("success")) return "成功";
  if (text === "go" || text.includes("go for launch")) return "実施可";
  if (text.includes("failure") || text.includes("fail")) return "失敗";
  if (text.includes("partial")) return "一部成功";
  if (text.includes("hold")) return "保留中";
  if (text.includes("scrub")) return "延期";
  if (text.includes("tbc") || text.includes("confirm")) return "確認中";
  if (text.includes("tbd") || text.includes("determin")) return "未定";
  if (text.includes("planned")) return "計画中";
  return value || "未定";
}

function missionTypeName(launch) {
  const raw = launch.mission?.type || "";
  const text = `${raw} ${launch.name || ""}`.toLowerCase();
  if (text.includes("communications")) return "通信衛星";
  if (text.includes("resupply") || text.includes("cargo")) return "補給・輸送";
  if (text.includes("test flight") || text.includes("flight test")) return "飛行試験";
  if (text.includes("government")) return "政府系";
  if (text.includes("earth science")) return "地球観測";
  if (text.includes("navigation")) return "測位衛星";
  if (text.includes("human") || text.includes("crew")) return "有人飛行";
  if (text.includes("rideshare") || text.includes("transporter")) return "ライドシェア";
  if (text.includes("starlink")) return "Starlink衛星";
  if (text.includes("commercial")) return "商業ミッション";
  return raw || "分類未定";
}

function statusClass(launch) {
  const text = rawStatusName(launch).toLowerCase();
  if (text.includes("success")) return "success";
  if (text.includes("go")) return "go";
  if (text.includes("fail")) return "failure";
  return "tbd";
}

function isSuccess(launch) {
  return rawStatusName(launch).toLowerCase().includes("success");
}

function isFailure(launch) {
  return rawStatusName(launch).toLowerCase().includes("fail");
}

function imageUrl(launch) {
  return launch.image?.thumbnail_url || launch.image?.image_url || launch.mission?.image?.thumbnail_url || "";
}

function formatClock(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  const options = { hour: "2-digit", minute: "2-digit" };
  if (state.timeZoneMode === "jst") options.timeZone = "Asia/Tokyo";
  if (state.timeZoneMode === "utc") options.timeZone = "UTC";
  return new Intl.DateTimeFormat("ja-JP", options).format(date);
}

function formatAge(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "--";
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}日前`;
  return formatDate(value);
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

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

function registerServiceWorker() {
  // ローカル開発環境（localhost）ではキャッシュの衝突を防ぐため、Service Workerを解除する
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          registration.unregister().then((success) => {
            if (success) {
              console.log("Service Worker unregistered for localhost development.");
              window.location.reload(); // キャッシュクリア後に自動リロードして最新版を適用
            }
          });
        }
      });
    }
    return;
  }

  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
  });
}
