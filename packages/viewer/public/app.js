import {
  filterOpenQuestions,
  filterSidebarItems,
  partitionOpenQuestions,
  parseBookmarkIds,
  sectionHeadingPresentation,
  selectHomeFocus,
  selectBookmarkItems,
  sortOpenQuestions,
  sortSubjects,
  toggleBookmark,
} from "/experience.js";
import {
  renderMarkdown as mdBlock,
  renderMarkdownInline as mdInline,
} from "/markdown.js";

const app = document.getElementById("app");
const sideSearchInput = document.getElementById("side-search-input");
const sideSearchResults = document.getElementById("side-list");
const sideSearchStatus = document.getElementById("side-search-status");
const routes = {
  "": renderHome,
  bookmarks: renderBookmarks,
  q: renderQuestions,
  s: renderTimeline,
  map: renderMap,
};
const BOOKMARK_KEY = "helix.bookmarks";
let mapHandle = null; // 나선 지도(#/map) 캔버스 정리 훅 (라우트 전환 시 destroy)
let mapToken = 0; // renderMap 비동기 import 중 라우트가 바뀌면 mount 취소
let routeToken = 0; // 모든 라우트의 느린 응답이 최신 화면을 덮지 못하게 하는 세대 번호
let strandObserver = null;
let strandFrame = 0;
let bookmarkIds = [];
let knownSubjectIds = null;
let sidebarSubjects = [];
let sidebarHierarchy = { repositories: [] };
let sidebarSearchReady = false;
let sidebarSearchFailed = false;
let mobileSidebarOpener = null;
try {
  bookmarkIds = parseBookmarkIds(localStorage.getItem(BOOKMARK_KEY));
} catch { /* 저장소를 쓸 수 없으면 현재 세션 메모리로 동작 */ }

/* ---------- 탭 (Obsidian풍 워크스페이스) ---------- */

let tabs = null;
let activeTab = 0;
try {
  tabs = JSON.parse(
    localStorage.getItem("helix-tabs") ??
      sessionStorage.getItem("helix-tabs") ??
      "null",
  );
  activeTab = Number(
    localStorage.getItem("helix-tab-active") ??
      sessionStorage.getItem("helix-tab-active") ??
      0,
  );
} catch { /* 세션 복원 실패 시 기본 탭 */ }
let subjectTitles = {}; // initSidebar가 채움 — 새 탭 제목 즉시 결정용

/** 라우트만으로 탭 제목을 결정한다. subject는 캐시에 있으면 즉시, 없으면 로드 후 setTabTitle이 확정. */
function titleForRoute(hash) {
  const [, rawPage = "", rawId] = (hash || "#/").split("/");
  const page = rawPage.split("?")[0];
  if (page === "q") return "열린 질문";
  if (page === "bookmarks") return "북마크";
  if (page === "map") {
    const id = decodeURIComponent((rawId ?? "").split("?")[0]);
    return id ? repoLabelOf(id) : "나선 지도";
  }
  if (page === "s") {
    const id = decodeURIComponent((rawId ?? "").split("?")[0]);
    return subjectTitles[id] ?? "…";
  }
  return "나선 일지";
}

if (!Array.isArray(tabs) || tabs.length === 0) tabs = [{ route: "#/", title: "나선 일지" }];
activeTab = Math.min(Math.max(activeTab || 0, 0), tabs.length - 1);
if (location.hash) tabs[activeTab].route = location.hash; // 딥링크 우선
else if (tabs[activeTab]?.route?.startsWith("#/")) {
  history.replaceState(null, "", tabs[activeTab].route);
}

function saveTabs() {
  sessionStorage.setItem("helix-tabs", JSON.stringify(tabs));
  sessionStorage.setItem("helix-tab-active", String(activeTab));
  try {
    localStorage.setItem("helix-tabs", JSON.stringify(tabs));
    localStorage.setItem("helix-tab-active", String(activeTab));
  } catch { /* 저장 공간 제한 시 현재 세션만 유지 */ }
}

function renderTabs() {
  document.getElementById("tabs").innerHTML = tabs
    .map(
      (t, i) => `
      <div class="tab-wrap${i === activeTab ? " active" : ""}">
        <button class="tab${i === activeTab ? " active" : ""}" data-tab="${i}" title="${esc(t.title)}"
             type="button" role="tab" tabindex="${i === activeTab ? "0" : "-1"}"
             aria-selected="${i === activeTab}" aria-controls="app">
          <span class="tab-title">${esc(t.title)}</span>
        </button>
        <button class="tab-close" data-close="${i}" aria-label="탭 닫기" tabindex="-1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>`,
    )
    .join("");
  requestAnimationFrame(() => {
    document.querySelector(".tab-wrap.active")?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  });
}

function setTabTitle(title) {
  tabs[activeTab].title = title;
  renderTabs();
  saveTabs();
  document.title = `${title} — Helix`;
}

/** 같은 해시여도 탭 표시는 갱신되도록 이동을 한 곳에서 처리 */
function go(route) {
  if (location.hash === route) {
    renderTabs();
    markSidebar();
  } else {
    location.hash = route;
  }
}

function selectTab(i) {
  if (i === activeTab || !tabs[i]) return;
  activeTab = i;
  saveTabs();
  go(tabs[i].route);
  renderTabs();
}

function closeTab(i) {
  tabs.splice(i, 1);
  if (tabs.length === 0) tabs = [{ route: "#/", title: "나선 일지" }];
  if (i < activeTab) activeTab -= 1;
  activeTab = Math.min(activeTab, tabs.length - 1);
  saveTabs();
  renderTabs();
  go(tabs[activeTab].route);
}

function openInNewTab(route) {
  tabs.push({ route, title: titleForRoute(route) }); // hash가 안 바뀌어 route()가 안 불려도 제목이 즉시 정확
  activeTab = tabs.length - 1;
  saveTabs();
  renderTabs();
  requestAnimationFrame(() => {
    document.getElementById("tab-new").scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  });
  go(route);
}

document.getElementById("tabs").addEventListener("click", (e) => {
  const close = e.target.closest(".tab-close");
  if (close) {
    e.stopPropagation();
    closeTab(Number(close.dataset.close));
    return;
  }
  const tab = e.target.closest(".tab");
  if (tab) selectTab(Number(tab.dataset.tab));
});
document.getElementById("tabs").addEventListener("auxclick", (e) => {
  const tab = e.target.closest(".tab");
  if (tab && e.button === 1) closeTab(Number(tab.dataset.tab)); // 휠클릭 = 닫기
});
document.getElementById("tabs").addEventListener("keydown", (e) => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    selectTab(Number(tab.dataset.tab));
  } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    e.preventDefault();
    const delta = e.key === "ArrowRight" ? 1 : -1;
    const next = (Number(tab.dataset.tab) + delta + tabs.length) % tabs.length;
    selectTab(next);
    document.querySelector(`.tab[data-tab="${next}"]`)?.focus();
  } else if (e.key === "Home" || e.key === "End") {
    e.preventDefault();
    const next = e.key === "Home" ? 0 : tabs.length - 1;
    selectTab(next);
    document.querySelector(`.tab[data-tab="${next}"]`)?.focus();
  } else if (e.key === "Backspace" || e.key === "Delete") {
    e.preventDefault();
    closeTab(Number(tab.dataset.tab));
  }
});
document.getElementById("tab-new").addEventListener("click", () => openInNewTab("#/"));
document.getElementById("nav-back").addEventListener("click", () => history.back());
document.getElementById("nav-fwd").addEventListener("click", () => history.forward());

// Cmd/Ctrl+클릭 = 새 탭에서 열기 (사이드바·본문 내부 링크 공통)
document.addEventListener("click", (e) => {
  if (!(e.metaKey || e.ctrlKey)) return;
  const a = e.target.closest("a[href^='#/']");
  if (!a) return;
  e.preventDefault();
  openInNewTab(a.getAttribute("href"));
});

/* ---------- 라우팅 ---------- */

window.addEventListener("hashchange", route);

