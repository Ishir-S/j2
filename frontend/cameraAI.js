/* =====================================================
   JARVIS - CAMERA AI MODULE
   Real, local computer vision. Every model here runs
   entirely in the browser (TensorFlow.js / face-api.js) —
   no frames are ever sent to a server. Heavier models are
   lazy-loaded only when their toggle is switched on.
===================================================== */

import { addSystemLog } from "./ui.js";
import { startHandTracking, stopHandTracking, onHandResult, drawHandSkeleton } from "./handTracking.js";
import { feedVisualEvent } from "./proactiveIntelligence.js";

const FACE_MODEL_BASE =
    "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model/";

const KNOWN_FACES_KEY = "jarvis_known_faces";

let video, overlay, ctx;
let rafId = null;

let cocoModel = null;
let cocoLoading = null;
let faceApiLoading = null;

let lastObjectDetectAt = 0;
let lastFaceDetectAt = 0;
let lastObjectResults = [];
let lastFaceResults = [];

let prevMotionFrame = null;

let state = {
    objects: true,
    motion: true,
    faces: true,
    hands: true
};

let latestHandResults = [];
let unsubscribeHands = null;

/* =====================================================
   INIT
===================================================== */

export async function initCameraAI() {

    video = document.getElementById("cameraFeed");
    overlay = document.getElementById("cameraOverlay");

    if (!video || !overlay) return;

    ctx = overlay.getContext("2d");

    const capObjects = document.getElementById("capObjects");
    const capMotion = document.getElementById("capMotion");
    const capFaces = document.getElementById("capFaces");
    const capHands = document.getElementById("capHands");

    if (capObjects) capObjects.checked = true;
    if (capMotion) capMotion.checked = true;
    if (capFaces) capFaces.checked = true;
    if (capHands) capHands.checked = true;

    capObjects?.addEventListener("change", (e) => toggleCapability("objects", e.target.checked));
    capMotion?.addEventListener("change", (e) => toggleCapability("motion", e.target.checked));
    capFaces?.addEventListener("change", (e) => toggleCapability("faces", e.target.checked));
    capHands?.addEventListener("change", (e) => toggleCapability("hands", e.target.checked));

    document.getElementById("enrollFaceBtn")?.addEventListener("click", handleEnrollFace);

    renderKnownFaces();

    window.addEventListener("resize", resizeOverlay);

    video.addEventListener("loadeddata", () => {
        resizeOverlay();
        ensureLoop();
    });
    video.addEventListener("play", () => {
        resizeOverlay();
        ensureLoop();
    });

    // Auto-enable all capabilities from boot
    await enableAllCapabilities();
}

export function ensureCameraAIRunning() {
    resizeOverlay();
    ensureLoop();
}

async function enableAllCapabilities() {
    resizeOverlay();
    ensureLoop();

    const promises = [
        toggleCapability("objects", true),
        toggleCapability("motion", true),
        toggleCapability("faces", true),
        toggleCapability("hands", true)
    ];

    await Promise.allSettled(promises);
}

function setModelStatus(text) {

    const el = document.getElementById("cameraModelStatus");
    if (el) el.textContent = text;
}

/* =====================================================
   CAPABILITY TOGGLES
===================================================== */

async function toggleCapability(name, enabled) {

    state[name] = enabled;

    if (!enabled) {

        if (name === "hands") {
            unsubscribeHands?.();
            stopHandTracking();
            latestHandResults = [];
        }

        return;
    }

    resizeOverlay();
    ensureLoop();

    try {

        if (name === "objects") {

            setModelStatus("Loading object detection model...");
            await ensureCocoModel();
            setModelStatus("");
            addSystemLog("Camera: object detection enabled");
        }

        if (name === "faces") {

            setModelStatus("Loading face recognition models...");
            await ensureFaceApi();
            setModelStatus("");
            addSystemLog("Camera: face recognition enabled");

            document.getElementById("cameraFacePanel")?.classList.remove("hidden");
        }

        if (name === "hands") {

            setModelStatus("Loading hand tracking model...");
            await startHandTracking(video);
            unsubscribeHands = onHandResult((hands) => { latestHandResults = hands; });
            setModelStatus("");
            addSystemLog("Camera: hand gesture tracking enabled");
        }

        if (name === "motion") {

            prevMotionFrame = null;
            addSystemLog("Camera: motion detection enabled");
        }

    } catch (err) {

        console.error(err);
        setModelStatus(`Failed to load: ${err.message}`);
    }
}

