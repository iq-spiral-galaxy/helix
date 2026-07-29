import {
  filterOpenQuestions,
  selectHomeFocus,
  sortOpenQuestions,
  sortSubjects,
} from "/experience.js";

const app = document.getElementById("app");
const routes = { "": renderHome, q: renderQuestions, s: renderTimeline, map: renderMap };
let mapHandle = null; // 나선 지도(#/map) 캔버스 정리 훅 (라우트 전환 시 destroy)
let mapToken = 0; // renderMap 비동기 import 중 라우트가 바뀌면 mount 취소
let routeToken = 0; // 모든 라우트의 느린 응답이 최신 화면을 덮지 못하게 하는 세대 번호
let strandObserver = null;
let strandFrame = 0;

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
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>`,
    )
    .join("");
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

/* ---------- 사이드바 ---------- */

/** 깨진/오염된 localStorage 값에 내성 — 항상 객체를 돌려준다 */
function readCollapsed() {
  try {
    const v = JSON.parse(localStorage.getItem("helix.roadmap.collapsed") || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

async function initSidebar() {
  try {
    const [subjects, grouping] = await Promise.all([
      getJSON("/api/subjects"),
      getJSON("/api/roadmaps"),
    ]);
    const byId = Object.fromEntries(subjects.map((s) => [s.id, s]));
    subjectTitles = Object.fromEntries(subjects.map((s) => [s.id, displayTitle(s.title)]));
    // 로딩 전에 열려서 "…"로 남은 탭 제목을 소급 확정
    let fixed = false;
    for (const t of tabs) {
      if (t.title === "…") { t.title = titleForRoute(t.route); fixed = true; }
    }
    if (fixed) { renderTabs(); saveTabs(); }
    const collapsed = readCollapsed();

    const itemHTML = (id) => {
      const s = byId[id];
      if (!s) return "";
      return `
        <a class="side-item" data-sid="${esc(id)}" href="#/s/${encodeURIComponent(id)}" title="${esc(displayTitle(s.title))}">
          <span class="si-title">${esc(displayTitle(s.title))}</span>
          ${s.openQuestionCount ? `<span class="si-oq" aria-label="열린 질문 ${s.openQuestionCount}개"></span>` : ""}
        </a>`;
    };
    const chapterHTML = (chapter) => `
      <div class="side-chapter">
        <a class="side-chapter-head" href="#/map/${encodeURIComponent(chapter.repositoryId)}?chapter=${encodeURIComponent(chapter.id)}">
          <span>${esc(chapter.title)}</span>
        </a>
        <div class="side-chapter-items">${chapter.subjectIds.map(itemHTML).join("")}</div>
      </div>`;
    const groupHTML = (key, label, chapters) => {
      const open = !collapsed[key];
      return `
        <section class="side-group" data-rm="${esc(key)}">
          <button class="side-group-head" aria-expanded="${open}">
            <span class="disc">${open ? "▾" : "▸"}</span>
            <span class="rm-label">${esc(label)}</span>
          </button>
          <div class="side-group-body"${open ? "" : " hidden"}>${chapters.map(chapterHTML).join("")}</div>
        </section>`;
    };

    // API 구버전에도 내성을 유지하면서 Repo > Chapter > Subject 계층을 복원한다.
    const repositories = grouping.repositories ?? (() => {
      const byRepo = new Map();
      for (const chapter of grouping.roadmaps ?? []) {
        const repositoryId = repoKeyOf(chapter.id);
        if (!byRepo.has(repositoryId)) {
          byRepo.set(repositoryId, {
            id: repositoryId,
            title: repoLabelOf(repositoryId),
            chapters: [],
          });
        }
        byRepo.get(repositoryId).chapters.push({
          ...chapter,
          repositoryId,
        });
      }
      return [...byRepo.values()];
    })();
    const miscChapters = grouping.ungrouped?.length
      ? [{
          id: "__misc",
          repositoryId: "misc",
          title: "분류되지 않은 나선",
          subjectIds: grouping.ungrouped,
        }]
      : [];
    const html = [
      ...repositories.map((repo) =>
        groupHTML(`repo:${repo.id}`, repo.title, repo.chapters),
      ),
      miscChapters.length ? groupHTML("__misc", "기타", miscChapters) : "",
    ].join("");
    const list = document.getElementById("side-list");
    list.innerHTML = html;

    list.addEventListener("click", (e) => {
      const head = e.target.closest(".side-group-head");
      if (!head) return;
      const sec = head.closest(".side-group");
      const body = sec.querySelector(".side-group-body");
      const open = body.hidden; // 토글 후 상태
      body.hidden = !open;
      head.querySelector(".disc").textContent = open ? "▾" : "▸";
      head.setAttribute("aria-expanded", String(open));
      const next = readCollapsed();
      next[sec.dataset.rm] = !open;
      localStorage.setItem("helix.roadmap.collapsed", JSON.stringify(next));
    });

    markSidebar();
  } catch {
    /* 사이드바는 장식 — 실패해도 본문 라우팅은 계속 동작 */
  }
}

function markSidebar() {
  const [, rawPage = "", rawId] = location.hash.split("/");
  const page = rawPage.split("?")[0];
  const navFor = page === "q" ? "questions" : page === "map" ? "map" : "subjects";
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
    // 현재 나선이 접힌 그룹 안이면 그 그룹을 펼쳐 보이게 한다
    if (on) {
      const body = item.closest(".side-group-body");
      if (body?.hidden) {
        body.hidden = false;
        const head = body.closest(".side-group").querySelector(".side-group-head");
        head.querySelector(".disc").textContent = "▾";
        head.setAttribute("aria-expanded", "true");
      }
      item.scrollIntoView({ block: "nearest" });
    }
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
    sideToggle.setAttribute("aria-label", open ? "나선 목록 닫기" : "나선 목록 열기");
    sideToggle.querySelector(".sr-only").textContent =
      open ? "나선 목록 닫기" : "나선 목록 열기";
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
  sidePanel.classList.add("mobile-open");
  syncMobileSidebar();
  sidePanel.querySelector(".side-search, .side-nav a")?.focus();
}

function closeMobileSidebar(restoreFocus = true) {
  const wasOpen = sidePanel.classList.contains("mobile-open");
  sidePanel.classList.remove("mobile-open");
  syncMobileSidebar();
  if (restoreFocus && wasOpen && mobileQuery.matches) sideToggle.focus();
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
document.getElementById("mobile-search").addEventListener("click", openSearch);
document.getElementById("mobile-bottom-search").addEventListener("click", openSearch);
mobileQuery.addEventListener("change", syncMobileSidebar);
syncMobileSidebar();
void route();
void initSidebar();

/* ---------- 검색 (Cmd/Ctrl+K) ---------- */

const searchModal = document.getElementById("search-modal");
const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");
const searchClose = document.getElementById("search-close");
const shell = document.querySelector(".shell");
let searchIndex = null;
let searchIndexPromise = null;
let searchSel = 0;
let searchHits = [];
let searchQueryToken = 0;

document.getElementById("search-trigger").addEventListener("click", openSearch);
searchClose.addEventListener("click", closeSearch);
document.addEventListener("keydown", (e) => {
  if (
    document.getElementById("settings-dialog")?.open &&
    (e.metaKey || e.ctrlKey) &&
    e.key.toLowerCase() === "k"
  ) {
    e.preventDefault();
    return;
  }
  if (!searchModal.hidden && e.key === "Tab") {
    e.preventDefault();
    if (e.shiftKey) {
      (document.activeElement === searchInput ? searchClose : searchInput).focus();
    } else {
      (document.activeElement === searchClose ? searchInput : searchClose).focus();
    }
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    searchModal.hidden ? openSearch() : closeSearch();
  } else if (e.key === "Escape" && !searchModal.hidden) {
    closeSearch();
  } else if (e.key === "Escape" && sidePanel.classList.contains("mobile-open")) {
    closeMobileSidebar();
  }
});
searchModal.addEventListener("click", (e) => {
  if (e.target === searchModal) closeSearch();
});

let searchOpener = null; // 닫을 때 포커스를 되돌릴 직전 요소

function openSearch() {
  searchOpener = document.activeElement;
  closeMobileSidebar(false);
  searchModal.hidden = false;
  shell.inert = true;
  searchInput.setAttribute("aria-expanded", "true");
  document.getElementById("search-trigger").setAttribute("aria-expanded", "true");
  document.getElementById("mobile-search").setAttribute("aria-expanded", "true");
  document.getElementById("mobile-bottom-search").setAttribute("aria-expanded", "true");
  searchInput.value = "";
  searchInput.removeAttribute("aria-activedescendant");
  searchResults.innerHTML = `<p class="sr-hint">입력하여 검색하기 — 나선 제목 · 태그 · Layer 본문 · 질문</p>`;
  searchInput.focus();
  void buildIndex().catch(() => {}); // 백그라운드에서 미리 적재
}

function closeSearch() {
  searchQueryToken += 1;
  searchModal.hidden = true;
  shell.inert = false;
  searchInput.setAttribute("aria-expanded", "false");
  searchInput.removeAttribute("aria-activedescendant");
  document.getElementById("search-trigger").setAttribute("aria-expanded", "false");
  document.getElementById("mobile-search").setAttribute("aria-expanded", "false");
  document.getElementById("mobile-bottom-search").setAttribute("aria-expanded", "false");
  // 포커스 복귀 — 트리거(또는 직전 요소)로 되돌린다
  const back = searchOpener instanceof HTMLElement ? searchOpener : document.getElementById("search-trigger");
  back?.focus();
  searchOpener = null;
}

/* ---------- 설정 ---------- */

const settingsTrigger = document.getElementById("settings-trigger");
const settingsDialog = document.getElementById("settings-dialog");
const settingsClose = document.getElementById("settings-close");
const themeColor = document.getElementById("theme-color");
const themeInputs = [...document.querySelectorAll('input[name="helix-theme"]')];

function currentTheme() {
  return root.dataset.theme === "dark" ? "dark" : "light";
}

function syncThemeControls() {
  const theme = currentTheme();
  for (const input of themeInputs) input.checked = input.value === theme;
  themeColor.content = theme === "dark" ? "#1b2420" : "#f7f8f5";
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
  if (!searchModal.hidden) closeSearch();
  closeMobileSidebar(false);
  syncThemeControls();
  settingsTrigger.setAttribute("aria-expanded", "true");
  if (!settingsDialog.open) settingsDialog.showModal();
  settingsClose.focus();
}

function closeSettings() {
  if (settingsDialog.open) settingsDialog.close();
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
});
syncThemeControls();

async function buildIndex() {
  if (searchIndex) return searchIndex;
  if (searchIndexPromise) return searchIndexPromise;
  searchIndexPromise = (async () => {
    const subjects = await getJSON("/api/subjects");
    const details = await Promise.all(
      subjects.map((s) => getJSON(`/api/subjects/${encodeURIComponent(s.id)}`)),
    );
    const next = [];
    for (const s of details) {
      const title = displayTitle(s.title);
      const base = `#/s/${encodeURIComponent(s.id)}`;
      next.push({ kind: "나선", k: "subject", title, text: s.tags.join(" · "), route: base });
      for (const l of s.layers) {
        const body = l.content.sections
          .map((sec) => `${sec.heading ?? ""} ${sec.body}`)
          .join(" ");
        next.push({
          kind: `L${l.index}`,
          k: "layer",
          title,
          text: plain(body).replace(/\s+/g, " ").trim(),
          route: `${base}?layer=${l.index}`,
        });
      }
      for (const q of s.questions) {
        next.push({
          kind: q.status === "open" ? "질문" : "해소",
          k: q.status === "open" ? "question" : "resolved",
          title,
          text: plain(q.text),
          route: `${base}?layer=${q.raisedAtLayer}`,
        });
      }
    }
    searchIndex = next;
    return next;
  })();
  try {
    return await searchIndexPromise;
  } finally {
    searchIndexPromise = null;
  }
}

