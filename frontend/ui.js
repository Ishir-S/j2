/* =====================================================
   JARVIS X - UI SYSTEM
===================================================== */

import { initHandCursor } from "./handCursor.js";

let startup;
let loaderFill;
let bootText;
let viewerBtn;

let dashboardPanel;
let cameraPanel;
let chatPanel;
let projectsPanel;

let projectsBtn;
let dashboardBtn;
let cameraBtn;  
let voiceBtn;
let chatBtn;
let mapBtn;
let researchBtn;
let asaBtn;
let physicsBtn;

let clockDisplay;
let dateDisplay;

let voiceStatus;
let cameraStatus;

let systemLog;
let notificationContainer;

let fpsValue;
let memoryValue;
let threadsValue;
let uptimeValue;

let ghostCursor;
let menuToggleBtn;
let bottomControls;

/* =====================================================
   BOOT SEQUENCE
===================================================== */

const bootLines = [
    "Good day. Beginning start-up sequence.",
    "Calibrating primary systems.",
    "Establishing a link to local intelligence.",
    "Running a full diagnostic — one moment.",
    "Awakening visual and audio arrays.",
    "All systems nominal.",
    "Systems are online and functioning perfectly.",
    "At your service."
];

/* =====================================================
   INIT
===================================================== */

export function initUI() {

    startup =
        document.getElementById(
            "startup"
        );

    loaderFill =
        document.getElementById(
            "loaderFill"
        );

    bootText =
        document.getElementById(
            "bootText"
        );

    dashboardPanel =
        document.getElementById(
            "dashboardPanel"
        );

    cameraPanel =
        document.getElementById(
            "cameraPanel"
        );

    chatPanel =
        document.getElementById(
            "chatPanel"
        );
    projectsPanel =
        document.getElementById(
            "projectsPanel"
        );

    dashboardBtn =
        document.getElementById(
            "dashboardBtn"
        );

    cameraBtn =
        document.getElementById(
            "cameraBtn"
        );

    voiceBtn =
        document.getElementById(
            "voiceBtn"
        );
    viewerBtn =
        document.getElementById(
            "viewerBtn"
    );
    projectsBtn =
        document.getElementById(
            "projectsBtn"
    );
    chatBtn =
        document.getElementById(
            "chatBtn"
        );

    mapBtn =
        document.getElementById(
            "mapBtn"
        );

    researchBtn =
        document.getElementById(
            "researchBtn"
        );

    asaBtn =
        document.getElementById(
            "asaBtn"
        );

    physicsBtn =
        document.getElementById(
            "physicsBtn"
        );

    clockDisplay =
        document.getElementById(
            "clockDisplay"
        );

    dateDisplay =
        document.getElementById(
            "dateDisplay"
        );

    voiceStatus =
        document.getElementById(
            "voiceStatus"
        );

    cameraStatus =
        document.getElementById(
            "cameraStatus"
        );

    systemLog =
        document.getElementById(
            "systemLog"
        );

    notificationContainer =
        document.getElementById(
            "notificationContainer"
        );

    fpsValue =
        document.getElementById(
            "fpsValue"
        );

    memoryValue =
        document.getElementById(
            "memoryValue"
        );

    threadsValue =
        document.getElementById(
            "threadsValue"
        );

    uptimeValue =
        document.getElementById(
            "uptimeValue"
        );

    setupClock();

    setupWindowButtons();

    setupMenuToggle();

    startBootSequence();
}

/* =====================================================
   MENU TOGGLE (fallback list, sphere nodes are primary)
===================================================== */

function setupMenuToggle() {

    menuToggleBtn = document.getElementById("menuToggleBtn");
    bottomControls = document.getElementById("bottomControls");

    if (!menuToggleBtn || !bottomControls) return;

    bottomControls.classList.add("collapsedMenu");

    menuToggleBtn.addEventListener("click", () => {

        bottomControls.classList.toggle("collapsedMenu");
    });
}

/* =====================================================
   BOOT ANIMATION
===================================================== */

function startBootSequence() {
    if (startup) {
        startup.style.display = "none";
        startup.classList.add("hidden");
    }
    addSystemLog("JARVIS Core Online — Center Neural Sphere winking into existence node by node.");
    notify("Good to see you again.");
}

/* =====================================================
   CLOCK
===================================================== */

function setupClock() {

    updateClock();

    setInterval(
        updateClock,
        1000
    );
}

function updateClock() {

    const now =
        new Date();

    clockDisplay.textContent =
        now.toLocaleTimeString();

    dateDisplay.textContent =
        now.toLocaleDateString(
            undefined,
            {
                weekday:
                    "long",
                year:
                    "numeric",
                month:
                    "long",
                day:
                    "numeric"
            }
        );
}

/* =====================================================
   WINDOW SYSTEM
===================================================== */

function setupWindowButtons() {

    document
        .querySelectorAll(
            ".closeWindow"
        )
        .forEach(btn => {

            btn.addEventListener(
                "click",
                () => {

                    const target =
                        btn.dataset
                            .close;

                    closeWindow(
                        target
                    );
                }
            );
        });
}

