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

function compareQuestionKey(a, b) {
  return text(a).localeCompare(text(b), undefined, { numeric: true });
}

const SECTION_HEADING_MARKERS = [
  { pattern: /^🔍\uFE0F?\s*/u, kind: "lookup" },
  { pattern: /^💬\uFE0F?\s*/u, kind: "dialogue" },
];

function canonicalSectionHeadingKind(heading) {
  if (/^학습 중 찾아본 표현(?:\s*\(\d+\))?$/u.test(heading)) return "lookup";
  if (heading === "전체 대화") return "dialogue";
  return null;
}

/**
 * 기존 노트의 장식 이모지는 저장 데이터에서 지우지 않고 표시 단계에서만 분리한다.
 * 요청된 두 제목만 정확히 다뤄 다른 의미 있는 이모지 제목은 그대로 보존한다.
 */
export function sectionHeadingPresentation(value) {
  const heading = text(value).trim();
  const marker = SECTION_HEADING_MARKERS.find(({ pattern }) =>
    pattern.test(heading),
  );
  const rawLabel = marker ? heading.replace(marker.pattern, "").trim() : heading;
  const kind = marker?.kind ?? canonicalSectionHeadingKind(rawLabel);
  const label = /^학습 중 찾아본 표현\s*\(\d+\)$/u.test(rawLabel)
    ? "학습 중 찾아본 표현"
    : rawLabel;
  return { kind, label };
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

const SEARCH_TOKEN_ALIASES = new Map([
  ["db", "database"],
]);

/**
 * 대소문자와 구분자 차이를 없애고 익숙한 축약어를 저장 ID와 맞춘다.
 * 예: "DB_internals"와 "database-internals" → "database internals".
 */
export function normalizeSidebarQuery(value) {
  return text(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => SEARCH_TOKEN_ALIASES.get(token) ?? token)
    .join(" ");
}

function searchScore(fields, query) {
  const normalized = fields.map(normalizeSidebarQuery).filter(Boolean);
  const tokens = query.split(" ").filter(Boolean);
  const haystack = normalized.join(" ");
  if (!tokens.every((token) => haystack.includes(token))) return null;
  const direct = normalized.flatMap((field, index) => {
    const fieldWeight = index * 4;
    if (field === query) return [fieldWeight];
    if (field.startsWith(query)) return [fieldWeight + 1];
    if (field.includes(query)) return [fieldWeight + 2];
    return [];
  });
  return direct.length ? Math.min(...direct) : normalized.length * 4 + 3;
}

/**
 * 기본 목록은 열지 않고, 입력한 동안에만 레포·챕터·Subject를 한 목록에서 찾는다.
 * `/api/roadmaps`의 subjectIds로 요약 Subject에 계층 문맥을 다시 연결한다.
 */
export function filterSidebarItems(
  subjects = [],
  hierarchy = {},
  query = "",
  limit = 30,
) {
  const needle = normalizeSidebarQuery(query);
  if (!needle) return [];

  const subjectContext = new Map();
  const entries = [];
  for (const repository of hierarchy.repositories ?? []) {
    entries.push({
      kind: "repository",
      id: repository.id,
      title: repository.title,
      context: `레포 · 나선 ${repository.subjectCount ?? 0}개`,
      route: `#/map/${encodeURIComponent(repository.id)}`,
      fields: [repository.title, repository.id],
      lastTouched: "",
    });
    for (const chapter of repository.chapters ?? []) {
      const context = {
        repositoryId: repository.id,
        repositoryTitle: repository.title,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
      };
      for (const subjectId of chapter.subjectIds ?? []) {
        subjectContext.set(subjectId, context);
      }
      entries.push({
        kind: "chapter",
        id: chapter.id,
        title: chapter.title,
        context: `챕터 · ${repository.title} · 나선 ${(chapter.subjectIds ?? []).length}개`,
        route: `#/map/${encodeURIComponent(repository.id)}?chapter=${encodeURIComponent(chapter.id)}`,
        fields: [
          chapter.title,
          chapter.id,
          repository.title,
          repository.id,
        ],
        lastTouched: "",
      });
    }
  }

  for (const subject of subjects) {
    const context = subjectContext.get(subject.id);
    const title = text(subject.title).replace(/^\d+[.)]\s*/, "");
    entries.push({
      kind: "subject",
      id: subject.id,
      subjectId: subject.id,
      title,
      context: context
        ? `나선 · ${context.repositoryTitle} / ${context.chapterTitle}`
        : "나선",
      route: `#/s/${encodeURIComponent(subject.id)}`,
      fields: [
        title,
        subject.id,
        ...(subject.tags ?? []),
        context?.repositoryTitle,
        context?.repositoryId,
        context?.chapterTitle,
        context?.chapterId,
      ],
      lastTouched: subject.lastTouched ?? "",
    });
  }

  const kindRank = { repository: 0, chapter: 1, subject: 2 };
  return entries
    .map((entry) => {
      const score = searchScore(entry.fields, needle);
      return score == null ? null : { ...entry, score };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        a.score - b.score ||
        kindRank[a.kind] - kindRank[b.kind] ||
        compareDateDesc(a.lastTouched, b.lastTouched) ||
        compareText(a.title, b.title) ||
        compareText(a.id, b.id),
    )
    .slice(0, Math.max(0, limit))
    .map(({ fields: _fields, score, ...entry }) => ({ ...entry, score }));
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

/**
 * 상세 API에 실제로 존재하는 생성 Layer와 자연스러운 질문 번호 순으로 고정한다.
 * 대표 질문 한 개와 같은 나선에서 이어 보여줄 나머지를 원본 변경 없이 나눈다.
 */
export function partitionOpenQuestions(questions = []) {
  const ordered = questions.slice().sort(
    (a, b) =>
      (Number(a.raisedAtLayer) || 0) - (Number(b.raisedAtLayer) || 0) ||
      compareQuestionKey(questionKey(a), questionKey(b)),
  );
  return {
    primary: ordered[0] ?? null,
    remaining: ordered.slice(1),
  };
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
