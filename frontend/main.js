/* =====================================================
   JARVIS - MAIN CONTROLLER
===================================================== */

import {
    initScene,
    setNodeCallback,
    zoomIn,
    zoomOut,
    getFPS
} from "./scene.js";

import {
    initUI,
    getButtons,
    showDashboard,
    showCamera,
    showChat,
    showProjects,
    showViewer,
    showMap,
    showResearch,
    showASA,
    showPhysics,
    closeWindow,
    notify,
    addSystemLog,
    startAutoLogs,
    setCameraStatus,
    setVoiceStatus,
    playAudio,
    updateTelemetry,
    initGhostCursor
} from "./ui.js";

import { initCamera, stopCamera } from "./camera.js";
import { initCameraAI } from "./cameraAI.js";
import { initChat, refreshChatPanel } from "./chat.js";
import { initProjects, refreshEditor } from "./projects.js";
import { initViewer, loadSceneByName, selectPartByName, hidePartByName, showPartByName, showAllParts } from "./viewer.js";
import { initMap, refreshMap, searchRoute } from "./map.js";
import { initResearch, refreshResearchPanel, startResearchOnTopic } from "./research.js";
import { initASA, refreshASAPanel, beginAnalysisOnGoal } from "./asa.js";
import { initPhysics, refreshPhysicsPanel, spawnByName, setGravity } from "./physics.js";
import { registerCommands } from "./commandBridge.js";
import { initVoiceEngine, toggleVoice } from "./voiceEngine.js";
import { initProactiveIntelligence, feedTelemetry } from "./proactiveIntelligence.js";
import { initBackendBridge, onAgentStatus } from "./backendBridge.js";
import { initEcoMode } from "./ecoMode.js";
import { initNetwork } from "./network.js";

let buttons;

const startTime = Date.now();

window.addEventListener("DOMContentLoaded", init);

async function init() {

    initUI();
    initGhostCursor();
    initBackendBridge();
    initEcoMode();
    initNetwork();

    buttons = getButtons();

    const canvas = document.getElementById("bgCanvas");
    initScene(canvas);

    bindButtons();
    registerSceneCallbacks();
    registerActionCommands();

    initChat();
    initProjects();
    initViewer();
    initMap();
    initResearch();
    initASA();
    initPhysics();

    // Auto-start continuous camera & all AI vision features from boot
    await initCamera();
    await initCameraAI();

    // Auto-start continuous voice engine with 'jarvis' wakeword from boot
    initVoiceEngine();

    // Engage proactive unprompted speech intelligence
    initProactiveIntelligence();

    document.addEventListener("camera-status", (event) => {
        setCameraStatus(event.detail);
    });

    startTelemetryLoop();

    notify("Welcome Back");
    addSystemLog("JARVIS initialized — Visual and Audio arrays online");
    playAudio("startupAudio");

    console.log("%cJARVIS ONLINE", "color:cyan;font-size:18px");
}

/* =====================================================
   BUTTON BINDING
===================================================== */

function bindButtons() {

    buttons.projectsBtn?.addEventListener("click", () => {
        playAudio("openAudio");
        openProjectsCommand();
    });

    buttons.dashboardBtn?.addEventListener("click", () => {
        playAudio("openAudio");
        openDashboardCommand();
    });

    buttons.cameraBtn?.addEventListener("click", () => {
        playAudio("openAudio");
        openCameraCommand();
    });

    buttons.chatBtn?.addEventListener("click", () => {
        playAudio("openAudio");
        openChatCommand();
    });

    buttons.viewerBtn?.addEventListener("click", () => {
        playAudio("openAudio");
        openViewerCommand();
    });

    buttons.mapBtn?.addEventListener("click", () => {
        playAudio("openAudio");
        openMapCommand();
    });

    buttons.researchBtn?.addEventListener("click", () => {
        playAudio("openAudio");
        openResearchCommand();
    });

    buttons.asaBtn?.addEventListener("click", () => {
        playAudio("openAudio");
        openASACommand();
    });

    buttons.physicsBtn?.addEventListener("click", () => {
        playAudio("openAudio");
        openPhysicsCommand();
    });

    buttons.voiceBtn?.addEventListener("click", () => {
        playAudio("clickAudio");
        toggleVoiceCommand();
    });
}

function registerSceneCallbacks() {

    setNodeCallback("dashboard", openDashboardCommand);
    setNodeCallback("camera", openCameraCommand);
    setNodeCallback("voice", toggleVoiceCommand);
    setNodeCallback("chat", openChatCommand);
    setNodeCallback("viewer", openViewerCommand);
    setNodeCallback("map", openMapCommand);
    setNodeCallback("research", openResearchCommand);
    setNodeCallback("asa", openASACommand);
    setNodeCallback("physics", openPhysicsCommand);
    setNodeCallback("projects", openProjectsCommand);
}

