import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const publicDir = new URL("../public/", import.meta.url);
const [html, app, css, map] = await Promise.all([
  readFile(new URL("index.html", publicDir), "utf8"),
  readFile(new URL("app.js", publicDir), "utf8"),
  readFile(new URL("styles.css", publicDir), "utf8"),
  readFile(new URL("spiralmap.js", publicDir), "utf8"),
]);

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
});
