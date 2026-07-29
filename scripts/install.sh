#!/usr/bin/env sh
set -eu

BASE_URL="https://github.com/iq-spiral-galaxy/helix/releases/latest/download"
OS="$(uname -s)"
ARCH="$(uname -m)"

if [ "$OS" = "Darwin" ]; then
  case "$ARCH" in
    arm64) ASSET="Helix-latest-arm64.dmg" ;;
    x86_64) ASSET="Helix-latest.dmg" ;;
    *) echo "지원하지 않는 macOS 아키텍처: $ARCH" >&2; exit 1 ;;
  esac

  TMP_DMG="$(mktemp -t helix.XXXXXX).dmg"
  TMP_SUMS="$(mktemp -t helix-checksums.XXXXXX)"
  MOUNT=""
  cleanup() {
    if [ -n "$MOUNT" ]; then hdiutil detach -quiet "$MOUNT" 2>/dev/null || true; fi
    rm -f -- "$TMP_DMG" "$TMP_SUMS"
  }
  trap cleanup EXIT INT TERM

  curl --proto '=https' --tlsv1.2 -fL --retry 3 \
    "$BASE_URL/$ASSET" -o "$TMP_DMG"
  curl --proto '=https' --tlsv1.2 -fL --retry 3 \
    "$BASE_URL/SHA256SUMS.txt" -o "$TMP_SUMS"
  EXPECTED="$(awk -v asset="$ASSET" '$2 == asset || $2 == "*" asset { print $1; exit }' "$TMP_SUMS")"
  ACTUAL="$(shasum -a 256 "$TMP_DMG" | awk '{ print $1 }')"
  if [ -z "$EXPECTED" ] || [ "$ACTUAL" != "$EXPECTED" ]; then
    echo "설치 파일 체크섬이 일치하지 않습니다." >&2
    exit 1
  fi
  MOUNT="$(hdiutil attach -nobrowse "$TMP_DMG" | tail -1 | sed 's/^.*	//')"
  SOURCE="$(find "$MOUNT" -maxdepth 1 -type d -name 'Helix.app' -print -quit)"
  if [ -z "$SOURCE" ]; then
    echo "설치 이미지에서 Helix.app을 찾지 못했습니다." >&2
    exit 1
  fi

  osascript -e 'tell application "Helix" to quit' 2>/dev/null || true
  WAIT_COUNT=0
  while pgrep -x "Helix" >/dev/null 2>&1; do
    if [ "$WAIT_COUNT" -ge 40 ]; then
      echo "실행 중인 Helix를 종료한 뒤 다시 설치해 주세요." >&2
      exit 1
    fi
    WAIT_COUNT=$((WAIT_COUNT + 1))
    sleep 0.25
  done

  INSTALL_DIR="/Applications"
  if [ ! -w "$INSTALL_DIR" ]; then
    INSTALL_DIR="$HOME/Applications"
    mkdir -p "$INSTALL_DIR"
  fi
  TARGET="$INSTALL_DIR/Helix.app"
  STAGED="$INSTALL_DIR/.Helix.app.installing"
  BACKUP="$INSTALL_DIR/.Helix.app.previous"
  rm -rf -- "$STAGED" "$BACKUP"
  ditto "$SOURCE" "$STAGED"
  if [ -d "$TARGET" ]; then mv "$TARGET" "$BACKUP"; fi
  if mv "$STAGED" "$TARGET"; then
    rm -rf -- "$BACKUP"
  else
    [ -d "$BACKUP" ] && mv "$BACKUP" "$TARGET"
    exit 1
  fi
  xattr -cr "$TARGET" 2>/dev/null || true
  open "$TARGET"
  echo "Helix를 설치하고 실행했습니다: $TARGET"
  exit 0
fi

if [ "$OS" = "Linux" ]; then
  if [ "$ARCH" != "x86_64" ]; then
    echo "현재 Linux 기술 프리뷰는 x86_64만 지원합니다." >&2
    exit 1
  fi
  INSTALL_DIR="$HOME/.local/bin"
  TARGET="$INSTALL_DIR/Helix.AppImage"
  TMP_FILE="$(mktemp)"
  TMP_SUMS="$(mktemp)"
  TMP_ICON="$(mktemp)"
  trap 'rm -f -- "$TMP_FILE" "$TMP_SUMS" "$TMP_ICON"' EXIT INT TERM
  mkdir -p "$INSTALL_DIR"
  curl --proto '=https' --tlsv1.2 -fL --retry 3 \
    "$BASE_URL/Helix-latest.AppImage" -o "$TMP_FILE"
  curl --proto '=https' --tlsv1.2 -fL --retry 3 \
    "$BASE_URL/Helix.png" -o "$TMP_ICON"
  curl --proto '=https' --tlsv1.2 -fL --retry 3 \
    "$BASE_URL/SHA256SUMS.txt" -o "$TMP_SUMS"
  EXPECTED="$(awk '$2 == "Helix-latest.AppImage" || $2 == "*Helix-latest.AppImage" { print $1; exit }' "$TMP_SUMS")"
  EXPECTED_ICON="$(awk '$2 == "Helix.png" || $2 == "*Helix.png" { print $1; exit }' "$TMP_SUMS")"
  ACTUAL="$(sha256sum "$TMP_FILE" | awk '{ print $1 }')"
  ACTUAL_ICON="$(sha256sum "$TMP_ICON" | awk '{ print $1 }')"
  if [ -z "$EXPECTED" ] || [ "$ACTUAL" != "$EXPECTED" ] ||
     [ -z "$EXPECTED_ICON" ] || [ "$ACTUAL_ICON" != "$EXPECTED_ICON" ]; then
    echo "설치 파일 체크섬이 일치하지 않습니다." >&2
    exit 1
  fi
  chmod +x "$TMP_FILE"
  mv "$TMP_FILE" "$TARGET"
  ICON_DIR="$HOME/.local/share/icons"
  DESKTOP_DIR="$HOME/.local/share/applications"
  ICON_PATH="$ICON_DIR/helix.png"
  DESKTOP_FILE="$DESKTOP_DIR/helix.desktop"
  mkdir -p "$ICON_DIR" "$DESKTOP_DIR"
  mv "$TMP_ICON" "$ICON_PATH"
  printf '%s\n' \
    "[Desktop Entry]" \
    "Type=Application" \
    "Name=Helix" \
    "Comment=나선형 학습 노트" \
    "Exec=$TARGET" \
    "Icon=$ICON_PATH" \
    "Terminal=false" \
    "Categories=Office;Utility;" > "$DESKTOP_FILE"
  chmod +x "$DESKTOP_FILE"
  "$TARGET" >/dev/null 2>&1 &
  echo "Helix를 설치하고 실행했습니다: $TARGET"
  exit 0
fi

echo "지원하지 않는 운영체제입니다: $OS" >&2
exit 1
