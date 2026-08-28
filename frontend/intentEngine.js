/* =====================================================
   JARVIS - INTENT UNDERSTANDING & CAPABILITY RESOLVER
   Classifies user prompts across all system scales:
   1. QUESTION_OR_CONVERSATION (questions, explanations, greetings)
   2. OPEN_FEATURE (launching windows, views, panels)
   3. EXECUTE_CAPABILITY (triggering internal feature tools)
   4. SYSTEM_CHANGE_OR_MODIFICATION (editing files, importing files, project changes)
===================================================== */

import { generateJSON, getSettings } from "./grok.js";
import { runCommand, hasCommand } from "./commandBridge.js";
import { addSystemLog, notify } from "./ui.js";

export const CAPABILITY_CATALOG = [
    // SCALE 1: FEATURE OPENING & NAVIGATION
    { id: "open_dashboard", scale: "Navigation", desc: "Open system status dashboard (clock, telemetry, system feed)", params: "{}" },
    { id: "open_camera", scale: "Navigation", desc: "Open live vision camera feed & AI tracking", params: "{}" },
    { id: "open_chat", scale: "Navigation", desc: "Open AI Chat console", params: "{}" },
    { id: "open_viewer", scale: "Navigation", desc: "Open 3D Model Viewer, optionally loading a scene", params: `{"scene": "solar|earth|molecule|neural"}` },
    { id: "open_map", scale: "Navigation", desc: "Open 3D interactive Globe, optionally searching route or city", params: `{"query": "string", "origin": "string", "destination": "string"}` },
    { id: "open_research", scale: "Navigation", desc: "Open Autonomous Research Agent", params: `{"topic": "string"}` },
    { id: "open_asa", scale: "Navigation", desc: "Open Autonomous Solution Architect", params: `{"goal": "string"}` },
    { id: "open_physics", scale: "Navigation", desc: "Open 3D Physics Simulation Lab", params: `{"spawn": "box|ball|cylinder|wall|ramp|car"}` },
    { id: "open_projects", scale: "Navigation", desc: "Open Project Manager & Code Editor", params: "{}" },
    { id: "close_all", scale: "Navigation", desc: "Close all active windows & panels", params: "{}" },

    // SCALE 2: PROJECT & FILE MODIFICATIONS
    { id: "new_project", scale: "Project & Code", desc: "Create a new project workspace", params: `{"name": "string"}` },
    { id: "create_file", scale: "Project & Code", desc: "Create a new file in current project", params: `{"name": "string", "content": "string"}` },
    { id: "edit_file", scale: "Project & Code", desc: "Edit code or file content in active project", params: `{"filename": "string", "content": "string"}` },
    { id: "save_file", scale: "Project & Code", desc: "Save currently edited file to storage", params: "{}" },
    { id: "delete_file", scale: "Project & Code", desc: "Delete a file from active project", params: `{"filename": "string"}` },
    { id: "import_files", scale: "Project & Code", desc: "Import external files into active project", params: `{"files": "array"}` },

    // SCALE 3: 3D VIEWER MANIPULATION
    { id: "viewer_select_part", scale: "3D Viewer", desc: "Select a specific named part in 3D scene", params: `{"name": "string"}` },
    { id: "viewer_hide_part", scale: "3D Viewer", desc: "Hide a specific named part", params: `{"name": "string"}` },
    { id: "viewer_show_part", scale: "3D Viewer", desc: "Show a hidden part or show all parts", params: `{"name": "string"}` },

    // SCALE 4: GLOBE & GEOSPATIAL
    { id: "locate_place", scale: "Globe", desc: "Locate a city or place on the interactive globe", params: `{"query": "string"}` },
    { id: "find_distance", scale: "Globe", desc: "Calculate distance/flight between origin and destination", params: `{"origin": "string", "destination": "string"}` },

    // SCALE 5: PHYSICS LAB
    { id: "spawn_physics", scale: "Physics", desc: "Spawn a 3D physics object (box, ball, cylinder, wall, ramp, car)", params: `{"spawn": "box|ball|cylinder|wall|ramp|car"}` },
    { id: "set_gravity", scale: "Physics", desc: "Set physics simulation gravity vector", params: `{"x": number, "y": number, "z": number}` },

    // SCALE 6: RESEARCH & ASA
    { id: "start_research", scale: "Research", desc: "Execute automated research on a topic", params: `{"topic": "string"}` },
    { id: "begin_asa_analysis", scale: "ASA", desc: "Begin solution architecture analysis for a goal", params: `{"goal": "string"}` }
];

function buildCatalogPromptSummary() {
    return CAPABILITY_CATALOG.map(c => `[${c.scale}] ${c.id}: ${c.desc} params: ${c.params}`).join("\n");
}