function resizeOverlay() {

    if (!video || !overlay) return;

    overlay.width = video.videoWidth || video.clientWidth || 640;
    overlay.height = video.videoHeight || video.clientHeight || 480;
}

/* =====================================================
   LAZY MODEL LOADING
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

async function ensureCocoModel() {

    if (cocoModel) return cocoModel;

    if (!cocoLoading) {

        cocoLoading = (async () => {

            await loadScript("https://unpkg.com/@tensorflow/tfjs@4.22.0/dist/tf.min.js");
            await loadScript("https://unpkg.com/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js");

            cocoModel = await window.cocoSsd.load();
            return cocoModel;
        })();
    }

    return cocoLoading;
}

async function ensureFaceApi() {

    if (window.faceapi && window.faceapi._jarvisModelsLoaded) return;

    if (!faceApiLoading) {

        faceApiLoading = (async () => {

            await loadScript("https://unpkg.com/@tensorflow/tfjs@4.22.0/dist/tf.min.js");
            await loadScript("https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/dist/face-api.js");

            await Promise.all([
                window.faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_BASE),
                window.faceapi.nets.faceLandmark68Net.loadFromUri(FACE_MODEL_BASE),
                window.faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODEL_BASE)
            ]);

            window.faceapi._jarvisModelsLoaded = true;
        })();
    }

    return faceApiLoading;
}

/* =====================================================
   MAIN DETECTION LOOP
===================================================== */

function ensureLoop() {

    if (rafId) return;
    loop();
}

function loop() {

    rafId = requestAnimationFrame(loop);

    if (!video || video.readyState < 2 || !ctx) return;

    const cameraPanel = document.getElementById("cameraPanel");
    const isCameraOpen = cameraPanel && cameraPanel.classList.contains("active");

    if (!isCameraOpen && !document.getElementById("gestureControlToggle")?.checked && !state.hands) {
        return; // Suspend ML inference when camera panel, gesture controls, and hand tracking are all closed
    }

    if (!Object.values(state).some(Boolean)) {

        cancelAnimationFrame(rafId);
        rafId = null;
        ctx.clearRect(0, 0, overlay.width, overlay.height);
        return;
    }

    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (state.motion) runMotionDetection();
    if (state.objects) runObjectDetectionThrottled();
    if (state.faces) runFaceDetectionThrottled();
    if (state.hands) drawHands();

    drawObjectBoxes();
    drawFaceBoxes();
}

/* =====================================================
   MOTION DETECTION (real frame-differencing, no ML)
===================================================== */

