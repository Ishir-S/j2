/* =====================================================
   JARVIS - NATIVE BACKEND & WEBSOCKET BRIDGE
   Manages bi-directional communication between the Three.js
   HUD frontend and the native Python JARVIS Core.
===================================================== */

import { addSystemLog, notify, updateTelemetry } from "./ui.js";
import { runCommand, hasCommand } from "./commandBridge.js";
import { feedTelemetry } from "./proactiveIntelligence.js";

const WS_URL = (location.protocol === "https:" ? "wss://" : "ws://") + 
               (location.hostname ? location.hostname : "localhost") + 
               ":8000/ws/jarvis";

const API_BASE = (location.protocol === "https:" ? "https://" : "http://") + 
                 (location.hostname ? location.hostname : "localhost") + 
                 ":8000/api";

let ws = null;
let reconnectTimer = null;
let isConnected = false;
let messageHandlers = new Set();
let statusHandlers = new Set();
let currentAgentStatus = "DISCONNECTED";

export function initBackendBridge() {
    connectWebSocket();
}

function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
    }

    try {
        ws = new WebSocket(WS_URL);

        ws.onopen = () => {
            isConnected = true;
            clearTimeout(reconnectTimer);
            setAgentStatus("ONLINE");
            addSystemLog("Connected to JARVIS Native Core Daemon");
            notify("JARVIS Core Online");
            document.dispatchEvent(new CustomEvent("backend-connected", { detail: true }));
        };

        ws.onmessage = (event) => {
            try {
                const data = jsonParseSafely(event.data);
                if (!data) return;
                handleIncomingMessage(data);
            } catch (err) {
                console.error("WebSocket message parse error:", err);
            }
        };

        ws.onclose = () => {
            isConnected = false;
            setAgentStatus("DISCONNECTED");
            document.dispatchEvent(new CustomEvent("backend-connected", { detail: false }));
            scheduleReconnect();
        };

        ws.onerror = () => {
            isConnected = false;
            setAgentStatus("OFFLINE");
        };

    } catch (e) {
        scheduleReconnect();
    }
}

function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
        connectWebSocket();
    }, 3000);
}

function jsonParseSafely(str) {
    try {
        return JSON.parse(str);
    } catch {
        return null;
    }
}

function setAgentStatus(status) {
    currentAgentStatus = status;
    statusHandlers.forEach(fn => fn(status));
    document.dispatchEvent(new CustomEvent("agent-status", { detail: status }));
}

export function getAgentStatus() {
    return currentAgentStatus;
}

export function onAgentStatus(fn) {
    statusHandlers.add(fn);
    return () => statusHandlers.delete(fn);
}

export function onBackendMessage(fn) {
    messageHandlers.add(fn);
    return () => messageHandlers.delete(fn);
}

function handleIncomingMessage(msg) {
    // Notify general listeners
    messageHandlers.forEach(fn => fn(msg));

    switch (msg.type) {
        case "telemetry":
            if (msg.data && msg.data.success) {
                const d = msg.data;
                const telemetryPacket = {
                    fps: window.jarvisFPS || 60,
                    memory: d.memory?.used_mb || 0,
                    threads: d.cpu_cores || navigator.hardwareConcurrency || 4,
                    uptimeSec: d.uptime_seconds || 0,
                    cpuPercent: d.cpu_percent,
                    diskPercent: d.disk?.percent,
                    battery: d.battery
                };
                updateTelemetry(telemetryPacket);
                feedTelemetry(telemetryPacket);
            }
            break;

        case "status":
            if (msg.status) {
                setAgentStatus(msg.status);
                if (msg.detail) {
                    addSystemLog(`JARVIS: ${msg.detail}`);
                }
            }
            break;

        case "tool_call":
            addSystemLog(`Tool Call [${msg.tool}]: ${msg.thought || ""}`);
            notify(`Tool: ${msg.tool}`, 2500);
            break;

        case "tool_result":
            addSystemLog(`Tool Result [${msg.tool}]: ${msg.result?.success ? "✓ Success" : "✕ Failed"}`);
            break;

        case "ui_action":
            if (msg.action && hasCommand(msg.action)) {
                try {
                    runCommand(msg.action, msg.params || {});
                    addSystemLog(`HUD Action: ${msg.action}`);
                } catch (e) {
                    console.warn("UI Action execution error:", e);
                }
            }
            break;

        case "error":
            addSystemLog(`JARVIS Error: ${msg.error}`);
            notify(`Error: ${msg.error}`, 4000);
            break;
    }
}

export function sendAgentMessage(text, { type = "chat", sessionId = "default" } = {}) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error("JARVIS Native Core Daemon is offline. Please launch via start_jarvis.bat");
    }

    ws.send(JSON.stringify({
        type,
        text,
        sessionId
    }));
}

export function setBackendModel(model) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: "set_model",
            model
        }));
    }
}

export async function fetchHealth() {
    try {
        const res = await fetch(`${API_BASE}/health`);
        return await res.json();
    } catch {
        return null;
    }
}

export async function fetchTelemetry() {
    try {
        const res = await fetch(`${API_BASE}/telemetry`);
        return await res.json();
    } catch {
        return null;
    }
}

export async function fetchMemory() {
    try {
        const res = await fetch(`${API_BASE}/memory`);
        return await res.json();
    } catch {
        return { facts: [], history: [], tasks: [] };
    }
}

export async function addMemoryFact(category, key, value) {
    try {
        const res = await fetch(`${API_BASE}/memory/fact`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ category, key, value })
        });
        return await res.json();
    } catch {
        return null;
    }
}

export async function deleteMemoryFact(factId) {
    try {
        const res = await fetch(`${API_BASE}/memory/fact/${factId}`, {
            method: "DELETE"
        });
        return await res.json();
    } catch {
        return null;
    }
}

export function isBackendOnline() {
    return isConnected;
}
