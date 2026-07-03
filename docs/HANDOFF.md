# iq-helix — Claude Code 이관 핸드오프

> 작성: 2026-06-10, claude.ai 기획+구현 세션 종료 시점.
> 용도: Claude Code 세션이 컨텍스트 제로에서 이 프로젝트를 이어받기 위한 문서.
> 레포에 `docs/HANDOFF.md`로 커밋해두고 Claude Code에게 "docs/HANDOFF.md 읽고 시작해"라고 지시할 것.

---

## 1. 이게 뭔가 (30초 요약)

**iq-helix = 나선형 사고를 위한 노트 시스템.** Obsidian의 코어가 "관계(그래프)"라면 helix의 코어는 **"진화"** — 하나의 Subject가 시간/깊이 축에서 Layer를 누적하고, Open Question이 lifecycle(제기→해소)을 가진다. 첫 적용 도메인은 학습이고, 입력원은 `iq-spiral-buddy`(같은 org의 Socratic 학습 MCP 앱)지만 포맷 자체는 도구 중립.

**이름 = 데이터 모델 (이중나선):**
- **Subject** — 나선의 축
- **Layer** — 가닥 1 (골드): 회전마다 누적되는 사고의 흔적
- **Open Question** — 가닥 2 (단청 레드): 미해결 의문의 lifecycle
- 두 가닥이 꼬이며 나선을 굴린다. 질문이 다음 layer를 끌어내고, layer가 질문을 낳거나 해소한다.

**시각 컨셉:** 나선 평면에 수직한 방향 = 시간축. 태양계가 시간축을 따라 나아가는 걸 **밖에서 관측**하는 시점. 뷰어 랜딩은 그래서 "관측소".

전체 설계는 `docs/SPEC.md` (Decision Log D1~D7 포함). 이 문서와 충돌 시 SPEC이 우선하되, 아래 §4의 "SPEC 이후 변경"을 반영할 것.

## 2. 환경 & 경로

| 항목 | 값 |
|---|---|
| 레포 | `~/iq-lab/iq-agent-lab/iq-helix` (github.com/iq-spiral-galaxy/helix, main — iq-agent-lab/iq-helix에서 이관) |
| helix 데이터 루트 | `~/helix` (`subjects/*.md` + 파생 인덱스 `_helix.json`) |
| Obsidian vault (import 원본, read-only) | `/Users/ibm514/Documents/Obsidian Vault` |
| spiral-buddy 레포 (Phase 3 대상) | `~/iq-lab/iq-agent-lab/iq-spiral-buddy` |
| 런타임 | Node 22, pnpm 11 (corepack), TypeScript ESM (NodeNext) |

**pnpm 11 함정 (이미 해결됨, 건드리지 말 것):** 빌드 스크립트 허용은 `pnpm-workspace.yaml`의 `allowBuilds: { esbuild: true }`. `onlyBuiltDependencies`는 pnpm 11에서 무시됨. `approve-builds`에서 선택 없이 엔터 치면 false로 잠기니 주의.

## 3. 레포 구조 & 현재 상태 (Phase 0~2.2 완료)

```
iq-helix/
  docs/SPEC.md                 # 설계 동결 문서 (D1~D7)
  packages/core/               # @iq-helix/core — 완성
    src/types.ts               #   데이터 모델 + HelixStore 인터페이스
    src/markdown.ts            #   parser/serializer (round-trip 무손실 테스트됨)
    src/store.ts               #   FileHelixStore (파일시스템 구현)
    src/indexer.ts             #   _helix.json 빌더
    src/importer.ts            #   spiral-buddy 노트 import (v2: 스키마 완화 + 스킵 사유)
    src/doctor.ts              #   frontmatter↔본문 앵커 일관성 검증
    src/cli.ts                 #   helix import / reindex / doctor
    test/                      #   vitest 8개
  packages/viewer/             # @iq-helix/viewer — 완성 (v3)
    src/server.ts              #   Hono API (/api/subjects, /api/subjects/:id, /api/questions) + 정적 서빙
    src/cli.ts                 #   helix-viewer --root --port (기본 4180)
    public/index.html          #   정적 SPA (빌드 없음 — public/ 수정은 서버 재시작만)
    public/styles.css          #   코스믹 디자인 토큰
    public/app.js              #   해시 라우팅: #/(관측소) #/s/:id(상세) #/q(질문)
    public/helix3d.js          #   3D 이중나선 렌더러 (의존성 0, 캔버스 직접 투영)
    test/server.test.ts
```