async function route() {
  const token = ++routeToken;
  if (mapHandle) { mapHandle.destroy(); mapHandle = null; } // 캔버스/리스너 누수 방지
  if (strandObserver) { strandObserver.disconnect(); strandObserver = null; }
  cancelAnimationFrame(strandFrame);
  strandFrame = 0;
  const hash = location.hash || "#/";
  tabs[activeTab].route = hash;
  const [, rawPage = "", id] = hash.split("/");
  const page = rawPage.split("?")[0]; // #/map?focus=x 처럼 쿼리가 page에 붙는 경우 분리
  const handler = routes[page] ?? renderHome;
  app.dataset.page = page || "home";
  tabs[activeTab].title = titleForRoute(hash);
  renderTabs();
  saveTabs();
  try { localStorage.setItem("helix.lastRoute", hash); } catch { /* 저장 실패는 무시 */ }
  markSidebar();
  closeMobileSidebar(false);
  // subject 페이지는 로드 후 setTabTitle이 제목을 채운다 — 그 전까지는 일반 제목
  document.title = page === "s" ? "Helix" : `${tabs[activeTab].title} — Helix`;
  const ws = document.querySelector(".workspace");
  if (ws) ws.scrollTop = 0;
  window.scrollTo({ top: 0 });
  app.setAttribute("aria-busy", "true");
  app.innerHTML = `<p class="page-sub">불러오는 중…</p>`;
  try {
    await handler(decodeURIComponent((id ?? "").split("?")[0]), token);
    if (token !== routeToken) return;
    app.removeAttribute("aria-busy");
    const heading = app.querySelector("h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    document.getElementById("route-status").textContent =
      `${tabs[activeTab].title} 화면을 열었습니다.`;
  } catch (err) {
    if (token !== routeToken) return;
    app.removeAttribute("aria-busy");
    app.innerHTML = `<div class="empty">불러오기 실패: ${esc(String(err))}</div>`;
    tabs[activeTab].title = "불러오기 실패";
    renderTabs();
    saveTabs();
    document.title = "불러오기 실패 — Helix";
  }
}

function routeIsCurrent(token) {
  return token === routeToken;
}

/* ---------- 북마크 ---------- */

function saveBookmarkIds(next) {
  bookmarkIds = parseBookmarkIds(JSON.stringify(next));
  try {
    localStorage.setItem(BOOKMARK_KEY, JSON.stringify(bookmarkIds));
  } catch { /* 저장소 제한 시 현재 화면에서는 계속 동작 */ }
  syncBookmarkCount();
  return bookmarkIds;
}

function syncBookmarkCount(subjects) {
  if (Array.isArray(subjects)) {
    knownSubjectIds = new Set(subjects.map((subject) => subject.id));
  }
  const count = document.getElementById("bookmark-count");
  if (!count) return;
  const total = knownSubjectIds
    ? bookmarkIds.filter((id) => knownSubjectIds.has(id)).length
    : bookmarkIds.length;
  count.textContent = total ? String(total) : "";
  count.setAttribute("aria-label", `저장한 북마크 ${total}개`);
}

function paintBookmarkButton(button, id) {
  if (!button) return;
  const saved = bookmarkIds.includes(id);
  button.setAttribute("aria-pressed", String(saved));
  button.title = saved ? "북마크 해제" : "북마크 추가";
  const label = button.querySelector(".bookmark-label");
  if (label) label.textContent = saved ? "저장됨" : "북마크";
}

function setBookmarked(id, title) {
  const wasSaved = bookmarkIds.includes(id);
  saveBookmarkIds(toggleBookmark(bookmarkIds, id));
  const saved = !wasSaved;
  document.getElementById("route-status").textContent =
    `${title} 북마크를 ${saved ? "추가했습니다." : "해제했습니다."}`;
  return saved;
}

/* ---------- 사이드바 ---------- */

async function initSidebar() {
  try {
    const [subjects, hierarchy] = await Promise.all([
      getJSON("/api/subjects"),
      getJSON("/api/roadmaps"),
    ]);
    syncBookmarkCount(subjects);
    sidebarSubjects = subjects;
    sidebarHierarchy = hierarchy;
    sidebarSearchReady = true;
    sidebarSearchFailed = false;
    subjectTitles = Object.fromEntries(subjects.map((s) => [s.id, displayTitle(s.title)]));
    // 로딩 전에 열려서 "…"로 남은 탭 제목을 소급 확정
    let fixed = false;
    for (const t of tabs) {
      if (t.title === "…") { t.title = titleForRoute(t.route); fixed = true; }
    }
    if (fixed) { renderTabs(); saveTabs(); }
    paintSidebarResults();
    markSidebar();
  } catch {
    sidebarSearchReady = true;
    sidebarSearchFailed = true;
    paintSidebarResults();
  }
}

function markSidebar() {
  const [, rawPage = "", rawId] = location.hash.split("/");
  const page = rawPage.split("?")[0];
  const navFor =
    page === "q"
      ? "questions"
      : page === "map"
        ? "map"
        : page === "bookmarks"
          ? "bookmarks"
          : "subjects";
  for (const a of document.querySelectorAll("[data-nav]")) {
    if (a.dataset.nav === navFor) {
      a.setAttribute("aria-current", "page");
    } else {
      a.removeAttribute("aria-current");
    }
  }
  const currentId = decodeURIComponent((rawId ?? "").split("?")[0]);
  for (const item of document.querySelectorAll(".side-item")) {
    const on = page === "s" && item.dataset.sid === currentId;
    item.classList.toggle("active", on);
    if (on) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
    if (on) item.scrollIntoView({ block: "nearest" });
  }
  const mobilePage = document.getElementById("mobile-page");
  if (mobilePage) mobilePage.textContent = titleForRoute(location.hash);
}

/* ---------- 모바일 탐색 ---------- */

const mobileQuery = window.matchMedia("(max-width: 880px)");
const root = document.documentElement;
const sidePanel = document.getElementById("side-panel");
const sideToggle = document.getElementById("sidebar-toggle");
const sideScrim = document.getElementById("sidebar-scrim");
const desktopSideToggle = document.getElementById("sidebar-collapse");

function desktopSidebarCollapsed() {
  return root.dataset.sidebar === "collapsed";
}

function syncDesktopSidebarToggle() {
  const collapsed = desktopSidebarCollapsed();
  desktopSideToggle.setAttribute("aria-expanded", String(!collapsed));
  desktopSideToggle.setAttribute(
    "aria-label",
    collapsed ? "사이드바 열기" : "사이드바 닫기",
  );
  desktopSideToggle.title = collapsed ? "사이드바 열기" : "사이드바 닫기";
}

function syncMobileSidebar() {
  if (mobileQuery.matches) {
    const open = sidePanel.classList.contains("mobile-open");
    sidePanel.inert = !open;
    sidePanel.setAttribute("aria-hidden", String(!open));
    sideScrim.hidden = !open;
    sideToggle.setAttribute("aria-expanded", String(open));
    sideToggle.setAttribute("aria-label", open ? "탐색 닫기" : "탐색 열기");
    sideToggle.querySelector(".sr-only").textContent =
      open ? "탐색 닫기" : "탐색 열기";
    for (const button of [
      document.getElementById("mobile-search"),
      document.getElementById("mobile-bottom-search"),
    ]) {
      button.setAttribute("aria-expanded", String(open));
    }
  } else {
    const collapsed = desktopSidebarCollapsed();
    if (collapsed && sidePanel.contains(document.activeElement)) {
      desktopSideToggle.focus();
    }
    sidePanel.classList.remove("mobile-open");
    sidePanel.inert = collapsed;
    if (collapsed) sidePanel.setAttribute("aria-hidden", "true");
    else sidePanel.removeAttribute("aria-hidden");
    sideScrim.hidden = true;
    sideToggle.setAttribute("aria-expanded", "false");
    document.getElementById("mobile-search").setAttribute("aria-expanded", "false");
    document
      .getElementById("mobile-bottom-search")
      .setAttribute("aria-expanded", "false");
  }
  syncDesktopSidebarToggle();
}

function setDesktopSidebar(collapsed) {
  if (mobileQuery.matches) return;
  if (collapsed && sidePanel.contains(document.activeElement)) {
    desktopSideToggle.focus();
  }
  if (collapsed) root.dataset.sidebar = "collapsed";
  else delete root.dataset.sidebar;
  try {
    localStorage.setItem("helix.sidebar", collapsed ? "collapsed" : "open");
  } catch { /* 저장 불가 환경에서는 현재 화면에만 적용 */ }
  syncMobileSidebar();
}

function openMobileSidebar() {
  if (!mobileQuery.matches) return;
  const opener = document.activeElement;
  mobileSidebarOpener =
    opener instanceof HTMLElement && !sidePanel.contains(opener)
      ? opener
      : sideToggle;
  sidePanel.classList.add("mobile-open");
  syncMobileSidebar();
  sideSearchInput.focus();
}

function closeMobileSidebar(restoreFocus = true) {
  const wasOpen = sidePanel.classList.contains("mobile-open");
  const restoreTarget =
    mobileSidebarOpener?.isConnected ? mobileSidebarOpener : sideToggle;
  mobileSidebarOpener = null;
  sidePanel.classList.remove("mobile-open");
  syncMobileSidebar();
  if (restoreFocus && wasOpen && mobileQuery.matches) restoreTarget.focus();
}

sideToggle.addEventListener("click", () => {
  sidePanel.classList.contains("mobile-open")
    ? closeMobileSidebar()
    : openMobileSidebar();
});
desktopSideToggle.addEventListener("click", () => {
  setDesktopSidebar(!desktopSidebarCollapsed());
});
sideScrim.addEventListener("click", () => closeMobileSidebar());
sidePanel.addEventListener("click", (event) => {
  if (event.target.closest("a[href^='#/']")) closeMobileSidebar(false);
});
document.getElementById("mobile-search").addEventListener("click", focusSideSearch);
document.getElementById("mobile-bottom-search").addEventListener("click", focusSideSearch);
mobileQuery.addEventListener("change", syncMobileSidebar);
syncMobileSidebar();
syncBookmarkCount();
void route();
void initSidebar();

/* ---------- 사이드바 검색 (Cmd/Ctrl+K) ---------- */

let searchSel = -1;
let searchHits = [];

document.addEventListener("keydown", (e) => {
  if (
    settingsDialog?.open &&
    (e.metaKey || e.ctrlKey) &&
    e.key.toLowerCase() === "k"
  ) {
    e.preventDefault();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    focusSideSearch();
  } else if (e.key === "Escape" && sidePanel.classList.contains("mobile-open")) {
    closeMobileSidebar();
  }
});

function focusSideSearch() {
  if (mobileQuery.matches) {
    openMobileSidebar();
  } else if (desktopSidebarCollapsed()) {
    setDesktopSidebar(false);
  }
  requestAnimationFrame(() => sideSearchInput.focus());
}

/* ---------- 설정 ---------- */

const settingsTrigger = document.getElementById("settings-trigger");
const settingsDialog = document.getElementById("settings-dialog");
const settingsClose = document.getElementById("settings-close");
const themeColor = document.getElementById("theme-color");
const themeInputs = [...document.querySelectorAll('input[name="helix-theme"]')];
const desktopApi = window.helixDesktop;
const desktopSettings = document.getElementById("desktop-settings");
const desktopVersion = document.getElementById("desktop-version");
const desktopUpdateStatus = document.getElementById("desktop-update-status");
const desktopUpdateButton = document.getElementById("desktop-update-button");
const desktopDataRoot = document.getElementById("desktop-data-root");
const desktopDataReveal = document.getElementById("desktop-data-reveal");
const desktopDataChange = document.getElementById("desktop-data-change");
let desktopUpdate = null;

function currentTheme() {
  return root.dataset.theme === "dark" ? "dark" : "light";
}

function syncThemeControls() {
  const theme = currentTheme();
  for (const input of themeInputs) input.checked = input.value === theme;
  themeColor.content = theme === "dark" ? "#1e1f20" : "#f7f7f6";
}

function applyTheme(theme, persist = true) {
  root.dataset.theme = theme === "dark" ? "dark" : "light";
  if (persist) {
    try { localStorage.setItem("helix.theme", currentTheme()); } catch { /* 현재 화면에만 적용 */ }
  }
  syncThemeControls();
  mapHandle?.refreshTheme?.();
}

function openSettings() {
  closeMobileSidebar(false);
  syncThemeControls();
  settingsTrigger.setAttribute("aria-expanded", "true");
  if (!settingsDialog.open) settingsDialog.showModal();
  settingsClose.focus();
}

function closeSettings() {
  if (settingsDialog.open) settingsDialog.close();
}

function paintDesktopUpdate(result) {
  desktopUpdate = result;
  desktopUpdateButton.disabled = false;
  if (result?.updateAvailable) {
    desktopUpdateButton.dataset.mode = "install";
    desktopUpdateButton.textContent = `v${result.latest} 받기`;
    desktopUpdateStatus.textContent = `새 버전 v${result.latest}을 받을 수 있습니다.`;
    return;
  }
  desktopUpdateButton.dataset.mode = "check";
  desktopUpdateButton.textContent = "다시 확인";
  desktopUpdateStatus.textContent = result?.error
    ? `확인하지 못했습니다. ${result.error}`
    : `v${result?.current ?? ""} 최신 버전입니다.`;
}

async function initDesktopSettings() {
  if (!desktopApi) return;
  desktopSettings.hidden = false;
  try {
    const info = await desktopApi.getInfo();
    desktopVersion.textContent = `v${info.version}`;
    desktopDataRoot.textContent = info.dataRoot;
    desktopDataRoot.title = info.dataRoot;
    paintDesktopUpdate(await desktopApi.checkForUpdate(false));
  } catch (error) {
    desktopUpdateStatus.textContent = `앱 정보를 불러오지 못했습니다. ${error?.message ?? error}`;
  }
}

if (desktopApi) {
  desktopUpdateButton.addEventListener("click", async () => {
    desktopUpdateButton.disabled = true;
    if (desktopUpdateButton.dataset.mode !== "install") {
      desktopUpdateStatus.textContent = "새 버전을 확인하는 중…";
      paintDesktopUpdate(await desktopApi.checkForUpdate(true));
      return;
    }
    desktopUpdateStatus.textContent = "업데이트를 안전하게 받는 중…";
    const result = await desktopApi.installUpdate();
    if (!result?.ok) {
      desktopUpdateButton.disabled = false;
      desktopUpdateStatus.textContent = `업데이트하지 못했습니다. ${result?.error ?? "다시 시도해 주세요."}`;
    } else if (result.mode === "browser") {
      desktopUpdateButton.disabled = false;
      desktopUpdateStatus.textContent = "현재 환경에서는 릴리스 페이지에서 설치해 주세요.";
    } else {
      desktopUpdateStatus.textContent = "검증을 마쳤습니다. 앱을 교체하고 다시 실행합니다.";
    }
  });
  desktopDataReveal.addEventListener("click", () => desktopApi.revealDataRoot());
  desktopDataChange.addEventListener("click", async () => {
    const result = await desktopApi.chooseDataRoot();
    if (result?.canceled) return;
    desktopDataRoot.textContent = result.dataRoot;
    desktopDataRoot.title = result.dataRoot;
    if (
      result.restartRequired &&
      window.confirm("새 데이터 폴더를 사용하려면 Helix를 다시 시작해야 합니다. 지금 다시 시작할까요?")
    ) {
      await desktopApi.restart();
    }
  });
  desktopApi.onUpdateProgress(({ percent }) => {
    desktopUpdateStatus.textContent =
      percent == null ? "업데이트를 받는 중…" : `업데이트를 받는 중… ${percent}%`;
  });
  desktopApi.onUpdateAvailable((result) => paintDesktopUpdate(result));
  void initDesktopSettings();
}

settingsTrigger.addEventListener("click", openSettings);
settingsClose.addEventListener("click", closeSettings);
settingsDialog.addEventListener("click", (event) => {
  if (event.target !== settingsDialog) return;
  const rect = settingsDialog.getBoundingClientRect();
  const inside =
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom;
  if (!inside) closeSettings();
});
settingsDialog.addEventListener("close", () => {
  settingsTrigger.setAttribute("aria-expanded", "false");
  const returnTarget = mobileQuery.matches
    ? sideToggle
    : desktopSidebarCollapsed()
      ? desktopSideToggle
      : settingsTrigger;
  returnTarget.focus();
});
for (const input of themeInputs) {
  input.addEventListener("change", () => {
    if (input.checked) applyTheme(input.value);
  });
}
window.addEventListener("storage", (event) => {
  if (event.key === "helix.theme") applyTheme(event.newValue, false);
  if (event.key === "helix.sidebar" && !mobileQuery.matches) {
    if (event.newValue === "collapsed") root.dataset.sidebar = "collapsed";
    else delete root.dataset.sidebar;
    syncMobileSidebar();
  }
  if (event.key === BOOKMARK_KEY) {
    bookmarkIds = parseBookmarkIds(event.newValue);
    syncBookmarkCount();
    const button = document.querySelector("[data-bookmark-id]");
    if (button) paintBookmarkButton(button, button.dataset.bookmarkId);
    if (app.dataset.page === "bookmarks") void route();
  }
});
syncThemeControls();

sideSearchInput.addEventListener("input", () => {
  searchSel = -1;
  paintSidebarResults();
});

sideSearchInput.addEventListener("keydown", (event) => {
  if (event.isComposing) return;
  if (
    (event.key === "ArrowDown" ||
      event.key === "ArrowUp") &&
    searchHits.length
  ) {
    event.preventDefault();
    if (event.key === "ArrowDown") {
      searchSel = searchSel < 0 ? 0 : Math.min(searchSel + 1, searchHits.length - 1);
    } else {
      searchSel = searchSel < 0 ? 0 : Math.max(searchSel - 1, 0);
    }
    paintSidebarResults();
  } else if (event.key === "Enter" && searchHits.length) {
    event.preventDefault();
    const hit = searchHits[searchSel < 0 ? 0 : searchSel];
    if (mobileQuery.matches) closeMobileSidebar(false);
    if (event.metaKey || event.ctrlKey) openInNewTab(hit.route);
    else go(hit.route);
  } else if (event.key === "Escape" && sideSearchInput.value) {
    event.preventDefault();
    event.stopPropagation();
    sideSearchInput.value = "";
    searchSel = -1;
    paintSidebarResults();
  }
});

function paintSidebarResults() {
  const q = sideSearchInput.value.trim().toLocaleLowerCase();
  sideSearchInput.removeAttribute("aria-activedescendant");
  sideSearchResults.removeAttribute("aria-busy");
  sideSearchStatus.classList.remove("sr-only");
  sideSearchStatus.textContent = "";

  if (!q) {
    searchHits = [];
    searchSel = -1;
    sideSearchResults.replaceChildren();
    sideSearchResults.hidden = true;
    sideSearchInput.setAttribute("aria-expanded", "false");
    return;
  }

  if (!sidebarSearchReady) {
    searchHits = [];
    sideSearchResults.hidden = true;
    sideSearchResults.setAttribute("aria-busy", "true");
    sideSearchInput.setAttribute("aria-expanded", "false");
    sideSearchStatus.textContent = "나선을 불러오는 중…";
    return;
  }

  if (sidebarSearchFailed) {
    searchHits = [];
    sideSearchResults.hidden = true;
    sideSearchInput.setAttribute("aria-expanded", "false");
    sideSearchStatus.textContent = "검색 목록을 불러오지 못했습니다.";
    return;
  }

  searchHits = filterSidebarItems(sidebarSubjects, sidebarHierarchy, q);

  if (!searchHits.length) {
    searchSel = -1;
    sideSearchResults.replaceChildren();
    sideSearchResults.hidden = true;
    sideSearchInput.setAttribute("aria-expanded", "false");
    sideSearchStatus.textContent = "일치하는 나선이 없습니다.";
    return;
  }

  if (searchSel < 0) searchSel = 0;
  if (searchSel >= searchHits.length) searchSel = searchHits.length - 1;
  sideSearchResults.innerHTML = searchHits
    .map(
      (hit, index) => `
        <a class="side-item side-search-result${index === searchSel ? " sel" : ""}"
          id="side-search-option-${index}" data-sid="${esc(hit.subjectId ?? "")}"
          href="${hit.route}" role="option" tabindex="-1"
          aria-selected="${index === searchSel}">
          <span class="side-search-copy">
            <span class="si-title">${mark(hit.title, q)}</span>
            <span class="si-context">${esc(hit.context)}</span>
          </span>
        </a>`,
    )
    .join("");
  sideSearchResults.hidden = false;
  sideSearchInput.setAttribute("aria-expanded", "true");
  sideSearchStatus.classList.add("sr-only");
  sideSearchStatus.textContent = `검색 결과 ${searchHits.length}개`;
  if (searchSel >= 0) {
    sideSearchInput.setAttribute(
      "aria-activedescendant",
      `side-search-option-${searchSel}`,
    );
    sideSearchResults
      .querySelector(".side-search-result.sel")
      ?.scrollIntoView({ block: "nearest" });
  }
  markSidebar();
}

function mark(text, q) {
  const i = text.toLocaleLowerCase().indexOf(q);
  if (i === -1) return esc(text);
  return `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
}

/* ---------- 북마크 목록 ---------- */

async function renderBookmarks(_id, token) {
  const subjects = await getJSON("/api/subjects");
  if (!routeIsCurrent(token)) return;
  syncBookmarkCount(subjects);

  app.innerHTML = `
    <header class="collection-mast">
      <h1 class="page-title">
        북마크 <span class="title-count" id="bookmark-page-count"></span>
      </h1>
    </header>
    <div class="bookmark-list" id="bookmark-list"></div>`;

  const list = document.getElementById("bookmark-list");
  const pageCount = document.getElementById("bookmark-page-count");
  const paint = () => {
    const items = selectBookmarkItems(bookmarkIds, subjects);
    pageCount.textContent = String(items.length);
    list.innerHTML = items.length
      ? items
          .map(
            (subject) => `
              <div class="bookmark-row">
                ${subjectRow(subject)}
                <button class="bookmark-remove" type="button"
                  data-bookmark-remove="${esc(subject.id)}"
                  aria-label="${esc(displayTitle(subject.title))} 북마크 해제"
                  title="북마크 해제">
                  <svg class="bookmark-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4Z"/>
                  </svg>
                </button>
              </div>`,
          )
          .join("")
      : `<div class="empty bookmark-empty">
          <p>저장한 노트가 없습니다.</p>
          <a href="#/">나선 일지 보기</a>
        </div>`;
  };

  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-bookmark-remove]");
    if (!button) return;
    const id = button.dataset.bookmarkRemove;
    const subject = subjects.find((item) => item.id === id);
    if (!subject) return;
    setBookmarked(id, displayTitle(subject.title));
    paint();
  });
  paint();
}

/* ---------- 나선 일지 (랜딩) ---------- */

async function renderHome(_id, token) {
  const [subjects, questions] = await Promise.all([
    getJSON("/api/subjects"),
    getJSON("/api/questions"),
  ]);
  if (!routeIsCurrent(token)) return;
  if (subjects.length === 0) {
    app.innerHTML = `
      <section class="empty-state">
        <h1>첫 노트를 시작해보세요.</h1>
        <p>기존 학습 노트를 가져오면 주제별 변화가 Layer로 이어집니다.</p>
        <code>helix import spiral-buddy &lt;vault-path&gt;</code>
      </section>`;
    return;
  }
  const focus = selectHomeFocus(subjects, questions);
  const focusLayer = focus.question?.raisedAtLayer ?? focus.subject.layerCount;
  const focusRoute =
    `#/s/${encodeURIComponent(focus.subject.id)}?layer=${focusLayer}`;
  const focusText = focus?.question
    ? compactText(plain(focus.question.text), 180)
    : "가장 최근에 작성한 Layer부터 다시 이어갈 수 있습니다.";

  app.innerHTML = `
    <header class="home-intro">
      <h1>생각을 이어 쓰세요.</h1>
    </header>
    <section class="continue-panel" aria-labelledby="continue-title">
      <div class="continue-copy">
        <span class="continue-label">
          ${focus.question ? `${metaMark("question")}<span>다음 질문</span>` : "이어서 보기"}
        </span>
        <h2 id="continue-title">${esc(displayTitle(focus.subject.title))}</h2>
        <p>${focus.question ? mdInline(focusText) : esc(focusText)}</p>
        <span class="continue-context">${metaMark("layer", focusLayer)}</span>
      </div>
      <a class="continue-action" href="${focusRoute}">
        ${focus.question ? "질문 이어보기" : "노트 열기"} <span aria-hidden="true">→</span>
      </a>
    </section>
    <div class="sec-head"><h2>노트</h2></div>
    <div class="subject-list" id="home-subject-list">
      ${sortSubjects(subjects, "recent").map(subjectRow).join("")}
    </div>`;
}

/* ---------- 나선 학습 지도 ---------- */

/** roadmapId("unit-testing/mocking-strategies")의 첫 구획 = 레포. 없으면 "misc". */
function repoKeyOf(roadmapId) {
  return roadmapId ? roadmapId.split("/")[0] : "misc";
}
function repoLabelOf(key) {
  if (key === "misc") return "기타";
  return key
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}
function chapterLabelOf(roadmapId) {
  const key = String(roadmapId ?? "")
    .split("/")
    .filter(Boolean)
    .at(-1);
  return key ? repoLabelOf(key) : "기타";
}

/**
 * 나선 지도 — 2단계 계층.
 *  #/map            전체: 레포마다 하나의 나선, 노드 = 챕터. 챕터 클릭 → 레포 지도.
 *  #/map/:repo      레포: 챕터별 주제 지도. 주제 클릭 → 상세.
 */
async function renderMap(repoKey, routeEpoch) {
  const token = ++mapToken;
  const onMap = () => (location.hash.split("?")[0].split("/")[1] || "").split("?")[0] === "map";
  const data = await getJSON("/api/graph");
  if (token !== mapToken || !onMap() || !routeIsCurrent(routeEpoch)) return; // fetch 중 다른 라우트로 이동 → 덮어쓰기 방지
  const query = new URLSearchParams(location.hash.split("?")[1] || "");
  const focus = query.get("focus") || undefined;
  const chapterFocus = query.get("chapter") || undefined;

  let mountNodes;
  let nodeRoute;
  let headHTML;
  let fallbackHTML;
  let ariaLabel;

  if (repoKey) {
    // ── 레포 지도: 이 레포의 주제만, 챕터 = 작은 나선 ──
    const subs = data.nodes.filter((n) => repoKeyOf(n.roadmapId) === repoKey);
    if (subs.length === 0) {
      app.innerHTML = `
        <h1 class="page-title">나선 지도</h1>
        <div class="empty">'${esc(repoLabelOf(repoKey))}' 레포를 찾을 수 없습니다. <a href="#/map">전체 나선 지도로 →</a></div>`;
      return;
    }
    const inRepo = new Set(subs.map((n) => n.id));
    mountNodes = subs.map((n) => {
      const nb = (n.neighbors ?? []).filter((m) => inRepo.has(m.id));
      return { ...n, neighbors: nb, degW: nb.reduce((a, m) => a + (m.score ?? 1), 0) };
    });
    nodeRoute = undefined; // 기본: 주제 상세로
    const label = repoLabelOf(repoKey);
    const selectedChapter = chapterFocus
      ? subs.find((subject) => subject.roadmapId === chapterFocus)?.roadmapId
      : undefined;
    const selectedChapterLabel = selectedChapter
      ? subs.find((subject) => subject.roadmapId === selectedChapter)?.roadmapTitle
      : undefined;
    headHTML = `
      <header class="map-heading">
        <h1 class="page-title">${esc(label)}</h1>
      </header>`;
    ariaLabel = `${label} 나선 지도: 주제 ${subs.length}개.${selectedChapterLabel ? ` 현재 ${selectedChapterLabel} 챕터에 초점.` : ""} 왼쪽과 오른쪽 화살표 키로 노드 이동, Enter로 열기. 아래 목록으로도 탐색할 수 있습니다.`;
    fallbackHTML = subs
      .map(
        (n) => `<li${n.roadmapId === selectedChapter ? ` class="current-chapter"` : ""}><a href="#/s/${encodeURIComponent(n.id)}">
      <span class="mf-title">${esc(displayTitle(n.title))}</span>
      ${n.roadmapTitle ? `<span class="mf-rm">${esc(n.roadmapTitle)}</span>` : ""}
      <span class="mf-meta">${metaMark("layer", n.layerCount)}${n.oqCount ? metaMark("question", n.oqCount) : ""}</span>
    </a></li>`,
      )
      .join("");
  } else {
    // ── 전체 지도: 레포 = 나선, 챕터 = 노드 (챕터 간 연결은 주제 연결의 집계) ──
    const chOf = new Map(data.nodes.map((n) => [n.id, n.roadmapId ?? "misc"]));
    const chapters = new Map(); // chKey → 합성 노드
    for (const n of data.nodes) {
      const ch = chOf.get(n.id);
      if (!chapters.has(ch)) {
        chapters.set(ch, {
          id: ch,
          title: n.roadmapTitle ?? "기타",
          roadmapId: repoKeyOf(n.roadmapId), // 그룹 키 = 레포
          roadmapTitle: repoLabelOf(repoKeyOf(n.roadmapId)),
          lastTouched: n.lastTouched,
          _last: n.lastTouched,
          layerCount: 0,
          oqCount: 0,
          count: 0,
          _agg: new Map(), // otherCh → {score, edge}
        });
      }
      const c = chapters.get(ch);
      c.count += 1;
      c.layerCount += n.layerCount;
      c.oqCount += n.oqCount;
      if (n.lastTouched < c.lastTouched) c.lastTouched = n.lastTouched;
      if (n.lastTouched > c._last) c._last = n.lastTouched;
      for (const m of n.neighbors ?? []) {
        const other = chOf.get(m.id);
        if (!other || other === ch) continue;
        const cur = c._agg.get(other) ?? { score: 0, edge: false };
        cur.score += m.score ?? 1;
        if (m.kind === "edge") cur.edge = true;
        c._agg.set(other, cur);
      }
    }
    mountNodes = [...chapters.values()].map((c) => ({
      id: c.id,
      title: c.title,
      roadmapId: c.roadmapId,
      roadmapTitle: c.roadmapTitle,
      lastTouched: c.lastTouched,
      layerCount: c.layerCount,
      oqCount: c.oqCount,
      degW: 3 * c.count, // 크기 = 주제 수
      tipMeta: `주제 ${c.count}`,
      neighbors: [...c._agg.entries()].map(([id, v]) => ({
        id,
        kind: v.edge ? "edge" : "tag",
        score: v.score,
      })),
    }));
    const chRepo = new Map(mountNodes.map((c) => [c.id, c.roadmapId]));
    nodeRoute = (chId) => {
      const repository = chRepo.get(chId) ?? "misc";
      return `#/map/${encodeURIComponent(repository)}?chapter=${encodeURIComponent(chId)}`;
    };
    const repoCount = new Set(mountNodes.map((c) => c.roadmapId)).size;
    headHTML = `
      <header class="map-heading">
        <h1 class="page-title">나선 지도</h1>
      </header>`;
    ariaLabel = `전체 나선 지도: 레포 ${repoCount}개, 챕터 ${mountNodes.length}개. 화살표 키로 챕터 이동, Enter로 레포 지도 열기. 아래 목록으로도 탐색할 수 있습니다.`;
    fallbackHTML = mountNodes
      .map(
        (c) => `<li><a href="#/map/${encodeURIComponent(c.roadmapId)}?chapter=${encodeURIComponent(c.id)}">
      <span class="mf-title">${esc(c.title)}</span>
      <span class="mf-meta">${metaMark("layer", c.layerCount)}${c.oqCount ? metaMark("question", c.oqCount) : ""}</span>
    </a></li>`,
      )
      .join("");
  }

  app.innerHTML = `
    ${headHTML}
    <div class="map-wrap">
      <canvas class="spiral-canvas" tabindex="0" role="group" aria-roledescription="나선 학습 지도"
        aria-label="${esc(ariaLabel)}"></canvas>
    </div>
    <div class="sr-only" aria-live="polite" id="map-live"></div>
    <details class="map-index">
      <summary><span>목록으로 보기</span></summary>
      <ol class="map-fallback">${fallbackHTML}</ol>
    </details>`;

  const canvas = app.querySelector(".spiral-canvas");
  const live = app.querySelector("#map-live");
  try {
    const { mount } = await import("/spiralmap.js");
    if (token !== mapToken || !onMap() || !routeIsCurrent(routeEpoch) || !canvas.isConnected) return; // import 중 라우트가 바뀜 → 죽은 canvas 마운트 방지
    mapHandle = mount(canvas, { nodes: mountNodes }, {
      focus,
      focusGroup: repoKey ? chapterFocus : undefined,
      nodeRoute,
      parentRoute: repoKey ? "#/map" : undefined,
      // 전체 지도에서만: 나선(레포) 원판 클릭 → 그 레포의 나선 지도로
      groupRoute: repoKey ? undefined : (key) => `#/map/${encodeURIComponent(key)}`,
      onNavigate: (route, newTab) => (newTab ? openInNewTab(route) : go(route)),
      onAnnounce: (text) => { if (live) live.textContent = text; },
    });
  } catch {
    /* 캔버스 실패해도 아래 목록으로 전체 내비게이션 가능 */
  }
}

function metaMarkIcon(kind) {
  if (kind === "question") {
    return `<svg class="meta-mark-icon" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
      stroke-linejoin="round" aria-hidden="true" focusable="false">
      <path d="M6.5 5.5h9a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3H11l-4.5 3v-3.4a3 3 0 0 1-2-2.8V8.5a3 3 0 0 1 2-3Z"/>
      <path d="M10 9.1a2 2 0 1 1 2.3 2c-.8.2-1.3.7-1.3 1.4M11 15.1h.01"/>
    </svg>`;
  }
  return `<svg class="meta-mark-icon" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path d="m4.5 7.5 7.5-4 7.5 4-7.5 4-7.5-4Z"/>
    <path d="m5.5 11 6.5 3.5 6.5-3.5M5.5 15l6.5 3.5 6.5-3.5"/>
  </svg>`;
}

function metaMark(kind, value = null) {
  const type = kind === "question" ? "question" : "layer";
  const label = type === "question" ? "열린 질문" : "Layer";
  const title = type === "question" ? "질문" : "Layer";
  const hasValue = value !== null && value !== undefined && value !== "";
  const safeValue = hasValue
    ? Math.max(0, Math.trunc(Number(value) || 0))
    : null;
  return `<span class="meta-mark meta-mark-${type}${hasValue ? "" : " meta-mark-icon-only"}"
    role="img" title="${title}" aria-label="${label}${hasValue ? ` ${safeValue}` : ""}">
    ${metaMarkIcon(type)}
    ${hasValue ? `<span class="meta-mark-value" aria-hidden="true">${safeValue}</span>` : ""}
  </span>`;
}

function subjectRow(s) {
  return `
    <a class="subject-row" href="#/s/${encodeURIComponent(s.id)}">
      <div class="subject-title-line">
        <h3>${esc(displayTitle(s.title))}</h3>
        <span class="subject-arrow" aria-hidden="true">→</span>
      </div>
      <div class="row-meta">
        ${metaMark("layer", s.layerCount)}
        ${s.openQuestionCount ? metaMark("question", s.openQuestionCount) : ""}
      </div>
    </a>`;
}

function sectionHeadingIcon(kind) {
  if (kind === "lookup") {
    return `<span class="section-heading-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
        stroke-linecap="round" stroke-linejoin="round" focusable="false">
        <circle cx="10.5" cy="10.5" r="5.5"/>
        <path d="m14.6 14.6 4.1 4.1"/>
      </svg>
    </span>`;
  }
  if (kind === "dialogue") {
    return `<span class="section-heading-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
        stroke-linecap="round" stroke-linejoin="round" focusable="false">
        <path d="M6.5 5.5h9a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3H11l-4.5 3v-3.4a3 3 0 0 1-2-2.8V8.5a3 3 0 0 1 2-3Z"/>
        <path d="M8.5 9.2h6M8.5 11.8h4"/>
      </svg>
    </span>`;
  }
  return "";
}

function renderSectionHeading(heading) {
  const { kind, label } = sectionHeadingPresentation(heading);
  if (!label) return "";
  if (!kind) return `<h3>${esc(label)}</h3>`;
  return `<h3 class="section-heading section-heading-${kind}">
    ${sectionHeadingIcon(kind)}
    <span>${esc(label)}</span>
  </h3>`;
}

/* ---------- subject 상세 ---------- */

function threadQuestionRow(question, subjectId) {
  return `<a class="thread-prompt-question"
    href="#/s/${encodeURIComponent(subjectId)}?layer=${question.raisedAtLayer}">
    ${metaMark("question")}
    <span class="thread-question-text">${mdInline(question.text)}</span>
    ${metaMark("layer", question.raisedAtLayer)}
  </a>`;
}

async function renderTimeline(id, token) {
  const s = await getJSON(`/api/subjects/${encodeURIComponent(id)}`);
  if (!routeIsCurrent(token)) return;
  const open = s.questions.filter((q) => q.status === "open");
  const { primary: nextQuestion, remaining: remainingQuestions } =
    partitionOpenQuestions(open);
  const qById = Object.fromEntries(s.questions.map((q) => [q.id, q]));
  const lanes = assignLanes(s.questions);
  const laneCount = Math.max(1, ...Object.values(lanes).map((l) => l + 1));
  const gutterW = 72;
  // 질문 실(strand)은 layer가 쌓여 실마다 시작·끝이 달라질 때만 정보가 된다.
  // layer 1개면 전부 동일한 평행선 = 번잡 — 배지·칩이 이미 같은 정보를 전달하므로 생략.
  const showStrands = s.layers.length >= 2;
  const latest = s.layers.at(-1);
  const target = new URLSearchParams(location.hash.split("?")[1]).get("layer");
  const current =
    s.layers.find((layer) => String(layer.index) === target) ?? latest;
  const rid = s.sources?.find((x) => x.kind === "spiral-buddy")?.roadmapId;
  const repository = repoKeyOf(rid);
  const chapter = rid ? chapterLabelOf(rid) : "분류되지 않은 나선";
  const backRoute = rid
    ? `#/map/${encodeURIComponent(repository)}?chapter=${encodeURIComponent(rid)}&focus=${encodeURIComponent(id)}`
    : "#/";
  const backLabel = rid ? `${chapter} 지도` : "나선 일지";

  setTabTitle(displayTitle(s.title));

  app.innerHTML = `
    <nav class="breadcrumbs" aria-label="나선 경로">
      <a class="back-link" href="${backRoute}" aria-label="${esc(backLabel)}로 돌아가기">
        <span aria-hidden="true">←</span><span>${esc(backLabel)}</span>
      </a>
    </nav>
    <header class="subject-mast">
      <div>
        <h1 class="page-title">${esc(displayTitle(s.title))}</h1>
        <p class="subject-meta">
          ${metaMark("layer", s.layers.length)}
          ${open.length ? metaMark("question", open.length) : ""}
        </p>
      </div>
      <button class="bookmark-toggle" type="button"
        data-bookmark-id="${esc(s.id)}" aria-label="북마크" aria-pressed="false">
        <svg class="bookmark-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4Z"/>
        </svg>
        <span class="bookmark-label">북마크</span>
      </button>
    </header>
    ${
      nextQuestion
        ? `<section class="thread-prompt">
            <div class="thread-prompt-copy">
              <h2>열린 질문</h2>
            </div>
            <div class="thread-prompt-list">
              ${threadQuestionRow(nextQuestion, id)}
              ${
                remainingQuestions.length
                  ? `<div class="thread-prompt-more" id="thread-prompt-more" hidden>
                      ${remainingQuestions.map((question) => threadQuestionRow(question, id)).join("")}
                    </div>
                    <button class="thread-more" type="button" aria-expanded="false"
                      aria-controls="thread-prompt-more" data-more-count="${remainingQuestions.length}">
                      <span class="thread-more-collapsed">${remainingQuestions.length}개 더 보기</span>
                      <span class="thread-more-expanded">추가 질문 접기</span>
                      <span aria-hidden="true">↓</span>
                    </button>`
                  : ""
              }
            </div>
          </section>`
        : ""
    }
    ${
      s.layers.length > 1
        ? `<nav class="layer-jump" aria-label="Layer 이동">
            <button class="layer-jump-toggle" type="button"
              aria-expanded="false" aria-controls="layer-jump-links">
              ${metaMarkIcon("layer")}
              <span>Layer 이동</span>
              <span class="layer-jump-chevron" aria-hidden="true"></span>
            </button>
            <div class="layer-jump-links" id="layer-jump-links" hidden>
              ${s.layers.map((layer) => `
                <a href="#/s/${encodeURIComponent(id)}?layer=${layer.index}"
                  ${layer.index === current?.index ? `class="current" aria-current="step"` : ""}>
                  ${metaMark("layer", layer.index)}
                </a>`).join("")}
            </div>
          </nav>`
        : ""
    }
    <h2 class="timeline-title">기록</h2>
    <div class="timeline">
      ${showStrands ? `<div class="strand-gutter"></div>` : ""}
      <div class="layers-col">
        ${s.layers.map((l) => layerCard(l, qById, l.index === current?.index)).join("")}
      </div>
    </div>`;

  app.querySelector(".timeline").style.setProperty(
    "--gutter-w",
    `${showStrands ? gutterW : 0}px`,
  );
  const bookmarkButton = app.querySelector("[data-bookmark-id]");
  paintBookmarkButton(bookmarkButton, s.id);
  bookmarkButton.addEventListener("click", () => {
    setBookmarked(s.id, displayTitle(s.title));
    paintBookmarkButton(bookmarkButton, s.id);
  });
  const layerJumpButton = app.querySelector(".layer-jump-toggle");
  const layerJumpLinks = app.querySelector(".layer-jump-links");
  layerJumpButton?.addEventListener("click", () => {
    const expanded = layerJumpButton.getAttribute("aria-expanded") === "true";
    layerJumpButton.setAttribute("aria-expanded", String(!expanded));
    layerJumpLinks.hidden = expanded;
  });
  const threadMoreButton = app.querySelector(".thread-more");
  const threadMoreQuestions = app.querySelector(".thread-prompt-more");
  threadMoreButton?.addEventListener("click", () => {
    const expanded = threadMoreButton.getAttribute("aria-expanded") === "true";
    threadMoreButton.setAttribute("aria-expanded", String(!expanded));
    threadMoreQuestions.hidden = expanded;
  });

  if (showStrands) mountStrands(s, lanes, laneCount);
  if (target) focusLayer(target);
  if (!routeIsCurrent(token)) return;
  renderConnections(id, repoKeyOf(rid));
}

/* ---------- 연결 패널 (옵시디언식 백링크) ---------- */

async function renderConnections(id, repo = "misc") {
  let c;
  try {
    c = await getJSON(`/api/subjects/${encodeURIComponent(id)}/connections`);
  } catch {
    return; // 연결은 보조 정보 — 실패해도 본문은 그대로
  }
  // 라우팅이 그새 바뀌었으면 그리지 않는다
  const [, page, rawId] = location.hash.split("/");
  if (page !== "s" || decodeURIComponent((rawId ?? "").split("?")[0]) !== id) return;

  const chip = (t) => `<span class="tagchip">${esc(t)}</span>`;
  const row = (x, withTags) => `
    <a class="conn-item" href="#/s/${encodeURIComponent(x.id)}">
      <span class="ci-title">${esc(displayTitle(x.title))}</span>
      ${
        withTags && x.sharedTags?.length
          ? `<span class="ci-tags">${x.sharedTags.slice(0, 3).map(chip).join("")}${
              x.sharedTags.length > 3 ? `<span class="tagchip more">+${x.sharedTags.length - 3}</span>` : ""
            }</span>`
          : ""
      }
      ${x.openQuestionCount ? `<span class="si-oq">${metaMark("question", x.openQuestionCount)}</span>` : ""}
    </a>`;

  const sections = [];
  if (c.roadmap) {
    sections.push(
      `<h3 class="conn-h">같은 로드맵 · ${esc(c.roadmap.title)}</h3>` +
        c.roadmap.siblings.map((x) => row(x, false)).join(""),
    );
  }
  if (c.related.length) {
    const head = c.related.slice(0, 6);
    const more = c.related.slice(6);
    sections.push(
      `<h3 class="conn-h">관련 나선 — 태그 공유</h3>` +
        head.map((x) => row(x, true)).join("") +
        (more.length
          ? `<details class="conn-more"><summary>관련 나선 ${more.length}개 더</summary>${more
              .map((x) => row(x, true))
              .join("")}</details>`
          : ""),
    );
  }
  const links = [...(c.explicit ?? []), ...(c.backlinks ?? [])];
  if (links.length) {
    sections.push(
      `<h3 class="conn-h">명시적 연결</h3>` +
        links
          .map(
            (x) => `
        <a class="conn-item" href="#/s/${encodeURIComponent(x.id)}">
          <span class="ci-dir">${x.direction === "out" ? "→" : "←"}</span>
          <span class="ci-title">${esc(displayTitle(x.title))}</span>
          <span class="ci-type">${esc(x.type)}</span>
        </a>`,
          )
          .join(""),
    );
  }
  app.querySelector(".conn-panel")?.remove(); // 비순차 fetch로 인한 중복 패널 방지
  if (!sections.length) return; // 완전 고립이면 패널 자체를 그리지 않는다

  const panel = document.createElement("details");
  panel.className = "conn-panel";
  panel.innerHTML =
    `<summary>연결</summary>` +
    `<div class="conn-body"><div class="conn-head">` +
    `<a class="conn-maplink" href="#/map/${encodeURIComponent(repo)}?focus=${encodeURIComponent(id)}">지도에서 보기 →</a></div>` +
    sections.join("") +
    `</div>`;
  app.appendChild(panel);
}

function focusLayer(index) {
  const safeIndex = String(index);
  if (!/^\d+$/.test(safeIndex)) return;
  const card = app.querySelector(`[data-layer="${safeIndex}"]`);
  if (!card) return;
  for (const c of app.querySelectorAll(".layer-card.highlight")) {
    c.classList.remove("highlight");
  }
  const details = card.querySelector("details.sections");
  if (details) details.open = true;
  card.classList.add("highlight");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  card.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
}

function layerCard(l, qById, isCurrent = false) {
  const lede =
    l.content.sections.find((sec) => /한 줄 요약/.test(sec.heading))?.body ??
    l.content.sections[0]?.body ??
    "";
  const rest = l.content.sections.filter(
    (sec) => !/한 줄 요약/.test(sec.heading),
  );
  return `
  <article class="layer-card${isCurrent ? " current-layer" : ""}" data-layer="${l.index}">
    <div class="layer-head">
      <span class="ln">${metaMark("layer", l.index)}</span>
      <span>${esc(l.date)}</span>
    </div>
    <p class="layer-lede">${mdInline(firstLine(lede))}</p>
    <div class="qchips">
      ${l.addedQuestionIds
        .map(
          (qid) =>
            `<span class="qchip add">${mdInline(qById[qid]?.text ?? "")}</span>`,
        )
        .join("")}
      ${l.resolvedQuestionIds
        .map(
          (qid) =>
            `<span class="qchip resolve">해소${
              qById[qid]?.resolution ? ` — ${mdInline(qById[qid].resolution)}` : ""
            }</span>`,
        )
        .join("")}
    </div>
    ${
      rest.length
        ? `<details class="sections"${isCurrent ? " open" : ""}>
           <summary>
             <span class="sum-closed">전체 내용 펼치기</span>
             <span class="sum-open">전체 내용 접기</span>
           </summary>
           ${rest
             .map(
               (sec) =>
                 `<div class="section">${renderSectionHeading(sec.heading)}<div class="md">${mdBlock(sec.body)}</div></div>`,
             )
             .join("")}</details>`
        : ""
    }
  </article>`;
}

function mountStrands(s, lanes, laneCount) {
  const timeline = app.querySelector(".timeline");
  const layers = app.querySelector(".layers-col");
  if (!timeline || !layers || !app.querySelector(".strand-gutter")) return;
  const schedule = () => {
    cancelAnimationFrame(strandFrame);
    strandFrame = requestAnimationFrame(() => {
      strandFrame = 0;
      drawStrands(s, lanes, laneCount);
    });
  };
  strandObserver = new ResizeObserver(schedule);
  strandObserver.observe(timeline);
  strandObserver.observe(layers);
  for (const details of layers.querySelectorAll("details.sections")) {
    details.addEventListener("toggle", schedule);
  }
  if (document.fonts?.ready) {
    void document.fonts.ready.then(schedule).catch(() => {});
  }
  schedule();
}

function drawStrands(s, lanes, laneCount) {
  const gutter = app.querySelector(".strand-gutter");
  const timeline = app.querySelector(".timeline");
  if (!gutter || !timeline) return;
  gutter.replaceChildren();
  const base = timeline.getBoundingClientRect();
  const cardY = {};
  for (const card of app.querySelectorAll(".layer-card")) {
    const r = card.getBoundingClientRect();
    cardY[card.dataset.layer] = {
      mid: r.top - base.top + Math.min(r.height / 2, 48),
      bottom: r.bottom - base.top,
    };
  }
  const last = cardY[String(s.layers.at(-1)?.index)] ?? { bottom: 0 };

  const spine = el("div", "spine");
  spine.style.height = `${last.bottom - 8}px`;
  gutter.appendChild(spine);
  for (const l of s.layers) {
    if (!cardY[l.index]) continue;
    const dot = el("div", "spine-dot");
    dot.style.top = `${cardY[l.index].mid - 7}px`;
    gutter.appendChild(dot);
  }

  for (const q of s.questions) {
    const lane = lanes[q.id];
    const x =
      laneCount <= 1 ? 34 : 24 + (Math.max(0, lane) / (laneCount - 1)) * 30;
    const from = cardY[q.raisedAtLayer]?.mid ?? 0;
    const resolved = q.status === "resolved" && cardY[q.resolvedAtLayer];
    const to = resolved ? cardY[q.resolvedAtLayer].mid : last.bottom + 28;
    const cls = resolved ? "resolved-strand" : "open-strand";

    const line = el("div", `strand ${cls}`);
    line.style.left = `${x}px`;
    line.style.top = `${from}px`;
    line.style.height = `${Math.max(to - from, 0)}px`;
    line.title = `${q.id}: ${plain(q.text)}`;
    gutter.appendChild(line);

    const raise = el("div", `strand-dot raise ${cls}-dot`);
    raise.style.left = `${x}px`;
    raise.style.top = `${from - 5}px`;
    raise.title = `${q.id} 제기 (layer ${q.raisedAtLayer})`;
    gutter.appendChild(raise);

    const end = el("div", `strand-dot ${resolved ? "resolve" : "still-open"}`);
    end.style.left = `${x}px`;
    end.style.top = `${to - 5}px`;
    end.title = resolved
      ? `${q.id} 해소 (layer ${q.resolvedAtLayer})`
      : `${q.id} 미해결`;
    gutter.appendChild(end);
  }
}

function assignLanes(questions) {
  const lanes = {};
  const laneEnd = [];
  const sorted = [...questions].sort((a, b) => a.raisedAtLayer - b.raisedAtLayer);
  for (const q of sorted) {
    const end = q.status === "resolved" ? q.resolvedAtLayer : Infinity;
    let lane = laneEnd.findIndex((e) => e < q.raisedAtLayer);
    if (lane === -1) lane = laneEnd.length;
    laneEnd[lane] = end;
    lanes[q.id] = lane;
  }
  return lanes;
}

/* ---------- 질문 대시보드 ---------- */

async function renderQuestions(_id, token) {
  const [questions, subjects] = await Promise.all([
    getJSON("/api/questions"),
    getJSON("/api/subjects"),
  ]);
  if (!routeIsCurrent(token)) return;
  const titleById = Object.fromEntries(
    subjects.map((s) => [s.id, displayTitle(s.title)]),
  );
  if (questions.length === 0) {
    app.innerHTML = `
      <h1 class="page-title">열린 질문</h1>
      <div class="empty">현재 열린 질문이 없습니다.<br/>새 Layer가 질문을 남기면 이곳에 이어갈 내용이 모입니다.</div>`;
    return;
  }
  app.innerHTML = `
    <header class="question-mast">
      <h1 class="page-title">열린 질문</h1>
      <div class="question-total">${metaMark("question", questions.length)}</div>
    </header>
    <div class="question-toolbar">
      <label class="question-filter">
        <span class="sr-only">열린 질문 필터</span>
        <input id="question-filter" type="search" placeholder="질문이나 나선 이름으로 찾기" autocomplete="off" />
      </label>
      <label class="question-sort">
        <span class="question-sort-label">정렬</span>
        <select id="question-sort">
          <option value="oldest">오래된 질문부터</option>
          <option value="newest">최근 질문부터</option>
          <option value="subject">나선 이름순</option>
        </select>
      </label>
    </div>
    <div class="question-list" id="question-list"></div>`;

  const list = document.getElementById("question-list");
  const filter = document.getElementById("question-filter");
  const sort = document.getElementById("question-sort");
  const paint = () => {
    const filtered = filterOpenQuestions(questions, filter.value, titleById);
    const ordered = sortOpenQuestions(filtered, sort.value, titleById);
    if (!ordered.length) {
      list.innerHTML = `<div class="empty question-empty">일치하는 열린 질문이 없습니다.</div>`;
      return;
    }
    list.innerHTML = ordered
      .map((question) => `
        <a class="q-row" href="#/s/${encodeURIComponent(question.subjectId)}?layer=${question.raisedAtLayer}">
          ${metaMark("question")}
          <span class="q-main">
            <span class="q-subject">${esc(titleById[question.subjectId] ?? question.subjectId)}</span>
            <span class="qtext">${mdInline(question.text)}</span>
          </span>
          <span class="qwhere">${metaMark("layer", question.raisedAtLayer)}</span>
        </a>`)
      .join("");
  };
  filter.addEventListener("input", paint);
  sort.addEventListener("change", paint);
  paint();
}

/* ---------- utils ---------- */

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function el(tag, className) {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function esc(raw) {
  return String(raw).replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
  );
}

function plain(raw) {
  return String(raw)
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

function compactText(raw, max = 160) {
  const value = plain(raw).replace(/\s+/g, " ").trim();
  return value.length > max
    ? `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`
    : value;
}

function displayTitle(title) {
  return String(title).replace(/^\d+[.)]\s*/, "");
}

function firstLine(text) {
  return text.split("\n").find((line) => line.trim()) ?? "";
}
