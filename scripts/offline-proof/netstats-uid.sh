#!/bin/bash
# MIT License
# Copyright (c) 2026 NIDO contributors
# See LICENSE file for details.
#
# netstats-uid.sh - NIDO Offline Proof: Per-UID network counters
#
# Reads kernel per-UID traffic counters via `dumpsys netstats detail`
# to prove the app sends/receives zero bytes after real use.
#
# Usage:
#   1. Install the APK on a physical device
#   2. Use the app normally (chat, memory, etc.)
#   3. ./netstats-uid.sh <package-name>
#   4. Verify: rx=0 tx=0
#
# Run in both airplane mode and Wi-Fi on to prove zero-network.
#
# Requires: adb, physical device

set -e

if [ $# -ne 1 ]; then
    echo "Usage: $0 <package-name>" >&2
    echo "Example: $0 com.nido.app" >&2
    exit 1
fi

PACKAGE="$1"

echo "NIDO Offline Proof: Network counters for $PACKAGE"
echo "=================================================="
echo ""

# Get UID for package
UID=$(adb shell dumpsys package "$PACKAGE" | grep -m1 "userId=" | sed 's/.*userId=//')
if [ -z "$UID" ]; then
    echo "ERROR: Package not found: $PACKAGE" >&2
    exit 1
fi

echo "Package UID: $UID"
echo ""

# Get network stats
echo "Reading kernel counters..."
STATS=$(adb shell dumpsys netstats detail | grep -A2 "uid=$UID" || true)

if [ -z "$STATS" ]; then
    echo "No network activity recorded for UID $UID"
    echo ""
    echo "VERDICT: NO TRAFFIC ✓"
    echo "The app has sent/received zero bytes."
    exit 0
fi

echo "$STATS"
echo ""

# Parse rx/tx bytes
RX=$(echo "$STATS" | grep -o "rxBytes=[0-9]*" | cut -d= -f2 | awk '{s+=$1} END {print s+0}')
TX=$(echo "$STATS" | grep -o "txBytes=[0-9]*" | cut -d= -f2 | awk '{s+=$1} END {print s+0}')

echo "Total RX: ${RX} bytes"
echo "Total TX: ${TX} bytes"
echo ""

if [ "$RX" -eq 0 ] && [ "$TX" -eq 0 ]; then
    echo "VERDICT: NO TRAFFIC ✓"
    echo "The app has sent/received zero bytes after real use."
    exit 0
else
    echo "VERDICT: TRAFFIC DETECTED ✗"
    echo "FAIL: The app transmitted data. Violates zero-network claim."
    exit 2
fi
