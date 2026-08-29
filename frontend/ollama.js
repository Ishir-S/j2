/* =====================================================
   JARVIS - GROQ API BRIDGE (Replaces legacy Ollama)
   Re-exports groq.js functions for backwards compatibility.
===================================================== */

export {
    getSettings,
    setSettings,
    checkStatus,
    generateJSON,
    chatStream,
    onStatusChange,
    AVAILABLE_MODELS
} from "./groq.js";
