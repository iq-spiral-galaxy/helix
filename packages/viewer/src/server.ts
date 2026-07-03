import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import type { Subject } from "@iq-helix/core";
import { FileHelixStore } from "@iq-helix/core";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

/** roadmap_id slug의 마지막 비어있지 않은 구획을 Title Case로. "unit-testing/mocking-strategies" → "Mocking Strategies" */
function roadmapLabel(roadmapId: string): string {
  const parts = roadmapId.split("/").filter(Boolean);
  const last = parts.at(-1) ?? roadmapId;
  const label = last
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
  return label || roadmapId;
}

function roadmapOf(s: Subject): string | null {
  const src = s.sources.find((x) => x.kind === "spiral-buddy");
  const id = src && src.kind === "spiral-buddy" ? src.roadmapId : null;
  return id && id.trim() ? id : null;
}

function cardMeta(s: Subject) {
  return {
    id: s.id,
    title: s.title,
    layerCount: s.layers.length,
    openQuestionCount: s.questions.filter((q) => q.status === "open").length,
  };
}

interface ConnIndex {
  all: Subject[];
  byId: Map<string, Subject>;
  groups: Map<string, Subject[]>;
  ungrouped: Subject[];
  outE: Map<string, { id: string; type: string; note?: string }[]>;
  inE: Map<string, { id: string; type: string; note?: string }[]>;
  idf: (t: string) => number;
}

/**
 * 전체 Subject(active)를 읽어 연결 인덱스를 만든다 (core 무변경).
 * 명시적 edges(현재 전부 비어있음)는 양방향으로, 태그/로드맵은 파생 연결로 노출한다.
 * 입력 순서는 파일시스템 readdir에 의존하므로 결정적 출력을 위해 id로 안정 정렬한다.
 */
async function buildConnectionIndex(store: FileHelixStore): Promise<ConnIndex> {
  const all = (await store.readAll())
    .filter((s) => s.status === "active")
    .sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(all.map((s) => [s.id, s]));

  const groups = new Map<string, Subject[]>();
  const ungrouped: Subject[] = [];
  for (const s of all) {
    const r = roadmapOf(s);
    if (r) {
      const list = groups.get(r) ?? [];
      list.push(s);
      groups.set(r, list);
    } else {
      ungrouped.push(s);
    }
  }

  const outE = new Map<string, { id: string; type: string; note?: string }[]>();
  const inE = new Map<string, { id: string; type: string; note?: string }[]>();
  for (const s of all) {
    for (const e of s.edges) {
      (outE.get(s.id) ?? outE.set(s.id, []).get(s.id)!).push({ id: e.to, type: e.type, note: e.note });
      (inE.get(e.to) ?? inE.set(e.to, []).get(e.to)!).push({ id: s.id, type: e.type, note: e.note });
    }
  }

  // 태그 IDF — 희소 태그 공유에 가중 (unit-testing 같은 허브 태그는 변별력 낮음)
  const N = all.length;
  const df = new Map<string, number>();
  for (const s of all) for (const t of new Set(s.tags)) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log(N / (df.get(t) ?? N));

  return { all, byId, groups, ungrouped, outE, inE, idf };
}