명령어:
```bash
pnpm install && pnpm build && pnpm test          # 테스트 9개 전부 green이어야 정상
node packages/core/dist/cli.js import spiral-buddy "<vault>" --root ~/helix
node packages/core/dist/cli.js doctor --root ~/helix
node packages/viewer/dist/cli.js --root ~/helix   # → http://localhost:4180
```

현재 데이터: subject 18+개, 전부 layer 1개 (아직 같은 주제를 재방문한 세션이 없어서). 열린 질문 ~64개.

## 4. SPEC 이후 변경된 결정 (이 문서가 최신)

1. **뷰어가 MVP에 포함, spiral-buddy 전환보다 먼저** (원안 변경). 이유: MVP 가치 검증 = "노트가 나선으로 보이는 순간".
2. **importer v2**: `generator`/`chapter_id` 비강제. topic 기반 파일명 노트(네이밍 개선 이후 스키마)도 수용 — depth는 frontmatter 또는 파일명 `dN`에서. 스킵 시 파일별 사유 출력. 그룹 키 = (roadmap_name, chapter basename | topic).
3. **뷰어 v3 = "관측소"**: 랜딩 진입 즉시 3D 헬릭스. 디자인은 iq-label 코스믹 토큰 (아래 §5).
4. 3D 표현 규칙: 3D에선 두 가닥이 실제로 만나지 않으므로 **layer = 두 가닥을 잇는 가로대(rung)** (DNA 방식). 2D 미니 글리프에선 교차점이 layer. depth가 깊어질수록 궤도 반경 증가. 열린 질문 = 마지막 회전 너머 점선 "유령 회전" 위에서 맥동하는 위성.

## 5. 디자인 시스템 (iq-label 코스믹 토큰)

| 토큰 | 값 | 용도 |
|---|---|---|
| cosmic dark | `#0D0A18` | 배경 |
| moonlight cream | `#F2EAD8` | 본문 텍스트 |
| stardust gold | `#D4B27A` | **Layer 가닥**, 구조 액센트 |
| dancheong red | `#E84852` | **Question 가닥**, 열린 질문 |
| cosmic purple | `#8B6FBF` | 해소(resolved) 마커 |
| 타이포 | Noto Serif KR(디스플레이) / IBM Plex Sans KR(본문) / IBM Plex Mono(메타) | |

배경에 옅은 별밭(트윙클) 캔버스. 패널은 cream 4~7% 알파의 글래스.

**디자인 개선 트랙 (사용자가 원하는 방향):** "3D + 인터랙티브 + 들어가자마자 헬릭스"는 v3에서 달성. 추가 고도화 시 Google Stitch MCP를 Claude Code에 붙여 시안 생성 → 코드 반영 루프 권장:
```bash
claude mcp add stitch --transport http \
  --header "X-Goog-Api-Key: <새로 발급한 키>" \
  https://stitch.googleapis.com/mcp
```
⚠️ 기존 Stitch API 키는 채팅에 노출되어 폐기 대상. **반드시 재발급 후 사용.**

## 6. 데이터 모델 핵심 (전체는 SPEC §2~5)

- Subject 1개 = `~/helix/subjects/<slug>.md` 1개. **markdown이 단일 진실**, `_helix.json`은 rebuild 가능한 파생 인덱스(gitignore).
- frontmatter = 기계가독 (id, sources, mastery, **questions**, edges). 본문 = `## Layer N` 헤딩 + `<!-- helix:layer index=.. depth=.. date=.. adds=q1 resolves=q2 -->` 앵커 + 섹션들.
- 질문 텍스트의 소유권은 frontmatter의 OpenQuestion. Layer 앵커는 id만 참조 (`adds=`/`resolves=`). 불일치는 `helix doctor`가 잡음.
- `Layer.index`(회차)와 `depth`(의미 깊이)는 별개. 같은 depth를 두 번 돌 수 있음.
- 핵심 불변식: round-trip(parse→serialize) 무손실, `sources.length <= 1`(MVP, D1), layer index 연속.

