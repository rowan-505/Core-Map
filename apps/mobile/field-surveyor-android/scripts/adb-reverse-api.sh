#!/usr/bin/env bash
# Tunnel phone localhost:3001 to the Mac API. Survives Wi-Fi changes.
# Usage: from any directory, with the phone connected over USB (or authorized wireless adb).
set -euo pipefail
adb reverse tcp:3001 tcp:3001
adb reverse --list
echo "Phone can now use http://127.0.0.1:3001 for the CoreMap API."
