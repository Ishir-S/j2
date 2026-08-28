"""
JARVIS - REAL TOOL EXECUTION ENGINE
Provides genuine OS control, filesystem access, live system telemetry,
web research, hardware/serial communication, and memory access.
"""

import os
import sys
import subprocess
import glob
import json
import time
import shutil
from typing import Dict, Any, List, Optional
import httpx
import psutil

try:
    import serial.tools.list_ports
    HAS_SERIAL = True
except ImportError:
    HAS_SERIAL = False

from . import memory

WORKSPACE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

# Registry of tools exposed to the Agent
TOOL_DEFINITIONS = [
    {
        "name": "os_execute_command",
        "description": "Execute a real terminal/shell command on the host system (PowerShell). Use for running scripts, checking git, querying system tools, etc.",
        "parameters": {
            "type": "object",
            "properties": {
                "command": {"type": "string", "description": "The exact shell command to execute."},
                "cwd": {"type": "string", "description": "Optional working directory path (defaults to project workspace)."}
            },
            "required": ["command"]
        }
    },
    {
        "name": "os_open_application",
        "description": "Launch or open a desktop application or file with its default program on the user's computer (e.g. 'notepad', 'calc', 'chrome', 'code', 'explorer').",
        "parameters": {
            "type": "object",
            "properties": {
                "app_name": {"type": "string", "description": "The name of the application, executable, or file path to open."}
            },
            "required": ["app_name"]
        }
    },
    {
        "name": "os_get_system_telemetry",
        "description": "Get real-time live host system telemetry: CPU usage %, Memory (RAM) MB/%, Disk usage, Battery status, Uptime, and Top active processes.",
        "parameters": {
            "type": "object",
            "properties": {}
        }
    },
    {
        "name": "fs_read_file",
        "description": "Read the text contents of a file on the local filesystem.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Relative or absolute path to the file."}
            },
            "required": ["path"]
        }
    },
    {
        "name": "fs_write_file",
        "description": "Create or overwrite a file with specific content on the local filesystem.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Relative or absolute path to the file to create or write."},
                "content": {"type": "string", "description": "The full text content to write."}
            },
            "required": ["path", "content"]
        }
    },
    {
        "name": "fs_list_directory",
        "description": "List all files and subdirectories in a given directory on disk.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Directory path (defaults to project root workspace)."}
            }
        }
    },
    {
        "name": "fs_search_files",
        "description": "Search for files by glob pattern or keyword across directories.",
        "parameters": {
            "type": "object",
            "properties": {
                "pattern": {"type": "string", "description": "File pattern or keyword (e.g. '*.js', '*presentation*', '**/*.py')."},
                "root_path": {"type": "string", "description": "Root path to search from."}
            },
            "required": ["pattern"]
        }
    },
    {
        "name": "web_search",
        "description": "Search the live internet for up-to-date information, news, documentation, or technical answers.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "The search query string."}
            },
            "required": ["query"]
        }
    },
    {
        "name": "web_search_google",
        "description": "Launch a live Google search query in the user's default browser.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "The search query to look up on Google."}
            },
            "required": ["query"]
        }
    },
    {
        "name": "web_fetch_page",
        "description": "Fetch the readable text content of a public webpage URL.",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "The URL to fetch."}
            },
            "required": ["url"]
        }
    },
    {
        "name": "hardware_list_ports",
        "description": "List all physical and virtual COM / Serial ports connected to the computer (e.g., Arduino, ESP32, Raspberry Pi USB bridges).",
        "parameters": {
            "type": "object",
            "properties": {}
        }
    },
    {
        "name": "memory_store_fact",
        "description": "Store a durable fact, user preference, project detail, or system rule in JARVIS's persistent long-term memory.",
        "parameters": {
            "type": "object",
            "properties": {
                "category": {"type": "string", "description": "Category (e.g. 'user_preference', 'project_note', 'hardware', 'system')."},
                "key": {"type": "string", "description": "Short identifier or topic for the fact."},
                "value": {"type": "string", "description": "The detailed fact or preference to remember."}
            },
            "required": ["category", "key", "value"]
        }
    },
    {
        "name": "memory_recall",
        "description": "Query JARVIS's persistent memory for stored facts, user preferences, and past tasks.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Keyword or topic to search for."}
            },
            "required": ["query"]
        }
    },
    {
        "name": "ui_trigger_action",
        "description": "Control the visual HUD interface (open viewer, show globe, open camera, launch physics lab, set gravity).",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "description": "Action name: 'open_dashboard' | 'open_camera' | 'open_viewer' | 'open_map' | 'open_physics' | 'open_projects' | 'set_gravity' | 'close_all'"
                },
                "params": {
                    "type": "object",
                    "description": "Optional parameters (e.g. {'scene': 'solar'}, {'origin': 'Tokyo', 'destination': 'London'}, {'x':0, 'y':-9.8, 'z':0})"
                }
            },
            "required": ["action"]
        }
    }
]


