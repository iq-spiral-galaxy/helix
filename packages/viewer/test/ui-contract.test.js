import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const publicDir = new URL("../public/", import.meta.url);
const [html, app, css, map, themeInit, markdown] = await Promise.all([
  readFile(new URL("index.html", publicDir), "utf8"),
  readFile(new URL("app.js", publicDir), "utf8"),
  readFile(new URL("styles.css", publicDir), "utf8"),
  readFile(new URL("spiralmap.js", publicDir), "utf8"),
  readFile(new URL("theme-init.js", publicDir), "utf8"),
  readFile(new URL("markdown.js", publicDir), "utf8"),
]);

function token(block, name) {
  return block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
}

function luminance(hex) {
  const channels = hex
    .slice(1)
    .match(/../g)
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a, b) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

function channelSpread(hex) {
  const channels = hex
    .slice(1)
    .match(/../g)
    .map((value) => Number.parseInt(value, 16));
  return Math.max(...channels) - Math.min(...channels);
}

function rgbaChannels(block, name) {
  const match = block.match(
    new RegExp(
      `--${name}:\\s*rgba\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*([\\d.]+)\\s*\\)`,
    ),
  );
  return match ? match.slice(1).map(Number) : [];
}

function ruleBodies(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    ...source.matchAll(new RegExp(`${escaped}\\s*\\{([^{}]*)\\}`, "g")),
  ].map((match) => match[1]);
}

function lastRule(source, selector) {
  return ruleBodies(source, selector).at(-1) ?? "";
}

