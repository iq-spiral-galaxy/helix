# Helix (iq-helix)

**나선형 사고를 위한 노트 시스템.** Obsidian의 코어가 "관계"라면, Helix의 코어는 **"진화"** — 같은 주제를 다시 팔 때마다 노트가 새 파일로 흩어지는 게 아니라, 하나의 Subject 위에 Layer가 감겨 올라간다.

이름 = 데이터 모델(이중나선):

- **Subject** — 나선의 축. 학습에선 하나의 개념/주제
- **Layer** — 가닥 1: 회전마다 누적되는 사고의 흔적 (시간·깊이 축)
- **Open Question** — 가닥 2: 미해결 의문의 lifecycle (제기 → 해소)

두 가닥이 꼬이며 나선을 굴린다 — 질문이 다음 layer를 끌어내고, layer가 질문을 낳거나 해소한다.

설계 결정 전체는 [docs/SPEC.md](docs/SPEC.md), 세션 이관 맥락은 [docs/HANDOFF.md](docs/HANDOFF.md) 참조.

## 화면

뷰어는 옵시디언풍 앱 셸(사이드바 + 탭 워크스페이스)의 정적 SPA다. 라이트를 기본으로 한 다크·라이트 테마와 포레스트 그린 브랜드 컬러를 쓴다.

| 화면 | 라우트 | 내용 |
|---|---|---|
| **나선 일지** | `#/` | 다음 질문 하나와 간결한 노트 목록 |
| **나선 지도** | `#/map` | 레포(로드맵)마다 하나의 나선, 노드 = 챕터. 나선을 클릭하면 안으로 |
| **레포 지도** | `#/map/:repo` | 챕터 = 작은 나선, 주제 = 노드(시간순, 안→밖). 클릭 = 상세 |
| **상세** | `#/s/:id` | layer 타임라인 + 질문 칩 + 마크다운 본문 + **연결 패널** |
| **열린 질문** | `#/q` | 전체 열린 질문 검색·정렬 |

### 뷰어 기능

- **간결한 홈** — 오래 열린 질문 하나를 다음 행동으로 제안하고, 전체 노트를 최근·질문 기준으로 탐색
- **검색 중심 사이드바** — 기본 목록은 숨기고 제목·태그를 입력했을 때만 평면 결과를 표시
- **연결 (옵시디언식)** — 명시 edge가 없어도 로드맵 형제 + 태그 공유(IDF 랭킹)에서 연결을 파생. 상세 페이지 연결 패널, 지도의 호버 점등으로 표면화
- **나선 지도** — 아르키메데스 나선 위 등호장 배치, 스프링 복원·드래그, 휠 줌·팬, 화면 맞춤, 사용자 제어 재생, 정착 시 rAF 주차(idle CPU 0)
- **탭 워크스페이스** — 탭 열기/닫기/새 탭, Cmd/Ctrl+클릭 = 새 탭, 세션 복원
- **검색 (⌘K)** — 사이드바를 열고 나선 제목·태그를 즉시 검색, 키보드 탐색
- **화면 설정** — 다크·라이트 테마와 접을 수 있는 데스크톱 사이드바, 선택 상태 로컬 저장
- **모바일 탐색** — 검색·탭을 유지하는 드로어와 하단 내비게이션, 목록 우선 지도 탐색
- **본문 렌더** — 섹션 마크다운(불릿·코드펜스·볼드/이탤릭) + 경량 신택스 하이라이터(의존성 0)
- **접근성** — 캔버스 폴백 목록, aria-live, 키보드 탐색, `prefers-reduced-motion` 지원

의존성 0 정책: 뷰어 프론트엔드는 바닐라 JS + Canvas 2D (`public/` 수정은 서버 재시작 불필요).

## 데스크톱 앱

Helix v0.2.0부터 macOS·Windows·Linux용 Electron 앱을 함께 배포한다. 앱은 `helix://app` 로컬 프로토콜로 뷰어를 열기 때문에 포트 충돌이나 외부 API 노출이 없다. 노트 데이터는 앱 번들 밖에 유지되어 앱을 재설치하거나 업데이트해도 보존된다.

데이터 폴더는 다음 순서로 선택된다.

1. 앱 설정에서 선택한 폴더
2. `HELIX_ROOT`
3. 기존 `~/spiral-galaxy/helix`
4. 기본 `~/helix`

앱의 `설정 → 데스크톱 앱`에서 데이터 폴더를 열거나 변경할 수 있다. 새 릴리스가 있으면 `받기` 버튼으로 다운로드·SHA-256 검증·교체·재실행을 진행한다.

### 한 줄 설치

macOS·Linux:

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://github.com/iq-spiral-galaxy/helix/releases/latest/download/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://github.com/iq-spiral-galaxy/helix/releases/latest/download/install.ps1 | iex
```

첫 기술 프리뷰는 코드 서명 전 배포다. macOS는 설치 스크립트가 격리 속성을 정리하며 Windows에서는 SmartScreen 안내가 나타날 수 있다.

## 패키지

```
packages/
  core/     @iq-helix/core   — 포맷 파서/직렬화(round-trip 무손실), FileHelixStore,
                               _helix.json 인덱서, spiral-buddy importer, doctor, CLI
  viewer/   @iq-helix/viewer — Hono API + 정적 SPA (helix-viewer CLI)
electron/  Helix Desktop    — 보안 브리지, 로컬 프로토콜, 업데이트·데이터 폴더 관리
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

# 데스크톱 앱 개발 실행
pnpm desktop:dev

# 현재 OS 설치 파일 생성
pnpm desktop:dist
```

`v*` 태그를 push하면 GitHub Actions가 macOS DMG(arm64/x64), Windows NSIS, Linux AppImage를 만들고 GitHub Release에 게시한다. 태그는 반드시 루트 `package.json`의 버전과 일치해야 한다.

## 상태

- [x] Phase 0 — 스펙 동결 + 스캐폴딩
- [x] Phase 1 — `@iq-helix/core` (파서/스토어/인덱서/importer/doctor/CLI)
- [x] Phase 2 — 뷰어 v4: 차분한 다크 + 앱 셸(탭·⌘K 검색) + 옵시디언식 연결 + 계층형 나선 지도
- [x] Phase 2.5 — 데스크톱 기술 프리뷰: 3개 OS 패키징 + 검증형 앱 업데이트 + 한 줄 설치
- [ ] Phase 3 — spiral-buddy 전환: 세션이 `appendLayer()`로 기존 나선에 쌓이게 (나선을 실제로 굴리는 마지막 조각)
