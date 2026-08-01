import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileHelixStore, importSpiralBuddy } from "../src/index.js";

describe("importSpiralBuddy — 변형 스키마 (네이밍 개선 이후 노트)", () => {
  it("generator/chapter_id 없는 토픽 파일명 노트도 구제하고, 진짜 비노트만 사유와 함께 스킵한다", async () => {
    const vault = await mkdtemp(join(tmpdir(), "vault-"));
    const notes = join(vault, "spiral-buddy");
    await mkdir(notes, { recursive: true });

    // 변형 1: chapter_id·generator 없음, 토픽 기반 파일명, depth는 frontmatter에
    await writeFile(
      join(notes, "InnoDB Buffer Pool — 메모리와 디스크 사이 캐시 레이어 d1.md"),
      `---
title: "InnoDB Buffer Pool — 메모리와 디스크 사이 캐시 레이어"
topic: "InnoDB Buffer Pool"
date: 2026-06-03
depth: 1
tags: ["mysql", "innodb"]
---
# InnoDB Buffer Pool

## 한 줄 요약
디스크 페이지의 메모리 캐시.

## 헷갈렸던 / 확인이 필요한 지점
- LRU의 midpoint insertion은 왜 필요한가?
`,
    );

    // 변형 2: depth가 파일명에만 있음 (frontmatter에 없음)
    await writeFile(
      join(notes, "Row Format — 데이터가 Page 안에 저장되는 구조 d1.md"),
      `---
topic: "Row Format"
date: 2026-06-05
tags: ["mysql"]
---
# Row Format

## 한 줄 요약
레코드의 물리 배치.
`,
    );

    // 진짜 스킵 대상들
    await writeFile(join(notes, "_index.md"), "# index\n");
    await writeFile(join(notes, "메모.md"), "frontmatter 없는 그냥 메모\n");

    const store = new FileHelixStore(await mkdtemp(join(tmpdir(), "helix-")));
    const result = await importSpiralBuddy(store, vault);

    expect(result.subjects).toBe(2);
    expect(result.seededQuestions).toBe(1);
    expect(result.skipped).toEqual([
      { file: "_index.md", reason: "인덱스/내부 파일" },
      { file: "메모.md", reason: "frontmatter 없음" },
    ]);

    const bp = (await store.getSubject("innodb-buffer-pool"))!;
    expect(bp.layers).toHaveLength(1);
    expect(bp.sources[0]).toMatchObject({ kind: "spiral-buddy", roadmapId: null });

    const rf = (await store.getSubject("row-format"))!;
    expect(rf.layers[0].depth).toBe(1); // 파일명 d1에서 추출
  });

  it("repo/roadmap/chapter 스키마를 레포와 챕터가 보존된 subject로 가져온다", async () => {
    const vault = await mkdtemp(join(tmpdir(), "vault-"));
    const notes = join(vault, "spiral-buddy");
    await mkdir(notes, { recursive: true });

    const chapter = "B-Tree 인덱스 — 왜 Binary Tree가 아닌 B-Tree인가";
    await writeFile(
      join(notes, `${chapter} d1.md`),
      `---
repo: "database-internals"
roadmap: "index-internals"
chapter: "${chapter}"
depth: 1
date: 2026-06-17
tags: ["btree", "innodb"]
summary: "B+Tree의 기본 구조"
---

# ${chapter}

## 한 줄 요약
B+Tree는 디스크 Page 단위 I/O에 맞춰 fan-out을 높인다.

## 헷갈렸던 / 확인이 필요한 지점
- B-Tree와 B+Tree의 리프 구조 차이는 무엇인가?
`,
    );
    await writeFile(
      join(notes, `${chapter} d2.md`),
      `---
repo: "database-internals"
roadmap: "index-internals"
chapter: "${chapter}"
depth: 2
date: 2026-06-18
tags: ["btree", "page-split"]
summary: "Page Split 심화"
---

# ${chapter}

## 한 줄 요약
키 선택에 따라 Page Split 빈도가 달라진다.
`,
    );

    const store = new FileHelixStore(await mkdtemp(join(tmpdir(), "helix-")));
    const result = await importSpiralBuddy(store, vault);

    expect(result).toMatchObject({
      subjects: 1,
      layers: 2,
      seededQuestions: 1,
      skipped: [],
    });

    const subject = (await store.getSubject(
      "b-tree-인덱스-왜-binary-tree가-아닌-b-tree인가",
    ))!;
    expect(subject.title).toBe(chapter);
    expect(subject.sources).toEqual([
      {
        kind: "spiral-buddy",
        roadmapId: "database-internals/index-internals",
        chapterId: `topic:${chapter}`,
      },
    ]);
    expect(subject.layers.map(({ depth, date }) => ({ depth, date }))).toEqual([
      { depth: 1, date: "2026-06-17" },
      { depth: 2, date: "2026-06-18" },
    ]);
    expect(subject.tags).toEqual(["btree", "innodb", "page-split"]);
  });
});