searchInput.addEventListener("input", async () => {
  const token = ++searchQueryToken;
  const q = searchInput.value.trim().toLowerCase();
  if (!q) {
    searchHits = [];
    searchResults.removeAttribute("aria-busy");
    searchInput.removeAttribute("aria-activedescendant");
    searchResults.innerHTML = `<p class="sr-hint">입력하여 검색하기 — 나선 제목 · 태그 · Layer 본문 · 질문</p>`;
    return;
  }
  searchResults.setAttribute("aria-busy", "true");
  let index;
  try {
    index = await buildIndex();
  } catch {
    if (token !== searchQueryToken || searchModal.hidden) return;
    searchIndex = null;
    searchResults.removeAttribute("aria-busy");
    searchResults.innerHTML = `<p class="sr-hint">검색 색인을 불러오지 못했습니다. 다시 입력해 주세요.</p>`;
    return;
  }
  if (
    token !== searchQueryToken ||
    searchModal.hidden ||
    searchInput.value.trim().toLowerCase() !== q
  ) return;
  const rank = { subject: 0, question: 1, resolved: 2, layer: 3 };
  searchHits = index
    .map((entry) => {
      const inTitle = entry.title.toLowerCase().indexOf(q);
      const inText = entry.text.toLowerCase().indexOf(q);
      if (inTitle === -1 && inText === -1) return null;
      return { ...entry, score: (inTitle !== -1 ? 0 : 10) + rank[entry.k] };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score)
    .slice(0, 30);
  searchSel = 0;
  searchResults.removeAttribute("aria-busy");
  paintResults(q);
});

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    searchSel = Math.min(searchSel + 1, searchHits.length - 1);
    paintResults(searchInput.value.trim().toLowerCase());
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    searchSel = Math.max(searchSel - 1, 0);
    paintResults(searchInput.value.trim().toLowerCase());
  } else if (e.key === "Enter" && searchHits[searchSel]) {
    openHit(searchHits[searchSel], e.metaKey || e.ctrlKey);
  }
});

