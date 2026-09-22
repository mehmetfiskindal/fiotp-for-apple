#!/bin/sh
set -eu

output="$(mktemp -t fiotp-host-test)"
trap 'rm -f "$output"' EXIT

xcrun clang++ -std=c++17 -fobjc-arc -DFIOTP_HOST_STANDALONE \
  -I native native/fiotp_host.mm native/fiotp_host_test.mm \
  -framework Cocoa -framework AVFoundation -framework QuartzCore \
  -o "$output"
"$output"
