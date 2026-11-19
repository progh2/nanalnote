#!/usr/bin/env bash
# 릴리스의 설치 파일을 "버전 없는 고정 이름"으로 한 벌 더 올린다.
# → https://github.com/<저장소>/releases/latest/download/nanalnote-windows-setup.exe 처럼 항상 최신판을 가리키는 주소가 생긴다.
# 사용: release-aliases.sh v1.0.0 [owner/repo]
set -euo pipefail
TAG="$1"
V="${TAG#v}"
REPO="${2:-${GITHUB_REPOSITORY:-progh2/nanalnote}}"
WORK="$(mktemp -d)"
alias_one() { # $1 = 원본 패턴(버전 포함 → 고정 이름 파일과 겹치지 않음), $2 = 고정 이름
  local dir="$WORK/src-$2"
  mkdir -p "$dir"
  if gh release download "$TAG" --repo "$REPO" --pattern "$1" --dir "$dir" 2>/dev/null && [ -n "$(ls "$dir")" ]; then
    local f
    f="$(ls "$dir" | head -1)"
    cp "$dir/$f" "$WORK/$2"
    gh release upload "$TAG" "$WORK/$2" --repo "$REPO" --clobber
    echo "OK  $f -> $2"
  else
    echo "건너뜀: $1 (릴리스에 없음)"
  fi
}
alias_one "*_${V}_*-setup.exe"               nanalnote-windows-setup.exe
alias_one "*_${V}_*.msi"                     nanalnote-windows.msi
alias_one "nanalnote-windows-portable-${V}.zip" nanalnote-windows-portable.zip
alias_one "*_${V}_*.dmg"                     nanalnote-macos.dmg
alias_one "nanalnote-macos-portable-${V}.zip"   nanalnote-macos-portable.zip
alias_one "*_${V}_*.AppImage"                nanalnote-linux.AppImage
alias_one "*_${V}_*.deb"                     nanalnote-linux.deb