function runMotionDetection() {

    const w = 80, h = 60; // downsample for speed

    const sample = document.createElement("canvas");
    sample.width = w;
    sample.height = h;

    const sctx = sample.getContext("2d");
    sctx.drawImage(video, 0, 0, w, h);

    const frame = sctx.getImageData(0, 0, w, h);

    if (prevMotionFrame) {

        let motionCells = [];

        for (let y = 0; y < h; y += 4) {

            for (let x = 0; x < w; x += 4) {

                const i = (y * w + x) * 4;

                const diff =
                    Math.abs(frame.data[i] - prevMotionFrame.data[i]) +
                    Math.abs(frame.data[i + 1] - prevMotionFrame.data[i + 1]) +
                    Math.abs(frame.data[i + 2] - prevMotionFrame.data[i + 2]);

                if (diff > 90) {
                    motionCells.push({ x: x / w, y: y / h });
                }
            }
        }

        if (motionCells.length > 3) {

            ctx.fillStyle = "rgba(255, 80, 80, 0.35)";

            motionCells.forEach(cell => {

                ctx.fillRect(
                    cell.x * overlay.width,
                    cell.y * overlay.height,
                    overlay.width * 0.02,
                    overlay.height * 0.02
                );
            });

            ctx.strokeStyle = "#ff5050";
            ctx.font = "14px Orbitron";
            ctx.fillStyle = "#ff5050";
            ctx.fillText(`MOTION DETECTED (${motionCells.length} regions)`, 10, 20);

            if (motionCells.length > 15) {
                feedVisualEvent("high_motion");
            }
        }
    }

    prevMotionFrame = frame;
}

/* =====================================================
   OBJECT DETECTION (TensorFlow.js COCO-SSD)
===================================================== */

async function runObjectDetectionThrottled() {

    const now = performance.now();
    if (now - lastObjectDetectAt < 400) return;
    lastObjectDetectAt = now;

    if (!cocoModel || !video || video.readyState < 2 || !video.videoWidth) return;

    try {

        lastObjectResults = await cocoModel.detect(video);

    } catch (err) {

        console.warn("Object detection warning:", err.message);
    }
}

function drawObjectBoxes() {

    if (!state.objects || !video.videoWidth) return;

    const scaleX = overlay.width / video.videoWidth;
    const scaleY = overlay.height / video.videoHeight;

    lastObjectResults.forEach(pred => {

        const [x, y, w, h] = pred.bbox;

        ctx.strokeStyle = "#00ffff";
        ctx.lineWidth = 2;
        ctx.strokeRect(x * scaleX, y * scaleY, w * scaleX, h * scaleY);

        const label = `${pred.class} ${Math.round(pred.score * 100)}%`;

        ctx.fillStyle = "rgba(0,255,255,0.85)";
        ctx.font = "13px Orbitron";
        const textWidth = ctx.measureText(label).width;

        ctx.fillRect(x * scaleX, y * scaleY - 18, textWidth + 10, 18);

        ctx.fillStyle = "#000";
        ctx.fillText(label, x * scaleX + 5, y * scaleY - 5);
    });
}

/* =====================================================
   FACE DETECTION + RECOGNITION (face-api.js)
===================================================== */

async function runFaceDetectionThrottled() {

    const now = performance.now();
    if (now - lastFaceDetectAt < 500) return;
    lastFaceDetectAt = now;

    if (!window.faceapi?._jarvisModelsLoaded || !video || video.readyState < 2 || !video.videoWidth) return;

    try {

        const detections = await window.faceapi
            .detectAllFaces(video, new window.faceapi.TinyFaceDetectorOptions())
            .withFaceLandmarks()
            .withFaceDescriptors();

        lastFaceResults = detections.map(d => ({
            box: d.detection.box,
            descriptor: d.descriptor,
            match: matchKnownFace(d.descriptor)
        }));

        if (lastFaceResults.length > 0) {
            const firstMatch = lastFaceResults.find(f => f.match);
            if (firstMatch) {
                feedVisualEvent("face_recognized", { label: firstMatch.match.label });
            } else {
                feedVisualEvent("unknown_face");
            }
        }

    } catch (err) {

        console.warn("Face detection warning:", err.message);
    }
}

function drawFaceBoxes() {

    if (!state.faces) return;

    const scaleX = overlay.width / video.videoWidth;
    const scaleY = overlay.height / video.videoHeight;

    lastFaceResults.forEach(face => {

        const { x, y, width, height } = face.box;

        const color = face.match ? "#4dffb8" : "#ffb454";

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(x * scaleX, y * scaleY, width * scaleX, height * scaleY);

        const label = face.match ? face.match.label : "Unknown";

        ctx.fillStyle = color;
        ctx.font = "13px Orbitron";
        ctx.fillText(label, x * scaleX, y * scaleY - 6);
    });
}

