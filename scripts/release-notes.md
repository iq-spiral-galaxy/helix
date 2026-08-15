# Helix __TAG__

로컬에 남는 나선형 노트를 데스크톱 앱으로 읽고 탐색하는 첫 기술 프리뷰입니다.

## 이번 버전

- 같은 로드맵, 관련 나선, 명시적 연결을 독립된 그룹으로 나눠 관계의 성격을 한눈에 구분할 수 있습니다.
- 연결 본문을 제목보다 뒤로 정렬하고 그룹 경계와 행 여백을 보강해 긴 관계 목록도 편하게 읽을 수 있습니다.
- 지도 이동을 패널 안의 명확한 아이콘 버튼으로 옮기고 좁은 화면에서 제목과 태그가 잘리지 않도록 개선했습니다.

## 한 줄 설치

### macOS · Linux

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://github.com/iq-spiral-galaxy/helix/releases/latest/download/install.sh | sh
```

### Windows PowerShell

```powershell
irm https://github.com/iq-spiral-galaxy/helix/releases/latest/download/install.ps1 | iex
```

설치 후에는 `설정 → 앱 업데이트`에서 새 버전을 확인하고 `받기`를 누르면 다운로드, 체크섬 검증, 교체와 재실행이 자동으로 진행됩니다.

## 기술 프리뷰 안내

- macOS: Apple Developer ID 공증 전 빌드라 설치 스크립트가 격리 속성을 정리합니다.
- Windows: 코드 서명 전에는 SmartScreen 경고가 표시될 수 있습니다.
- Linux: AppImage로 설치한 경우 앱 안에서 자동 교체됩니다.
- 사용자 데이터는 앱과 분리된 Helix 데이터 폴더에 남으므로 재설치와 업데이트에 영향을 받지 않습니다.
