#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REAL_CXX="${FIOTP_REAL_CXX:-g++}"

# The GeaStack target calls CXX once for each framework translation unit and
# once for the final link. Compile its normal sources untouched; add FiOTP's
# Linux host only to the final executable.
VIRTUAL_KEYBOARD_ENABLED="${GEA_RPIOS_ENABLE_VIRTUAL_KEYBOARD:-0}"
if [[ "$VIRTUAL_KEYBOARD_ENABLED" != "0" && "$VIRTUAL_KEYBOARD_ENABLED" != "1" ]]; then
  echo "GEA_RPIOS_ENABLE_VIRTUAL_KEYBOARD must be 0 or 1" >&2
  exit 2
fi

for arg in "$@"; do
  if [[ "$arg" == "-c" ]]; then
    exec "$REAL_CXX" -DGEA_EMBEDDED_ENABLE_VIRTUAL_KEYBOARD="$VIRTUAL_KEYBOARD_ENABLED" "$@"
  fi
done

TARGET_ROOT="$PROJECT_ROOT/node_modules/@geastack/linux/targets/raspberry-pi-os"
GENERATED_DIR="$PROJECT_ROOT/.gea-linux/generated/fiotp-gea"
GEA_CORE="$(node -e "process.stdout.write(require('fs').realpathSync('$PROJECT_ROOT/node_modules/@geastack/core'))")"
if [[ ! -f "$GENERATED_DIR/gea_runtime.h" ]]; then
  echo "FiOTP Linux host runtime header is missing; run the GeaStack Linux build from the project root." >&2
  exit 1
fi

GEA_MANIFEST="$GEA_CORE/gea_sources.sh"
[[ -f "$GEA_MANIFEST" ]] || GEA_MANIFEST="$GEA_CORE/../../gea_sources.sh"
source "$GEA_MANIFEST"
read -r -a SDL_CFLAGS <<< "$(sdl2-config --cflags)"
INCLUDES=("-I$PROJECT_ROOT/native" "-I$GENERATED_DIR" "${SDL_CFLAGS[@]}")
while IFS= read -r include_flag; do INCLUDES+=("$include_flag"); done < <(gea_fw_include_flags)

exec "$REAL_CXX" -std=c++20 "$@" "${INCLUDES[@]}" "$PROJECT_ROOT/native/fiotp_host_linux.cpp" -lcrypto
