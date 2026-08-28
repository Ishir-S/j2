/* =====================================================
   JARVIS - CHAT MODULE (personality + memory + context)
===================================================== */

import { addSystemLog, notify } from "./ui.js";
import { getSettings, setSettings, checkStatus, chatStream, generateJSON } from "./ollama.js";
import * as memory from "./memory.js";
import { classifyAndExecuteIntent } from "./commander.js";
import { sendAgentMessage, onBackendMessage, isBackendOnline, setBackendModel, fetchMemory, deleteMemoryFact } from "./backendBridge.js";

const fallbackResponses = [
    "Command acknowledged.",
    "Processing request...",
    "Systems nominal, awaiting further instruction.",
    "I've logged that for you.",
    "Affirmative.",
    "Analyzing... no anomalies detected.",
    "Standing by."
];

const PERSONA_PROMPT = `You are JARVIS — a brilliant, unflappably composed AI assistant with a dry
wit and genuine warmth, in the spirit of Tony Stark's JARVIS. You speak with
polished, precise language and aren't above a well-placed touch of irony or a
clever turn of phrase, but cleverness never gets in the way of being
genuinely useful. When it helps someone understand something, you reach for
an apt analogy or metaphor rather than a dry technical definition. You
address the user warmly and personably — a light "sir" or similar is fine
occasionially, but don't overdo it. You have a good memory for what's been
discussed and you weave past context in naturally, the way a trusted
assistant would, rather than reciting it back mechanically. Keep responses
concise unless real depth is asked for.`;

let history = memory.loadHistory();
let ollamaAvailable = false;
let userTurnsSinceLastMemoryUpdate = 0;
let cachedWeatherBundle = null;
let currentStreamingBubble = null;

/* =====================================================
   INIT
===================================================== */

export function initChat() {

    const input = document.getElementById("chatInput");
    const sendBtn = document.getElementById("sendChat");
    const messages = document.getElementById("chatMessages");

    if (!input || !sendBtn || !messages) return;

    rehydrateMessageUI(messages);

    // Setup backend streaming listener
    onBackendMessage((msg) => {
        handleBackendStreamEvent(messages, msg);
    });

    const send = () => {

        const text = input.value.trim();
        if (!text) return;

        appendMessage(messages, text, "user-message");
        input.value = "";

        addSystemLog(`Chat: ${text}`);
        respond(messages, text);
    };

    sendBtn.addEventListener("click", send);

    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") send();
    });

    const saveApiKeyAndRefresh = () => {
        const apiKeyInput = document.getElementById("grokApiKeyInput");
        if (apiKeyInput && apiKeyInput.value.trim()) {
            setSettings({ apiKey: apiKeyInput.value.trim() });
        }
        refreshChatConnection();
    };

    document.getElementById("chatOllamaRefresh")?.addEventListener("click", saveApiKeyAndRefresh);
    document.getElementById("grokApiKeyInput")?.addEventListener("change", saveApiKeyAndRefresh);

    document.getElementById("chatModelSelect")?.addEventListener("change", (event) => {
        const val = event.target.value;
        setSettings({ model: val });
        setBackendModel(val);
    });

    // memory panel
    document.getElementById("chatMemoryToggle")?.addEventListener("click", toggleMemoryPanel);
    document.getElementById("chatMemoryClose")?.addEventListener("click", () => setMemoryPanelVisible(false));
    document.getElementById("chatClearMemoryBtn")?.addEventListener("click", handleClearMemory);
    document.getElementById("chatClearHistoryBtn")?.addEventListener("click", handleClearHistory);

    // location / weather
    document.getElementById("chatSetLocationBtn")?.addEventListener("click", handleSetLocationByCity);
    document.getElementById("chatUseGeoBtn")?.addEventListener("click", handleUseGeolocation);

    updateDateTimeLine();
    setInterval(updateDateTimeLine, 60000);

    loadWeatherIntoContext({ promptForGeo: false });

    refreshChatConnection();
}

/* Called by main.js right after the Chat panel is opened */
export function refreshChatPanel() {

    refreshChatConnection();
    updateDateTimeLine();
    loadWeatherIntoContext({ promptForGeo: false });
}

/* =====================================================
   REHYDRATE PERSISTED HISTORY INTO THE UI
===================================================== */

