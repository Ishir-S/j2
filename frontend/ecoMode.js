/* =====================================================
   JARVIS - ECO STANDBY & LOW-POWER SLEEP ENGINE
   Monitors user inactivity, pauses WebGL & ML loops to
   reduce CPU/GPU usage to near zero, and instantly awakens
   on wake word ('JARVIS') or user interaction.
===================================================== */

import { addSystemLog, notify } from "./ui.js";

const INACTIVITY_TIMEOUT_MS = 50000; // 50 seconds of inactivity triggers Eco Sleep
let lastActivityTimestamp = Date.now();
let isSleeping = false;
let sleepCheckTimer = null;
let overlayEl = null;

const sleepListeners = new Set();

export function initEcoMode() {
    createEcoOverlay();

    // Activity listeners
    const recordActivity = (e) => {
        if (isSleeping) {
            // Wake up on intentional interaction
            wakeUp("User interaction detected");
        } else {
            lastActivityTimestamp = Date.now();
        }
    };

    window.addEventListener("pointermove", throttle(recordActivity, 1000));
    window.addEventListener("keydown", recordActivity);
    window.addEventListener("touchstart", recordActivity);
    window.addEventListener("click", recordActivity);

    // Periodic check for inactivity
    clearInterval(sleepCheckTimer);
    sleepCheckTimer = setInterval(checkInactivity, 5000);

    addSystemLog("Eco Sleep Engine active (50s idle threshold)");
}

function createEcoOverlay() {
    if (document.getElementById("ecoSleepOverlay")) return;

    overlayEl = document.createElement("div");
    overlayEl.id = "ecoSleepOverlay";
    overlayEl.className = "ecoSleepOverlay hidden";
    overlayEl.innerHTML = `
        <div class="ecoSleepCore">
            <div class="ecoRing"></div>
            <div class="ecoText">ECO STANDBY</div>
            <div class="ecoSubtext">0% GPU Active • Listening for "JARVIS" or press any key</div>
        </div>
    `;
    document.body.appendChild(overlayEl);

    overlayEl.addEventListener("click", () => {
        wakeUp("User clicked overlay");
    });
}

function checkInactivity() {
    if (isSleeping) return;

    const idleTime = Date.now() - lastActivityTimestamp;
    if (idleTime >= INACTIVITY_TIMEOUT_MS) {
        enterSleep();
    }
}

export function enterSleep() {
    if (isSleeping) return;
    isSleeping = true;

    if (overlayEl) {
        overlayEl.classList.remove("hidden");
    }

    addSystemLog("Eco Mode engaged — Visual rendering and ML loops suspended (0% GPU)");
    notify("Eco Standby Mode", 3000);

    // Dispatch event to pause Three.js loops across all modules
    document.dispatchEvent(new CustomEvent("eco-mode-change", { detail: { sleeping: true } }));
    sleepListeners.forEach(fn => fn(true));
}

export function wakeUp(reason = "Wake word detected") {
    if (!isSleeping) {
        lastActivityTimestamp = Date.now();
        return;
    }

    isSleeping = false;
    lastActivityTimestamp = Date.now();

    if (overlayEl) {
        overlayEl.classList.add("hidden");
    }

    addSystemLog(`JARVIS awakened: ${reason}`);
    notify("JARVIS Systems Online", 3000);

    // Dispatch event to resume Three.js rendering loops
    document.dispatchEvent(new CustomEvent("eco-mode-change", { detail: { sleeping: false } }));
    sleepListeners.forEach(fn => fn(false));
}

export function isEcoSleeping() {
    return isSleeping;
}

export function onEcoModeChange(fn) {
    sleepListeners.add(fn);
    return () => sleepListeners.delete(fn);
}

function throttle(func, limit) {
    let inThrottle = false;
    return function (...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => (inThrottle = false), limit);
        }
    };
}
