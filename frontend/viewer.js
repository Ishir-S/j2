/* =====================================================
   JARVIS - 3D VIEWER MODULE
   Real textures + live animation for every scene, plus a
   professional toolkit: multi-part STL import, an
   outliner, transform gizmo, orientation gizmo, wireframe/
   grid/lighting controls, and real hand-gesture + voice
   control over the scene.
===================================================== */

import * as THREE from "three";

import { GLTFLoader }
from "https://unpkg.com/three@0.165.0/examples/jsm/loaders/GLTFLoader.js";

import { STLLoader }
from "https://unpkg.com/three@0.165.0/examples/jsm/loaders/STLLoader.js";

import { OrbitControls }
from "https://unpkg.com/three@0.165.0/examples/jsm/controls/OrbitControls.js";

import { TransformControls }
from "https://unpkg.com/three@0.165.0/examples/jsm/controls/TransformControls.js";

import { addSystemLog, notify } from "./ui.js";
import { startHandTracking, onHandResult } from "./handTracking.js";

const PRIMARY_TEX_CDN = "https://threejs.org/examples/textures/";
const BACKUP_TEX_CDN = "https://cdn.jsdelivr.net/gh/mrdoob/three.js@master/examples/textures/";

const textureLoader = new THREE.TextureLoader();

function getLocalTexturePath(relativePath) {
    const map = {
        "lava/lavatile.jpg": "./assets/textures/sun_lava.jpg",
        "planets/earth_atmos_2048.jpg": "./assets/textures/earth.jpg",
        "planets/earth_lights_2048.png": "./assets/textures/earth_lights.png",
        "planets/earth_specular_2048.jpg": "./assets/textures/earth_specular.jpg",
        "planets/earth_normal_2048.jpg": "./assets/textures/earth_normal.jpg",
        "planets/moon_1024.jpg": "./assets/textures/moon.jpg"
    };
    return map[relativePath] || null;
}

