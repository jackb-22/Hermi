#!/bin/sh
# Fast local Swift loop on Linux: builds and tests the Foundation-only mirror of HermiDesign
# (apps/ios/HermiPreview/LinuxCheck). The macOS CI (scripts/ios-ci.sh) remains the real build.
#
#   scripts/linux-swift.sh                # swift test
#   scripts/linux-swift.sh --filter Assistant
#
# Toolchain: swiftly's Ubuntu 24.04 build (~/.local/share/swiftly). On Arch it needs two library shims next to the
# toolchain's own libraries (on its RUNPATH, so SwiftPM's sub-processes find them too):
#   L=~/.local/share/swiftly/toolchains/<version>/usr/lib/swift/linux
#   ln -s /usr/lib/libncursesw.so.6 $L/libncurses.so.6; ln -s /usr/lib/libxml2.so.16 $L/libxml2.so.2
set -eu
cd "$(dirname "$0")/../apps/ios/HermiPreview/LinuxCheck"
SWIFTLY="${SWIFTLY_HOME_DIR:-$HOME/.local/share/swiftly}"
"$SWIFTLY/bin/swift" test "$@" 2>&1 | grep -v "no version information available"