describe("Helix viewer UI contract", () => {
  it("검색·탭·모바일 탐색의 접근성 표면을 유지한다", () => {
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('id="side-search-input"');
    expect(html).toContain('id="side-search-status"');
    expect(html).not.toContain('id="search-modal"');
    expect(html).toContain('id="sidebar-toggle"');
    expect(html).toContain('class="mobile-bottom-nav"');
    expect(app).toContain('role="option"');
    expect(app).toContain("aria-activedescendant");
  });

  it("질문 → Layer → 지도 맥락을 잇는 핵심 워크플로를 렌더한다", () => {
    expect(app).toContain("selectHomeFocus");
    expect(app).toContain("다음 질문");
    expect(app).toContain("Layer 이동");
    expect(app).toContain("?chapter=");
    expect(app).toContain("focusGroup:");
  });

  it("외부 CDN 없이 안전한 Markdown과 Obsidian callout을 렌더한다", () => {
    expect(app).toContain('from "/markdown.js"');
    expect(markdown).toContain("export function renderMarkdown(raw)");
    expect(markdown).toContain("function renderCallout");
    expect(markdown).toContain("function renderTable");
    expect(markdown).toContain("function safeHref");
    expect(markdown).toContain("escapeHtml");
    expect(html).not.toContain("cdn.jsdelivr.net");
    expect(html).not.toContain("unpkg.com");
    expect(css).toContain(".section .md .md-callout");
    expect(css).toContain(".section .md .md-table-wrap");
  });

  it("나와 버디를 색상에만 의존하지 않는 대화 turn으로 구분한다", () => {
    expect(markdown).toContain('role="list" aria-label="나와 버디의 대화"');
    expect(markdown).toContain('role="listitem"');
    expect(markdown).toContain('class="md-dialogue-symbol"');
    expect(markdown).toContain('focusable="false"');
    expect(css).toContain(".md-dialogue-turn-me");
    expect(css).toContain(".md-dialogue-turn-buddy");
    expect(css).toMatch(
      /@media \(max-width: 520px\)[\s\S]*\.md-dialogue-turn[\s\S]*grid-template-columns/,
    );
    expect(css).toMatch(
      /@media \(forced-colors: active\)[\s\S]*--speaker-buddy-border: Highlight/,
    );
  });

  it("기존 섹션 이모지를 중립적인 선형 아이콘과 텍스트 제목으로 바꾼다", () => {
    expect(app).toContain("sectionHeadingPresentation");
    expect(app).toContain('class="section-heading-icon" aria-hidden="true"');
    expect(app).toContain('focusable="false"');
    expect(app).toContain('class="section-heading section-heading-${kind}"');
    expect(app).not.toContain("<h3>${esc(sec.heading)}</h3>");
    expect(css).toContain(".section-heading-icon svg");
  });

  it("Layer 표시와 이동 제어를 군더더기 없이 같은 축에 정렬한다", () => {
    expect(app).not.toContain('${isLatest ? " · 최신" : ""}');
    expect(app).not.toContain('aria-label="최신 Layer');
    expect(app).toContain('aria-current="step"');
    expect(app).toMatch(/const current =[\s\S]*?String\(layer\.index\) === target/);
    expect(app).toContain("layer.index === current?.index");
    expect(app).toContain('class="layer-jump-toggle"');
    expect(app).toContain('aria-controls="layer-jump-links"');
    expect(app).toContain('class="layer-jump-links" id="layer-jump-links" hidden');
    expect(app).toContain('layerJumpButton.setAttribute("aria-expanded"');
    expect(css).toContain("--layer-rail-gap: 1.1rem");
    expect(lastRule(css, ".layer-jump")).toContain("align-items: center");
    expect(lastRule(css, ".layer-jump-links")).toContain("align-items: center");
    expect(lastRule(css, ".layer-jump-links")).toContain("padding: 7px 4px");
    expect(lastRule(css, ".layer-jump-toggle")).toContain("align-items: center");
    expect(lastRule(css, ".layer-jump a:not(.latest-link)")).toContain(
      "place-items: center",
    );
    expect(lastRule(css, ".layer-jump a:not(.latest-link)")).toContain(
      "line-height: 1",
    );
    expect(lastRule(css, ".layer-card.current-layer::before")).toContain(
      "left: calc(-1 * var(--layer-rail-gap))",
    );
    expect(lastRule(css, ".qchip.add")).toContain("padding-left: 0.8rem");
    expect(lastRule(css, ".qchip.add")).toContain(
      "border-left-color: var(--accent-border)",
    );
  });

  it("과장된 콘셉트 라벨과 지도 메타데이터를 기본 화면에서 제거한다", () => {
    for (const label of [
      "HELIX OBSERVATORY",
      "LIBRARY",
      "REPOSITORY ORBIT",
      "HELIX MAP",
      "SUBJECT · EVOLUTION LOG",
      "NEXT TURN",
      "LAYER TIMELINE",
      "OPEN THREADS",
      "챕터마다 하나의 나선",
      "주제마다 배움의 변화를 Layer로 남깁니다.",
    ]) {
      expect(app).not.toContain(label);
    }
    expect(html).not.toContain("brand-halo");
    expect(html).not.toContain("side-foot");
    expect(map).not.toContain("motionBtn");
  });

  it("모바일 탐색과 명시적 지도 제어를 제공한다", () => {
    expect(css).toMatch(/@media \(max-width: 880px\)[\s\S]*\.sidebar\.mobile-open/);
    expect(css).toMatch(/\.spiral-canvas \{ touch-action: pan-y; \}/);
    expect(css).toContain(".map-controls");
    expect(map).toContain('zoomOut.setAttribute("aria-label", "지도 축소")');
    expect(map).toContain("coarse ? 22 : 12");
  });

  it("라이트를 기본으로 하고 중성 표면과 그린 포인트의 두 테마를 제공한다", () => {
    const light = css.match(/^:root\s*\{([\s\S]*?)^\}/m)?.[1] ?? "";
    const dark =
      css.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)^\}/m)?.[1] ?? "";

    expect(html).toMatch(
      /<dialog[^>]*id="settings-dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="settings-title"/,
    );
    expect(html).toContain('id="settings-trigger"');
    expect(html).toContain('aria-controls="settings-dialog"');
    expect(html).toContain('id="settings-close"');
    expect(html).toContain('name="helix-theme" value="dark"');
    expect(html).toContain('name="helix-theme" value="light"');
    expect(html).toContain('src="/theme-init.js"');
    expect(themeInit).toContain('localStorage.getItem("helix.theme")');
    expect(themeInit).toContain('theme === "dark" ? "dark" : "light"');
    expect(html).toContain('content="#f7f7f6"');
    expect(themeInit).toMatch(/catch \{\s*document\.documentElement\.dataset\.theme = "light";/);
    expect(app).toContain('"helix.theme"');
    expect(app).toContain('root.dataset.theme === "dark" ? "dark" : "light"');
    expect(app).toContain("refreshTheme");
    expect(css).toContain(':root[data-theme="dark"]');
    expect(light).toContain("color-scheme: light");
    expect(dark).toContain("color-scheme: dark");
    expect(light).toContain("--paper: #f7f7f6");
    expect(dark).toContain("--paper: #1e1f20");
    expect(light).toContain("--accent: #1f7147");
    expect(light).toContain("--link: #356b4d");
    expect(dark).toContain("--accent: #78c995");
    expect(dark).toContain("--link: #9bcfb0");
    for (const block of [light, dark]) {
      for (const name of [
        "paper",
        "sidebar",
        "raised",
        "raised-soft",
        "panel",
        "map-surface",
        "map-path",
        "selected-surface",
      ]) {
        expect(channelSpread(token(block, name))).toBeLessThanOrEqual(5);
      }
      const [red, green, blue] = token(block, "accent")
        .slice(1)
        .match(/../g)
        .map((value) => Number.parseInt(value, 16));
      expect(green).toBeGreaterThan(red + 30);
      expect(green).toBeGreaterThan(blue + 20);
      expect(
        contrast(token(block, "map-path"), token(block, "map-surface")),
      ).toBeGreaterThan(3);
    }
    expect(contrast(token(light, "text"), token(light, "paper"))).toBeGreaterThan(7);
    expect(contrast(token(light, "text-faint"), token(light, "paper"))).toBeGreaterThan(4.5);
    for (const name of ["text-soft", "accent", "link"]) {
      expect(contrast(token(light, name), token(light, "raised"))).toBeGreaterThan(4.5);
      expect(contrast(token(dark, name), token(dark, "raised"))).toBeGreaterThan(4.5);
    }
    expect(contrast(token(light, "focus-ring"), token(light, "paper"))).toBeGreaterThan(3);
    expect(contrast(token(dark, "focus-ring"), token(dark, "paper"))).toBeGreaterThan(3);
    expect(contrast(token(light, "field-border"), token(light, "paper"))).toBeGreaterThan(3);
    expect(contrast(token(dark, "field-border"), token(dark, "paper"))).toBeGreaterThan(3);
    expect(contrast(token(dark, "text"), token(dark, "paper"))).toBeGreaterThan(7);
    expect(contrast(token(dark, "text-faint"), token(dark, "paper"))).toBeGreaterThan(4.5);
    expect(token(light, "focus-ring")).toBe(token(light, "accent"));
    expect(token(dark, "focus-ring")).toBe(token(dark, "accent"));
    expect(css).toContain(".side-search:focus-within");
    expect(map).toContain("refreshTheme()");
  });

  it("나선 애니메이션 재생과 명시적인 상위 지도 복귀를 제공한다", () => {
    expect(map).toContain('playBtn.type = "button"');
    expect(map).toContain('playBtn.className = "map-play"');
    expect(map).toContain('"▶ 재생"');
    expect(map).toContain('"Ⅱ 일시정지"');
    expect(map).toContain("let motion = false");
    expect(map).toContain("if (rotationActive())");
    expect(map).toContain('window.matchMedia("(prefers-reduced-motion: reduce)")');
    expect(map).toMatch(
      /playBtn\.addEventListener\("click",[\s\S]*?motion = !motion;[\s\S]*?paintPlayButton\(\);[\s\S]*?wake\(\);/,
    );
    expect(map).toContain("playBtn.disabled = reduceMotion.matches");
    expect(map).toMatch(/onReduceMotionChange[\s\S]*?motion = false;[\s\S]*?wake\(\);/);
    expect(map).toContain('reduceMotion.removeEventListener("change", onReduceMotionChange)');
    expect(map).toContain('"aria-label", "지도 제어"');
    expect(app).not.toContain('class="back-link map-back"');
    expect(app).toContain('parentRoute: repoKey ? "#/map" : undefined');
    expect(map).toContain('parentLink.className = "map-control-back"');
    expect(map).toContain('"aria-label", "전체 나선 지도로 돌아가기"');
    expect(map).toMatch(/mapControls\.append\(parentLink\)[\s\S]*?mapControls\.append\(zoomOut,/);
    expect(app).toContain('class="back-link"');
    expect(app).toContain('?chapter=${encodeURIComponent(rid)}&focus=${encodeURIComponent(id)}');
    expect(app).not.toContain('class="subject-actions"');
    expect(css).toContain(".map-controls .map-play");
    expect(css).toContain(".map-controls .map-control-back");
    expect(css).toContain(".back-link");
  });

  it("데스크톱 사이드바를 다시 열 수 있고 질문 정렬을 가로로 유지한다", () => {
    const asideEnd = html.indexOf("</aside>");
    const desktopToggle = html.indexOf('id="sidebar-collapse"');
    expect(desktopToggle).toBeGreaterThan(asideEnd);
    expect(html).toContain('aria-controls="side-panel"');
    expect(app).toContain('"helix.sidebar"');
    expect(app).toContain("sidePanel.inert = collapsed");
    expect(app).toContain('desktopSideToggle.setAttribute("aria-expanded"');
    expect(app).toContain('open ? "탐색 닫기" : "탐색 열기"');
    expect(css).toContain(':root[data-sidebar="collapsed"] .sidebar');
    expect(css).toMatch(/\.question-sort > span \{[\s\S]*?white-space: nowrap;/);
    expect(css).toMatch(/\.question-sort > span \{[\s\S]*?writing-mode: horizontal-tb;/);
  });

  it("사이드바는 기본 목록 없이 검색할 때만 평면 결과를 연다", () => {
    const aside = html.match(/<aside[\s\S]*?<\/aside>/)?.[0] ?? "";
    expect(aside).not.toContain('class="brand"');
    expect(aside).toMatch(/<aside[^>]*>\s*<label class="side-search"/);
    expect(html).toMatch(
      /id="side-list"[^>]*role="listbox"[^>]*hidden/,
    );
    expect(app).toContain('getJSON("/api/subjects")');
    expect(app).toContain('getJSON("/api/roadmaps")');
    expect(app).toContain("const [subjects, hierarchy] = await Promise.all");
    expect(app).not.toContain("helix.roadmap.collapsed");
    expect(app).toContain(
      "filterSidebarItems(sidebarSubjects, sidebarHierarchy, q)",
    );
    expect(app).toMatch(
      /if \(!q\) \{[\s\S]*?sideSearchResults\.replaceChildren\(\);[\s\S]*?sideSearchResults\.hidden = true;[\s\S]*?aria-expanded",/,
    );
    expect(app).toContain('class="side-item side-search-result');
    expect(app).toContain('class="side-search-copy"');
    expect(app).toContain('class="si-context"');
    expect(app).toContain('role="option" tabindex="-1"');
    expect(app).toContain("event.isComposing");
    expect(app).toContain("if (searchSel < 0) searchSel = 0;");
    expect(app).toContain("검색 결과 ${searchHits.length}개");
    expect(app).toMatch(
      /event\.key === "Enter"[\s\S]*?mobileQuery\.matches\) closeMobileSidebar\(false\);[\s\S]*?go\(hit\.route\)/,
    );
    expect(app).toContain("mobileSidebarOpener?.isConnected");
    expect(app).toMatch(
      /function focusSideSearch\(\)[\s\S]*?openMobileSidebar\(\)[\s\S]*?setDesktopSidebar\(false\)[\s\S]*?sideSearchInput\.focus/,
    );
    expect(app).toContain('item.setAttribute("aria-current", "page")');
    expect(css).toContain(".side-list[hidden] { display: none !important; }");
    expect(css).toContain(".side-search-copy");
    expect(css).toContain(".si-context");
    expect(css).toContain(".side-settings { margin-top: auto; }");
  });

  it("새 탭 버튼을 탭 목록 바로 뒤의 같은 스크롤 흐름에 둔다", () => {
    expect(html).toMatch(
      /class="tabstrip-scroll"[\s\S]*?id="tabs"[^>]*role="tablist"[\s\S]*?id="tab-new"[\s\S]*?<\/div>/,
    );
    expect(css).toMatch(
      /\.tabstrip-scroll\s*\{[\s\S]*?display:\s*flex;[\s\S]*?overflow-x:\s*auto;/,
    );
    expect(css).toMatch(
      /\.tabs\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?overflow:\s*visible;/,
    );
    expect(app).toContain('document.getElementById("tab-new").scrollIntoView');
    expect(html).toMatch(/id="tab-new"[\s\S]*?<svg width="15" height="15"/);
    expect(app).toMatch(
      /class="tab-close"[\s\S]*?<svg width="14" height="14"[\s\S]*?stroke-width="1.8"/,
    );
    expect(css).toMatch(/\.tab-close\s*\{[\s\S]*?width:\s*28px;[\s\S]*?height:\s*28px;/);
  });

  it("데스크톱 앱 업데이트와 데이터 폴더 제어를 안전한 브리지로 연결한다", () => {
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).not.toContain("cdn.jsdelivr.net");
    expect(html).toContain('id="desktop-settings" hidden');
    expect(html).toContain('id="desktop-update-button"');
    expect(html).toContain('id="desktop-data-change"');
    expect(app).toContain("window.helixDesktop");
    expect(app).toContain("desktopApi.checkForUpdate");
    expect(app).toContain("desktopApi.installUpdate");
    expect(app).toContain("desktopApi.chooseDataRoot");
    expect(app).toContain("v${result.latest} 받기");
    expect(css).toContain(".desktop-settings");
    expect(css).toContain(".settings-action.primary");
  });

  it("지도 광택과 선택 면은 중성으로 두고 상태 표시만 그린으로 연결한다", () => {
    const light = css.match(/^:root\s*\{([\s\S]*?)^\}/m)?.[1] ?? "";
    const dark =
      css.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)^\}/m)?.[1] ?? "";
    for (const block of [light, dark]) {
      const [red, green, blue, alpha] = rgbaChannels(block, "map-bloom");
      expect(red).toBe(green);
      expect(green).toBe(blue);
      expect(alpha).toBeGreaterThan(0);
      expect(alpha).toBeLessThanOrEqual(0.06);
      expect(block).toContain("--selected-surface:");
      expect(block).toContain("--surface-highlight:");
    }
    expect(css).toMatch(
      /\.map-wrap\s*\{[\s\S]*?radial-gradient\([^}]*var\(--map-bloom\)/,
    );
    expect(css).toMatch(
      /\.tab-wrap\.active\s*\{[\s\S]*?background:\s*var\(--selected-surface\)/,
    );
    expect(css).toMatch(
      /\.tab-wrap\.active::after\s*\{[\s\S]*?background:\s*var\(--accent\)/,
    );
    expect(map).toContain('ghost: g("--map-path"');
    expect(css).toContain("--map-path: GrayText;");
    expect(css).not.toContain("shimmer");
  });

  it("북마크 토글·목록·기기 저장·탭 간 동기화를 연결한다", () => {
    expect(html).toContain('id="side-bookmarks"');
    expect(html).toContain('id="bookmark-count"');
    expect(app).toContain('BOOKMARK_KEY = "helix.bookmarks"');
    expect(app).toContain("parseBookmarkIds");
    expect(app).toContain("toggleBookmark");
    expect(app).toContain("selectBookmarkItems");
    expect(app).toContain("localStorage.getItem(BOOKMARK_KEY)");
    expect(app).toContain("localStorage.setItem(BOOKMARK_KEY");
    expect(app).toContain('event.key === BOOKMARK_KEY');
    expect(app).toContain('data-bookmark-id="');
    expect(app).toContain("data-bookmark-remove");
    expect(app).toContain('aria-pressed="false"');
    expect(app).toContain('bookmarks: renderBookmarks');
    expect(app).toMatch(
      /bookmarkButton\.addEventListener\("click"[\s\S]*?setBookmarked\(s\.id,[\s\S]*?paintBookmarkButton/,
    );
    expect(app).toMatch(
      /renderBookmarks[\s\S]*?selectBookmarkItems\(bookmarkIds, subjects\)[\s\S]*?subjectRow\(subject\)/,
    );
    expect(app).toMatch(
      /syncBookmarkCount\(subjects\)[\s\S]*?knownSubjectIds = new Set/,
    );
    expect(css).toContain(".bookmark-toggle[aria-pressed=\"true\"]");
    expect(css).toContain("--bookmark-control-size: 40px");
    expect(css).toContain("--bookmark-icon-size: 18px");
    expect(lastRule(css, ".bookmark-remove")).toContain("top: 50%");
    expect(lastRule(css, ".bookmark-remove")).toContain(
      "transform: translateY(-50%)",
    );
    expect(lastRule(css, ".bookmark-remove")).toContain(
      "width: var(--bookmark-control-size)",
    );
    expect(ruleBodies(css, ".bookmark-toggle").join("\n")).toContain(
      "min-height: var(--bookmark-control-size)",
    );
    expect(css).toContain('@media (forced-colors: active)');
    expect(css).toContain("--text: CanvasText");
    expect(css).toContain("--focus-ring: Highlight");
  });

  it("검색 포커스는 내부 테두리 없이 하나의 accent 외곽선만 사용한다", () => {
    expect(lastRule(css, ".question-filter input:focus-visible")).toContain(
      "border-color: transparent",
    );
    expect(lastRule(css, ".side-search:focus-within")).toContain(
      "border-color: transparent",
    );
    expect(lastRule(css, ".side-search:focus-within")).toContain(
      "outline: 2px solid var(--focus-ring)",
    );
    expect(lastRule(css, ".side-search:focus-within")).toContain(
      "box-shadow: none",
    );
  });

  it("현재 Layer·질문 상태·북마크가 같은 accent 상태 토큰을 공유한다", () => {
    expect(lastRule(css, ".layer-jump a.current")).toContain(
      "background: var(--accent-soft)",
    );
    expect(lastRule(css, ".subject-row .row-meta .oq")).toContain(
      "color: var(--accent)",
    );
    expect(lastRule(css, ".si-oq")).toContain("background: var(--accent)");
    expect(
      ruleBodies(css, '.bookmark-toggle[aria-pressed="true"]').join("\n"),
    ).toContain(
      "background: var(--accent-soft)",
    );
  });
});