function loadTextureWithFallback(relativePath, proceduralFallbackFn) {
    const fallbackCanvas = proceduralFallbackFn ? proceduralFallbackFn() : generateProceduralEarthCanvas();
    const texture = new THREE.CanvasTexture(fallbackCanvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;

    const localUrl = getLocalTexturePath(relativePath);
    const primaryUrl = localUrl || (PRIMARY_TEX_CDN + relativePath);
    const backupUrl = BACKUP_TEX_CDN + relativePath;

    textureLoader.load(
        primaryUrl,
        (loadedTex) => {
            texture.image = loadedTex.image;
            texture.needsUpdate = true;
        },
        undefined,
        () => {
            textureLoader.load(
                backupUrl,
                (bTex) => {
                    texture.image = bTex.image;
                    texture.needsUpdate = true;
                }
            );
        }
    );

    return texture;
}
const clock = new THREE.Clock();

let renderer;
let scene;
let camera;
let controls;
let transformControls;

let currentGroup = null;
let currentUpdate = null; // (elapsed, delta) => void, set per-scene
let initialized = false;

let defaultCameraPos = new THREE.Vector3(0, 2, 8);
let defaultTarget = new THREE.Vector3(0, 0, 0);

let wireframeOn = false;
let gridHelper = null;
let lightingPresetIndex = 0;
let sceneLights = {};

/* Multi-part STL/imported scene management */
let parts = []; // { id, name, mesh, visible }
let nextPartId = 1;
let selectedPart = null;
let raycaster, mouse;
let justFinishedDragging = false;

/* Axis orientation gizmo (small second renderer) */
let gizmoRenderer, gizmoScene, gizmoCamera;

/* Gesture control state */
let gestureVideo = null;
let gestureStream = null;
let gestureEnabled = false;
let lastGestureByHand = {};
let gestureDragOrigin = null;
let gestureOrbitState = null;

/* Voice control state */
let recognition = null;
let voiceEnabled = false;

/* =====================================================
   INIT
===================================================== */

export function initViewer() {

    document
        .getElementById("loadSolar")
        ?.addEventListener("click", () => loadScene(buildSolarSystem));

    document
        .getElementById("loadEarth")
        ?.addEventListener("click", () => loadScene(buildEarth));

    document
        .getElementById("loadMolecule")
        ?.addEventListener("click", () => loadScene(buildMolecule));

    document
        .getElementById("loadNeural")
        ?.addEventListener("click", () => loadScene(buildNeuralNetwork));

    document
        .getElementById("loadCustom")
        ?.addEventListener("click", () => {

            document.getElementById("modelFile")?.click();
        });

    document
        .getElementById("modelFile")
        ?.addEventListener("change", handleFileImport);

    document
        .getElementById("loadStlBtn")
        ?.addEventListener("click", () => {

            document.getElementById("stlFileInput")?.click();
        });

    document
        .getElementById("stlFileInput")
        ?.addEventListener("change", handleStlImport);

    document
        .getElementById("clearPartsBtn")
        ?.addEventListener("click", clearAllParts);

    document
        .getElementById("toggleWireframe")
        ?.addEventListener("click", toggleWireframe);

    document
        .getElementById("toggleGrid")
        ?.addEventListener("click", toggleGrid);

    document
        .getElementById("cycleLighting")
        ?.addEventListener("click", cycleLighting);

    document
        .getElementById("resetViewBtn")
        ?.addEventListener("click", resetView);

    document
        .getElementById("gestureControlToggle")
        ?.addEventListener("change", (e) => toggleGestureControl(e.target.checked));

    document
        .getElementById("voiceControlToggle")
        ?.addEventListener("change", (e) => toggleVoiceControl(e.target.checked));

    setupTabs();
}

function setupTabs() {

    document.querySelectorAll(".viewerTabBtn").forEach(btn => {

        btn.addEventListener("click", () => {

            document.querySelectorAll(".viewerTabBtn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".viewerTabPanel").forEach(p => p.classList.remove("active"));

            btn.classList.add("active");
            document.getElementById(`tab${capitalize(btn.dataset.tab)}`)?.classList.add("active");
        });
    });
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function ensureRenderer() {

    if (initialized) return;

    initialized = true;

    const canvas =
        document.getElementById("viewerCanvas");

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(
        60,
        (canvas.clientWidth || 1) / (canvas.clientHeight || 1),
        0.1,
        1000
    );

    camera.position.copy(defaultCameraPos);

    renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true
    });

    renderer.setPixelRatio(
        Math.min(window.devicePixelRatio, 2)
    );

    renderer.outputColorSpace = THREE.SRGBColorSpace;

    buildLights("studio");

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.copy(defaultTarget);

    transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.setMode("translate");
    transformControls.addEventListener("dragging-changed", (event) => {
        controls.enabled = !event.value;
        if (!event.value) justFinishedDragging = true;
    });
    scene.add(transformControls.getHelper ? transformControls.getHelper() : transformControls);

    gridHelper = new THREE.GridHelper(20, 20, 0x00ffff, 0x113344);
    gridHelper.visible = false;
    scene.add(gridHelper);

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    renderer.domElement.addEventListener("click", handleViewerClick);

    window.addEventListener("resize", resizeViewer);

    initAxisGizmo();

    resizeViewer();

    clock.start();
    animateViewer();
}

/* =====================================================
   LIGHTING PRESETS
===================================================== */

function buildLights(preset) {

    Object.values(sceneLights).forEach(light => scene.remove(light));
    sceneLights = {};

    if (preset === "studio") {

        sceneLights.ambient = new THREE.AmbientLight(0xffffff, 0.6);
        sceneLights.key = new THREE.PointLight(0x00ffff, 4, 100);
        sceneLights.key.position.set(5, 5, 5);
        sceneLights.fill = new THREE.PointLight(0xffffff, 1.5, 100);
        sceneLights.fill.position.set(-5, 2, -5);

    } else if (preset === "outdoor") {

        sceneLights.ambient = new THREE.HemisphereLight(0xbfd9ff, 0x554433, 1.1);
        sceneLights.key = new THREE.DirectionalLight(0xfff2cc, 1.6);
        sceneLights.key.position.set(8, 10, 6);

    } else { // dark / moody

        sceneLights.ambient = new THREE.AmbientLight(0x223344, 0.35);
        sceneLights.key = new THREE.PointLight(0x00ffff, 5, 60);
        sceneLights.key.position.set(3, 4, 3);
    }

    Object.values(sceneLights).forEach(light => scene.add(light));
}

function cycleLighting() {

    const presets = ["studio", "outdoor", "dark"];
    lightingPresetIndex = (lightingPresetIndex + 1) % presets.length;

    buildLights(presets[lightingPresetIndex]);
    notify(`Lighting: ${presets[lightingPresetIndex]}`);
}

/* =====================================================
   TOOLBAR ACTIONS
===================================================== */

function toggleWireframe() {

    wireframeOn = !wireframeOn;

    document.getElementById("toggleWireframe")?.classList.toggle("active", wireframeOn);

    applyWireframeToAll();
}

function applyWireframeToAll() {

    parts.forEach(p => setWireframeRecursive(p.mesh, wireframeOn));

    if (currentGroup) setWireframeRecursive(currentGroup, wireframeOn);
}

function setWireframeRecursive(object, on) {

    object.traverse(child => {

        if (child.material) {

            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach(m => { if ("wireframe" in m) m.wireframe = on; });
        }
    });
}

function toggleGrid() {

    if (!gridHelper) return;

    gridHelper.visible = !gridHelper.visible;
    document.getElementById("toggleGrid")?.classList.toggle("active", gridHelper.visible);
}

function resetView() {

    camera.position.copy(defaultCameraPos);
    controls.target.copy(defaultTarget);
    controls.update();
}

/* =====================================================
   AXIS ORIENTATION GIZMO (small, self-contained)
===================================================== */

function initAxisGizmo() {

    const canvas = document.getElementById("viewerAxisGizmo");
    if (!canvas) return;

    gizmoRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    gizmoRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    gizmoRenderer.setSize(canvas.clientWidth || 90, canvas.clientHeight || 90, false);

    gizmoScene = new THREE.Scene();

    gizmoCamera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);
    gizmoCamera.position.set(0, 0, 4);

    const axes = [
        { dir: [1, 0, 0], color: 0xff4444 },
        { dir: [0, 1, 0], color: 0x44ff66 },
        { dir: [0, 0, 1], color: 0x4488ff }
    ];

    axes.forEach(axis => {

        const points = [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(...axis.dir).multiplyScalar(1.1)
        ];

        const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(points),
            new THREE.LineBasicMaterial({ color: axis.color })
        );

        gizmoScene.add(line);

        const tip = new THREE.Mesh(
            new THREE.SphereGeometry(0.14, 12, 12),
            new THREE.MeshBasicMaterial({ color: axis.color })
        );

        tip.position.set(...axis.dir).multiplyScalar(1.1);
        gizmoScene.add(tip);
    });
}

function renderAxisGizmo() {

    if (!gizmoRenderer || !camera) return;

    // mirror the main camera's rotation so the gizmo always shows
    // the current viewing orientation, CAD-viewport style
    gizmoCamera.position.copy(camera.position).sub(controls.target).normalize().multiplyScalar(4);
    gizmoCamera.lookAt(0, 0, 0);

    gizmoRenderer.render(gizmoScene, gizmoCamera);
}

/* =====================================================
   RESIZE / ANIMATE
===================================================== */

function resizeViewer() {

    const canvas =
        document.getElementById("viewerCanvas");

    if (!canvas || !renderer) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (!width || !height) return;

    renderer.setSize(width, height, false);

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    const gizmoCanvas = document.getElementById("viewerAxisGizmo");

    if (gizmoRenderer && gizmoCanvas) {
        gizmoRenderer.setSize(gizmoCanvas.clientWidth || 90, gizmoCanvas.clientHeight || 90, false);
    }
}

function animateViewer() {

    requestAnimationFrame(animateViewer);

    const panel = document.getElementById("viewerPanel");
    if (!panel || !panel.classList.contains("active")) {
        return; // Skip rendering when viewer is closed
    }

    const elapsed = clock.getElapsedTime();
    const delta = clock.getDelta();

    if (currentUpdate) {

        currentUpdate(elapsed, delta);

    } else if (currentGroup) {

        // fallback for imported models with no custom animation
        currentGroup.rotation.y += 0.002;
    }

    controls?.update();

    updateGestureOrbit();

    renderer?.render(scene, camera);
    renderAxisGizmo();
}

/* =====================================================
   SCENE / PART CLEARING
===================================================== */