searchResults.addEventListener("click", (e) => {
  const row = e.target.closest(".sr-row");
  if (row) openHit(searchHits[Number(row.dataset.hit)], e.metaKey || e.ctrlKey);
});

function openHit(hit, newTab) {
  if (!hit) return;
  closeSearch();
  if (newTab) openInNewTab(hit.route);
  else go(hit.route);
}

function paintResults(q) {
  if (searchHits.length === 0) {
    searchInput.removeAttribute("aria-activedescendant");
    searchResults.innerHTML = `<p class="sr-hint">일치하는 결과가 없습니다.</p>`;
    return;
  }
  searchResults.innerHTML = searchHits
    .map((h, i) => {
      const inTitle = h.title.toLowerCase().indexOf(q);
      const snippet = inTitle !== -1 ? h.text.slice(0, 90) : excerpt(h.text, q);
      return `
      <div class="sr-row${i === searchSel ? " sel" : ""}" data-hit="${i}"
           id="search-option-${i}" role="option" aria-selected="${i === searchSel}">
        <span class="sr-kind k-${h.k}">${esc(h.kind)}</span>
        <span class="sr-main">
          <span class="sr-title">${inTitle !== -1 ? mark(h.title, q) : esc(h.title)}</span>
          <span class="sr-snippet">${inTitle !== -1 ? esc(snippet) : mark(snippet, q)}</span>
        </span>
      </div>`;
    })
    .join("");
  searchInput.setAttribute("aria-activedescendant", `search-option-${searchSel}`);
  searchResults.querySelector(".sr-row.sel")?.scrollIntoView({ block: "nearest" });
}

