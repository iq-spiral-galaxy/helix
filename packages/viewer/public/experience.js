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
