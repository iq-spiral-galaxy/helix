import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const publicDir = new URL("../public/", import.meta.url);
const [html, app, css, map] = await Promise.all([
  readFile(new URL("index.html", publicDir), "utf8"),
  readFile(new URL("app.js", publicDir), "utf8"),
  readFile(new URL("styles.css", publicDir), "utf8"),
  readFile(new URL("spiralmap.js", publicDir), "utf8"),
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

describe("Helix viewer UI contract", () => {
  it("검색·탭·모바일 탐색의 접근성 표면을 유지한다", () => {
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('id="search-close"');
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

  it("라이트를 기본으로 하고 가독성 높은 그린 다크·라이트 테마를 제공한다", () => {
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
    expect(html).toContain('localStorage.getItem("helix.theme")');
    expect(html).toContain('theme === "dark" ? "dark" : "light"');
    expect(html).toContain('content="#f7f8f5"');
    expect(html).toMatch(/catch \{\s*document\.documentElement\.dataset\.theme = "light";/);
    expect(app).toContain('"helix.theme"');
    expect(app).toContain('root.dataset.theme === "dark" ? "dark" : "light"');
    expect(app).toContain("refreshTheme");
    expect(css).toContain(':root[data-theme="dark"]');
    expect(light).toContain("color-scheme: light");
    expect(dark).toContain("color-scheme: dark");
    expect(light).toContain("--paper: #f7f8f5");
    expect(dark).toContain("--paper: #1b2420");
    expect(light).toContain("--accent: #1f6b49");
    expect(light).toContain("--link: #346b51");
    expect(dark).toContain("--accent: #78c69a");
    expect(dark).toContain("--link: #9bcfb0");
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
    expect(css).toContain(".search-head input:focus-visible");
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
    expect(app).toContain('class="back-link map-back" href="#/map"');
    expect(app).toContain('aria-label="전체 나선 지도로 돌아가기"');
    expect(app).toContain('class="back-link"');
    expect(app).toContain('?chapter=${encodeURIComponent(rid)}&focus=${encodeURIComponent(id)}');
    expect(app).not.toContain('class="subject-actions"');
    expect(css).toContain(".map-controls .map-play");
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
    expect(app).toContain('open ? "나선 목록 닫기" : "나선 목록 열기"');
    expect(css).toContain(':root[data-sidebar="collapsed"] .sidebar');
    expect(css).toMatch(/\.question-sort > span \{[\s\S]*?white-space: nowrap;/);
    expect(css).toMatch(/\.question-sort > span \{[\s\S]*?writing-mode: horizontal-tb;/);
  });
});