function excerpt(text, q) {
  const i = text.toLowerCase().indexOf(q);
  if (i === -1) return text.slice(0, 90);
  const from = Math.max(0, i - 32);
  return (from > 0 ? "…" : "") + text.slice(from, i + q.length + 56);
}

function mark(text, q) {
  const i = text.toLowerCase().indexOf(q);
  if (i === -1) return esc(text);
  return `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
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
        <span class="continue-label">${focus.question ? "다음 질문" : "이어서 보기"}</span>
        <h2 id="continue-title">${esc(displayTitle(focus.subject.title))}</h2>
        <p>${focus.question ? mdInline(focusText) : esc(focusText)}</p>
        <span class="continue-context">Layer ${focusLayer}</span>
      </div>
      <a class="continue-action" href="${focusRoute}">
        ${focus.question ? "질문 이어보기" : "노트 열기"} <span aria-hidden="true">→</span>
      </a>
    </section>
    <div class="sec-head">
      <h2>노트</h2>
      <div class="subject-sort" role="group" aria-label="나선 정렬">
        <button type="button" data-home-sort="recent" aria-pressed="true">최근</button>
        <button type="button" data-home-sort="questions" aria-pressed="false">질문</button>
      </div>
    </div>
    <div class="subject-list" id="home-subject-list"></div>`;

  const list = document.getElementById("home-subject-list");
  const paintSubjects = (mode) => {
    list.innerHTML = sortSubjects(subjects, mode).map(subjectRow).join("");
  };
  paintSubjects("recent");
  app.querySelector(".subject-sort").addEventListener("click", (event) => {
    const button = event.target.closest("[data-home-sort]");
    if (!button) return;
    for (const option of app.querySelectorAll("[data-home-sort]")) {
      option.setAttribute("aria-pressed", String(option === button));
    }
    paintSubjects(button.dataset.homeSort);
  });
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
        <a class="back-link map-back" href="#/map" aria-label="전체 나선 지도로 돌아가기">
          <span aria-hidden="true">←</span><span>전체 지도</span>
        </a>
        <h1 class="page-title">${esc(label)}</h1>
      </header>`;
    ariaLabel = `${label} 나선 지도: 주제 ${subs.length}개.${selectedChapterLabel ? ` 현재 ${selectedChapterLabel} 챕터에 초점.` : ""} 왼쪽과 오른쪽 화살표 키로 노드 이동, Enter로 열기. 아래 목록으로도 탐색할 수 있습니다.`;
    fallbackHTML = subs
      .map(
        (n) => `<li${n.roadmapId === selectedChapter ? ` class="current-chapter"` : ""}><a href="#/s/${encodeURIComponent(n.id)}">
      <span class="mf-title">${esc(displayTitle(n.title))}</span>
      ${n.roadmapTitle ? `<span class="mf-rm">${esc(n.roadmapTitle)}</span>` : ""}
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
      // 전체 지도에서만: 나선(레포) 원판 클릭 → 그 레포의 나선 지도로
      groupRoute: repoKey ? undefined : (key) => `#/map/${encodeURIComponent(key)}`,
      onNavigate: (route, newTab) => (newTab ? openInNewTab(route) : go(route)),
      onAnnounce: (text) => { if (live) live.textContent = text; },
    });
  } catch {
    /* 캔버스 실패해도 아래 목록으로 전체 내비게이션 가능 */
  }
}