function rehydrateMessageUI(messages) {

    const turns = history.filter(m => m.role === "user" || m.role === "assistant");

    if (!turns.length) {

        messages.innerHTML = "";
        appendMessage(messages, buildGreeting(), "bot-message", false);
        return;
    }

    messages.innerHTML = "";

    turns.forEach(m => {
        appendMessage(messages, m.content, m.role === "user" ? "user-message" : "bot-message", false);
    });

    messages.scrollTop = messages.scrollHeight;
}

function buildGreeting() {

    const hour = new Date().getHours();

    if (hour < 5) return "You're up rather late. All systems are online, should you need me.";
    if (hour < 12) return "Good morning. All systems are online and functioning perfectly.";
    if (hour < 17) return "Good afternoon. Standing by, as always.";
    if (hour < 22) return "Good evening. At your service.";
    return "Working late again. I'll be here — systems are fully online.";
}

/* =====================================================
   CONNECTION BAR
===================================================== */

async function refreshChatConnection() {

    const dot = document.getElementById("chatOllamaDot");
    const label = document.getElementById("chatOllamaLabel");
    const select = document.getElementById("chatModelSelect");
    const apiKeyInput = document.getElementById("grokApiKeyInput");

    const currentSettings = getSettings();
    if (apiKeyInput && currentSettings.apiKey && !apiKeyInput.value) {
        apiKeyInput.value = currentSettings.apiKey;
    }

    if (label) label.textContent = "Connecting to Grok API...";

    const result = await checkStatus();

    ollamaAvailable = result.connected;

    if (result.connected) {

        dot?.classList.add("connected");

        if (label) {
            label.textContent = "Grok API online";
        }

        if (select && result.models.length) {

            select.innerHTML = "";

            result.models.forEach(name => {
                const opt = document.createElement("option");
                opt.value = name;
                opt.textContent = name;
                select.appendChild(opt);
            });

            const useModel = result.models.includes(currentSettings.model) ? currentSettings.model : result.models[0];
            select.value = useModel;
            setSettings({ model: useModel });
        }

    } else {

        dot?.classList.remove("connected");
        if (label) label.textContent = result.error || "Grok API Key missing";
    }
}

/* =====================================================
   LIVE CONTEXT: DATE/TIME + WEATHER
===================================================== */

function updateDateTimeLine() {

    const el = document.getElementById("chatDateTime");
    if (el) el.textContent = memory.getDateTimeContext();
}

async function loadWeatherIntoContext({ promptForGeo }) {

    const bundle = await memory.getWeatherContext({ allowGeolocationPrompt: promptForGeo });

    cachedWeatherBundle = bundle;

    const line = document.getElementById("chatWeatherLine");
    if (!line) return;

    line.textContent = bundle
        ? memory.formatWeatherContext(bundle)
        : "Weather unavailable — set a location below for JARVIS to factor it in.";
}

async function handleSetLocationByCity() {

    const input = document.getElementById("chatLocationInput");
    const city = input?.value.trim();

    if (!city) return;

    const line = document.getElementById("chatWeatherLine");
    if (line) line.textContent = "Looking up that location...";

    try {

        const location = await memory.geocodeCity(city);
        memory.saveLocation(location);

        input.value = "";
        await loadWeatherIntoContext({ promptForGeo: false });

        notify(`Weather location set to ${location.name}`);

    } catch (err) {

        if (line) line.textContent = err.message;
    }
}

async function handleUseGeolocation() {

    const line = document.getElementById("chatWeatherLine");
    if (line) line.textContent = "Requesting your location...";

    try {

        const location = await memory.requestBrowserLocation();
        memory.saveLocation(location);

        await loadWeatherIntoContext({ promptForGeo: false });

        notify("Using your current location for weather");

    } catch (err) {

        if (line) line.textContent = err.message;
    }
}

/* =====================================================
   SYSTEM PROMPT ASSEMBLY (persona + memory + live context)
===================================================== */