function clearScene() {

    if (currentGroup) {

        disposeGroup(currentGroup);
        scene.remove(currentGroup);
        currentGroup = null;
    }

    currentUpdate = null;

    clearAllParts();
}

function disposeGroup(group) {

    group.traverse(obj => {

        if (obj.geometry) obj.geometry.dispose();

        if (obj.material) {

            const materials = Array.isArray(obj.material) ? obj.material : [obj.material];

            materials.forEach(mat => {

                Object.values(mat).forEach(value => {

                    if (value && value.isTexture) value.dispose();
                });

                mat.dispose();
            });
        }
    });
}

export function loadSceneByName(name) {

    const builders = {
        solar: buildSolarSystem,
        earth: buildEarth,
        molecule: buildMolecule,
        neural: buildNeuralNetwork
    };

    const builder = builders[name];
    if (!builder) return false;

    loadScene(builder);
    return true;
}

function loadScene(builder) {

    ensureRenderer();

    // canvas may have been hidden (display:none) when sized, resize again
    resizeViewer();

    clearScene();

    const result = builder();

    currentGroup = result.group;
    currentUpdate = result.update || null;

    scene.add(currentGroup);
}
function makeCanvas(size = 256) {

    const canvas = document.createElement("canvas");
    canvas.width = size * 2;
    canvas.height = size;

    return canvas;
}

function canvasToTexture(canvas) {

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;

    return tex;
}

/** Rocky, cratered surface — Mercury / Mars-style */
function createRockyTexture(baseColor, craterColor, craterCount = 90) {

    const canvas = makeCanvas();
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < craterCount; i++) {

        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        const r = 2 + Math.random() * 10;

        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, craterColor);
        grad.addColorStop(1, "rgba(0,0,0,0)");

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    return canvasToTexture(canvas);
}

/** Turbulent horizontal bands — gas giants / Venus */
function createBandedTexture(colors) {

    const canvas = makeCanvas();
    const ctx = canvas.getContext("2d");

    const bandHeight = canvas.height / colors.length;

    colors.forEach((color, i) => {

        ctx.fillStyle = color;
        ctx.fillRect(0, i * bandHeight, canvas.width, bandHeight + 1);
    });

    // turbulence: scribble semi-transparent arcs across the bands
    for (let i = 0; i < 40; i++) {

        const y = Math.random() * canvas.height;
        const amp = 4 + Math.random() * 14;
        const color = colors[Math.floor(Math.random() * colors.length)];

        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = 1 + Math.random() * 3;

        ctx.beginPath();

        for (let x = 0; x <= canvas.width; x += 8) {

            const yy = y + Math.sin(x * 0.02 + i) * amp;

            if (x === 0) ctx.moveTo(x, yy);
            else ctx.lineTo(x, yy);
        }

        ctx.stroke();
    }

    ctx.globalAlpha = 1;

    return canvasToTexture(canvas);
}

/** Soft alpha cloud layer, used over Earth */
function createCloudTexture() {

    const canvas = makeCanvas();
    const ctx = canvas.getContext("2d");

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < 140; i++) {

        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        const r = 8 + Math.random() * 26;

        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, "rgba(255,255,255,0.65)");
        grad.addColorStop(1, "rgba(255,255,255,0)");

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;

    return tex;
}

/** Soft radial glow, used as a sprite map for neural nodes / pulses */
function createGlowTexture(hex = "#00ffff") {

    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;

    const ctx = canvas.getContext("2d");

    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.25, hex);
    grad.addColorStop(1, "rgba(0,0,0,0)");

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    return new THREE.CanvasTexture(canvas);
}

/** Saturn-style ring texture: concentric bands of varying opacity */
function createRingTexture() {

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 64;

    const ctx = canvas.getContext("2d");

    for (let x = 0; x < canvas.width; x++) {

        const t = x / canvas.width;
        const alpha = 0.15 + Math.abs(Math.sin(t * 40)) * 0.5 * (1 - Math.abs(t - 0.5) * 1.6);

        ctx.fillStyle = `rgba(210,190,150,${Math.max(0, alpha).toFixed(3)})`;
        ctx.fillRect(x, 0, 1, canvas.height);
    }

    return new THREE.CanvasTexture(canvas);
}

/** Procedural 2K Earth Surface (Oceans, Continents, Vegetation) */
function generateProceduralEarthCanvas() {
    const canvas = document.createElement("canvas");
    canvas.width = 2048;
    canvas.height = 1024;
    const ctx = canvas.getContext("2d");

    const oceanGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    oceanGrad.addColorStop(0, "#081d38");
    oceanGrad.addColorStop(0.5, "#0b2b54");
    oceanGrad.addColorStop(1, "#081d38");
    ctx.fillStyle = oceanGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const continents = [
        { x: 350, y: 300, rx: 220, ry: 150, color: "#2e5a27" },
        { x: 280, y: 220, rx: 180, ry: 120, color: "#3d6e32" },
        { x: 550, y: 650, rx: 110, ry: 200, color: "#285220" },
        { x: 1250, y: 280, rx: 380, ry: 170, color: "#3a602c" },
        { x: 1100, y: 240, rx: 140, ry: 90, color: "#487538" },
        { x: 1080, y: 520, rx: 160, ry: 210, color: "#8a7642" },
        { x: 1680, y: 700, rx: 130, ry: 90, color: "#a37a45" },
        { x: 680, y: 130, rx: 110, ry: 60, color: "#dbe8e8" },
        { x: 1024, y: 970, rx: 950, ry: 70, color: "#eef8ff" }
    ];

    continents.forEach(c => {
        ctx.fillStyle = c.color;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, c.rx, c.ry, Math.PI / 12, 0, Math.PI * 2);
        ctx.fill();
    });

    for (let i = 0; i < 2000; i++) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        const r = 2 + Math.random() * 14;
        ctx.fillStyle = Math.random() > 0.4 ? "rgba(40,80,30,0.25)" : "rgba(180,150,90,0.2)";
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    return canvas;
}