/* =====================================================
   FACE ENROLLMENT (local only — descriptors in localStorage)
===================================================== */

function loadKnownFaces() {

    try {

        const raw = localStorage.getItem(KNOWN_FACES_KEY);
        return raw ? JSON.parse(raw) : [];

    } catch {

        return [];
    }
}

function saveKnownFaces(faces) {

    localStorage.setItem(KNOWN_FACES_KEY, JSON.stringify(faces));
}

async function handleEnrollFace() {

    const nameInput = document.getElementById("faceNameInput");
    const label = nameInput?.value.trim();

    if (!label) return;

    if (!lastFaceResults.length) {

        setModelStatus("No face currently detected to enroll.");
        return;
    }

    const descriptor = Array.from(lastFaceResults[0].descriptor);

    const faces = loadKnownFaces();
    faces.push({ label, descriptor, addedAt: new Date().toISOString() });
    saveKnownFaces(faces);

    nameInput.value = "";
    renderKnownFaces();
    addSystemLog(`Face enrolled: ${label}`);
}

function matchKnownFace(descriptor) {

    const faces = loadKnownFaces();
    if (!faces.length) return null;

    let best = null;
    let bestDist = Infinity;

    faces.forEach(face => {

        const d = euclideanDistance(descriptor, face.descriptor);

        if (d < bestDist) {
            bestDist = d;
            best = face;
        }
    });

    // 0.6 is face-api.js's commonly used match threshold
    if (best && bestDist < 0.6) {
        return { label: best.label, distance: bestDist };
    }

    return null;
}

function euclideanDistance(a, b) {

    let sum = 0;

    for (let i = 0; i < a.length; i++) {
        sum += (a[i] - b[i]) ** 2;
    }

    return Math.sqrt(sum);
}

function renderKnownFaces() {

    const list = document.getElementById("knownFacesList");
    if (!list) return;

    const faces = loadKnownFaces();

    list.innerHTML = "";

    if (!faces.length) {

        list.innerHTML = `<div class="cameraFaceMuted">No enrolled faces yet.</div>`;
        return;
    }

    faces.forEach((face, i) => {

        const row = document.createElement("div");
        row.className = "cameraFaceRow";

        row.innerHTML = `<span>${face.label}</span>`;

        const removeBtn = document.createElement("button");
        removeBtn.textContent = "✕";
        removeBtn.addEventListener("click", () => {

            const updated = loadKnownFaces().filter((_, idx) => idx !== i);
            saveKnownFaces(updated);
            renderKnownFaces();
        });

        row.appendChild(removeBtn);
        list.appendChild(row);
    });
}

/* =====================================================
   HAND GESTURE DRAWING (in the camera panel)
===================================================== */

function drawHands() {

    if (!latestHandResults.length) return;

    latestHandResults.forEach(hand => {

        drawHandSkeleton(ctx, hand.landmarks, overlay.width, overlay.height);

        const wrist = hand.landmarks[0];

        ctx.fillStyle = "#00ffff";
        ctx.font = "14px Orbitron";
        ctx.fillText(
            `${hand.handedness}: ${hand.gesture.toUpperCase()}`,
            wrist.x * overlay.width,
            wrist.y * overlay.height + 20
        );

        // Hand cursor tracking & pinch clicks are managed by handCursor.js
    });
}

/* =====================================================
   CLEANUP
===================================================== */

export function stopCameraAI() {

    Object.keys(state).forEach(k => { state[k] = false; });

    unsubscribeHands?.();
    stopHandTracking();
    latestHandResults = [];

    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }

    ctx?.clearRect(0, 0, overlay?.width || 0, overlay?.height || 0);
}
