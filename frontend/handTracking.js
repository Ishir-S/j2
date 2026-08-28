/* =====================================================
   JARVIS - HAND TRACKING MODULE
   Real hand-landmark tracking via MediaPipe Hands
   (Google's open, browser-deployable model — 21 3D
   landmarks per hand, running locally via WASM/WebGL,
   nothing sent anywhere). Gestures are derived from real
   landmark geometry, not guessed.
===================================================== */

const MEDIAPIPE_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/hands/";

let handsInstance = null;
let mediapipeCameraInstance = null;
let loadingPromise = null;

let subscribers = []; // fn(result) => void, result = { landmarks, gesture, handedness }

/* =====================================================
   SCRIPT LOADING (lazy — only when a feature needs it)
===================================================== */

function loadScript(src) {

    return new Promise((resolve, reject) => {

        if (document.querySelector(`script[src="${src}"]`)) {
            resolve();
            return;
        }

        const script = document.createElement("script");
        script.src = src;
        script.crossOrigin = "anonymous";
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load ${src}`));

        document.head.appendChild(script);
    });
}

async function ensureMediaPipeLoaded() {

    if (window.Hands) return;

    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {

        await loadScript("https://unpkg.com/@mediapipe/hands@0.4.1675469240/hands.js");
        await loadScript("https://unpkg.com/@mediapipe/camera_utils@0.3.1675466862/camera_utils.js");
    })();

    return loadingPromise;
}

/* =====================================================
   INIT
===================================================== */

/**
 * Starts real-time hand tracking on a <video> element.
 * Safe to call multiple times — reuses the running tracker.
 */
export async function startHandTracking(videoEl) {

    await ensureMediaPipeLoaded();

    if (!handsInstance) {

        handsInstance = new window.Hands({
            locateFile: (file) => `${MEDIAPIPE_CDN}${file}`
        });

        handsInstance.setOptions({
            maxNumHands: 2,
            modelComplexity: 1,
            minDetectionConfidence: 0.6,
            minTrackingConfidence: 0.6
        });

        handsInstance.onResults(handleResults);
    }

    if (!mediapipeCameraInstance) {

        mediapipeCameraInstance = new window.Camera(videoEl, {
            onFrame: async () => {
                await handsInstance.send({ image: videoEl });
            },
            width: 640,
            height: 480
        });

        mediapipeCameraInstance.start();
    }
}

export function stopHandTracking() {

    mediapipeCameraInstance?.stop();
    mediapipeCameraInstance = null;
}

export function onHandResult(fn) {

    subscribers.push(fn);
    return () => { subscribers = subscribers.filter(s => s !== fn); };
}

function handleResults(results) {

    const hands = (results.multiHandLandmarks || []).map((landmarks, i) => {

        const handedness = results.multiHandedness?.[i]?.label || "Unknown";

        return {
            landmarks,
            handedness,
            gesture: classifyGesture(landmarks)
        };
    });

    subscribers.forEach(fn => fn(hands));
}

/* =====================================================
   GESTURE CLASSIFICATION
   Derived from real landmark distances/angles — 21 points
   per hand, indices per MediaPipe's standard hand model:
   0 = wrist, 4 = thumb tip, 8 = index tip, 12 = middle tip,
   16 = ring tip, 20 = pinky tip.
===================================================== */

function dist(a, b) {

    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function fingerExtended(landmarks, tipIdx, pipIdx, mcpIdx) {

    // A finger is "extended" if its tip is further from the wrist
    // than its middle joint — a simple, real geometric heuristic.
    const wrist = landmarks[0];

    return dist(landmarks[tipIdx], wrist) > dist(landmarks[pipIdx], wrist) * 1.05
        && dist(landmarks[pipIdx], wrist) > dist(landmarks[mcpIdx], wrist) * 0.95;
}

export function classifyGesture(landmarks) {

    const wrist = landmarks[0];
    const palmSize = dist(landmarks[0], landmarks[9]) || 0.1; // wrist to middle-finger MCP, for scale

    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];

    const pinchDistance = dist(thumbTip, indexTip) / palmSize;

    const indexExt = fingerExtended(landmarks, 8, 6, 5);
    const middleExt = fingerExtended(landmarks, 12, 10, 9);
    const ringExt = fingerExtended(landmarks, 16, 14, 13);
    const pinkyExt = fingerExtended(landmarks, 20, 18, 17);

    const extendedCount = [indexExt, middleExt, ringExt, pinkyExt].filter(Boolean).length;

    if (pinchDistance < 0.55) return "pinch";

    if (extendedCount === 0) return "fist";

    if (extendedCount >= 4) return "open_palm";

    if (indexExt && !middleExt && !ringExt && !pinkyExt) return "point";

    return "none";
}

/**
 * Returns the average normalized (0-1) screen position of a hand,
 * useful for mapping hand position to cursor-like control.
 */
export function getHandCenter(landmarks) {

    const wrist = landmarks[0];
    const middleMcp = landmarks[9];

    return {
        x: (wrist.x + middleMcp.x) / 2,
        y: (wrist.y + middleMcp.y) / 2
    };
}

/* =====================================================
   DRAWING (skeleton overlay on a canvas)
===================================================== */

const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [17, 18], [18, 19], [19, 20],
    [0, 17]
];

export function drawHandSkeleton(ctx, landmarks, width, height, color = "#00ffff") {

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.fillStyle = color;

    HAND_CONNECTIONS.forEach(([a, b]) => {

        ctx.beginPath();
        ctx.moveTo(landmarks[a].x * width, landmarks[a].y * height);
        ctx.lineTo(landmarks[b].x * width, landmarks[b].y * height);
        ctx.stroke();
    });

    landmarks.forEach(p => {

        ctx.beginPath();
        ctx.arc(p.x * width, p.y * height, 3, 0, Math.PI * 2);
        ctx.fill();
    });
}