/** Procedural 2K Earth Night Lights Canvas */
function generateProceduralEarthLightsCanvas() {
    const canvas = document.createElement("canvas");
    canvas.width = 2048;
    canvas.height = 1024;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cityClusters = [
        { x: 420, y: 320, r: 40 }, { x: 320, y: 340, r: 35 }, { x: 380, y: 280, r: 25 },
        { x: 1060, y: 250, r: 60 }, { x: 1120, y: 270, r: 45 }, { x: 1020, y: 280, r: 35 },
        { x: 1450, y: 350, r: 65 }, { x: 1550, y: 320, r: 50 }, { x: 1620, y: 360, r: 40 },
        { x: 1320, y: 440, r: 55 }, { x: 1380, y: 480, r: 40 }, { x: 1100, y: 520, r: 30 }
    ];

    cityClusters.forEach(c => {
        const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r);
        grad.addColorStop(0, "rgba(255, 215, 120, 0.95)");
        grad.addColorStop(0.4, "rgba(255, 160, 50, 0.5)");
        grad.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        ctx.fill();
    });

    return canvas;
}

/** Procedural Sun Lava Texture Canvas */
function generateProceduralLavaCanvas() {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#cc3300";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < 800; i++) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        const r = 10 + Math.random() * 35;

        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, "rgba(255, 230, 100, 0.9)");
        grad.addColorStop(0.5, "rgba(255, 100, 0, 0.6)");
        grad.addColorStop(1, "rgba(100, 10, 0, 0)");

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    return canvas;
}

/** Procedural Moon Texture Canvas */
function generateProceduralMoonCanvas() {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#a0a0a0";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const maria = [
        { x: 300, y: 200, rx: 120, ry: 90 },
        { x: 450, y: 220, rx: 140, ry: 100 },
        { x: 600, y: 260, rx: 90, ry: 70 }
    ];
    maria.forEach(m => {
        ctx.fillStyle = "#585858";
        ctx.beginPath();
        ctx.ellipse(m.x, m.y, m.rx, m.ry, 0, 0, Math.PI * 2);
        ctx.fill();
    });

    return canvas;
}

/* =====================================================
   SOLAR SYSTEM
===================================================== */

function buildSolarSystem() {

    const group = new THREE.Group();

    // 1. Sun Mesh & Emissive Atmosphere
    const lavaTex = loadTextureWithFallback("lava/lavatile.jpg", generateProceduralLavaCanvas);
    lavaTex.wrapS = lavaTex.wrapT = THREE.RepeatWrapping;

    const sun = new THREE.Mesh(
        new THREE.SphereGeometry(0.65, 48, 48),
        new THREE.MeshBasicMaterial({ map: lavaTex, color: 0xffea88 })
    );
    group.add(sun);

    // SCIENTIFIC LIGHTING: Real solar radiation point light originating from (0,0,0) inside Sun
    const sunLight = new THREE.PointLight(0xfffaed, 5.0, 150, 0.4);
    sunLight.position.set(0, 0, 0);
    group.add(sunLight);

    // Soft solar corona aura
    const sunGlow = new THREE.Mesh(
        new THREE.SphereGeometry(0.78, 32, 32),
        new THREE.MeshBasicMaterial({
            color: 0xffaa33,
            transparent: true,
            opacity: 0.22,
            side: THREE.BackSide
        })
    );
    group.add(sunGlow);

    // Deep space minimal ambient fill (starlight) - ensures dark scientific day/night terminators on planets
    const spaceAmbient = new THREE.AmbientLight(0x060c18, 0.08);
    group.add(spaceAmbient);

    // 2. All 8 Planets (NASA Textures + Procedural Canvas Fallbacks)
    const planetDefs = [
        {
            name: "Mercury",
            r: 0.09, dist: 1.15, speed: 1.6, spin: 0.4,
            texPath: "planets/mercury.jpg",
            fallback: () => createRockyTexture("#88827a", "#4a4640", 120)
        },
        {
            name: "Venus",
            r: 0.14, dist: 1.6, speed: 1.17, spin: 0.2,
            texPath: "planets/venus_atmosphere.jpg",
            fallback: () => createBandedTexture(["#e6c280", "#d4a359", "#f5db9e", "#c28c46"])
        },
        {
            name: "Earth",
            r: 0.15, dist: 2.15, speed: 1.0, spin: 1.0,
            texPath: "planets/earth_atmos_2048.jpg",
            fallback: generateProceduralEarthCanvas,
            hasMoon: true
        },
        {
            name: "Mars",
            r: 0.11, dist: 2.7, speed: 0.8, spin: 0.95,
            texPath: "planets/mars.jpg",
            fallback: () => createRockyTexture("#b84c2a", "#782810", 110)
        },
        {
            name: "Jupiter",
            r: 0.35, dist: 3.5, speed: 0.43, spin: 2.4,
            texPath: "planets/jupiter.jpg",
            fallback: () => createBandedTexture(["#c89e74", "#b07e54", "#dcb28a", "#9a623a", "#e8c8a8"])
        },
        {
            name: "Saturn",
            r: 0.28, dist: 4.6, speed: 0.32, spin: 2.2,
            texPath: "planets/saturn.jpg",
            fallback: () => createBandedTexture(["#d4be8d", "#bfa872", "#e6d3a5", "#a89058"]),
            hasRing: true,
            ringInner: 0.38, ringOuter: 0.65
        },
        {
            name: "Uranus",
            r: 0.21, dist: 5.5, speed: 0.23, spin: 1.4,
            texPath: "planets/uranus.jpg",
            fallback: () => createBandedTexture(["#7de3e3", "#5bc4c4", "#99f0f0", "#4ca8a8"]),
            hasRing: true,
            ringInner: 0.28, ringOuter: 0.40
        },
        {
            name: "Neptune",
            r: 0.20, dist: 6.4, speed: 0.18, spin: 1.5,
            texPath: "planets/neptune.jpg",
            fallback: () => createBandedTexture(["#2746ab", "#193187", "#3b5ed9", "#112266"])
        }
    ];

    const planets = planetDefs.map(def => {

        const planetTex = loadTextureWithFallback(def.texPath, def.fallback);

        const planet = new THREE.Mesh(
            new THREE.SphereGeometry(def.r, 32, 32),
            new THREE.MeshStandardMaterial({
                map: planetTex,
                roughness: 0.85,
                metalness: 0.05
            })
        );

        planet.position.x = def.dist;

        const pivot = new THREE.Group();
        pivot.add(planet);

        // Add Moon if Earth
        if (def.hasMoon) {
            const moonPivot = new THREE.Group();
            moonPivot.position.x = def.dist;

            const moonTex = loadTextureWithFallback("planets/moon_1024.jpg", generateProceduralMoonCanvas);
            const moon = new THREE.Mesh(
                new THREE.SphereGeometry(0.04, 16, 16),
                new THREE.MeshStandardMaterial({ map: moonTex, roughness: 0.9 })
            );
            moon.position.x = 0.32;
            moonPivot.add(moon);
            pivot.add(moonPivot);
            def.moonPivot = moonPivot;
        }

        // Add Rings if Saturn or Uranus
        if (def.hasRing) {
            const ringGeom = new THREE.RingGeometry(def.ringInner, def.ringOuter, 64);
            const ringMat = new THREE.MeshBasicMaterial({
                map: createRingTexture(),
                transparent: true,
                side: THREE.DoubleSide
            });
            const ring = new THREE.Mesh(ringGeom, ringMat);
            ring.rotation.x = Math.PI / 2.4;
            ring.position.x = def.dist;
            pivot.add(ring);
        }

        group.add(pivot);

        // Orbit trajectory line
        const orbitPoints = [];
        for (let i = 0; i <= 128; i++) {
            const angle = (i / 128) * Math.PI * 2;
            orbitPoints.push(new THREE.Vector3(
                Math.cos(angle) * def.dist,
                0,
                Math.sin(angle) * def.dist
            ));
        }

        const orbit = new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(orbitPoints),
            new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.18 })
        );
        group.add(orbit);

        return { ...def, mesh: planet, pivot };
    });

    // Starfield backdrop
    group.add(buildStarfield());

    const update = (elapsed) => {

        sun.rotation.y = elapsed * 0.05;
        if (lavaTex.offset) lavaTex.offset.x = elapsed * 0.02;

        sunGlow.scale.setScalar(1 + Math.sin(elapsed * 1.5) * 0.03);

        planets.forEach(p => {
            p.pivot.rotation.y = elapsed * p.speed * 0.3;
            p.mesh.rotation.y = elapsed * p.spin;
            if (p.moonPivot) p.moonPivot.rotation.y = elapsed * 2.5;
        });

        group.rotation.y += 0.0002;
    };

    return { group, update };
}