def resolve_path(path: str) -> str:
    if not path:
        return WORKSPACE_DIR
    if os.path.isabs(path):
        return os.path.normpath(path)
    return os.path.normpath(os.path.join(WORKSPACE_DIR, path))


# --- Tool Implementations ---

def os_execute_command(command: str, cwd: Optional[str] = None) -> Dict[str, Any]:
    target_cwd = resolve_path(cwd) if cwd else WORKSPACE_DIR
    if not os.path.exists(target_cwd):
        target_cwd = WORKSPACE_DIR

    try:
        # Use PowerShell on Windows for modern scripting support
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-Command", command],
            cwd=target_cwd,
            capture_output=True,
            text=True,
            timeout=25
        )
        return {
            "success": proc.returncode == 0,
            "returncode": proc.returncode,
            "stdout": proc.stdout.strip(),
            "stderr": proc.stderr.strip()
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Command execution timed out (25 seconds limit)."}
    except Exception as e:
        return {"success": False, "error": str(e)}


APP_ALIASES = {
    "calculator": "calc",
    "calc": "calc",
    "notepad": "notepad",
    "text editor": "notepad",
    "chrome": "chrome",
    "google chrome": "chrome",
    "edge": "msedge",
    "browser": "msedge",
    "vs code": "code",
    "vscode": "code",
    "code": "code",
    "explorer": "explorer",
    "file explorer": "explorer",
    "files": "explorer",
    "task manager": "taskmgr",
    "taskmgr": "taskmgr",
    "cmd": "cmd",
    "terminal": "wt",
    "powershell": "powershell",
    "settings": "ms-settings:",
    "paint": "mspaint",
    "wordpad": "write",
    "control panel": "control"
}

def os_open_application(app_name: str) -> Dict[str, Any]:
    cleaned = app_name.lower().strip()
    target = APP_ALIASES.get(cleaned, app_name)
    try:
        if sys.platform == "win32":
            if target.startswith("ms-settings:") or target.startswith("http"):
                os.system(f"start {target}")
            else:
                try:
                    os.startfile(target)
                except Exception:
                    subprocess.Popen(f"start {target}", shell=True)
        else:
            subprocess.Popen([target], shell=True)
        return {"success": True, "message": f"Launched '{app_name}' (target: {target}) successfully."}
    except Exception as e:
        return {"success": False, "error": f"Failed to open '{app_name}': {str(e)}"}


def web_search_google(query: str) -> Dict[str, Any]:
    try:
        import urllib.parse
        encoded = urllib.parse.quote_plus(query)
        url = f"https://www.google.com/search?q={encoded}"
        if sys.platform == "win32":
            os.system(f"start {url}")
        else:
            import webbrowser
            webbrowser.open(url)
        return {"success": True, "query": query, "url": url, "message": f"Opened Google search for '{query}'."}
    except Exception as e:
        return {"success": False, "error": str(e)}


def os_get_system_telemetry() -> Dict[str, Any]:
    try:
        cpu_percent = psutil.cpu_percent(interval=0.1)
        cpu_count = psutil.cpu_count(logical=True)
        mem = psutil.virtual_memory()
        disk = psutil.disk_usage(os.path.splitdrive(WORKSPACE_DIR)[0] or "C:")
        boot_time = psutil.boot_time()
        uptime_sec = int(time.time() - boot_time)

        battery = psutil.sensors_battery()
        battery_info = None
        if battery:
            battery_info = {
                "percent": round(battery.percent, 1),
                "power_plugged": battery.power_plugged,
                "seconds_left": battery.secsleft if battery.secsleft > 0 else None
            }

        # Top 5 CPU/Memory processes
        top_procs = []
        for p in sorted(psutil.process_iter(['name', 'cpu_percent', 'memory_info']),
                        key=lambda x: x.info.get('memory_info').rss if x.info.get('memory_info') else 0,
                        reverse=True)[:5]:
            try:
                top_procs.append({
                    "name": p.info['name'],
                    "memory_mb": round(p.info['memory_info'].rss / (1024 * 1024), 1)
                })
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

        return {
            "success": True,
            "cpu_percent": cpu_percent,
            "cpu_cores": cpu_count,
            "memory": {
                "total_mb": round(mem.total / (1024 * 1024), 1),
                "used_mb": round(mem.used / (1024 * 1024), 1),
                "available_mb": round(mem.available / (1024 * 1024), 1),
                "percent": mem.percent
            },
            "disk": {
                "total_gb": round(disk.total / (1024 * 1024 * 1024), 1),
                "free_gb": round(disk.free / (1024 * 1024 * 1024), 1),
                "percent": disk.percent
            },
            "uptime_seconds": uptime_sec,
            "battery": battery_info,
            "top_processes": top_procs
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def fs_read_file(path: str) -> Dict[str, Any]:
    full_path = resolve_path(path)
    if not os.path.exists(full_path):
        return {"success": False, "error": f"File not found: '{path}'"}
    if os.path.isdir(full_path):
        return {"success": False, "error": f"Path is a directory, not a file: '{path}'"}

    try:
        with open(full_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read(30000)
        return {
            "success": True,
            "path": full_path,
            "size_bytes": os.path.getsize(full_path),
            "content": content
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def fs_write_file(path: str, content: str) -> Dict[str, Any]:
    full_path = resolve_path(path)
    try:
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w", encoding="utf-8") as f:
            f.write(content)
        return {
            "success": True,
            "path": full_path,
            "bytes_written": len(content.encode("utf-8")),
            "message": f"Successfully wrote {len(content)} characters to '{path}'."
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def fs_list_directory(path: Optional[str] = None) -> Dict[str, Any]:
    target_dir = resolve_path(path)
    if not os.path.exists(target_dir):
        return {"success": False, "error": f"Directory not found: '{path}'"}

    try:
        entries = []
        for item in os.listdir(target_dir):
            item_path = os.path.join(target_dir, item)
            is_dir = os.path.isdir(item_path)
            size = os.path.getsize(item_path) if not is_dir else 0
            mod_time = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(os.path.getmtime(item_path)))
            entries.append({
                "name": item,
                "type": "directory" if is_dir else "file",
                "size_bytes": size,
                "modified": mod_time
            })
        return {
            "success": True,
            "directory": target_dir,
            "total_items": len(entries),
            "items": entries[:60]
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def fs_search_files(pattern: str, root_path: Optional[str] = None) -> Dict[str, Any]:
    target_root = resolve_path(root_path)
    try:
        results = []
        # Support recursive glob
        search_expr = os.path.join(target_root, "**", pattern) if "**" not in pattern else os.path.join(target_root, pattern)
        for match in glob.glob(search_expr, recursive=True)[:30]:
            rel_path = os.path.relpath(match, target_root)
            results.append({
                "relative_path": rel_path,
                "absolute_path": match,
                "is_dir": os.path.isdir(match),
                "size_bytes": os.path.getsize(match) if os.path.isfile(match) else 0
            })
        return {
            "success": True,
            "pattern": pattern,
            "matches_found": len(results),
            "results": results
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def web_search(query: str) -> Dict[str, Any]:
    try:
        # Use DuckDuckGo Instant Answer API + Wikipedia fallback
        with httpx.Client(timeout=8.0) as client:
            # 1. DuckDuckGo
            ddg_url = f"https://api.duckduckgo.com/?q={httpx.URL(query).raw_path.decode()}&format=json&no_html=1"
            res = client.get(f"https://api.duckduckgo.com/?q={query}&format=json&no_html=1")
            ddg_data = res.json() if res.status_code == 200 else {}

            abstract = ddg_data.get("AbstractText", "")
            related = [t.get("Text") for t in ddg_data.get("RelatedTopics", []) if t.get("Text")][:4]

            # 2. Wikipedia Summary
            wiki_res = client.get(f"https://en.wikipedia.org/api/rest_v1/page/summary/{query}")
            wiki_summary = wiki_res.json().get("extract", "") if wiki_res.status_code == 200 else ""

        return {
            "success": True,
            "query": query,
            "abstract": abstract,
            "wikipedia_summary": wiki_summary,
            "related_points": related
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def web_fetch_page(url: str) -> Dict[str, Any]:
    try:
        with httpx.Client(timeout=10.0, follow_redirects=True) as client:
            res = client.get(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) JARVIS/2.0"})
            if res.status_code != 200:
                return {"success": False, "error": f"HTTP error {res.status_code}"}

            text = res.text
            # Basic tag stripping
            import re
            clean_text = re.sub(r'<script.*?</script>', '', text, flags=re.DOTALL | re.IGNORECASE)
            clean_text = re.sub(r'<style.*?</style>', '', clean_text, flags=re.DOTALL | re.IGNORECASE)
            clean_text = re.sub(r'<[^>]+>', ' ', clean_text)
            clean_text = re.sub(r'\s+', ' ', clean_text).strip()

            return {
                "success": True,
                "url": url,
                "title": res.headers.get("title", ""),
                "content_preview": clean_text[:4000]
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


def hardware_list_ports() -> Dict[str, Any]:
    if not HAS_SERIAL:
        return {"success": False, "error": "pyserial package not installed."}
    try:
        ports = serial.tools.list_ports.comports()
        device_list = []
        for p in ports:
            device_list.append({
                "port": p.device,
                "description": p.description,
                "hwid": p.hwid,
                "vid": hex(p.vid) if p.vid else None,
                "pid": hex(p.pid) if p.pid else None
            })
        return {
            "success": True,
            "count": len(device_list),
            "ports": device_list
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def memory_store_fact(category: str, key: str, value: str) -> Dict[str, Any]:
    try:
        memory.store_fact(category, key, value)
        return {
            "success": True,
            "message": f"Successfully stored memory: [{category}] {key} = '{value}'"
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def memory_recall(query: str) -> Dict[str, Any]:
    try:
        facts = memory.search_facts(query)
        return {
            "success": True,
            "query": query,
            "results_found": len(facts),
            "facts": facts
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def ui_trigger_action(action: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    # This action is dispatched via WebSocket to the HUD frontend
    return {
        "success": True,
        "is_ui_event": True,
        "action": action,
        "params": params or {}
    }


# Tool Dispatch Table
DISPATCH_MAP = {
    "os_execute_command": os_execute_command,
    "os_open_application": os_open_application,
    "os_get_system_telemetry": os_get_system_telemetry,
    "fs_read_file": fs_read_file,
    "fs_write_file": fs_write_file,
    "fs_list_directory": fs_list_directory,
    "fs_search_files": fs_search_files,
    "web_search": web_search,
    "web_search_google": web_search_google,
    "web_fetch_page": web_fetch_page,
    "hardware_list_ports": hardware_list_ports,
    "memory_store_fact": memory_store_fact,
    "memory_recall": memory_recall,
    "ui_trigger_action": ui_trigger_action
}


def execute_tool(tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Safely executes any registered tool by name."""
    if tool_name not in DISPATCH_MAP:
        return {"success": False, "error": f"Unknown tool: '{tool_name}'"}

    func = DISPATCH_MAP[tool_name]
    try:
        return func(**arguments)
    except TypeError as te:
        return {"success": False, "error": f"Invalid arguments for '{tool_name}': {str(te)}"}
    except Exception as e:
        return {"success": False, "error": f"Tool execution failed: {str(e)}"}
