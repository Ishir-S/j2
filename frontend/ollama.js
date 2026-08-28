/* =====================================================
   JARVIS - GROK API BRIDGE (Replaces legacy Ollama)
   Re-exports grok.js functions for backwards compatibility.
===================================================== */

export {
    getSettings,
    setSettings,
    checkStatus,
    generateJSON,
    chatStream,
    onStatusChange,
    AVAILABLE_MODELS
} from "./grok.js";