/* =====================================================
   EARTH (detailed, real satellite imagery with fallback)
===================================================== */

function buildEarth() {

    const group = new THREE.Group();

    const earthGeom = new THREE.SphereGeometry(1.5, 64, 64);

    const earth = new THREE.Mesh(
        earthGeom,
        new THREE.MeshPhongMaterial({
            map: loadTextureWithFallback("planets/earth_atmos_2048.jpg", generateProceduralEarthCanvas),
            specularMap: loadTextureWithFallback("planets/earth_specular_2048.jpg", generateProceduralEarthCanvas),
            bumpMap: loadTextureWithFallback("planets/earth_normal_2048.jpg", generateProceduralEarthCanvas),
            bumpScale: 0.04,
            emissiveMap: loadTextureWithFallback("planets/earth_lights_2048.png", generateProceduralEarthLightsCanvas),
            emissive: new THREE.Color(0xffffaa),
            emissiveIntensity: 1.4,
            specular: new THREE.Color(0x333333),
            shininess: 8
        })
    );

    earth.rotation.z = THREE.MathUtils.degToRad(23.4); // axial tilt
    group.add(earth);

    const clouds = new THREE.Mesh(
        new THREE.SphereGeometry(1.52, 64, 64),
        new THREE.MeshLambertMaterial({
            map: canvasToTexture(createCloudTexture()),
            transparent: true,
            opacity: 0.55,
            depthWrite: false
        })
    );

    clouds.rotation.z = earth.rotation.z;
    group.add(clouds);

    const atmosphere = new THREE.Mesh(
        new THREE.SphereGeometry(1.58, 48, 48),
        new THREE.MeshBasicMaterial({
            color: 0x00aaff,
            transparent: true,
            opacity: 0.12,
            side: THREE.BackSide
        })
    );

    group.add(atmosphere);

    // Moon, orbiting
    const moonPivot = new THREE.Group();

    const moon = new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 32, 32),
        new THREE.MeshStandardMaterial({
            map: loadTextureWithFallback("planets/moon_1024.jpg", generateProceduralMoonCanvas),
            roughness: 1
        })
    );

    moon.position.set(3.4, 0, 0);
    moonPivot.add(moon);
    group.add(moonPivot);

    const moonOrbitPoints = [];

    for (let i = 0; i <= 96; i++) {

        const angle = (i / 96) * Math.PI * 2;

        moonOrbitPoints.push(new THREE.Vector3(
            Math.cos(angle) * 3.4, 0, Math.sin(angle) * 3.4
        ));
    }

    group.add(new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(moonOrbitPoints),
        new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.2 })
    ));

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.4);
    sunLight.position.set(6, 2, 4);
    group.add(sunLight);

    const update = (elapsed) => {

        earth.rotation.y = elapsed * 0.12;
        clouds.rotation.y = elapsed * 0.16;
        moonPivot.rotation.y = elapsed * 0.06;
        moon.rotation.y = elapsed * 0.05;
    };

    return { group, update };
}

/* =====================================================
   MOLECULE (gentle vibration, matcap-shaded atoms)
===================================================== */

function buildMolecule() {

    const group = new THREE.Group();

    const basePositions = [
        [0, 0, 0],
        [1, 0.5, 0],
        [-1, 0.5, 0],
        [0, -1, 0.6],
        [0, -1, -0.6]
    ];

    const matcap = textureLoader.load(TEX_BASE + "matcaps/matcap-porcelain-white.jpg");

    const atomColors = [0x00ffff, 0xffffff, 0xffffff, 0xff8844, 0xff8844];

    const atomGeom = new THREE.SphereGeometry(0.25, 32, 32);

    const atoms = basePositions.map((pos, i) => {

        const atom = new THREE.Mesh(
            atomGeom,
            new THREE.MeshMatcapMaterial({
                matcap,
                color: atomColors[i]
            })
        );

        atom.position.set(...pos);
        atom.userData.base = new THREE.Vector3(...pos);
        atom.userData.phase = Math.random() * Math.PI * 2;

        group.add(atom);

        return atom;
    });

    const bondMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
    const bonds = [];

    for (let i = 1; i < atoms.length; i++) {

        const geom = new THREE.BufferGeometry()
            .setFromPoints([atoms[0].position, atoms[i].position]);

        const line = new THREE.Line(geom, bondMat);

        group.add(line);
        bonds.push({ line, a: atoms[0], b: atoms[i] });
    }

    const update = (elapsed) => {

        atoms.forEach(atom => {

            const wobble = Math.sin(elapsed * 2 + atom.userData.phase) * 0.05;

            atom.position.copy(atom.userData.base);
            atom.position.x += wobble;
            atom.position.y += Math.cos(elapsed * 2.3 + atom.userData.phase) * 0.05;
        });

        bonds.forEach(bond => {

            const positions = bond.line.geometry.attributes.position;

            positions.setXYZ(0, bond.a.position.x, bond.a.position.y, bond.a.position.z);
            positions.setXYZ(1, bond.b.position.x, bond.b.position.y, bond.b.position.z);

            positions.needsUpdate = true;
        });

        group.rotation.y = elapsed * 0.15;
    };

    return { group, update };
}