function buildSystemPrompt(actionTaken) {

    const parts = [PERSONA_PROMPT];

    parts.push(`CURRENT DATE/TIME: ${memory.getDateTimeContext()}`);

    const weatherLine = memory.formatWeatherContext(cachedWeatherBundle);
    if (weatherLine) parts.push(`CURRENT WEATHER: ${weatherLine}`);

    const longTermMemory = memory.loadLongTermMemory();

    if (longTermMemory.length) {

        parts.push(
            `THINGS YOU REMEMBER ABOUT THIS USER FROM PAST CONVERSATIONS (weave these in naturally where relevant, don't just list them back):\n`
            + longTermMemory.map(n => `- ${n}`).join("\n")
        );
    }

    if (actionTaken) {

        parts.push(
            `You just took this real action on the user's behalf, on their interface, `
            + `right before replying: "${actionTaken.action}" with parameters ${JSON.stringify(actionTaken.params)}. `
            + `Acknowledge that you've done it, briefly and naturally, in character — don't describe it mechanically or repeat the raw action name.`
        );
    }

    return parts.join("\n\n");
}

/* =====================================================
   RESPONSE HANDLING
===================================================== */

export async function sendVoiceMessage(text, { speakBack = true } = {}) {
    const messages = document.getElementById("chatMessages");
    if (!messages || !text) return;

    appendMessage(messages, text, "user-message");
    addSystemLog(`Voice: "${text}"`);

    const reply = await respond(messages, text, { speakBack });
    return reply;
}

function handleBackendStreamEvent(messages, msg) {
    if (msg.type === "token") {
        if (!currentStreamingBubble) {
            currentStreamingBubble = appendMessage(messages, "", "bot-message");
            currentStreamingBubble.classList.add("streaming");
        }
        currentStreamingBubble.textContent = msg.full;
        messages.scrollTop = messages.scrollHeight;
    } else if (msg.type === "tool_call") {
        const toolCard = document.createElement("div");
        toolCard.className = "bot-tool-call";
        toolCard.innerHTML = `<span class="tool-icon">⚡</span> <strong>Action:</strong> <code>${msg.tool}</code><br><small>${msg.thought || ""}</small>`;
        messages.appendChild(toolCard);
        messages.scrollTop = messages.scrollHeight;
    } else if (msg.type === "tool_result") {
        const resultCard = document.createElement("div");
        resultCard.className = `bot-tool-result ${msg.result?.success ? "success" : "failure"}`;
        resultCard.innerHTML = `<span class="result-badge">${msg.result?.success ? "✓" : "✕"}</span> <code>${msg.tool}</code>: ${msg.result?.message || (msg.result?.success ? "Execution successful" : (msg.result?.error || "Failed"))}`;
        messages.appendChild(resultCard);
        messages.scrollTop = messages.scrollHeight;
    } else if (msg.type === "done") {
        if (currentStreamingBubble) {
            currentStreamingBubble.classList.remove("streaming");
            currentStreamingBubble.textContent = msg.response;
            currentStreamingBubble = null;
        }
        if (msg.response && window.jarvisVoiceEnabled) {
            import("./voiceEngine.js").then(m => m.speak(msg.response)).catch(() => {});
        }
    } else if (msg.type === "error") {
        if (currentStreamingBubble) {
            currentStreamingBubble.classList.remove("streaming");
            currentStreamingBubble = null;
        }
        appendMessage(messages, `[Error]: ${msg.error}`, "bot-message error");
    }
}

async function respond(messages, text, { speakBack = true } = {}) {

    // 1. Native Backend Daemon (Primary Path)
    if (isBackendOnline()) {
        currentStreamingBubble = appendMessage(messages, "", "bot-message");
        currentStreamingBubble.classList.add("streaming");

        try {
            sendAgentMessage(text, { sessionId: "default" });
            return;
        } catch (err) {
            console.warn("Backend send error, falling back to direct Ollama:", err);
            if (currentStreamingBubble) {
                currentStreamingBubble.remove();
                currentStreamingBubble = null;
            }
        }
    }

    // 2. Direct Ollama Fallback
    if (!ollamaAvailable) {
        return new Promise((resolve) => {
            setTimeout(() => {
                const reply = fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)];
                appendMessage(messages, reply, "bot-message");
                if (speakBack) {
                    import("./voiceEngine.js").then(m => m.speak(reply)).catch(() => {});
                }
                resolve(reply);
            }, 500);
        });
    }

    history.push({ role: "user", content: text });
    memory.saveHistory(history);

    const { model, host } = getSettings();
    const actionTaken = await classifyAndExecuteIntent(text);

    const bubble = appendMessage(messages, "", "bot-message");
    bubble.classList.add("streaming");

    const outgoing = [{ role: "system", content: buildSystemPrompt(actionTaken) }, ...historyForModel()];

    try {
        const full = await chatStream(outgoing, {
            model,
            host,
            onToken: (chunk, fullSoFar) => {
                bubble.textContent = fullSoFar;
                messages.scrollTop = messages.scrollHeight;
            }
        });

        bubble.classList.remove("streaming");
        history.push({ role: "assistant", content: full });
        memory.saveHistory(history);

        maybeUpdateLongTermMemory();

        if (speakBack) {
            import("./voiceEngine.js").then(m => m.speak(full)).catch(() => {});
        }
        return full;

    } catch (err) {
        console.error(err);
        bubble.classList.remove("streaming");
        bubble.textContent = "Local AI request failed — falling back to standby mode. Check the connection bar above.";
        ollamaAvailable = false;
        return "Local AI request failed. Standing by.";
    }
}

