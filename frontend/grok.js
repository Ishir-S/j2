/* =====================================================
   JARVIS - GROK API (xAI) LLM MODULE
   Direct integration with xAI's Grok API (https://api.x.ai/v1).
   Supports streaming chat, JSON generation, and status checks.
===================================================== */

const SETTINGS_KEY = "jarvis_grok_settings";

const DEFAULTS = {
    apiKey: localStorage.getItem("grok_api_key") || "",
    baseUrl: "https://api.x.ai/v1",
    model: "grok-2-latest"
};

const AVAILABLE_MODELS = [
    "grok-2-latest",
    "grok-2-1212",
    "grok-beta",
    "grok-vision-beta"
];

let settings = loadSettings();
let statusListeners = [];

/* =====================================================
   SETTINGS MANAGEMENT
===================================================== */

function loadSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
    } catch {
        return { ...DEFAULTS };
    }
}

export function getSettings() {
    return { ...settings };
}

export function setSettings(next) {
    settings = { ...settings, ...next };
    if (next.apiKey !== undefined) {
        localStorage.setItem("grok_api_key", next.apiKey);
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    checkStatus();
}

/* =====================================================
   STATUS & CONNECTIVITY CHECK
===================================================== */

export function onStatusChange(fn) {
    statusListeners.push(fn);
}

function emitStatus(status) {
    statusListeners.forEach(fn => fn(status));
}

export async function checkStatus(overrideSettings = {}) {
    const apiKey = overrideSettings.apiKey !== undefined ? overrideSettings.apiKey : settings.apiKey;
    const baseUrl = overrideSettings.baseUrl || settings.baseUrl;

    if (!apiKey) {
        const status = { connected: false, error: "Grok API Key missing. Please set your xAI Grok API Key.", models: AVAILABLE_MODELS };
        emitStatus(status);
        return status;
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const res = await fetch(`${baseUrl}/models`, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            signal: controller.signal
        }).catch(() => null);

        clearTimeout(timeoutId);

        if (!res || !res.ok) {
            const status = { connected: false, error: res ? `API Error ${res.status}` : "Network / CORS Error", models: AVAILABLE_MODELS };
            emitStatus(status);
            return status;
        }

        const data = await res.json();
        const models = (data.data || []).map(m => m.id).filter(id => id.includes("grok"));
        const finalModels = models.length ? models : AVAILABLE_MODELS;

        const status = { connected: true, models: finalModels };
        emitStatus(status);
        return status;

    } catch (err) {
        const status = { connected: false, error: err.message, models: AVAILABLE_MODELS };
        emitStatus(status);
        return status;
    }
}

/* =====================================================
   JSON GENERATION (Grok API)
===================================================== */

export async function generateJSON(prompt, { model, apiKey, baseUrl } = {}) {
    const useModel = model || settings.model || "grok-2-latest";
    const useApiKey = apiKey || settings.apiKey;
    const useBaseUrl = baseUrl || settings.baseUrl || "https://api.x.ai/v1";

    if (!useApiKey) {
        throw new Error("Grok API Key is missing. Please enter your xAI API Key in settings.");
    }

    const messages = [
        {
            role: "system",
            content: "You are a JSON generator. Respond ONLY with valid, raw JSON matching the requested schema. Do not include markdown code blocks, preambles, or postscript explanations."
        },
        {
            role: "user",
            content: prompt
        }
    ];

    const res = await fetch(`${useBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${useApiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: useModel,
            messages,
            temperature: 0.1,
            response_format: { type: "json_object" }
        })
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Grok API Error ${res.status}: ${errText || res.statusText}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Clean JSON text if wrapped in codeblocks
    const cleanContent = content.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/\s*```$/, "").trim();

    try {
        return JSON.parse(cleanContent);
    } catch (err) {
        console.error("Grok JSON parse error. Raw response:", content);
        throw new Error("Grok model response could not be parsed as valid JSON.");
    }
}

/* =====================================================
   STREAMING CHAT (Grok API)
===================================================== */

export async function chatStream(messages, { model, apiKey, baseUrl, onToken, onDone } = {}) {
    const useModel = model || settings.model || "grok-2-latest";
    const useApiKey = apiKey || settings.apiKey;
    const useBaseUrl = baseUrl || settings.baseUrl || "https://api.x.ai/v1";

    if (!useApiKey) {
        throw new Error("Grok API Key is missing. Please enter your xAI API Key in settings.");
    }

    const res = await fetch(`${useBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${useApiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: useModel,
            messages,
            stream: true,
            temperature: 0.3
        })
    });

    if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Grok API Error ${res.status}: ${errText || res.statusText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    let fullText = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep partial line

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(":")) continue;

            if (trimmed === "data: [DONE]") {
                onDone?.(fullText);
                return fullText;
            }

            if (trimmed.startsWith("data: ")) {
                try {
                    const json = JSON.parse(trimmed.slice(6));
                    const chunk = json.choices?.[0]?.delta?.content || "";
                    if (chunk) {
                        fullText += chunk;
                        onToken?.(chunk, fullText);
                    }
                } catch {
                    // Ignore parse errors on SSE chunks
                }
            }
        }
    }

    onDone?.(fullText);
    return fullText;
}

export { AVAILABLE_MODELS };