function subjectRow(s) {
  return `
    <a class="subject-row" href="#/s/${encodeURIComponent(s.id)}">
      <div class="subject-title-line">
        <h3>${esc(displayTitle(s.title))}</h3>
        <span class="subject-arrow" aria-hidden="true">→</span>
      </div>
      <div class="row-meta">
        <span>Layer ${s.layerCount}</span>
        ${s.openQuestionCount ? `<span class="oq">질문 ${s.openQuestionCount}</span>` : ""}
      </div>
    </a>`;
}

/* ---------- subject 상세 ---------- */

async function renderTimeline(id, token) {
  const s = await getJSON(`/api/subjects/${encodeURIComponent(id)}`);
  if (!routeIsCurrent(token)) return;
  const open = s.questions.filter((q) => q.status === "open");
  const nextQuestion = open
    .slice()
    .sort((a, b) => String(a.raisedAtDate).localeCompare(String(b.raisedAtDate)))[0];
  const qById = Object.fromEntries(s.questions.map((q) => [q.id, q]));
  const lanes = assignLanes(s.questions);
  const laneCount = Math.max(1, ...Object.values(lanes).map((l) => l + 1));
  const gutterW = 72;
  // 질문 실(strand)은 layer가 쌓여 실마다 시작·끝이 달라질 때만 정보가 된다.
  // layer 1개면 전부 동일한 평행선 = 번잡 — 배지·칩이 이미 같은 정보를 전달하므로 생략.
  const showStrands = s.layers.length >= 2;
  const latest = s.layers.at(-1);
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
        <p class="subject-meta">Layer ${s.layers.length}${open.length ? ` · 열린 질문 ${open.length}` : ""}</p>
      </div>
    </header>
    ${
      nextQuestion
        ? `<section class="thread-prompt">
            <div class="thread-prompt-copy">
              <h2>열린 질문</h2>
            </div>
            <div class="thread-prompt-list">
              <a href="#/s/${encodeURIComponent(id)}?layer=${nextQuestion.raisedAtLayer}">
                <span>${mdInline(compactText(nextQuestion.text, 150))}</span>
                <b>Layer ${nextQuestion.raisedAtLayer}</b>
              </a>
              ${open.length > 1 ? `<a class="thread-more" href="#/q">${open.length - 1}개 더 보기 →</a>` : ""}
            </div>
          </section>`
        : ""
    }
    <details class="layer-jump">
      <summary>Layer 이동</summary>
      <div>
        ${s.layers.map((layer) => `
          <a href="#/s/${encodeURIComponent(id)}?layer=${layer.index}"
             ${layer.index === latest?.index ? `class="latest" aria-label="최신 Layer ${layer.index}"` : ""}>
            ${layer.index}
          </a>`).join("")}
      </div>
    </details>
    <h2 class="timeline-title">기록</h2>
    <div class="timeline" style="--gutter-w:${showStrands ? gutterW : 0}px">
      ${showStrands ? `<div class="strand-gutter"></div>` : ""}
      <div class="layers-col">
        ${s.layers.map((l) => layerCard(l, qById, l.index === latest?.index)).join("")}
      </div>
    </div>`;

  if (showStrands) mountStrands(s, lanes, laneCount);
  const target = new URLSearchParams(location.hash.split("?")[1]).get("layer");
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
      ${x.openQuestionCount ? `<span class="si-oq">${x.openQuestionCount}</span>` : ""}
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

function layerCard(l, qById, isLatest = false) {
  const lede =
    l.content.sections.find((sec) => /한 줄 요약/.test(sec.heading))?.body ??
    l.content.sections[0]?.body ??
    "";
  const rest = l.content.sections.filter(
    (sec) => !/한 줄 요약/.test(sec.heading),
  );
  return `
  <article class="layer-card${isLatest ? " latest-layer" : ""}" data-layer="${l.index}">
    <div class="layer-head">
      <span class="ln">Layer ${l.index}${isLatest ? " · 최신" : ""}</span>
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
        ? `<details class="sections"${isLatest ? " open" : ""}>
           <summary>
             <span class="sum-closed">전체 내용 펼치기</span>
             <span class="sum-open">전체 내용 접기</span>
           </summary>
           ${rest
             .map(
               (sec) =>
                 `<div class="section">${sec.heading ? `<h3>${esc(sec.heading)}</h3>` : ""}<div class="md">${mdBlock(sec.body)}</div></div>`,
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
      <h1 class="page-title">열린 질문 <span class="title-count">${questions.length}</span></h1>
    </header>
    <div class="question-toolbar">
      <label class="question-filter">
        <span class="sr-only">열린 질문 필터</span>
        <input id="question-filter" type="search" placeholder="질문이나 나선 이름으로 찾기" autocomplete="off" />
      </label>
      <label class="question-sort">
        <span>정렬</span>
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
          <span class="q-main">
            <span class="q-subject">${esc(titleById[question.subjectId] ?? question.subjectId)}</span>
            <span class="qtext">${mdInline(question.text)}</span>
          </span>
          <span class="qwhere">Layer ${question.raisedAtLayer}</span>
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

function mdInline(raw) {
  return esc(raw)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\s][^*]*)\*/g, "<em>$1</em>") // ** 처리 후 남은 단일 * = 이탤릭
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/**
 * 경량 신택스 하이라이터 (의존성 0) — 언어 불문 범용 토큰:
 * 주석 · 문자열 · @어노테이션 · 숫자 · 키워드 · 타입(대문자 시작) · 함수 호출.
 * 토큰별로 esc 처리하므로 XSS-safe. 학습 노트의 Java/JS/SQL/Python 코드에 충분한 수준.
 */
const CODE_TOKEN_RE = new RegExp(
  [
    /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/, // 1 주석 (블록·라인)
    /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/, // 2 문자열
    /((?<=^|[\s(])#[^\n]*)/, // 3 # 주석 (파이썬/셸)
    /(@[A-Za-z_]\w*)/, // 4 어노테이션
    /(\b(?:0x[\da-fA-F_]+|\d[\d_]*(?:\.\d+)?[fFLdD]?)\b)/, // 5 숫자
    /(\b(?:abstract|async|await|boolean|break|byte|case|catch|char|class|const|continue|def|delete|do|double|else|enum|extends|final|finally|float|for|from|fun|function|if|implements|import|in|instanceof|int|interface|is|lambda|let|long|new|not|null|of|or|and|package|print|private|protected|public|record|return|select|short|static|super|switch|this|throw|throws|try|typeof|val|var|void|when|where|while|yield|true|false|None|True|False)\b)/, // 6 키워드
    /(\b[A-Z]\w*\b)/, // 7 타입/상수 (대문자 시작)
    /(\b[a-z_]\w*(?=\s*\())/, // 8 함수 호출
  ]
    .map((r) => r.source)
    .join("|"),
  "gm",
);
const CODE_TOKEN_CLS = ["tk-c", "tk-s", "tk-c", "tk-a", "tk-n", "tk-k", "tk-t", "tk-f"];

function highlightCode(src) {
  let out = "";
  let last = 0;
  let m;
  CODE_TOKEN_RE.lastIndex = 0;
  while ((m = CODE_TOKEN_RE.exec(src))) {
    out += esc(src.slice(last, m.index));
    const gi = m.slice(1).findIndex((g) => g !== undefined);
    out += `<span class="${CODE_TOKEN_CLS[gi]}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(src.slice(last));
}

