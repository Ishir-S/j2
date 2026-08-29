#!/bin/bash

# ========================================================
#                 JARVIS - MAC/LINUX LAUNCHER
# ========================================================

echo "========================================================"
echo "           JARVIS NATIVE ASSISTANT (macOS/Linux)        "
echo "========================================================"
echo ""

# Find Python 3
if command -v python3 &>/dev/null; then
    PYTHON_BIN="python3"
elif command -v python &>/dev/null; then
    PYTHON_BIN="python"
else
    echo "[ERROR] Python 3 not found. Please install Python 3 (e.g., brew install python3)."
    exit 1
fi

echo "[JARVIS] Using Python: $($PYTHON_BIN --version)"
echo "[JARVIS] Initializing backend daemon and opening HUD..."
echo ""

$PYTHON_BIN run.py
