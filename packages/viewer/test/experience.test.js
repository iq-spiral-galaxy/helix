import { describe, expect, it } from "vitest";
import {
  filterOpenQuestions,
  parseBookmarkIds,
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
});
