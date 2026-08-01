import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { computeMastery, serializeSubject } from "./markdown.js";
import { slugify, slugifyChapter } from "./slug.js";
import type { FileHelixStore } from "./store.js";
import type { Layer, OpenQuestion, Subject } from "./types.js";

export interface ImportResult {
  subjects: number;
  layers: number;
  seededQuestions: number;
  resolvedEdges: number;
  unresolvedLinks: number;
  skipped: { file: string; reason: string }[];
}

interface OldNote {
  file: string;
  topic: string;
  date: string;
  depth: number;
  chapterId: string;
  roadmapName: string | null;
  roadmapId: string | null;
  tags: string[];
  related: string[];
  sections: { heading: string; body: string }[];
}

const QUESTION_SECTION_RE = /헷갈렸|확인이 필요/;

/**
 * 기존 spiral-buddy 노트(read-only)를 helix subjects로 접는다.
 * 그룹 키 = (roadmap_name, chapter basename) — roadmap_id 유무가 섞인 옛/새 스키마를
 * vault.ts:235 fallback과 같은 효과로 병합한다 (SPEC §7-2).
 */
export async function importSpiralBuddy(
  store: FileHelixStore,
  vaultOrNotesPath: string,
): Promise<ImportResult> {
  const notesDir = existsSync(join(vaultOrNotesPath, "spiral-buddy"))
    ? join(vaultOrNotesPath, "spiral-buddy")
    : vaultOrNotesPath;

  const result: ImportResult = {
    subjects: 0,
    layers: 0,
    seededQuestions: 0,
    resolvedEdges: 0,
    unresolvedLinks: 0,
    skipped: [],
  };

  const files = (await readdir(notesDir)).filter((f) => f.endsWith(".md"));
  const notes: OldNote[] = [];
  for (const f of files) {
    const parsed = parseOldNote(f, await readFile(join(notesDir, f), "utf8"));
    if ("note" in parsed) notes.push(parsed.note);
    else result.skipped.push({ file: f, reason: parsed.reason });
  }

  const groups = new Map<string, OldNote[]>();
  for (const n of notes) {
    const key = `${n.roadmapName ?? ""}::${chapterBasename(n.chapterId)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(n);
  }

  const subjects: Subject[] = [];
  const usedIds = new Set<string>();
  const fileSlugToSubjectId = new Map<string, string>();

  for (const group of groups.values()) {
    group.sort(
      (a, b) => a.depth - b.depth || a.date.localeCompare(b.date),
    );
    const first = group[0];
    let id = first.chapterId.startsWith("topic:")
      ? slugify(first.topic)
      : slugifyChapter(first.chapterId);
    if (usedIds.has(id)) {
      id = `${slugify(first.roadmapName ?? "roadmap")}-${id}`;
    }
    usedIds.add(id);

    const questions: OpenQuestion[] = [];
    const layers: Layer[] = group.map((n, i) => {
      const index = i + 1;
      const added: string[] = [];
      for (const text of extractQuestions(n)) {
        const qid = `q${questions.length + 1}`;
        questions.push({ id: qid, text, status: "open", raisedAtLayer: index });
        added.push(qid);
      }
      return {
        index,
        depth: n.depth,
        date: n.date,
        sessionRef: n.file.replace(/\.md$/, ""),
        content: { sections: n.sections },
        addedQuestionIds: added,
        resolvedQuestionIds: [],
      };
    });

    const roadmapId = group.find((n) => n.roadmapId)?.roadmapId ?? null;
    const subject: Subject = {
      id,
      title: first.topic,
      status: "active",
      tags: [...new Set(group.flatMap((n) => n.tags))],
      sources: [
        { kind: "spiral-buddy", roadmapId, chapterId: first.chapterId },
      ],
      mastery: computeMastery(layers),
      layers,
      questions,
      edges: [],
    };

    for (const n of group) {
      fileSlugToSubjectId.set(n.file.replace(/\.md$/, ""), id);
    }
    subjects.push(subject);
    result.subjects += 1;
    result.layers += layers.length;
    result.seededQuestions += questions.length;
  }

  // 2차 패스: related 위키링크 → edges, 실패 시 unresolved_links 보존
  for (const subject of subjects) {
    const group = [...groups.values()].find((g) =>
      g.some((n) => fileSlugToSubjectId.get(n.file.replace(/\.md$/, "")) === subject.id),
    )!;
    const unresolved: string[] = [];
    for (const link of new Set(group.flatMap((n) => n.related))) {
      const target =
        fileSlugToSubjectId.get(link) ?? matchByConceptSlug(link, usedIds);
      if (target && target !== subject.id) {
        if (!subject.edges.some((e) => e.to === target)) {
          subject.edges.push({ to: target, type: "related" });
          result.resolvedEdges += 1;
        }
      } else if (!target) {
        unresolved.push(link);
        result.unresolvedLinks += 1;
      }
    }
    if (unresolved.length) subject.unresolvedLinks = unresolved;
  }

  await store.init();
  for (const subject of subjects) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      store.subjectPath(subject.id),
      serializeSubject(subject),
      "utf8",
    );
  }
  await store.reindex();
  return result;
}

function parseOldNote(
  file: string,
  md: string,
): { note: OldNote } | { reason: string } {
  if (file.startsWith("_")) return { reason: "인덱스/내부 파일" };
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fmMatch) return { reason: "frontmatter 없음" };
  let fm: any;
  try {
    fm = YAML.parse(fmMatch[1]);
  } catch {
    return { reason: "frontmatter YAML 파싱 실패" };
  }
  if (!fm || typeof fm !== "object") return { reason: "frontmatter가 비어 있음" };

  const topic = stringValue(fm.topic ?? fm.title ?? fm.chapter);
  if (!topic) return { reason: "topic/title/chapter 없음" };

  const roadmapName = stringValue(fm.roadmap);
  const explicitRoadmapId = stringValue(fm.roadmap_id);
  const repositoryId = stringValue(fm.repo);
  const roadmapId =
    explicitRoadmapId ??
    (repositoryId && roadmapName
      ? `${repositoryId}/${roadmapName}`
      : null);

  // generator는 비강제: topic/title 또는 repo/roadmap/chapter 스키마를 모두 수용.
  // 단, spiral 노트의 최소 신호(chapter_id 또는 depth)는 있어야 한다.
  const hasChapter = fm.chapter_id != null;
  const depthFromName = file.match(/[\s-]d(\d+)\.md$/)?.[1];
  if (!hasChapter && fm.depth == null && depthFromName == null) {
    return { reason: "spiral 노트 신호 없음 (chapter_id/depth 모두 없음)" };
  }

  const date: string | null =
    fm.date != null
      ? String(fm.date).slice(0, 10)
      : (file.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? null);
  if (!date) return { reason: "date 없음 (frontmatter/파일명 모두)" };

  const body = md.slice(fmMatch[0].length);
  const sections = body
    .split(/^## /m)
    .slice(1)
    .map((part) => {
      const nl = part.indexOf("\n");
      return {
        heading: (nl === -1 ? part : part.slice(0, nl)).trim(),
        body: nl === -1 ? "" : part.slice(nl + 1).trim(),
      };
    });

  const related: string[] = [];
  for (const raw of fm.related ?? []) {
    const m = String(raw).match(/\[\[([^\]]+)\]\]/);
    related.push(m ? m[1] : String(raw));
  }

  return {
    note: {
      file,
      topic,
      date,
      depth: Number(fm.depth ?? depthFromName ?? 1),
      // chapter_id 없는 변형 스키마: topic/title/chapter 기반으로 그룹핑
      chapterId: hasChapter ? String(fm.chapter_id) : `topic:${topic}`,
      roadmapName,
      roadmapId,
      tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
      related,
      sections,
    },
  };
}

function stringValue(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function extractQuestions(n: OldNote): string[] {
  const section = n.sections.find((s) => QUESTION_SECTION_RE.test(s.heading));
  if (!section) return [];
  return section.body
    .split("\n")
    .map((line) => line.match(/^\s*[-*]\s+(.+)$/)?.[1]?.trim())
    .filter((q): q is string => Boolean(q));
}

function chapterBasename(chapterId: string): string {
  return chapterId.split("/").at(-1)!;
}

/** "2026-05-20-applicationcontext-d1" → "applicationcontext" 추정 매칭 */
function matchByConceptSlug(
  link: string,
  ids: Set<string>,
): string | null {
  const stripped = link
    .replace(/^\d{4}-\d{2}-\d{2}-/, "")
    .replace(/-d\d+$/, "");
  const candidate = slugify(stripped.replace(/^\d+[-_.]?/, ""));
  return ids.has(candidate) ? candidate : null;
}
