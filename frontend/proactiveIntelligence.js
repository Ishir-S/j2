/* =====================================================
   JARVIS - PROACTIVE INTELLIGENCE & UNPROMPTED SPEECH
   Monitors system telemetry (GPU/FPS, memory, uptime),
   visual sensors (faces, motion, presence), and
   temporal cues (late night, morning) to deliver witty,
   in-character, unprompted remarks.
===================================================== */

import { speak } from "./voiceEngine.js";
import { addSystemLog, notify } from "./ui.js";

let enabled = true;
let lastSpokenTimestamp = Date.now();
const MIN_COOLDOWN_MS = 180000; // 3 minutes minimum between unprompted remarks

let previousFps = 60;
let fpsDropCounter = 0;
let highMemoryAlertGiven = false;
let lateNightAlertGiven = false;
let morningGreetingGiven = false;
let lastKnownFaceSeen = null;
let lastFaceAlertTimestamp = 0;
let lastMotionAlertTimestamp = 0;

/* Periodic ambient idle remarks */
const AMBIENT_REMARKS = [
    "All background diagnostics report 100% operational readiness, sir.",
    "Neural matrix stable. Standing by whenever you need assistance.",
    "Core telemetry streams are synchronized. Systems running at peak efficiency.",
    "Visual and audio arrays are vigilant, sir.",
    "Everything is running smoothly on my end, sir."
];

export function initProactiveIntelligence() {
    addSystemLog("Proactive Intelligence: Autonomous monitoring engaged");

    // Periodic check for time-based cues and ambient observations
    setInterval(checkTimeAndAmbientCues, 45000);
}

export function setProactiveEnabled(val) {
    enabled = val;
    addSystemLog(`Proactive Intelligence: ${enabled ? "Enabled" : "Muted"}`);
}

export function isProactiveEnabled() {
    return enabled;
}

/**
 * Feeds live telemetry from the telemetry loop into the proactive engine
 */
export function feedTelemetry({ fps, memory, uptimeSec, cpuPercent, battery }) {
    if (!enabled) return;

    const now = Date.now();

    // 1. High CPU / Host Processor Load
    if (cpuPercent !== undefined && cpuPercent > 88 && canSpeak(now, 180000)) {
        const cpuRemarks = [
            `High processor load detected at ${Math.round(cpuPercent)}%, sir. Running something demanding?`,
            "Host computational cores under heavy load, sir. Allocating background capacity.",
            "Processor utilization spiking, sir. Diagnostics show high background activity."
        ];
        speakUnprompted(randomPick(cpuRemarks), "High CPU Load");
        return;
    }

    // 2. GPU / FPS Load Detection ("High GPU usage detected, running something demanding sir?")
    if (previousFps >= 45 && fps < 28 && fps > 0) {
        fpsDropCounter++;
        if (fpsDropCounter >= 2 && canSpeak(now, 150000)) {
            fpsDropCounter = 0;
            const gpuRemarks = [
                "High GPU usage detected. Running something demanding, sir?",
                "Graphics pipeline experiencing heavy load, sir. Calibrating rendering buffers.",
                "Visual telemetry shows increased GPU load. Shall I optimize background threads, sir?"
            ];
            speakUnprompted(randomPick(gpuRemarks), "High GPU Load");
            return;
        }
    } else {
        fpsDropCounter = 0;
    }
    previousFps = fps;

    // 3. Low Battery Warning
    if (battery && !battery.power_plugged && battery.percent <= 20 && canSpeak(now, 300000)) {
        speakUnprompted(
            `Main battery reserves are down to ${battery.percent}%, sir. May I suggest connecting the power supply?`,
            "Low Battery Warning"
        );
        return;
    }

    // 4. Extended Session / Milestone Uptime
    if (uptimeSec === 3600 && canSpeak(now, 60000)) {
        speakUnprompted(
            "You've been at the console for a full hour, sir. All subsystems remain fully optimized.",
            "Session Uptime"
        );
    }
}

/**
 * Feeds visual detection events from Camera AI
 */
export function feedVisualEvent(type, detail = {}) {
    if (!enabled) return;

    const now = Date.now();

    if (type === "face_recognized" && detail.label) {
        if (lastKnownFaceSeen !== detail.label && (now - lastFaceAlertTimestamp > 300000) && canSpeak(now, 150000)) {
            lastKnownFaceSeen = detail.label;
            lastFaceAlertTimestamp = now;
            const greetings = [
                `Visual recognition confirmed. Welcome back, ${detail.label}.`,
                `Good to see you, ${detail.label}. All systems are at your command.`
            ];
            speakUnprompted(randomPick(greetings), `Face: ${detail.label}`);
        }
    } else if (type === "unknown_face") {
        if (now - lastFaceAlertTimestamp > 400000 && canSpeak(now, 180000)) {
            lastFaceAlertTimestamp = now;
            speakUnprompted(
                "Optical sensors detect an unrecognized face in frame, sir.",
                "Visual Presence"
            );
        }
    } else if (type === "high_motion") {
        if (now - lastMotionAlertTimestamp > 360000 && canSpeak(now, 180000)) {
            lastMotionAlertTimestamp = now;
            speakUnprompted(
                "Motion detected in sector. Optical sensors tracking.",
                "Motion Sensor"
            );
        }
    }
}

/**
 * Checks environmental time cues (late night, early morning)
 */
function checkTimeAndAmbientCues() {
    if (!enabled) return;

    const now = new Date();
    const hour = now.getHours();
    const timeMs = now.getTime();

    // Late Night Check (1 AM - 4:30 AM)
    if (hour >= 1 && hour <= 4) {
        if (!lateNightAlertGiven && canSpeak(timeMs, 600000)) {
            lateNightAlertGiven = true;
            const lateNightQuotes = [
                `It is past ${hour} AM, sir. Burning the midnight oil again?`,
                "Working late into the morning hours, sir. Auxiliary systems remain at full capacity.",
                "You're up rather late, sir. Should you need anything, I am right here."
            ];
            speakUnprompted(randomPick(lateNightQuotes), "Late Night Vigil");
        }
    } else {
        lateNightAlertGiven = false;
    }

    // Morning Check (6 AM - 8:30 AM)
    if (hour >= 6 && hour <= 8) {
        if (!morningGreetingGiven && canSpeak(timeMs, 600000)) {
            morningGreetingGiven = true;
            speakUnprompted(
                "Good morning, sir. Diagnostics complete, all neural matrices are online.",
                "Morning Status"
            );
        }
    } else {
        morningGreetingGiven = false;
    }

    // Ambient observation if long silence (every ~10-15 mins)
    if (timeMs - lastSpokenTimestamp > 720000 && canSpeak(timeMs, MIN_COOLDOWN_MS)) {
        speakUnprompted(randomPick(AMBIENT_REMARKS), "Telemetry Sync");
    }
}

function canSpeak(now, customCooldown = MIN_COOLDOWN_MS) {
    return (now - lastSpokenTimestamp) >= customCooldown;
}

function speakUnprompted(phrase, reason = "Autonomous") {
    if (!phrase || !enabled) return;

    lastSpokenTimestamp = Date.now();
    addSystemLog(`JARVIS (${reason}): "${phrase}"`);
    notify(`JARVIS: "${phrase}"`, 4000);

    try {
        speak(phrase);
    } catch (err) {
        console.warn("Proactive speech failed:", err);
    }
}

function randomPick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
