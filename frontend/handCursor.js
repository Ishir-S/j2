/* =====================================================
   JARVIS - HAND CURSOR CONTROLLER
   - Tracks user's Thumb tip (MediaPipe Landmark 4)
   - Exponential position smoothing (Lerp) for fluid tracking
   - Magnetic snap to buttons & interactive UI elements
   - Pinch gesture detection (Thumb tip to Index tip distance)
   - Pinch = Click (short pinch) / Hold Click (long pinch / drag)
   - Dispatches real DOM pointer & mouse events
   - High-tech HUD Ghost Cursor states & badge visualization
===================================================== */

import { onHandResult } from "./handTracking.js";
import { playAudio } from "./ui.js";

let ghostCursor = null;
let cursorBadge = null;

// Smoothed cursor position
let posX = window.innerWidth / 2;
let posY = window.innerHeight / 2;
let rawX = posX;
let rawY = posY;

// Magnetic snapping state
let snappedEl = null;
let snappedX = posX;
let snappedY = posY;
let isSnapped = false;

// Pinch & Hold State
let isPinching = false;
let isHolding = false;
let pinchStartTime = 0;
let lastPinchState = false;

// Configuration
const LERP_FACTOR = 0.35;           // Smooth movement factor (0.1 = heavy smooth, 0.5 = responsive)
const SNAP_RADIUS = 80;             // Magnetic snap radius in pixels
const PINCH_THRESHOLD_START = 0.40; // Normalized landmark distance threshold to start pinch
const PINCH_THRESHOLD_END = 0.50;   // Normalized landmark distance threshold to release pinch (hysteresis)
const HOLD_DELAY_MS = 180;          // Duration before pinch transitions to hold click / drag

let unsubscribe = null;
let rafId = null;

export function initHandCursor() {
    ghostCursor = document.getElementById("ghostCursor");
    if (!ghostCursor) return;

    cursorBadge = ghostCursor.querySelector(".cursorBadge");

    // Subscribe to MediaPipe hand tracking updates
    unsubscribe = onHandResult(handleHandResults);

    // Fallback: mouse interaction moves cursor when hands are not in view
    window.addEventListener("pointermove", (e) => {
        if (!window.handTrackActive) {
            rawX = e.clientX;
            rawY = e.clientY;
            updateCursorDOM(e.clientX, e.clientY, false, false, false, "MOUSE");
        }
    });

    if (!rafId) {
        rafId = requestAnimationFrame(renderLoop);
    }
}

function handleHandResults(hands) {
    if (!hands || hands.length === 0) {
        window.handTrackActive = false;
        if (isPinching) releasePinch();
        return;
    }

    window.handTrackActive = true;
    const hand = hands[0]; // Track dominant/first hand
    const landmarks = hand.landmarks;
    if (!landmarks || landmarks.length < 9) return;

    // 1. TRACK THUMB TIP (Landmark 4)
    // Webcam is horizontally mirrored, so screenX = (1 - landmark.x) * window.innerWidth
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const wrist = landmarks[0];
    const middleMcp = landmarks[9];

    rawX = (1 - thumbTip.x) * window.innerWidth;
    rawY = thumbTip.y * window.innerHeight;

    // 2. PINCH DETECTION (Distance between Thumb Tip #4 and Index Tip #8)
    const palmSize = Math.hypot(
        wrist.x - middleMcp.x,
        wrist.y - middleMcp.y,
        wrist.z - middleMcp.z
    ) || 0.1;

    const pinchDist = Math.hypot(
        thumbTip.x - indexTip.x,
        thumbTip.y - indexTip.y,
        thumbTip.z - indexTip.z
    ) / palmSize;

    // Apply Hysteresis threshold
    let newPinchState = isPinching;
    if (!isPinching && pinchDist < PINCH_THRESHOLD_START) {
        newPinchState = true;
    } else if (isPinching && pinchDist > PINCH_THRESHOLD_END) {
        newPinchState = false;
    }

    // Pinch State Machine
    if (newPinchState && !lastPinchState) {
        startPinch();
    } else if (!newPinchState && lastPinchState) {
        releasePinch();
    }
    lastPinchState = newPinchState;

    if (isPinching && !isHolding) {
        if (Date.now() - pinchStartTime >= HOLD_DELAY_MS) {
            isHolding = true;
            triggerHoldMove(isSnapped ? snappedX : posX, isSnapped ? snappedY : posY);
        }
    }

    if (isHolding) {
        triggerHoldMove(isSnapped ? snappedX : posX, isSnapped ? snappedY : posY);
    }
}

// Render loop for exponential position smoothing & magnetic snap recalculation
function renderLoop() {
    rafId = requestAnimationFrame(renderLoop);

    if (!window.handTrackActive) return;

    // Exponential position smoothing (Lerp)
    posX += (rawX - posX) * LERP_FACTOR;
    posY += (rawY - posY) * LERP_FACTOR;

    // 3. MAGNETIC BUTTON SNAPPING
    findAndSnapToNearestButton();

    const targetX = isSnapped ? snappedX : posX;
    const targetY = isSnapped ? snappedY : posY;

    // Determine Status Badge Text
    let badgeText = "TRACKING";
    if (isHolding) badgeText = "HOLD CLICK";
    else if (isPinching) badgeText = "PINCH";
    else if (isSnapped) badgeText = "LOCKED";

    updateCursorDOM(targetX, targetY, isSnapped, isPinching, isHolding, badgeText);
}

