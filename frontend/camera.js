/* =====================================================
   JARVIS - CAMERA MODULE (Continuous Live Video)
===================================================== */

import { stopCameraAI, ensureCameraAIRunning } from "./cameraAI.js";

let stream = null;
let cameraStarting = false;

export async function initCamera() {

    const video = document.getElementById("cameraFeed");
    if (!video) return;

    if (stream && stream.active) {
        if (video.srcObject !== stream) {
            video.srcObject = stream;
            video.play().catch(() => {});
        }
        ensureCameraAIRunning();
        return;
    }

    if (cameraStarting) return;
    cameraStarting = true;

    try {

        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: "user"
            },
            audio: false
        });

        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        video.setAttribute("autoplay", "true");
        video.muted = true;

        video.onloadedmetadata = () => {
            video.play().catch(() => {});
            ensureCameraAIRunning();
        };

        document.dispatchEvent(
            new CustomEvent(
                "camera-status",
                { detail: "Live" }
            )
        );

        cameraStarting = false;

    } catch (err) {

        cameraStarting = false;
        console.warn("Camera init pending user gesture or permission:", err.message);

        document.dispatchEvent(
            new CustomEvent(
                "camera-status",
                { detail: "Standby" }
            )
        );

        // Retry on first user interaction in case the browser blocks background getUserMedia
        const retryOnGesture = () => {
            if (!stream) {
                initCamera();
            }
            window.removeEventListener("pointerdown", retryOnGesture);
            window.removeEventListener("keydown", retryOnGesture);
        };
        window.addEventListener("pointerdown", retryOnGesture, { once: true });
        window.addEventListener("keydown", retryOnGesture, { once: true });
    }
}

export function stopCamera(force = false) {

    // Keep camera live in the background unless explicitly forced to shut down
    if (!force) return;

    if (!stream) return;

    stopCameraAI();

    stream.getTracks()
        .forEach(track => track.stop());

    stream = null;

    const video =
        document.getElementById(
            "cameraFeed"
        );

    if (video) video.srcObject = null;

    document.dispatchEvent(
        new CustomEvent(
            "camera-status",
            { detail: "Offline" }
        )
    );
}

export function getCameraStream() {
    return stream;
}