/**
 * Analyzes the user prompt with Grok API to understand intent and match existing capabilities.
 */
export async function analyzeAndResolveIntent(userPrompt) {
    const { apiKey, model } = getSettings();

    // If Grok API key is not configured, fallback to basic keyword matching
    if (!apiKey) {
        return fallbackRuleBasedIntent(userPrompt);
    }

    const prompt = `You are JARVIS's Core Intent & Capability Classifier powered by Grok AI.
Your job is to analyze the user's input and determine:
1. Is this a question/conversation, or an explicit action request?
2. If an action request, which existing JARVIS capability across ALL scales matches it?

AVAILABLE CAPABILITIES CATALOG:
${buildCatalogPromptSummary()}

USER PROMPT:
"${userPrompt}"

INTENT CATEGORIES:
- "QUESTION_OR_CONVERSATION": Questions, explanations, greetings, general topics (no system action).
- "OPEN_FEATURE": User wants to open a window/panel (Dashboard, Camera, Viewer, Globe, Research, ASA, Physics, Projects, Chat).
- "EXECUTE_CAPABILITY": User wants to execute an existing feature tool (spawn physics object, locate city, select 3D part, start research, etc.).
- "SYSTEM_CHANGE_OR_MODIFICATION": User wants to add changes, edit code, create files, import files, or save projects.

Respond with ONLY valid JSON:
{
  "intent_category": "QUESTION_OR_CONVERSATION | OPEN_FEATURE | EXECUTE_CAPABILITY | SYSTEM_CHANGE_OR_MODIFICATION",
  "matched_capability": "name of matched capability from catalog, or 'none'",
  "parameters": { ...extracted parameters },
  "explanation": "1 sentence explanation of user intent analysis",
  "requires_action": true or false
}`;

    try {
        const result = await generateJSON(prompt, { model });
        const intentCategory = result?.intent_category || "QUESTION_OR_CONVERSATION";
        const capabilityId = result?.matched_capability;
        const params = result?.parameters || {};

        if (intentCategory !== "QUESTION_OR_CONVERSATION" && capabilityId && capabilityId !== "none") {
            if (hasCommand(capabilityId)) {
                runCommand(capabilityId, params);
                addSystemLog(`Intent Engine [${intentCategory}]: Resolved "${capabilityId}"`);
                return {
                    resolved: true,
                    intentCategory,
                    capability: capabilityId,
                    params,
                    explanation: result.explanation || `Executed ${capabilityId}`
                };
            }
        }

        return {
            resolved: false,
            intentCategory,
            isQuestion: intentCategory === "QUESTION_OR_CONVERSATION",
            explanation: result.explanation || "Conversational prompt"
        };

    } catch (err) {
        console.warn("Intent analysis via Grok API failed:", err);
        return fallbackRuleBasedIntent(userPrompt);
    }
}

function fallbackRuleBasedIntent(text) {
    const lower = text.toLowerCase();

    if (lower.includes("dashboard")) {
        runCommand("open_dashboard");
        return { resolved: true, intentCategory: "OPEN_FEATURE", capability: "open_dashboard", params: {} };
    }
    if (lower.includes("camera")) {
        runCommand("open_camera");
        return { resolved: true, intentCategory: "OPEN_FEATURE", capability: "open_camera", params: {} };
    }
    if (lower.includes("viewer") || lower.includes("3d")) {
        runCommand("open_viewer");
        return { resolved: true, intentCategory: "OPEN_FEATURE", capability: "open_viewer", params: {} };
    }
    if (lower.includes("globe") || lower.includes("map")) {
        runCommand("open_map");
        return { resolved: true, intentCategory: "OPEN_FEATURE", capability: "open_map", params: {} };
    }
    if (lower.includes("research")) {
        runCommand("open_research");
        return { resolved: true, intentCategory: "OPEN_FEATURE", capability: "open_research", params: {} };
    }
    if (lower.includes("asa") || lower.includes("architect")) {
        runCommand("open_asa");
        return { resolved: true, intentCategory: "OPEN_FEATURE", capability: "open_asa", params: {} };
    }
    if (lower.includes("physics")) {
        runCommand("open_physics");
        return { resolved: true, intentCategory: "OPEN_FEATURE", capability: "open_physics", params: {} };
    }
    if (lower.includes("project") || lower.includes("code")) {
        runCommand("open_projects");
        return { resolved: true, intentCategory: "OPEN_FEATURE", capability: "open_projects", params: {} };
    }
    if (lower.includes("close")) {
        runCommand("close_all");
        return { resolved: true, intentCategory: "OPEN_FEATURE", capability: "close_all", params: {} };
    }

    return { resolved: false, intentCategory: "QUESTION_OR_CONVERSATION", isQuestion: true };
}
