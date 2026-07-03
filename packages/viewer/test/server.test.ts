import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileHelixStore } from "@iq-helix/core";
import { createApp } from "../src/server.js";

describe("viewer API", () => {
  it("subjects/questions 엔드포인트가 store를 그대로 노출한다", async () => {
    const store = new FileHelixStore(await mkdtemp(join(tmpdir(), "helix-")));
    await store.createSubject({ title: "MVCC", tags: ["db"] });
    await store.appendLayer("mvcc", {
      depth: 1,
      date: "2026-06-01",
      content: { sections: [{ heading: "한 줄 요약", body: "버전 동시성." }] },
      addQuestions: ["undo log 정리 시점은?"],
    });

    const app = createApp(store);

    const list = await (await app.request("/api/subjects")).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "mvcc", openQuestionCount: 1 });

    const subject = await (await app.request("/api/subjects/mvcc")).json();
    expect(subject.layers).toHaveLength(1);
    expect(subject.questions[0].id).toBe("q1");

    const missing = await app.request("/api/subjects/없음");
    expect(missing.status).toBe(404);

    const questions = await (await app.request("/api/questions")).json();
    expect(questions).toEqual([
      expect.objectContaining({ subjectId: "mvcc", id: "q1", status: "open" }),
    ]);

    const html = await (await app.request("/")).text();
    expect(html).toContain("Helix");
  });

  it("/api/graph가 노드 + 사전 솎인 이웃을 반환한다 (로드맵 형제 연결)", async () => {
    const store = new FileHelixStore(await mkdtemp(join(tmpdir(), "helix-")));
    const src = (chapter: string) => ({
      kind: "spiral-buddy" as const,
      roadmapId: "unit-testing/mocking",
      chapterId: chapter,
    });
    await store.createSubject({ title: "Stub", tags: ["mock"], sources: [src("01.md")] });
    await store.createSubject({ title: "Spy", tags: ["mock"], sources: [src("02.md")] });
    await store.appendLayer("stub", {
      depth: 1,
      date: "2026-06-01",
      content: { sections: [{ heading: "한 줄 요약", body: "스텁." }] },
    });
    await store.appendLayer("spy", {
      depth: 1,
      date: "2026-06-02",
      content: { sections: [{ heading: "한 줄 요약", body: "스파이." }] },
    });

    const graph = await (await createApp(store).request("/api/graph")).json();
    expect(graph.nodes).toHaveLength(2);
    // lastTouched ASC 정렬 — stub(06-01)이 먼저
    expect(graph.nodes[0].id).toBe("stub");
    expect(graph.nodes[1].id).toBe("spy");
    // 같은 로드맵 → 서로 sibling 이웃, degW > 0
    const stub = graph.nodes[0];
    expect(stub.neighbors).toEqual([
      expect.objectContaining({ id: "spy", kind: "sibling" }),
    ]);
    expect(stub.degW).toBeGreaterThan(0);
    expect(stub.roadmapTitle).toBe("Mocking");
    expect(graph.roadmaps).toEqual([
      expect.objectContaining({ id: "unit-testing/mocking", size: 2 }),
    ]);
  });
});
