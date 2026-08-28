"""
JARVIS - NATIVE BACKEND SERVER & REAL-TIME WEBSOCKET HUB
FastAPI application serving the sci-fi HUD, providing REST endpoints,
broadcasting live system telemetry, and hosting the Agent WebSocket bridge.
"""

import os
import sys
import json
import asyncio
from typing import Dict, Any, List, Set
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .core.agent import JarvisAgent, DEFAULT_GROK_URL, DEFAULT_MODEL, get_grok_api_key
from .core import memory
from .core import tools

from backend.security.device_manager import device_manager
from backend.network.discovery import discovery_service

STATIC_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))

# Active WebSocket clients
connected_clients: Set[WebSocket] = set()

# Global Agent instance
current_settings = {
    "api_key": get_grok_api_key(),
    "base_url": DEFAULT_GROK_URL,
    "model": DEFAULT_MODEL
}
agent = JarvisAgent(api_key=current_settings["api_key"], model=current_settings["model"])


async def telemetry_broadcaster():
    """Background loop that broadcasts genuine host telemetry to all connected HUDs."""
    while True:
        try:
            if connected_clients:
                telemetry = tools.os_get_system_telemetry()
                # Append device info to telemetry for HUD
                telemetry["local_device"] = device_manager.get_local_device()
                telemetry["network_devices"] = device_manager.get_all_devices()

                message = json.dumps({"type": "telemetry", "data": telemetry})
                dead_clients = set()
                for ws in connected_clients:
                    try:
                        await ws.send_text(message)
                    except Exception:
                        dead_clients.add(ws)
                connected_clients.difference_update(dead_clients)
        except Exception as e:
            print(f"[Telemetry Error]: {e}", file=sys.stderr)
        await asyncio.sleep(1.0)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    memory.init_memory_db()
    
    # Start Discovery
    discovery_service.start()
    
    telemetry_task = asyncio.create_task(telemetry_broadcaster())
    
    local_dev = device_manager.get_local_device()
    print(f"[JARVIS Core Online]: Native Daemon active on http://localhost:8000")
    print(f"[Device Identity]: {local_dev['name']} ({local_dev['device_id']}) - Role: {local_dev['role']}")
    yield
    # Shutdown
    discovery_service.stop()
    telemetry_task.cancel()

app = FastAPI(title="JARVIS Core (Grok Engine)", version="2.0.0", lifespan=lifespan)

# Allow CORS for local dev / UI
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- REST Endpoints ---

class MessageRequest(BaseModel):
    text: str
    session_id: str = "default"


class SettingsRequest(BaseModel):
    api_key: str = ""
    model: str = DEFAULT_MODEL
    base_url: str = DEFAULT_GROK_URL


class FactRequest(BaseModel):
    category: str
    key: str
    value: str


class ToolExecRequest(BaseModel):
    tool: str
    arguments: Dict[str, Any] = {}


@app.get("/api/health")
async def health_check():
    return {
        "status": "online",
        "version": "2.0.0",
        "engine": "xAI Grok API",
        "model": current_settings["model"],
        "has_api_key": bool(current_settings["api_key"] or get_grok_api_key())
    }


@app.get("/api/telemetry")
async def get_telemetry():
    return tools.os_get_system_telemetry()


@app.get("/api/models")
async def get_models():
    models = await agent.get_available_models()
    return {"models": models, "active_model": current_settings["model"]}


@app.post("/api/settings")
async def update_settings(req: SettingsRequest):
    if req.api_key:
        current_settings["api_key"] = req.api_key
        agent.api_key = req.api_key
        os.environ["GROK_API_KEY"] = req.api_key

    current_settings["model"] = req.model
    agent.model = req.model
    return {"status": "updated", "settings": {
        "model": current_settings["model"],
        "has_api_key": bool(current_settings["api_key"])
    }}


@app.get("/api/memory")
async def get_memory():
    facts = memory.get_all_facts()
    history = memory.get_recent_history(limit=50)
    tasks = memory.get_recent_tasks(limit=10)
    return {"facts": facts, "history": history, "tasks": tasks}

@app.get("/api/devices")
async def api_get_devices():
    return {
        "local": device_manager.get_local_device(),
        "network": device_manager.get_all_devices()
    }

class RoleRequest(BaseModel):
    role: str