/* =====================================================
   NEURAL NETWORK (glowing nodes + traveling signal pulses)
===================================================== */

function buildNeuralNetwork() {

    const group = new THREE.Group();

    const layers = [4, 6, 6, 2];
    const layerSpacing = 1.8;

    const glowTex = createGlowTexture("#00ffff");

    const layerNodes = [];

    layers.forEach((count, li) => {

        const nodes = [];

        for (let i = 0; i < count; i++) {

            const position = new THREE.Vector3(
                li * layerSpacing - ((layers.length - 1) * layerSpacing) / 2,
                i - (count - 1) / 2,
                0
            );

            const core = new THREE.Mesh(
                new THREE.SphereGeometry(0.08, 16, 16),
                new THREE.MeshBasicMaterial({ color: 0x00ffff })
            );

            core.position.copy(position);
            group.add(core);

            const glow = new THREE.Sprite(
                new THREE.SpriteMaterial({
                    map: glowTex,
                    color: 0x00ffff,
                    transparent: true,
                    opacity: 0.8,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false
                })
            );

            glow.scale.setScalar(0.5);
            glow.position.copy(position);
            group.add(glow);

            nodes.push({ core, glow, position, phase: Math.random() * Math.PI * 2 });
        }

        layerNodes.push(nodes);
    });

    const lineMat = new THREE.LineBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.15
    });

    const edges = [];

    for (let l = 0; l < layerNodes.length - 1; l++) {

        layerNodes[l].forEach(a => {

            layerNodes[l + 1].forEach(b => {

                const geom = new THREE.BufferGeometry()
                    .setFromPoints([a.position, b.position]);

                group.add(new THREE.Line(geom, lineMat));

                edges.push([a.position, b.position]);
            });
        });
    }

    // traveling signal pulses along random edges
    const pulseTex = createGlowTexture("#ffffff");
    const pulseCount = 14;

    const pulses = Array.from({ length: pulseCount }, () => {

        const sprite = new THREE.Sprite(
            new THREE.SpriteMaterial({
                map: pulseTex,
                color: 0x66ffff,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            })
        );

        sprite.scale.setScalar(0.18);
        group.add(sprite);

        return {
            sprite,
            edge: edges[Math.floor(Math.random() * edges.length)],
            t: Math.random(),
            speed: 0.4 + Math.random() * 0.5
        };
    });

    const allNodes = layerNodes.flat();

    const update = (elapsed, delta) => {

        allNodes.forEach(node => {

            const pulseScale = 1 + Math.sin(elapsed * 3 + node.phase) * 0.35;

            node.glow.scale.setScalar(0.5 * pulseScale);
            node.core.scale.setScalar(pulseScale);
        });

        pulses.forEach(pulse => {

            pulse.t += delta * pulse.speed;

            if (pulse.t >= 1) {

                pulse.t = 0;
                pulse.edge = edges[Math.floor(Math.random() * edges.length)];
            }

            pulse.sprite.position.lerpVectors(pulse.edge[0], pulse.edge[1], pulse.t);
        });

        group.rotation.y = Math.sin(elapsed * 0.15) * 0.15;
    };

    return { group, update };
}

/* =====================================================
   SHARED STARFIELD
===================================================== */