function registerActionCommands() {

    registerCommands({

        open_dashboard: () => openDashboardCommand(),
        open_camera: () => openCameraCommand(),
        toggle_voice: () => toggleVoiceCommand(),
        open_chat: () => openChatCommand(),

        open_viewer: (params) => {
            openViewerCommand();
            if (params.scene) setTimeout(() => loadSceneByName(params.scene), 350);
        },

        viewer_select_part: (params) => {
            openViewerCommand();
            if (params.name) setTimeout(() => selectPartByName(params.name), 350);
        },

        viewer_hide_part: (params) => {
            if (params.name) hidePartByName(params.name);
        },

        viewer_show_part: (params) => {
            if (params.name) showPartByName(params.name);
            else showAllParts();
        },

        open_map: (params) => {
            openMapCommand();
            if (params.query) {
                setTimeout(() => import("./map.js").then(m => m.locateCityOrPlace(params.query)), 400);
            } else if (params.origin && params.destination) {
                setTimeout(() => import("./map.js").then(m => m.calculateDistanceBetween(params.origin, params.destination)), 400);
            } else if (params.origin || params.destination) {
                setTimeout(() => searchRoute(params.origin, params.destination), 400);
            }
        },

        locate_place: (params) => {
            openMapCommand();
            if (params.query) {
                setTimeout(() => import("./map.js").then(m => m.locateCityOrPlace(params.query)), 400);
            }
        },

        find_distance: (params) => {
            openMapCommand();
            if (params.origin && params.destination) {
                setTimeout(() => import("./map.js").then(m => m.calculateDistanceBetween(params.origin, params.destination)), 400);
            }
        },

        open_research: (params) => {
            openResearchCommand();
            if (params.topic) setTimeout(() => startResearchOnTopic(params.topic), 350);
        },

        open_asa: (params) => {
            openASACommand();
            if (params.goal) setTimeout(() => beginAnalysisOnGoal(params.goal), 350);
        },

        open_physics: (params) => {
            openPhysicsCommand();
            if (params.spawn) setTimeout(() => spawnByName(params.spawn), 350);
        },

        spawn_physics: (params) => {
            openPhysicsCommand();
            if (params.spawn) setTimeout(() => spawnByName(params.spawn), 350);
        },

        open_projects: () => openProjectsCommand(),

        set_gravity: (params) => {
            openPhysicsCommand();
            setTimeout(() => setGravity(params.x, params.y, params.z), 350);
        },

        close_all: () => closeAllWindows()
    });
}

/* =====================================================
   COMMANDS
===================================================== */

function openDashboardCommand() {
    showDashboard();
    zoomIn();
    addSystemLog("Dashboard opened");
}

function openCameraCommand() {
    showCamera();
    zoomIn();
    initCamera();
    addSystemLog("Camera opened");
}

function openChatCommand() {
    showChat();
    zoomIn();
    addSystemLog("Chat opened");
    refreshChatPanel();
}

function openProjectsCommand() {
    showProjects();
    zoomIn();
    addSystemLog("Projects opened");
    setTimeout(refreshEditor, 60);
}

function openViewerCommand() {
    showViewer();
    zoomIn();
    addSystemLog("3D Viewer opened");
}

function openMapCommand() {
    showMap();
    zoomIn();
    addSystemLog("Globe opened");
    setTimeout(refreshMap, 60);
}

function openResearchCommand() {
    showResearch();
    zoomIn();
    addSystemLog("Research Agent opened");
    refreshResearchPanel();
}

function openASACommand() {
    showASA();
    zoomIn();
    addSystemLog("ASA opened");
    refreshASAPanel();
}

function openPhysicsCommand() {
    showPhysics();
    zoomIn();
    addSystemLog("Physics simulation opened");
    refreshPhysicsPanel();
}

function toggleVoiceCommand() {

    toggleVoice();
}

function closeAllWindows() {

    closeWindow("projectsPanel");
    closeWindow("dashboardPanel");
    closeWindow("cameraPanel");
    closeWindow("chatPanel");
    closeWindow("viewerPanel");
    closeWindow("mapPanel");
    closeWindow("researchPanel");
    closeWindow("asaPanel");
    closeWindow("physicsPanel");

    // Camera and Voice stay alive in the background
    stopCamera(false);
    zoomOut();

    notify("Windows Closed");
    addSystemLog("All windows closed");
}

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeAllWindows();
    }
});

/* =====================================================
   TELEMETRY
===================================================== */

function startTelemetryLoop() {

    setInterval(() => {

        const fps = getFPS();
        window.jarvisFPS = fps;

        const uptimeSec =
            Math.floor((Date.now() - startTime) / 1000);

        feedTelemetry({ fps, uptimeSec });

    }, 1000);
}
