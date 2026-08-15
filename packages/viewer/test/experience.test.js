import { describe, expect, it } from "vitest";
import {
  filterOpenQuestions,
  filterSidebarItems,
  normalizeSidebarQuery,
  parseBookmarkIds,
  sectionHeadingPresentation,
  selectHomeFocus,
  selectBookmarkItems,
  sortOpenQuestions,
  sortSubjects,
  toggleBookmark,
} from "../public/experience.js";

const subjects = [
  {
    id: "newer",
    title: "Newer",
    lastTouched: "2026-06-10",
    layerCount: 1,
    openQuestionCount: 1,
  },
  {
    id: "deeper",
    title: "Deeper",
    lastTouched: "2026-05-10",
    layerCount: 3,
    openQuestionCount: 2,
  },
];

const questions = [
  {
    subjectId: "newer",
    questionId: "q1",
    text: "최근 질문",
    raisedAtDate: "2026-06-10",
  },
  {
    subjectId: "deeper",
    questionId: "q2",
    text: "오래 기다린 질문",
    raisedAtDate: "2026-05-10",
  },
];

describe("Helix viewer experience model", () => {
  it("기존 섹션 이모지를 데이터 변경 없이 표시용 제목과 종류로 분리한다", () => {
    expect(sectionHeadingPresentation("🔍 학습 중 찾아본 표현 (5)")).toEqual({
      kind: "lookup",
      label: "학습 중 찾아본 표현 (5)",
    });
    expect(sectionHeadingPresentation("💬 전체 대화")).toEqual({
      kind: "dialogue",
      label: "전체 대화",
    });
    expect(sectionHeadingPresentation("학습 중 찾아본 표현 (3)")).toEqual({
      kind: "lookup",
      label: "학습 중 찾아본 표현 (3)",
    });
    expect(sectionHeadingPresentation("전체 대화")).toEqual({
      kind: "dialogue",
      label: "전체 대화",
    });
    expect(sectionHeadingPresentation("🎯 다음 목표")).toEqual({
      kind: null,
      label: "🎯 다음 목표",
    });
  });

  it("오래 열린 질문을 홈의 다음 관찰로 고른다", () => {
    expect(selectHomeFocus(subjects, questions)).toMatchObject({
      kind: "question",
      subject: { id: "deeper" },
      question: { questionId: "q2" },
    });
  });

  it("고아 질문은 무시하고 질문이 없으면 최근 나선으로 돌아간다", () => {
    const orphan = [{ ...questions[0], subjectId: "missing" }];
    expect(selectHomeFocus(subjects, orphan)).toMatchObject({
      kind: "subject",
      subject: { id: "newer" },
      question: null,
    });
  });

  it("나선을 최근·질문·Layer 기준으로 결정적으로 정렬하며 원본은 보존한다", () => {
    const original = subjects.slice();
    expect(sortSubjects(subjects, "recent").map((s) => s.id)).toEqual([
      "newer",
      "deeper",
    ]);
    expect(sortSubjects(subjects, "questions").map((s) => s.id)).toEqual([
      "deeper",
      "newer",
    ]);
    expect(sortSubjects(subjects, "layers").map((s) => s.id)).toEqual([
      "deeper",
      "newer",
    ]);
    expect(subjects).toEqual(original);
  });

  it("열린 질문을 정렬하고 제목·본문으로 필터링한다", () => {
    const titles = { newer: "새 나선", deeper: "깊은 나선" };
    expect(sortOpenQuestions(questions, "newest", titles)[0].subjectId).toBe(
      "newer",
    );
    expect(sortOpenQuestions(questions, "subject", titles)[0].subjectId).toBe(
      "deeper",
    );
    expect(filterOpenQuestions(questions, "깊은", titles)).toEqual([
      questions[1],
    ]);
    expect(filterOpenQuestions(questions, "최근", titles)).toEqual([
      questions[0],
    ]);
  });

  it("오염되거나 중복된 북마크 저장값을 안전하게 정규화한다", () => {
    expect(parseBookmarkIds(null)).toEqual([]);
    expect(parseBookmarkIds("잘못된 JSON")).toEqual([]);
    expect(parseBookmarkIds('{"id":"a"}')).toEqual([]);
    expect(parseBookmarkIds('["a","a","",42," b "]')).toEqual(["a", "b"]);
  });

  it("북마크를 추가·삭제하며 원본 배열을 보존한다", () => {
    const saved = ["a", "b"];
    expect(toggleBookmark(saved, "c")).toEqual(["c", "a", "b"]);
    expect(toggleBookmark(saved, "a")).toEqual(["b"]);
    expect(saved).toEqual(["a", "b"]);
  });

  it("유효한 북마크만 저장 순서대로 인코딩된 나선 경로에 연결한다", () => {
    const bookmarked = selectBookmarkItems(
      ["deeper", "missing", "a/b"],
      [...subjects, { id: "a/b", title: "Slash" }],
    );
    expect(bookmarked.map(({ id, route }) => ({ id, route }))).toEqual([
      { id: "deeper", route: "#/s/deeper" },
      { id: "a/b", route: "#/s/a%2Fb" },
    ]);
  });

  it("빈 검색에는 전체 목록을 노출하지 않고 입력할 때만 나선을 검색한다", () => {
    const searchable = [
      {
        id: "tag-match",
        title: "다른 제목",
        tags: ["unit-testing"],
        lastTouched: "2026-06-10",
      },
      {
        id: "unit/a",
        title: "01. Unit Basics",
        tags: [],
        lastTouched: "2026-05-10",
      },
    ];

    expect(filterSidebarItems(searchable, {}, "")).toEqual([]);
    expect(filterSidebarItems(searchable, {}, "unit").map((item) => item.id)).toEqual([
      "unit/a",
      "tag-match",
    ]);
    expect(filterSidebarItems(searchable, {}, "unit", 1)).toEqual([
      expect.objectContaining({
        id: "unit/a",
        kind: "subject",
        title: "Unit Basics",
        route: "#/s/unit%2Fa",
      }),
    ]);
  });

  it("레포·챕터·나선을 함께 검색하고 db 별칭과 구분자를 정규화한다", () => {
    const searchable = [
      {
        id: "page-block-extent",
        title: "Page · Block · Extent — InnoDB 물리 저장 구조",
        tags: ["innodb"],
        lastTouched: "2026-06-01",
      },
    ];
    const hierarchy = {
      repositories: [
        {
          id: "database-internals",
          title: "Database Internals",
          subjectCount: 1,
          chapters: [
            {
              id: "database-internals/storage-and-file-structure",
              repositoryId: "database-internals",
              title: "Storage And File Structure",
              subjectIds: ["page-block-extent"],
            },
          ],
        },
      ],
    };

    expect(normalizeSidebarQuery(" DB_internals ")).toBe("database internals");
    expect(
      filterSidebarItems(searchable, hierarchy, "db-internals").map(
        ({ kind, id, route }) => ({ kind, id, route }),
      ),
    ).toEqual([
      {
        kind: "repository",
        id: "database-internals",
        route: "#/map/database-internals",
      },
      {
        kind: "chapter",
        id: "database-internals/storage-and-file-structure",
        route:
          "#/map/database-internals?chapter=database-internals%2Fstorage-and-file-structure",
      },
      {
        kind: "subject",
        id: "page-block-extent",
        route: "#/s/page-block-extent",
      },
    ]);
    expect(
      filterSidebarItems(searchable, hierarchy, "storage_and file-structure")[0],
    ).toMatchObject({
      kind: "chapter",
      id: "database-internals/storage-and-file-structure",
    });
  });
});