function buildStarfield() {

    const count = 1200;
    const positions = [];

    for (let i = 0; i < count; i++) {

        positions.push(
            (Math.random() - 0.5) * 40,
            (Math.random() - 0.5) * 40,
            (Math.random() - 0.5) * 40
        );
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

    return new THREE.Points(
        geom,
        new THREE.PointsMaterial({ color: 0xffffff, size: 0.02 })
    );
}


/* =====================================================
   GLTF / GLB IMPORT (single model, same slot as scenes)
===================================================== */

function handleFileImport(event) {

    const file = event.target.files[0];

    if (!file) return;

    ensureRenderer();
    resizeViewer();

    const url = URL.createObjectURL(file);
    const loader = new GLTFLoader();

    loader.load(
        url,
        (gltf) => {

            clearScene();

            currentGroup = new THREE.Group();
            currentGroup.add(gltf.scene);

            currentUpdate = (elapsed) => {
                currentGroup.rotation.y = elapsed * 0.2;
            };

            scene.add(currentGroup);

            URL.revokeObjectURL(url);

            notify(`Imported ${file.name}`);
        },
        undefined,
        (error) => {

            console.error("Model load error:", error);

            alert("Failed to load model. Please check the file and try again.");

            URL.revokeObjectURL(url);
        }
    );

    event.target.value = "";
}

/* =====================================================
   MULTI-PART STL IMPORT
   Every selected file becomes its own named, selectable
   part in the same scene — layer as many as you like.
===================================================== */

function handleStlImport(event) {

    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    ensureRenderer();
    resizeViewer();

    // demo scenes / GLTF live in a different "mode" — starting a
    // multi-part STL session clears them, but NOT previously loaded parts
    if (currentGroup) {

        disposeGroup(currentGroup);
        scene.remove(currentGroup);
        currentGroup = null;
        currentUpdate = null;
    }

    const loader = new STLLoader();
    const colors = [0x00c8c8, 0xff9933, 0x9966ff, 0x4dffb8, 0xff5588, 0xffcc44];

    files.forEach((file, i) => {

        const url = URL.createObjectURL(file);

        loader.load(
            url,
            (geometry) => {

                geometry.computeVertexNormals();
                geometry.center();

                const material = new THREE.MeshStandardMaterial({
                    color: colors[(nextPartId + i) % colors.length],
                    roughness: 0.5,
                    metalness: 0.15,
                    wireframe: wireframeOn
                });

                const mesh = new THREE.Mesh(geometry, material);

                // stagger multiple parts so they don't all land exactly on top of each other
                mesh.position.x = (parts.length % 4) * 0.02;

                scene.add(mesh);

                const name = file.name.replace(/\.stl$/i, "");

                addPart({ name, mesh });

                URL.revokeObjectURL(url);
            },
            undefined,
            (error) => {

                console.error("STL load error:", error);
                notify(`Failed to load ${file.name}`);
                URL.revokeObjectURL(url);
            }
        );
    });

    event.target.value = "";
}

function addPart({ name, mesh }) {

    const part = { id: nextPartId++, name, mesh, visible: true };

    parts.push(part);
    renderOutliner();

    addSystemLog(`3D Viewer: loaded part "${name}"`);
}

function clearAllParts() {

    parts.forEach(p => {

        scene?.remove(p.mesh);

        if (p.mesh.geometry) p.mesh.geometry.dispose();
        if (p.mesh.material) p.mesh.material.dispose();
    });

    parts = [];
    deselectPart();
    renderOutliner();
}

/* =====================================================
   OUTLINER (part list — select / show-hide / delete)
===================================================== */

function renderOutliner() {

    const container = document.getElementById("partsOutliner");
    if (!container) return;

    container.innerHTML = "";

    if (!parts.length) {

        container.innerHTML = `<div class="viewerHint">No parts loaded yet.</div>`;
        return;
    }

    parts.forEach(part => {

        const row = document.createElement("div");
        row.className = `outlinerRow${part === selectedPart ? " selected" : ""}${part.visible ? "" : " hiddenPart"}`;

        const name = document.createElement("span");
        name.className = "outlinerRowName";
        name.textContent = part.name;
        name.addEventListener("click", () => selectPart(part));

        const visBtn = document.createElement("button");
        visBtn.className = "outlinerVisBtn";
        visBtn.textContent = part.visible ? "👁" : "🚫";
        visBtn.title = "Toggle visibility";
        visBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            setPartVisible(part, !part.visible);
        });

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "outlinerDeleteBtn";
        deleteBtn.textContent = "✕";
        deleteBtn.title = "Delete part";
        deleteBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            deletePart(part);
        });

        row.appendChild(name);
        row.appendChild(visBtn);
        row.appendChild(deleteBtn);

        container.appendChild(row);
    });
}

function setPartVisible(part, visible) {

    part.visible = visible;
    part.mesh.visible = visible;

    renderOutliner();
}

function deletePart(part) {

    scene?.remove(part.mesh);

    if (part.mesh.geometry) part.mesh.geometry.dispose();
    if (part.mesh.material) part.mesh.material.dispose();

    parts = parts.filter(p => p !== part);

    if (selectedPart === part) deselectPart();

    renderOutliner();
}

/* =====================================================
   SELECTION (click, gesture, or voice — same code path)
===================================================== */

function handleViewerClick(event) {

    if (justFinishedDragging) {
        justFinishedDragging = false;
        return;
    }

    if (!parts.length) return;

    const rect = renderer.domElement.getBoundingClientRect();

    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const meshes = parts.filter(p => p.visible).map(p => p.mesh);
    const hits = raycaster.intersectObjects(meshes);

    if (!hits.length) return;

    const part = parts.find(p => p.mesh === hits[0].object);
    if (part) selectPart(part);
}

function selectPart(part) {

    if (selectedPart) unhighlightPart(selectedPart);

    selectedPart = part;
    highlightPart(part);

    transformControls.attach(part.mesh);

    updateInfoBox(part);
    renderOutliner();
}

export function selectPartByName(query) {

    if (!parts.length) return false;

    const match = fuzzyFindPart(query);
    if (!match) return false;

    if (!match.visible) setPartVisible(match, true);

    selectPart(match);
    notify(`Selected "${match.name}"`);
    return true;
}

export function hidePartByName(query) {

    const match = fuzzyFindPart(query);
    if (!match) return false;

    setPartVisible(match, false);
    if (selectedPart === match) deselectPart();

    notify(`Hid "${match.name}"`);
    return true;
}

export function showPartByName(query) {

    const match = fuzzyFindPart(query);
    if (!match) return false;

    setPartVisible(match, true);
    notify(`Showing "${match.name}"`);
    return true;
}

export function showAllParts() {

    parts.forEach(p => setPartVisible(p, true));
    notify("All parts visible");
}

function fuzzyFindPart(query) {

    if (!query) return null;

    const normalized = query.toLowerCase().trim();

    let best = null;
    let bestScore = 0;

    parts.forEach(part => {

        const name = part.name.toLowerCase();

        let score = 0;

        if (name === normalized) score = 100;
        else if (name.includes(normalized) || normalized.includes(name)) score = 60;
        else {

            const queryWords = normalized.split(/\s+/);
            const nameWords = name.split(/[\s_-]+/);

            score = queryWords.filter(w => nameWords.some(nw => nw.includes(w) || w.includes(nw))).length * 20;
        }

        if (score > bestScore) {
            bestScore = score;
            best = part;
        }
    });

    return bestScore > 0 ? best : null;
}

function deselectPart() {

    if (selectedPart) unhighlightPart(selectedPart);

    selectedPart = null;
    transformControls.detach();

    document.getElementById("viewerInfoBox")?.classList.add("hidden");
    renderOutliner();
}

function highlightPart(part) {

    const materials = Array.isArray(part.mesh.material) ? part.mesh.material : [part.mesh.material];

    materials.forEach(m => {
        part.mesh.userData._origEmissive = m.emissive?.getHex();
        m.emissive?.setHex(0x00ffff);
    });
}

function unhighlightPart(part) {

    const materials = Array.isArray(part.mesh.material) ? part.mesh.material : [part.mesh.material];

    materials.forEach(m => {
        if (part.mesh.userData._origEmissive !== undefined) {
            m.emissive?.setHex(part.mesh.userData._origEmissive);
        }
    });
}

