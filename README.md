# Helix (iq-helix)

**나선형 사고를 위한 노트 시스템.** Obsidian의 코어가 "관계"라면, Helix의 코어는 **"진화"** — 같은 주제를 다시 팔 때마다 노트가 새 파일로 흩어지는 게 아니라, 하나의 Subject 위에 Layer가 감겨 올라간다.

이름 = 데이터 모델(이중나선):

- **Subject** — 나선의 축. 학습에선 하나의 개념/주제
- **Layer** — 가닥 1: 회전마다 누적되는 사고의 흔적 (시간·깊이 축)
- **Open Question** — 가닥 2: 미해결 의문의 lifecycle (제기 → 해소)

두 가닥이 꼬이며 나선을 굴린다 — 질문이 다음 layer를 끌어내고, layer가 질문을 낳거나 해소한다.

설계 결정 전체는 [docs/SPEC.md](docs/SPEC.md), 세션 이관 맥락은 [docs/HANDOFF.md](docs/HANDOFF.md) 참조.

## 화면

뷰어는 옵시디언풍 앱 셸(사이드바 + 탭 워크스페이스)의 정적 SPA다. 차분한 다크 단일 테마 — 무채색 위계에 액센트 2색(파랑 = 현재 위치, 세이지 = 관계)만 쓴다.

| 화면 | 라우트 | 내용 |
|---|---|---|
| **나선 일지** | `#/` | 학습 기록 전체 — 시간순 리스트 + 히어로 통계 |
| **나선 지도** | `#/map` | 레포(로드맵)마다 하나의 나선, 노드 = 챕터. 나선을 클릭하면 안으로 |
| **레포 지도** | `#/map/:repo` | 챕터 = 작은 나선, 주제 = 노드(시간순, 안→밖). 클릭 = 상세 |
| **상세** | `#/s/:id` | layer 타임라인 + 질문 칩 + 마크다운 본문 + **연결 패널** |
| **남은 질문** | `#/q` | 전체 열린 질문 — 다음 나선을 굴릴 연료 |

### 뷰어 기능

- **연결 (옵시디언식)** — 명시 edge가 없어도 로드맵 형제 + 태그 공유(IDF 랭킹)에서 연결을 파생. 상세 페이지 연결 패널, 지도의 호버 점등으로 표면화
- **나선 지도** — 아르키메데스 나선 위 등호장 배치, 물리 기반(스프링 복원·드래그 리플·관성 없는 강체 회전), 휠 줌·팬, ⏸ 회전 토글(영속), 정착 시 rAF 주차(idle CPU 0)
- **탭 워크스페이스** — 탭 열기/닫기/새 탭, Cmd/Ctrl+클릭 = 새 탭, 세션 복원
- **검색 (⌘K)** — 나선 제목·태그·layer 본문·질문 전문 검색, 키보드 탐색
- **본문 렌더** — 섹션 마크다운(불릿·코드펜스·볼드/이탤릭) + 경량 신택스 하이라이터(의존성 0)
- **접근성** — 캔버스 폴백 목록, aria-live, 키보드 탐색, `prefers-reduced-motion` 지원

의존성 0 정책: 뷰어 프론트엔드는 바닐라 JS + Canvas 2D (`public/` 수정은 서버 재시작 불필요).

## 패키지

```
packages/
  core/     @iq-helix/core   — 포맷 파서/직렬화(round-trip 무손실), FileHelixStore,
                               _helix.json 인덱서, spiral-buddy importer, doctor, CLI
  viewer/   @iq-helix/viewer — Hono API + 정적 SPA (helix-viewer CLI)
```

### 뷰어 API

| 엔드포인트 | 내용 |
|---|---|
| `GET /api/subjects` | active subject 요약 목록 (lastTouched desc) |
| `GET /api/subjects/:id` | subject 전체 (layers·questions·edges·sources) |
| `GET /api/subjects/:id/connections` | 연결 — 로드맵 형제 + 태그 IDF 관련 나선 + 명시 edges 양방향 |
| `GET /api/roadmaps` | 사이드바용 로드맵 그룹핑 |
| `GET /api/graph` | 나선 지도용 — 노드 + 사전 솎인 대칭 이웃(노드당 ≤6, 허브태그 가드) |
| `GET /api/questions` | 전체 열린 질문 |

## 저장 포맷

**Markdown이 단일 진실.** subject 1개 = `~/helix/subjects/<slug>.md` 1개 — frontmatter(id·tags·sources·mastery·questions·edges) + 본문(`## Layer N` 헤딩 + `<!-- helix:layer ... -->` 앵커). `_helix.json`은 rebuild 가능한 파생 인덱스(gitignore). 불일치는 `helix doctor`가 검증한다.

레포 계층은 spiral-buddy `roadmap_id`에서 나온다: `unit-testing/mocking-strategies` → **레포**(unit-testing) / **챕터**(mocking-strategies). 새 레포를 import하면 나선 지도에 새 나선이 자동으로 생긴다.

## 사용

```bash
pnpm install && pnpm build && pnpm test

# 기존 spiral-buddy 노트 import (원본 vault는 read-only)
node packages/core/dist/cli.js import spiral-buddy "<obsidian-vault-경로>" --root ~/helix
node packages/core/dist/cli.js doctor --root ~/helix

# 뷰어 실행 → http://localhost:4180
node packages/viewer/dist/cli.js --root ~/helix
```

## 상태

- [x] Phase 0 — 스펙 동결 + 스캐폴딩
- [x] Phase 1 — `@iq-helix/core` (파서/스토어/인덱서/importer/doctor/CLI)
- [x] Phase 2 — 뷰어 v4: 차분한 다크 + 앱 셸(탭·⌘K 검색) + 옵시디언식 연결 + 계층형 나선 지도
- [ ] Phase 3 — spiral-buddy 전환: 세션이 `appendLayer()`로 기존 나선에 쌓이게 (나선을 실제로 굴리는 마지막 조각)
