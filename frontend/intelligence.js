/* =====================================================
   JARVIS - ASA: INTELLIGENCE LAYER
   Every stage here is a real call to your local Ollama
   model. Nothing is templated/hardcoded — the model
   reasons about the actual goal and actual detected
   resources/hardware each time.
===================================================== */

import { generateJSON, getSettings } from "./ollama.js";

/* =====================================================
   STAGE 1: INTENT UNDERSTANDING
===================================================== */

export async function decomposeIntent(goalText) {

    const prompt = `You are the Intent Engine inside an autonomous solution architect.
A user gave this goal, verbatim:

"${goalText}"

Extract their REAL underlying goal — not a specific implementation. For example
"I want to learn Morse code" has the real goal "teach the user Morse code",
NOT "build a button".

Respond with ONLY valid JSON:
{
  "realGoal": "one clear sentence describing the underlying goal",
  "goalType": "learning | automation | monitoring | creative | utility | communication | other",
  "constraints": ["any explicit constraints or preferences the user stated, else empty array"]
}`;

    return generateJSON(prompt, currentModelHost());
}

/* =====================================================
   STAGE 4: SOLUTION ARCHITECT
===================================================== */

export async function generateSolutions(intent, resources, hardware) {

    const prompt = `You are the Solution Architect inside an autonomous solution architect
system. You NEVER assume a specific technology up front — you reason about the
best fit from first principles.

Real goal: "${intent.realGoal}" (type: ${intent.goalType})

Detected resources on the user's machine:
${JSON.stringify(resources, null, 2)}

Detected/connected hardware so far:
${JSON.stringify(hardware, null, 2)}

Propose 3 to 5 genuinely different candidate solutions (spanning software-only,
mobile, and hardware-involving options where plausible) for achieving the real
goal. For each, score 0-100 on these criteria: learningEffectiveness, cost,
complexity (100 = very simple), hardwareAvailability (100 = uses only what's
already detected or no hardware at all), reliability, maintainability,
accessibility, safety, userExperience, timeToBuild (100 = fast to build).

Respond with ONLY valid JSON:
{
  "solutions": [
    {
      "name": "short name",
      "description": "2-3 sentences on what this solution is and how it works",
      "components": ["list of major components/technologies involved"],
      "requiresHardware": true or false,
      "hardwareNeeded": ["list of physical hardware needed, empty if none"],
      "scores": {
        "learningEffectiveness": 0-100, "cost": 0-100, "complexity": 0-100,
        "hardwareAvailability": 0-100, "reliability": 0-100,
        "maintainability": 0-100, "accessibility": 0-100, "safety": 0-100,
        "userExperience": 0-100, "timeToBuild": 0-100
      }
    }
  ]
}`;

    const data = await generateJSON(prompt, currentModelHost());

    const solutions = (data.solutions || []).map(s => ({
        ...s,
        totalScore: averageScore(s.scores)
    }));

    solutions.sort((a, b) => b.totalScore - a.totalScore);

    return solutions;
}

function averageScore(scores) {

    if (!scores) return 0;

    const values = Object.values(scores).filter(v => typeof v === "number");

    if (!values.length) return 0;

    return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

/* =====================================================
   STAGE 5: CAPABILITY GAP ANALYSIS
===================================================== */

export async function analyzeCapabilityGap(solution, existingCapabilities) {

    const prompt = `You are the Capability Gap Analyzer inside an autonomous solution
architect. A solution has been chosen:

${JSON.stringify(solution, null, 2)}

The system already has these reusable capabilities available (built previously):
${JSON.stringify(existingCapabilities.map(c => c.name))}

Determine which of the chosen solution's needs are already covered by existing
capabilities, and which are genuinely missing and need to be generated.

Respond with ONLY valid JSON:
{
  "existingCapabilitiesUsed": ["names from the existing list that cover part of this solution"],
  "missingCapabilities": [
    { "name": "short capability name", "description": "what this capability must do" }
  ]
}`;

    return generateJSON(prompt, currentModelHost());
}

/* =====================================================
   STAGE 6: CAPABILITY GENERATOR
===================================================== */

export async function generateCapability(capability, solution) {

    const prompt = `You are the Capability Generator inside an autonomous solution
architect. Generate a real, working software capability for this need:

Capability: "${capability.name}" — ${capability.description}

Context — this capability is part of building: ${solution.name} (${solution.description})

Generate actual source code, not placeholders. Keep it self-contained and as
simple as correctness allows. If this capability is firmware/embedded code,
write it as real Arduino-style C++ (.ino) or ESP-IDF style C, clearly commented
with the pin mapping assumed.

Respond with ONLY valid JSON:
{
  "manifest": { "name": "...", "version": "0.1.0", "description": "..." },
  "files": [ { "path": "relative/file/path", "content": "full real file contents" } ],
  "testFile": { "path": "relative/test/path", "content": "a real basic test or validation script for this capability" },
  "documentation": "markdown documentation explaining what this capability does, how to use it, and any hardware wiring involved"
}`;

    return generateJSON(prompt, currentModelHost());
}

/* =====================================================
   STAGE 8: BOARD SELECTION
===================================================== */

export async function selectBoard(solution, detectedHardware) {

    const prompt = `You are the Board Selection stage inside an autonomous solution
architect. The chosen solution requires hardware:

${JSON.stringify(solution, null, 2)}

Hardware already detected/connected by the user:
${JSON.stringify(detectedHardware, null, 2)}

If a detected device already satisfies the need, say so. Otherwise recommend
the single best microcontroller/board for this solution from common options
(ESP32, ESP8266, RP2040/Pico, STM32, nRF52, Arduino Uno/Nano, Raspberry Pi,
Jetson, or a custom PCB only if truly justified).

Respond with ONLY valid JSON:
{
  "usesDetectedHardware": true or false,
  "board": "board name",
  "reason": "2-3 sentences explaining the choice, referencing the solution's actual needs",
  "alternatives": ["other boards that would also work, with one-line trade-offs each as a single string per entry"]
}`;

    return generateJSON(prompt, currentModelHost());
}

/* =====================================================
   HELPERS
===================================================== */

function currentModelHost() {

    const { model, host } = getSettings();

    return { model, host };
}