@app.post("/api/devices/role")
async def api_set_role(req: RoleRequest):
    if req.role not in ["HOST", "CLIENT"]:
        raise HTTPException(status_code=400, detail="Invalid role")
    device_manager.set_role(req.role)
    # Re-broadcast announcement on role change
    import json
    import socket
    local_info = device_manager.get_local_device()
    msg = json.dumps({
        "action": "announce",
        "device_id": local_info["device_id"],
        "name": local_info["name"],
        "role": local_info["role"],
        "port": 8000
    }).encode('utf-8')
    try:
        bsock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        bsock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
        bsock.sendto(msg, ('224.1.1.1', 5007))
        bsock.close()
    except:
        pass
    return {"status": "success", "role": req.role}


from backend.fs.local_fs import file_manager
from backend.security.permissions import permission_system

@app.get("/api/fs/list")
async def fs_list(path: str, request_device_id: str = ""):
    # Use provided ID or default to local for UI testing
    req_id = request_device_id or device_manager.get_local_device()["device_id"]
    perm = permission_system.evaluate(req_id, "fs.read")
    
    if perm == "DENY":
        raise HTTPException(status_code=403, detail="Permission Denied by Policy")
    elif perm == "ASK":
        # In a real system, we would hold the request and emit a WS event to the Owner.
        # For this prototype sync API, we'll return 403 to indicate it needs approval.
        raise HTTPException(status_code=403, detail="Owner Approval Required (ASK)")
        
    try:
        return file_manager.list_files(path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

class FSWriteRequest(BaseModel):
    path: str
    content: str
    request_device_id: str = ""

@app.post("/api/fs/write")
async def fs_write(req: FSWriteRequest):
    req_id = req.request_device_id or device_manager.get_local_device()["device_id"]
    perm = permission_system.evaluate(req_id, "fs.write")
    if perm != "ALLOW":
        raise HTTPException(status_code=403, detail=f"Permission {perm}")
    try:
        return file_manager.write_file(req.path, req.content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/memory/fact")
async def add_fact(req: FactRequest):
    memory.store_fact(req.category, req.key, req.value)
    return {"status": "stored"}


@app.delete("/api/memory/fact/{fact_id}")
async def remove_fact(fact_id: int):
    success = memory.delete_fact(fact_id)
    return {"status": "deleted" if success else "not_found"}


@app.delete("/api/memory/history")
async def clear_chat_history(session_id: str = "default"):
    memory.clear_history(session_id=session_id)
    return {"status": "cleared"}


@app.post("/api/tools/execute")
async def direct_execute_tool(req: ToolExecRequest):
    result = tools.execute_tool(req.tool, req.arguments)
    return {"tool": req.tool, "result": result}


# --- Real-Time WebSocket Hub ---

@app.websocket("/ws/jarvis")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    connected_clients.add(websocket)

    # Send initial welcome and models
    models = await agent.get_available_models()
    await websocket.send_text(json.dumps({
        "type": "init",
        "models": models,
        "active_model": current_settings["model"],
        "status": "IDLE"
    }))

    try:
        while True:
            raw_data = await websocket.receive_text()
            try:
                data = json.loads(raw_data)
            except json.JSONDecodeError:
                continue

            msg_type = data.get("type")

            if msg_type in ("chat", "voice"):
                user_text = data.get("text", "").strip()
                session_id = data.get("sessionId", "default")
                if not user_text:
                    continue

                # Run Agent ReAct execution loop
                async for event in agent.run(user_text, session_id=session_id):
                    await websocket.send_text(json.dumps(event))

                    # If the agent triggered a UI action, notify HUD
                    if event.get("type") == "tool_result" and event.get("result", {}).get("is_ui_event"):
                        ui_event = event["result"]
                        await websocket.send_text(json.dumps({
                            "type": "ui_action",
                            "action": ui_event.get("action"),
                            "params": ui_event.get("params", {})
                        }))

                # Reset to IDLE status when complete
                await websocket.send_text(json.dumps({"type": "status", "status": "IDLE"}))

            elif msg_type == "set_model":
                new_model = data.get("model")
                if new_model:
                    current_settings["model"] = new_model
                    agent.model = new_model
                    await websocket.send_text(json.dumps({"type": "model_updated", "model": new_model}))

            elif msg_type == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))

    except WebSocketDisconnect:
        connected_clients.discard(websocket)
    except Exception as e:
        print(f"[WebSocket Error]: {e}", file=sys.stderr)
        connected_clients.discard(websocket)


# --- Serve Frontend Static Files ---

# Explicit route for index.html
@app.get("/")
async def serve_index():
    return FileResponse(os.path.join(STATIC_ROOT, "index.html"))

# Mount frontend files (CSS, JS, 3D assets, fonts)
app.mount("/", StaticFiles(directory=STATIC_ROOT, html=True), name="static")