/** 블록 마크다운(불릿·번호목록·코드펜스·문단) → 안전한 HTML. 섹션 본문용 — esc 후 변환이라 XSS-safe. */
function mdBlock(raw) {
  const lines = String(raw).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  const para = [];
  let list = null;
  let code = null;
  const codeHTML = (buf) =>
    `<pre class="codeblock"><code>${highlightCode(buf.join("\n"))}</code></pre>`;
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${mdInline(para.join(" "))}</p>`);
      para.length = 0;
    }
  };
  const flushList = () => {
    if (!list) return;
    out.push(
      `<ul>${list
        .map(
          (it) =>
            `<li class="${it.num ? "li-num" : ""}${it.ind ? " li-1" : ""}">${mdInline(it.text)}</li>`,
        )
        .join("")}</ul>`,
    );
    list = null;
  };

  for (const line of lines) {
    if (code) {
      if (/^\s*```/.test(line)) {
        out.push(codeHTML(code.buf));
        code = null;
      } else {
        code.buf.push(line);
      }
      continue;
    }
    if (/^\s*```/.test(line)) {
      flushPara();
      flushList();
      code = { buf: [] };
      continue;
    }
    const li = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (li) {
      flushPara();
      (list ??= []).push({ ind: li[1].length >= 2 ? 1 : 0, text: li[2], num: false });
      continue;
    }
    const oli = line.match(/^(\s*)(\d+[.)])\s+(.+)$/);
    if (oli) {
      flushPara();
      (list ??= []).push({ ind: oli[1].length >= 2 ? 1 : 0, text: `${oli[2]} ${oli[3]}`, num: true });
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  if (code) out.push(codeHTML(code.buf)); // 닫히지 않은 펜스도 코드로 처리
  flushPara();
  flushList();
  return out.join("");
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