## 7. 다음 작업 = Phase 3: spiral-buddy 전환 (MVP 마지막 조각)

**목표:** 다음 학습 세션부터 노트가 흩어진 파일이 아니라 **기존 Subject의 새 Layer로 쌓이게** 한다.

spiral-buddy 쪽 작업 (레포: `~/iq-lab/iq-agent-lab/iq-spiral-buddy`):
1. `@iq-helix/core`를 의존성으로 추가 (로컬 워크스페이스가 아니므로 `file:` 또는 git 의존, 아니면 pnpm link).
2. 노트 작성 경로 교체: 기존 `src/vault.ts`의 "새 md 파일 생성" 로직 → `FileHelixStore.appendLayer()` 호출로.
   - subject 식별: `(roadmap_name, chapter basename)` → slug (core의 `slugifyChapter` 재사용). 없으면 `createSubject` 먼저.
   - 세션의 "헷갈렸던/확인이 필요한 지점" → `LayerDraft.addQuestions`.
   - 세션 중 기존 열린 질문이 풀렸다고 판단되면 → `LayerDraft.resolveQuestions: [{id, resolution}]`. (세션 시작 시 `store.openQuestions({subjectId})`를 가져와 프롬프트에 노출하고, 세션이 어떤 질문을 해소했는지 모델이 표시하게 하는 게 자연스러움 — **이게 Phase 3의 설계 포인트. 나선을 굴리는 메커니즘이다.**)
3. Obsidian 미러는 유지 (마이그레이션 안전망): helix 쓰기 성공 후 기존 방식으로 vault에도 export. 끄는 건 나중에.
4. 검증(DoD): **같은 chapter로 세션 1회 → 해당 subject에 layer가 1개 늘고, 관측소에서 새 rung이 보이고, 풀린 질문이 퍼플로 바뀐다.**

주의: spiral-buddy는 Claude Desktop MCP 서버 + 로컬 웹앱. Phase 2~2.3 완료 상태, Notion 통합(Phase 3였던 것)은 롤백됨. 파일 네이밍 개선만 보존되어 있음 — importer v2가 이미 두 스키마 모두 수용.

## 8. 백로그 (Phase 3 이후, 우선순위 순)

1. 관측소 디자인 고도화 (Stitch 루프) — 사용자가 "기본 느낌" 탈피를 계속 원함. 후보: 히어로 카메라 연출, subject 그리드의 별자리/은하 배치, 모바일 대응
2. `helix doctor --fix` (자동 복구), 검색
3. `mergeSubjects(a,b)` — cross-roadmap 합치기 (D1이 문 열어둠)
4. Obsidian 미러 export 공식화 → spiral-buddy 미러 제거
5. `@iq-helix/mcp` — Claude가 나선/열린 질문을 직접 읽는 MCP 서버 (spiral-buddy 세션 시작 시 자동 컨텍스트)
6. sqlite 인덱스 (subject 수백 개 이후)

## 9. 작업 수칙 (이 세션들에서 합의된 것)

- 커밋 메시지는 한국어, `feat:`/`fix:` 프리픽스.
- 큰 변경 전 `pnpm test` green 확인. core 포맷 변경 시 round-trip 테스트 필수.
- import 재실행은 `rm -rf ~/helix` 후 (원본 vault는 항상 read-only).
- 서버 띄운 채 작업 시: `nohup node packages/viewer/dist/cli.js --root ~/helix > /tmp/helix-viewer.log 2>&1 &`, 종료는 `pkill -f "viewer/dist/cli.js"`.
- 결정엔 "왜"를 문서로 남길 것 (SPEC Decision Log 스타일).
