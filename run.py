"""
JARVIS - ALL-IN-ONE NATIVE LAUNCHER
Installs dependencies if needed, starts the FastAPI/WebSocket backend,
and launches the JARVIS HUD in your browser.
"""

import os
import sys
import subprocess
import webbrowser
import time

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
REQ_FILE = os.path.join(ROOT_DIR, "backend", "requirements.txt")


def check_and_install_dependencies():
    print("=====================================================")
    print("           JARVIS - SYSTEM INITIALIZATION            ")
    print("=====================================================")
    print("[1/3] Verifying core Python dependencies...")

    try:
        import fastapi
        import uvicorn
        import psutil
        import httpx
        import websockets
        print("      [OK] All core dependencies verified.")
    except ImportError:
        print("      ! Installing missing dependencies from backend/requirements.txt...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", REQ_FILE])
        print("      [OK] Dependencies installed successfully.")


def launch_browser():
    time.sleep(1.2)
    print("[3/3] Opening JARVIS HUD interface on http://localhost:8000...")
    webbrowser.open("http://localhost:8000")


def main():
    check_and_install_dependencies()

    print("[2/3] Starting JARVIS Native Daemon on http://localhost:8000...")
    import threading
    threading.Thread(target=launch_browser, daemon=True).start()

    import uvicorn
    # Start server
    uvicorn.run(
        "backend.server:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        log_level="info"
    )


if __name__ == "__main__":
    main()
