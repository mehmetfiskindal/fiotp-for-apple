#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

node "$PROJECT_ROOT/patches/geastack-linux-build.mjs"
export GEA_CORE="$(node -e "process.stdout.write(require('fs').realpathSync('$PROJECT_ROOT/node_modules/@geastack/core'))")"
export GEA_HOST_DIR="$(node -e "process.stdout.write(require('fs').realpathSync('$PROJECT_ROOT/node_modules/@geastack/host'))")"
export GEA_ENGINE_DIR="$(node -e "process.stdout.write(require('fs').realpathSync('$PROJECT_ROOT/node_modules/@geastack/engine'))")"
export GEA_ELEMENTS_DIR="$(node -e "process.stdout.write(require('fs').realpathSync('$PROJECT_ROOT/node_modules/@geastack/elements'))")"
export GEA_GEAOS_PACKAGE_DIR="$(node -e "process.stdout.write(require('fs').realpathSync('$PROJECT_ROOT/node_modules/@geastack/geaos'))")"
export CXX="$PROJECT_ROOT/scripts/fiotp-linux-cxx.sh"
export GEA_RPIOS_WIDTH="${GEA_RPIOS_WIDTH:-1100}"
export GEA_RPIOS_HEIGHT="${GEA_RPIOS_HEIGHT:-760}"
export GEA_RPIOS_SCALE="${GEA_RPIOS_SCALE:-1}"
export GEA_RPIOS_FONT_VIEWPORT_WIDTH="${GEA_RPIOS_FONT_VIEWPORT_WIDTH:-$GEA_RPIOS_WIDTH}"
export GEA_RPIOS_FONT_VIEWPORT_HEIGHT="${GEA_RPIOS_FONT_VIEWPORT_HEIGHT:-$GEA_RPIOS_HEIGHT}"
export GEA_RPIOS_FONT_DEVICE_PIXEL_RATIO="${GEA_RPIOS_FONT_DEVICE_PIXEL_RATIO:-1.0}"

bash "$PROJECT_ROOT/node_modules/@geastack/linux/targets/raspberry-pi-os/build-raspberry-pi-os.sh" fiotp-gea
touch "$PROJECT_ROOT/.gea-linux/generated/fiotp-gea/geatsc-sources.txt"