export function openWindow(id) {

    const el =
        document.getElementById(
            id
        );

    if (!el) return;

    el.classList.add(
        "active"
    );
}

export function closeWindow(id) {

    const el =
        document.getElementById(
            id
        );

    if (!el) return;

    el.classList.remove(
        "active"
    );
}

/* =====================================================
   BUTTON ACCESS
===================================================== */

export function getButtons() {

    return {
        projectsBtn,
        dashboardBtn,
        cameraBtn,
        voiceBtn,
        chatBtn,
        viewerBtn,
        mapBtn,
        researchBtn,
        asaBtn,
        physicsBtn
    };
}

/* =====================================================
   STATUS
===================================================== */

export function setVoiceStatus(
    text
) {

    if (
        !voiceStatus
    ) return;

    voiceStatus.textContent =
        text;
}

export function setCameraStatus(
    text
) {

    if (
        !cameraStatus
    ) return;

    cameraStatus.textContent =
        text;
}

/* =====================================================
   TELEMETRY
===================================================== */

export function updateTelemetry(
    { fps, memory, threads, uptimeSec, cpuPercent, diskPercent, battery }
) {

    if (fpsValue) {
        fpsValue.textContent =
            `FPS: ${fps}`;
    }

    if (memoryValue) {
        memoryValue.textContent =
            `RAM: ${memory} MB`;
    }

    if (threadsValue) {
        const cpuStr = cpuPercent !== undefined ? `CPU: ${cpuPercent}% (${threads}T)` : `Threads: ${threads}`;
        threadsValue.textContent = cpuStr;
    }

    if (uptimeValue) {
        uptimeValue.textContent =
            `Uptime: ${formatUptime(uptimeSec)}`;
    }
}

function formatUptime(totalSeconds) {

    const h = String(
        Math.floor(totalSeconds / 3600)
    ).padStart(2, "0");

    const m = String(
        Math.floor((totalSeconds % 3600) / 60)
    ).padStart(2, "0");

    const s = String(
        totalSeconds % 60
    ).padStart(2, "0");

    return `${h}:${m}:${s}`;
}

/* =====================================================
   GHOST CURSOR
===================================================== */

export function initGhostCursor() {
    initHandCursor();
}

/* =====================================================
   SYSTEM LOG
===================================================== */

export function addSystemLog(
    message
) {

    if (!systemLog)
        return;

    const line =
        document.createElement(
            "div"
        );

    const stamp =
        new Date()
            .toLocaleTimeString();

    line.textContent =
        `[${stamp}] ${message}`;

    systemLog.prepend(
        line
    );
}

export function startAutoLogs() {
    // Replaced with real live telemetry and tool event stream from JARVIS backend
}

/* =====================================================
   NOTIFICATIONS
===================================================== */

export function notify(
    text,
    duration = 3000
) {

    const item =
        document.createElement(
            "div"
        );

    item.className =
        "notification";

    item.textContent =
        text;

    notificationContainer
        .appendChild(item);

    setTimeout(() => {

        item.style.opacity =
            "0";

        item.style.transform =
            "translateX(40px)";

        setTimeout(() => {

            item.remove();

        }, 400);

    }, duration);
}

/* =====================================================
   AUDIO
===================================================== */

export function playAudio(
    id
) {

    const audio =
        document.getElementById(
            id
        );

    if (!audio)
        return;

    audio.currentTime = 0;

    audio.play()
        .catch(() => {});
}

/* =====================================================
   SHORTCUTS
===================================================== */

export function showDashboard() {

    openWindow(
        "dashboardPanel"
    );

    notify(
        "Dashboard online."
    );

    addSystemLog(
        "Dashboard opened"
    );
}

export function showCamera() {

    openWindow(
        "cameraPanel"
    );

    notify(
        "Camera feed live."
    );

    addSystemLog(
        "Camera interface opened"
    );
}

export function showChat() {

    openWindow(
        "chatPanel"
    );

    notify(
        "I'm listening."
    );

    addSystemLog(
        "Chat console opened"
    );
}
export function showProjects() {

    openWindow(
        "projectsPanel"
    );

    notify(
        "The archive is open."
    );

    addSystemLog(
        "Project Manager opened"
    );
}

export function showViewer() {

    openWindow(
        "viewerPanel"
    );

    notify(
        "Visualization ready."
    );

    addSystemLog(
        "3D Viewer opened"
    );
}

export function showMap() {

    openWindow(
        "mapPanel"
    );

    notify(
        "Charting the globe."
    );

    addSystemLog(
        "Interactive globe opened"
    );
}

export function showResearch() {

    openWindow(
        "researchPanel"
    );

    notify(
        "Beginning research, as requested."
    );

    addSystemLog(
        "Research Agent opened"
    );
}

export function showASA() {

    openWindow(
        "asaPanel"
    );

    notify(
        "Solution Architect engaged."
    );

    addSystemLog(
        "ASA opened"
    );
}

export function showPhysics() {

    openWindow(
        "physicsPanel"
    );

    notify(
        "The physics lab is live."
    );

    addSystemLog(
        "Physics simulation opened"
    );
}