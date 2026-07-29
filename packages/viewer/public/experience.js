function text(value) {
  return String(value ?? "");
}

function compareText(a, b) {
  return text(a).localeCompare(text(b));
}

function compareDateDesc(a, b) {
  return compareText(b, a);
}

function compareDateAsc(a, b) {
  return compareText(a, b);
}

function questionKey(question) {
  return question?.id ?? question?.questionId ?? "";
}

/**
 * localStorage의 북마크 값을 안전하게 읽고 중복·오염된 ID를 제거한다.
 */
export function parseBookmarkIds(raw) {
  if (typeof raw !== "string") return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return [
      ...new Set(
        value
          .filter((id) => typeof id === "string")
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ];
  } catch {
    return [];
  }
}

/**
 * 최근 저장한 나선을 목록 앞에 두고, 이미 저장한 나선은 제거한다.
 */
export function toggleBookmark(ids = [], id = "") {
  const clean = parseBookmarkIds(JSON.stringify(ids));
  const target = String(id).trim();
  if (!target) return clean;
  if (clean.includes(target)) return clean.filter((value) => value !== target);
  return [target, ...clean];
}

/**
 * 사라진 subject ID는 건너뛰고 저장 순서대로 이동 경로를 만든다.
 */
export function selectBookmarkItems(ids = [], subjects = []) {
  const byId = new Map(subjects.map((subject) => [subject.id, subject]));
  return parseBookmarkIds(JSON.stringify(ids)).flatMap((id) => {
    const subject = byId.get(id);
    return subject
      ? [{ ...subject, route: `#/s/${encodeURIComponent(id)}` }]
      : [];
  });
}

/**
 * 홈에서 가장 먼저 보여줄 "다음 관찰"을 고른다.
 * 오래 열린 질문을 우선해 Helix의 핵심 루프(질문 → 다음 Layer)를 드러내고,
 * 질문이 없으면 가장 최근에 움직인 나선을 이어서 보여준다.
 */
export function selectHomeFocus(subjects = [], questions = []) {
  const byId = new Map(subjects.map((subject) => [subject.id, subject]));
  const open = questions
    .filter((question) => byId.has(question.subjectId))
    .slice()
    .sort(
      (a, b) =>
        compareDateAsc(a.raisedAtDate, b.raisedAtDate) ||
        compareText(a.subjectId, b.subjectId) ||
        compareText(questionKey(a), questionKey(b)),
    );

  if (open.length) {
    const question = open[0];
    return {
      kind: "question",
      subject: byId.get(question.subjectId),
      question,
    };
  }

  const subject = sortSubjects(subjects, "recent")[0] ?? null;
  return subject ? { kind: "subject", subject, question: null } : null;
}

export function sortSubjects(subjects = [], mode = "recent") {
  const copy = subjects.slice();
  copy.sort((a, b) => {
    if (mode === "questions") {
      return (
        (b.openQuestionCount ?? 0) - (a.openQuestionCount ?? 0) ||
        compareDateDesc(a.lastTouched, b.lastTouched) ||
        compareText(a.id, b.id)
      );
    }
    if (mode === "layers") {
      return (
        (b.layerCount ?? 0) - (a.layerCount ?? 0) ||
        compareDateDesc(a.lastTouched, b.lastTouched) ||
        compareText(a.id, b.id)
      );
    }
    return (
      compareDateDesc(a.lastTouched, b.lastTouched) ||
      compareText(a.id, b.id)
    );
  });
  return copy;
}

export function sortOpenQuestions(
  questions = [],
  mode = "oldest",
  titleById = {},
) {
  const copy = questions.slice();
  copy.sort((a, b) => {
    if (mode === "newest") {
      return (
        compareDateDesc(a.raisedAtDate, b.raisedAtDate) ||
        compareText(a.subjectId, b.subjectId) ||
        compareText(questionKey(a), questionKey(b))
      );
    }
    if (mode === "subject") {
      return (
        compareText(titleById[a.subjectId] ?? a.subjectId, titleById[b.subjectId] ?? b.subjectId) ||
        compareDateAsc(a.raisedAtDate, b.raisedAtDate) ||
        compareText(questionKey(a), questionKey(b))
      );
    }
    return (
      compareDateAsc(a.raisedAtDate, b.raisedAtDate) ||
      compareText(a.subjectId, b.subjectId) ||
      compareText(questionKey(a), questionKey(b))
    );
  });
  return copy;
}

export function filterOpenQuestions(questions = [], query = "", titleById = {}) {
  const needle = text(query).trim().toLocaleLowerCase();
  if (!needle) return questions.slice();
  return questions.filter((question) => {
    const haystack = [
      question.text,
      questionKey(question),
      titleById[question.subjectId],
      question.subjectId,
    ]
      .map(text)
      .join(" ")
      .toLocaleLowerCase();
    return haystack.includes(needle);
  });
}