export function createApp(store: FileHelixStore): Hono {
  const app = new Hono();
  const publicDir = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "public",
  );

  // 한 페이지 로드가 /roadmaps + 다수의 /connections 를 동시에 부르므로 짧은 TTL로 묶는다.
  // 뷰어는 read-only이고 데이터는 외부 편집으로만 바뀌므로 2초 staleness는 무해.
  let cache: { at: number; index: ConnIndex } | null = null;
  async function connIndex(): Promise<ConnIndex> {
    if (cache && Date.now() - cache.at < 2000) return cache.index;
    const index = await buildConnectionIndex(store);
    cache = { at: Date.now(), index };
    return index;
  }

  app.get("/api/subjects", async (c) =>
    c.json(await store.listSubjects({ status: "active" })),
  );

  app.get("/api/subjects/:id", async (c) => {
    const subject = await store.getSubject(c.req.param("id"));
    if (!subject) return c.json({ error: "존재하지 않는 subject" }, 404);
    return c.json(subject);
  });

  // 옵시디언식 연결: 같은 로드맵 형제 + 태그 공유 관련 나선 + 명시 edges(양방향)
  app.get("/api/subjects/:id/connections", async (c) => {
    const ix = await connIndex();
    const self = ix.byId.get(c.req.param("id"));
    if (!self) return c.json({ error: "존재하지 않는 subject" }, 404);

    const sharedTags = (s: Subject) => self.tags.filter((t) => s.tags.includes(t));

    // 같은 로드맵 형제 (자기 제외 — 싱글톤 로드맵이면 형제 없음 → null)
    const myRoadmap = roadmapOf(self);
    const siblingIds = new Set<string>();
    let roadmap: { id: string; title: string; siblings: ReturnType<typeof cardMeta>[] } | null = null;
    if (myRoadmap) {
      const sibs = (ix.groups.get(myRoadmap) ?? []).filter((s) => s.id !== self.id);
      sibs.forEach((s) => siblingIds.add(s.id));
      if (sibs.length) {
        roadmap = { id: myRoadmap, title: roadmapLabel(myRoadmap), siblings: sibs.map(cardMeta) };
      }
    }

    // 관련 나선: 태그 공유, 형제·자기 제외, IDF 점수 내림차순, 상한 8
    const related = ix.all
      .filter((s) => s.id !== self.id && !siblingIds.has(s.id))
      .map((s) => {
        const shared = sharedTags(s);
        const score = shared.reduce((a, t) => a + ix.idf(t), 0);
        return { ...cardMeta(s), sharedTags: shared, sharedTagCount: shared.length, score };
      })
      .filter((x) => x.sharedTagCount > 0)
      .sort((a, b) => b.score - a.score || b.sharedTagCount - a.sharedTagCount)
      .slice(0, 8);

    const hydrate = (e: { id: string; type: string; note?: string }, direction: "out" | "in") => {
      const t = ix.byId.get(e.id);
      return t ? { ...cardMeta(t), type: e.type, note: e.note, direction } : null;
    };
    const explicit = (ix.outE.get(self.id) ?? []).map((e) => hydrate(e, "out")).filter(Boolean);
    const backlinks = (ix.inE.get(self.id) ?? []).map((e) => hydrate(e, "in")).filter(Boolean);

    return c.json({ id: self.id, roadmap, related, explicit, backlinks });
  });

  // 사이드바 로드맵 그룹핑 (lastTouched 내림차순 + id 타이브레이커로 결정적 순서)
  app.get("/api/roadmaps", async (c) => {
    const ix = await connIndex();
    const order = [...ix.all].sort(
      (a, b) =>
        b.mastery.lastTouched.localeCompare(a.mastery.lastTouched) ||
        a.id.localeCompare(b.id),
    );
    const rank = new Map(order.map((s, i) => [s.id, i] as const));
    const sortIds = (subs: Subject[]) =>
      subs.map((s) => s.id).sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
    const roadmaps = [...ix.groups.entries()]
      .map(([id, subs]) => ({ id, title: roadmapLabel(id), subjectIds: sortIds(subs) }))
      .sort((a, b) => b.subjectIds.length - a.subjectIds.length || a.title.localeCompare(b.title));
    return c.json({ roadmaps, ungrouped: sortIds(ix.ungrouped) });
  });

  // 나선 학습 지도: 전체 노드 + 사전 솎인 이웃(헤어볼 방지). lastTouched ASC = 나선 안→밖 순서.
  app.get("/api/graph", async (c) => {
    const ix = await connIndex();
    const nodes = [...ix.all].sort(
      (a, b) =>
        a.mastery.lastTouched.localeCompare(b.mastery.lastTouched) ||
        a.id.localeCompare(b.id),
    );

    // 태그 document-frequency (허브 가드용)
    const df = new Map<string, number>();
    for (const s of ix.all) for (const t of new Set(s.tags)) df.set(t, (df.get(t) ?? 0) + 1);
    // 태그 연결 최소 점수. df≤7인 태그 1개 공유면 통과(idf=log(18/7)≈0.94), 허브성 단독 공유는 탈락.
    // 주의: N≈18 기준값 — 코퍼스가 매우 작으면 단독 희소태그도 idf가 낮아 tag 이웃이 0일 수 있다(형제만).
    const TAU = 0.9;
    const HUB = 8; // fan ≥ 8 이면 허브 태그
    const CAP = 6; // 노드당 이웃 상한

    const out = nodes.map((self) => {
      const rid = roadmapOf(self);
      const sibIds = new Set(
        (rid ? ix.groups.get(rid) ?? [] : []).filter((s) => s.id !== self.id).map((s) => s.id),
      );
      const edgeIds = new Set<string>();
      const neighbors: { id: string; kind: "edge" | "sibling" | "tag"; score: number; sharedTags?: string[] }[] = [];

      // 1) 명시 edges (현재 0개) — 양방향, 항상 포함. 비활성/삭제된 대상(byId에 없음)은 제외(ghost 방지).
      for (const e of [...(ix.outE.get(self.id) ?? []), ...(ix.inE.get(self.id) ?? [])]) {
        if (e.id === self.id || edgeIds.has(e.id) || !ix.byId.has(e.id)) continue;
        edgeIds.add(e.id);
        neighbors.push({ id: e.id, kind: "edge", score: 3 });
      }
      // 2) 로드맵 형제 — 항상 포함
      for (const sid of sibIds) {
        if (edgeIds.has(sid)) continue;
        neighbors.push({ id: sid, kind: "sibling", score: 2 });
      }
      // 3) 태그 공유 — IDF 점수, 허브 가드, τ 임계, 남은 슬롯만큼 상위
      const tagCands = ix.all
        .filter((s) => s.id !== self.id && !sibIds.has(s.id) && !edgeIds.has(s.id))
        .map((s) => {
          const shared = self.tags.filter((t) => s.tags.includes(t));
          const score = shared.reduce((a, t) => a + ix.idf(t), 0);
          const allHub = shared.length > 0 && shared.every((t) => (df.get(t) ?? 0) >= HUB);
          return { id: s.id, shared, score, allHub };
        })
        .filter((x) => x.shared.length > 0 && !x.allHub && x.score >= TAU)
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      for (const t of tagCands.slice(0, Math.max(0, CAP - neighbors.length))) {
        neighbors.push({ id: t.id, kind: "tag", score: t.score, sharedTags: t.shared });
      }

      return {
        id: self.id,
        title: self.title,
        lastTouched: self.mastery.lastTouched,
        roadmapId: rid,
        roadmapTitle: rid ? roadmapLabel(rid) : null,
        oqCount: self.questions.filter((q) => q.status === "open").length,
        layerCount: self.mastery.layerCount,
        degW: 0, // 대칭화 후 재계산
        neighbors,
      };
    });

    // 무방향 대칭화: CAP 절단이 한쪽만 잘라 b∈nbr(a)인데 a∉nbr(b)이 되는 비대칭 제거
    // (그대로 두면 호버 방향에 따라 같은 연결이 보였다 사라진다). 누락된 역방향을 보강한다.
    const outById = new Map(out.map((n) => [n.id, n]));
    for (const n of out) {
      for (const m of n.neighbors) {
        const t = outById.get(m.id);
        if (t && !t.neighbors.some((x) => x.id === n.id)) {
          t.neighbors.push({ id: n.id, kind: m.kind, score: m.score, ...(m.sharedTags ? { sharedTags: m.sharedTags } : {}) });
        }
      }
    }
    for (const n of out) n.degW = n.neighbors.reduce((a, x) => a + x.score, 0);

    const roadmaps = [...ix.groups.entries()].map(([id, subs]) => ({
      id,
      title: roadmapLabel(id),
      size: subs.length,
    }));
    return c.json({ nodes: out, roadmaps });
  });

  app.get("/api/questions", async (c) => c.json(await store.openQuestions()));

  app.get("*", async (c) => {
    const reqPath = normalize(c.req.path).replace(/^\/+/, "");
    const candidate = join(publicDir, reqPath || "index.html");
    const file =
      candidate.startsWith(publicDir) && existsSync(candidate) && extname(candidate)
        ? candidate
        : join(publicDir, "index.html");
    const body = await readFile(file);
    return c.body(body, 200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
    });
  });

  return app;
}