function updateInfoBox(part) {

    const box = document.getElementById("viewerInfoBox");
    if (!box) return;

    box.classList.remove("hidden");

    const bbox = new THREE.Box3().setFromObject(part.mesh);
    const size = new THREE.Vector3();
    bbox.getSize(size);

    const triCount = part.mesh.geometry.index
        ? part.mesh.geometry.index.count / 3
        : part.mesh.geometry.attributes.position.count / 3;

    document.getElementById("viewerInfoName").textContent = part.name;
    document.getElementById("viewerInfoDims").textContent =
        `Size: ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}`;
    document.getElementById("viewerInfoTris").textContent =
        `Triangles: ${Math.round(triCount).toLocaleString()}`;
}

/* =====================================================
   HAND GESTURE CONTROL
   Reuses the same MediaPipe tracker as the Camera panel,
   but with its own independent webcam feed so the two
   panels don't have to be open together.
===================================================== */

async function toggleGestureControl(enabled) {

    gestureEnabled = enabled;

    if (!enabled) {

        gestureStream?.getTracks().forEach(t => t.stop());
        gestureStream = null;

        document.getElementById("viewerGestureReadout")?.classList.add("hidden");
        return;
    }

    try {

        gestureVideo = document.createElement("video");
        gestureVideo.playsInline = true;
        gestureVideo.muted = true;

        gestureStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        gestureVideo.srcObject = gestureStream;
        await gestureVideo.play();

        await startHandTracking(gestureVideo);

        onHandResult(handleGestureResults);

        document.getElementById("viewerGestureReadout")?.classList.remove("hidden");
        notify("Gesture control active — pinch to orbit, fist to select, open palm to deselect");
        addSystemLog("3D Viewer: gesture control enabled");

    } catch (err) {

        console.error(err);
        notify("Couldn't access the camera for gesture control");

        const toggle = document.getElementById("gestureControlToggle");
        if (toggle) toggle.checked = false;

        gestureEnabled = false;
    }
}

function handleGestureResults(hands) {

    if (!gestureEnabled || !hands.length) {

        gestureDragOrigin = null;
        gestureOrbitState = null;
        return;
    }

    const hand = hands[0];
    const handId = hand.handedness;

    const readout = document.getElementById("viewerGestureReadout");
    if (readout) readout.textContent = `${handId}: ${hand.gesture.replace("_", " ").toUpperCase()}`;

    const prevGesture = lastGestureByHand[handId];

    // edge-triggered actions (fire once per transition, not every frame)
    if (hand.gesture === "fist" && prevGesture !== "fist") {

        raycastFromCenter();
    }

    if (hand.gesture === "open_palm" && prevGesture !== "open_palm") {

        deselectPart();
    }

    // continuous drag/orbit while pinching
    if (hand.gesture === "pinch") {

        const center = { x: hand.landmarks[8].x, y: hand.landmarks[8].y };

        if (!gestureDragOrigin) {

            gestureDragOrigin = center;

        } else {

            const dx = center.x - gestureDragOrigin.x;
            const dy = center.y - gestureDragOrigin.y;

            if (selectedPart) {

                selectedPart.mesh.position.x += dx * 3;
                selectedPart.mesh.position.y -= dy * 3;

            } else {

                gestureOrbitState = { dx: dx * 4, dy: dy * 4 };
            }

            gestureDragOrigin = center;
        }

    } else {

        gestureDragOrigin = null;
    }

    lastGestureByHand[handId] = hand.gesture;
}

function raycastFromCenter() {

    if (!parts.length) return;

    raycaster.setFromCamera({ x: 0, y: 0 }, camera);

    const meshes = parts.filter(p => p.visible).map(p => p.mesh);
    const hits = raycaster.intersectObjects(meshes);

    if (!hits.length) return;

    const part = parts.find(p => p.mesh === hits[0].object);
    if (part) selectPart(part);
}

function updateGestureOrbit() {

    if (!gestureOrbitState || !controls) return;

    const spherical = new THREE.Spherical().setFromVector3(
        camera.position.clone().sub(controls.target)
    );

    spherical.theta -= gestureOrbitState.dx;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi - gestureOrbitState.dy, 0.1, Math.PI - 0.1);

    camera.position.setFromSpherical(spherical).add(controls.target);
    camera.lookAt(controls.target);

    gestureOrbitState = null;
}

/* =====================================================
   VOICE CONTROL (Web Speech API)
===================================================== */

function toggleVoiceControl(enabled) {

    voiceEnabled = enabled;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!enabled) {

        recognition?.stop();
        return;
    }

    if (!SpeechRecognition) {

        notify("Voice recognition isn't supported in this browser (try Chrome or Edge)");

        const toggle = document.getElementById("voiceControlToggle");
        if (toggle) toggle.checked = false;

        voiceEnabled = false;
        return;
    }

    if (!recognition) {

        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-US";

        recognition.onresult = handleVoiceResult;

        recognition.onerror = (event) => {
            console.warn("Speech recognition error:", event.error);
        };

        recognition.onend = () => {
            if (voiceEnabled) recognition.start(); // auto-restart while enabled
        };
    }

    recognition.start();
    addSystemLog("3D Viewer: voice control enabled");
}

function handleVoiceResult(event) {

    let transcript = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
    }

    const transcriptEl = document.getElementById("voiceTranscript");
    if (transcriptEl) transcriptEl.textContent = transcript;

    const isFinal = event.results[event.results.length - 1].isFinal;
    if (!isFinal) return;

    runVoiceCommand(transcript.trim().toLowerCase());
}

function runVoiceCommand(text) {

    if (!text) return;

    let match;

    if ((match = text.match(/select (the )?(.+)/))) {

        selectPartByName(match[2]);
        return;
    }

    if (text.match(/show all|show everything/)) {

        showAllParts();
        return;
    }

    if ((match = text.match(/hide (the )?(.+)/))) {

        hidePartByName(match[2]);
        return;
    }

    if ((match = text.match(/show (the )?(.+)/))) {

        showPartByName(match[2]);
        return;
    }

    if (text.match(/deselect|unselect/)) {

        deselectPart();
        return;
    }

    if (text.match(/wireframe on/)) {

        if (!wireframeOn) toggleWireframe();
        return;
    }

    if (text.match(/wireframe off/)) {

        if (wireframeOn) toggleWireframe();
        return;
    }

    if (text.match(/reset( the)? view|reset camera/)) {

        resetView();
        return;
    }
}