function isElementVisible(el) {
    if (!el) return false;

    // 1. Must have valid non-zero dimensions
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    // 2. Must be inside current viewport
    if (
        rect.bottom < 0 ||
        rect.top > window.innerHeight ||
        rect.right < 0 ||
        rect.left > window.innerWidth
    ) {
        return false;
    }

    // 3. Native browser checkVisibility if available
    if (typeof el.checkVisibility === "function") {
        try {
            if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
                return false;
            }
        } catch (e) {}
    }

    // 4. Walk DOM hierarchy up to body checking display, opacity, visibility, pointer-events, and hidden classes
    let curr = el;
    while (curr && curr !== document.body && curr !== document.documentElement) {
        if (curr.classList.contains("hidden")) return false;

        const style = window.getComputedStyle(curr);
        if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.visibility === "collapse" ||
            parseFloat(style.opacity) === 0 ||
            style.pointerEvents === "none"
        ) {
            return false;
        }
        curr = curr.parentElement;
    }

    // 5. Ensure element is top-most visible element at center point (not covered by another window/overlay)
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const topEl = document.elementFromPoint(cx, cy);
    if (topEl && !el.contains(topEl) && !topEl.contains(el)) {
        return false;
    }

    return true;
}

function findAndSnapToNearestButton() {
    if (snappedEl && !isElementVisible(snappedEl)) {
        snappedEl.classList.remove("hand-snapped");
        snappedEl = null;
        isSnapped = false;
    }

    // Find all potential interactive elements across the app
    const candidates = document.querySelectorAll(`
        button,
        a,
        input,
        select,
        textarea,
        [role='button'],
        .closeWindow,
        .card,
        .outlinerRow,
        .viewerTabBtn,
        #menuToggleBtn,
        #bottomControls button,
        .cameraToggle,
        .researchToggle,
        .viewerToggle,
        .status-row,
        .physicsAddGrid button,
        .asaDeployRow button
    `);

    let closestEl = null;
    let minDist = 70; // 70px magnetic radius
    let bestCenterX = posX;
    let bestCenterY = posY;

    candidates.forEach(el => {
        // Ignore invisible, transparent, pointer-disabled, or covered elements
        if (!isElementVisible(el)) return;

        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const d = Math.hypot(posX - cx, posY - cy);

        if (d < minDist) {
            minDist = d;
            closestEl = el;
            bestCenterX = cx;
            bestCenterY = cy;
        }
    });

    if (closestEl) {
        if (snappedEl !== closestEl) {
            if (snappedEl) snappedEl.classList.remove("hand-snapped");
            snappedEl = closestEl;
            snappedEl.classList.add("hand-snapped");
        }
        isSnapped = true;
        // Smooth magnetic pull towards center of element
        snappedX += (bestCenterX - snappedX) * 0.45;
        snappedY += (bestCenterY - snappedY) * 0.45;
    } else {
        if (snappedEl) {
            snappedEl.classList.remove("hand-snapped");
            snappedEl = null;
        }
        isSnapped = false;
        snappedX = posX;
        snappedY = posY;
    }
}

function startPinch() {
    isPinching = true;
    isHolding = false;
    pinchStartTime = Date.now();

    const targetX = isSnapped ? snappedX : posX;
    const targetY = isSnapped ? snappedY : posY;

    const target = document.elementFromPoint(targetX, targetY) || snappedEl || document.body;

    dispatchPointerEvent("pointerdown", target, targetX, targetY);
    dispatchMouseEvent("mousedown", target, targetX, targetY);

    playAudio("clickAudio");
}

function triggerHoldMove(x, y) {
    const target = document.elementFromPoint(x, y) || snappedEl || document.body;
    dispatchPointerEvent("pointermove", target, x, y, 1);
    dispatchMouseEvent("mousemove", target, x, y, 1);
}

function releasePinch() {
    const targetX = isSnapped ? snappedX : posX;
    const targetY = isSnapped ? snappedY : posY;

    const target = document.elementFromPoint(targetX, targetY) || snappedEl || document.body;

    dispatchPointerEvent("pointerup", target, targetX, targetY);
    dispatchMouseEvent("mouseup", target, targetX, targetY);

    const pinchDuration = Date.now() - pinchStartTime;

    // If quick pinch (short click), execute click action on target
    if (pinchDuration < 450 || !isHolding) {
        const clickTarget = target.closest("button, a, input, select, [role='button']") || target;
        if (typeof clickTarget.click === "function") {
            clickTarget.click();
        } else {
            dispatchMouseEvent("click", clickTarget, targetX, targetY);
        }
    }

    isPinching = false;
    isHolding = false;
}

function dispatchPointerEvent(type, target, x, y, buttons = 0) {
    if (!target) return;
    try {
        const ev = new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            screenX: x,
            screenY: y,
            button: 0,
            buttons: buttons || (type === "pointerup" ? 0 : 1),
            pointerId: 1,
            pointerType: "touch"
        });
        target.dispatchEvent(ev);
    } catch (e) {}
}

function dispatchMouseEvent(type, target, x, y, buttons = 0) {
    if (!target) return;
    try {
        const ev = new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            screenX: x,
            screenY: y,
            button: 0,
            buttons: buttons || (type === "mouseup" ? 0 : 1)
        });
        target.dispatchEvent(ev);
    } catch (e) {}
}

function updateCursorDOM(x, y, snapped, pinching, holding, badgeText) {
    if (!ghostCursor) return;

    ghostCursor.style.display = "block";
    ghostCursor.style.left = `${x}px`;
    ghostCursor.style.top = `${y}px`;

    ghostCursor.classList.toggle("snapped", snapped);
    ghostCursor.classList.toggle("pinching", pinching && !holding);
    ghostCursor.classList.toggle("holding", holding);

    if (cursorBadge) {
        cursorBadge.textContent = badgeText;
    }
}
