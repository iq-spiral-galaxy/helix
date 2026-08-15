# Helix __TAG__

로컬에 남는 나선형 노트를 데스크톱 앱으로 읽고 탐색하는 첫 기술 프리뷰입니다.

## 이번 버전

- 아래에서 위로 흐르는 시간축을 나선이 감고 올라가는 흑백 `Time Coil` 앱 아이콘을 적용했습니다.
- 기존 녹색 DNA 형태와 그라디언트를 걷어내고 오프화이트·니어블랙 두 색의 단순한 브랜드 마크로 정리했습니다.
- 데스크톱 앱 아이콘과 웹 파비콘을 같은 형태로 통일하고 작은 크기에서도 축과 나선을 구분할 수 있도록 보정했습니다.

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
