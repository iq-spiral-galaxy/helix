# Helix __TAG__

로컬에 남는 나선형 노트를 데스크톱 앱으로 읽고 탐색하는 첫 기술 프리뷰입니다.

## 이번 버전

- 전체 대화에서 `나`와 `버디`를 화자별 turn으로 구분해 긴 학습 흐름을 빠르게 읽을 수 있습니다.
- 화자 이모지를 절제된 프로필·Helix 선형 아이콘과 텍스트 라벨로 교체했습니다.
- 문단·목록·코드·표를 한 turn 안에 그대로 보존하고 라이트·다크·모바일·고대비 모드를 지원합니다.

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