function historyForModel() {

    // exclude any stored system messages (we always rebuild a fresh one)
    // and cap how much raw transcript we send per turn
    const turns = history.filter(m => m.role !== "system");

    return turns.length > 24 ? turns.slice(turns.length - 24) : turns;
}

/* =====================================================
   BACKGROUND LONG-TERM MEMORY DISTILLATION
===================================================== */

function maybeUpdateLongTermMemory() {

    userTurnsSinceLastMemoryUpdate++;

    if (userTurnsSinceLastMemoryUpdate < 5) return;

    userTurnsSinceLastMemoryUpdate = 0;
    distillMemory(); // fire and forget; failure here shouldn't disrupt chat
}

async function distillMemory() {

    const { model, host } = getSettings();
    if (!model) return;

    const recent = historyForModel().slice(-16);
    if (!recent.length) return;

    const transcript = recent.map(m => `${m.role === "user" ? "User" : "JARVIS"}: ${m.content}`).join("\n");

    const prompt = `Read this conversation excerpt and extract 2-5 short, durable facts worth
remembering about the user for future conversations (name, preferences,
ongoing projects, recurring goals, communication style). Skip anything
trivial or one-off. If nothing durable stands out, return an empty array.

CONVERSATION:
${transcript}

Respond with ONLY valid JSON: { "facts": ["short fact", "..."] }`;

    try {

        const data = await generateJSON(prompt, { model, host });

        if (Array.isArray(data.facts) && data.facts.length) {

            memory.mergeLongTermMemory(data.facts);
            addSystemLog(`JARVIS updated its memory (${data.facts.length} new note(s))`);

            if (isMemoryPanelVisible()) renderMemoryList();
        }

    } catch {
        // best-effort only — don't disrupt the chat experience on failure
    }
}

/* =====================================================
   MEMORY PANEL UI
===================================================== */

function isMemoryPanelVisible() {

    return !document.getElementById("chatMemoryPanel")?.classList.contains("hidden");
}

function setMemoryPanelVisible(visible) {

    const panel = document.getElementById("chatMemoryPanel");
    if (!panel) return;

    panel.classList.toggle("hidden", !visible);

    if (visible) renderMemoryList();
}

function toggleMemoryPanel() {

    setMemoryPanelVisible(!isMemoryPanelVisible());
}

function renderMemoryList() {

    const list = document.getElementById("chatMemoryList");
    if (!list) return;

    const notes = memory.loadLongTermMemory();

    list.innerHTML = "";

    if (!notes.length) {

        list.innerHTML = `<div class="chatMemoryItem">Nothing remembered yet — JARVIS distills durable facts every few exchanges as you chat.</div>`;
        return;
    }

    notes.forEach(note => {

        const item = document.createElement("div");
        item.className = "chatMemoryItem";
        item.textContent = note;
        list.appendChild(item);
    });
}

function handleClearMemory() {

    memory.clearLongTermMemory();
    renderMemoryList();
    notify("Long-term memory cleared");
    addSystemLog("JARVIS long-term memory cleared by user");
}

function handleClearHistory() {

    memory.clearHistory();
    history = [];

    const messages = document.getElementById("chatMessages");
    if (messages) {
        messages.innerHTML = `<div class="bot-message">Very well — a clean slate. I'm still here.</div>`;
    }

    notify("Chat history cleared");
    addSystemLog("Chat history cleared by user");
}

/* =====================================================
   DOM HELPERS
===================================================== */

function appendMessage(container, text, className, scroll = true) {

    const div = document.createElement("div");

    div.className = className;
    div.textContent = text;

    container.appendChild(div);

    if (scroll) container.scrollTop = container.scrollHeight;

    return div;
}