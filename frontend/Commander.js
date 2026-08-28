/* =====================================================
   JARVIS - INTENT COMMANDER
   Integrates with intentEngine.js to classify user intent
   across all scales (Question vs Feature Opening vs Capability
   Execution vs System Modification) using Grok API.
===================================================== */

import { analyzeAndResolveIntent } from "./intentEngine.js";

/**
 * Classifies the user's message against JARVIS's full capability catalog across all scales.
 * Returns { action, params } if an action was matched and executed, or null if conversational.
 */
export async function classifyAndExecuteIntent(userText) {
    const result = await analyzeAndResolveIntent(userText);

    if (result && result.resolved) {
        return {
            action: result.capability,
            params: result.params || {},
            intentCategory: result.intentCategory,
            explanation: result.explanation
        };
    }

    return null;
}
