import * as THREE
from "https://unpkg.com/three@0.165.0/build/three.module.js";

import { EffectComposer }
from "https://unpkg.com/three@0.165.0/examples/jsm/postprocessing/EffectComposer.js";

import { RenderPass }
from "https://unpkg.com/three@0.165.0/examples/jsm/postprocessing/RenderPass.js";

import { UnrealBloomPass }
from "https://unpkg.com/three@0.165.0/examples/jsm/postprocessing/UnrealBloomPass.js";

/* =====================================================
   CORE
===================================================== */

let scene;
let camera;
let renderer;
let composer;

let neuralGroup;
let nodeGroup;

let raycaster;
let mouse;

let animationClock;

let targetScale = 1;
const scaleVector = new THREE.Vector3();

let cameraHome;
let cameraFocus;

const clickableObjects = [];
const nodeEntries = []; // { key, label, mesh, callback }

let hoveredEntry = null;
let tooltipEl = null;

/* =====================================================
   NODE DEFINITIONS
   Every JARVIS feature lives here as a point on the
   sphere. Positions are spread evenly using a Fibonacci
   sphere distribution so they never overlap.
===================================================== */

const NODE_KEYS = [
    { key: "dashboard", label: "SYSTEM STATUS" },
    { key: "camera", label: "LIVE CAMERA" },
    { key: "voice", label: "VOICE ENGINE" },
    { key: "chat", label: "JARVIS" },
    { key: "viewer", label: "3D VIEWER" },
    { key: "map", label: "GLOBAL MAP" },
    { key: "research", label: "RESEARCH AGENT" },
    { key: "asa", label: "SOLUTION ARCHITECT" },
    { key: "physics", label: "PHYSICS LAB" },
    { key: "projects", label: "PROJECT ARCHIVE" }
];

/* =====================================================
   INIT
===================================================== */

export function initScene(canvas) {

    scene = new THREE.Scene();

    animationClock = new THREE.Clock();

    camera = new THREE.PerspectiveCamera(
        65,
        window.innerWidth / window.innerHeight,
        0.1,
        1000
    );

    cameraHome = new THREE.Vector3(0, 0, 7);
    cameraFocus = cameraHome.clone();
    camera.position.copy(cameraHome);

    renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true
    });

    renderer.setPixelRatio(
        Math.min(window.devicePixelRatio, 1.25)
    );

    renderer.setSize(
        window.innerWidth,
        window.innerHeight
    );

    renderer.outputColorSpace =
        THREE.SRGBColorSpace;

    createBloom();
    createLights();
    createNeuralSphere();
    createInteractiveNodes();
    createBackgroundParticles();
    createTooltip();

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("resize", handleResize);

    document.addEventListener("eco-mode-change", (e) => {
        if (e.detail?.sleeping) {
            pauseScene();
        } else {
            resumeScene();
        }
    });

    animate();
}

/* =====================================================
   BLOOM
===================================================== */

function createBloom() {

    composer = new EffectComposer(renderer);

    const renderPass =
        new RenderPass(scene, camera);

    composer.addPass(renderPass);

    // Optimized bloom pass for high frame rates and low GPU power
    const bloomPass =
        new UnrealBloomPass(
            new THREE.Vector2(
                window.innerWidth / 2,
                window.innerHeight / 2
            ),
            0.9,
            0.3,
            0.85
        );

    bloomPass.threshold = 0.05;
    bloomPass.strength = 1.0;
    bloomPass.radius = 0.35;

    composer.addPass(bloomPass);
}

/* =====================================================
   LIGHTS
===================================================== */

function createLights() {

    const ambient =
        new THREE.AmbientLight(
            0x00ffff,
            0.7
        );

    scene.add(ambient);

    const point =
        new THREE.PointLight(
            0x00ffff,
            8,
            50
        );

    point.position.set(
        0,
        0,
        8
    );

    scene.add(point);
}

let neuralNodeMeshes = [];
let connectionLineSegments = null;
let totalLinePairs = [];
let currentWinkIndex = 0;
let isWinkingComplete = false;

/* =====================================================
   NEURAL SPHERE
===================================================== */

function createNeuralSphere() {

    neuralGroup = new THREE.Group();
    scene.add(neuralGroup);

    const material = new THREE.MeshBasicMaterial({ color: 0x00ffff });
    const geometry = new THREE.SphereGeometry(0.035, 8, 8);
    const points = [];
    neuralNodeMeshes = [];

    for (let i = 0; i < 500; i++) {

        const phi = Math.acos(-1 + (2 * i) / 500);
        const theta = Math.sqrt(800 * Math.PI) * phi;

        const x = Math.cos(theta) * Math.sin(phi);
        const y = Math.sin(theta) * Math.sin(phi);
        const z = Math.cos(phi);

        const node = new THREE.Mesh(geometry, material.clone());
        node.position.set(x * 2.2, y * 2.2, z * 2.2);

        // Start hidden at scale 0 for node-by-node winking
        node.scale.set(0, 0, 0);
        node.userData = {
            index: i,
            wunk: false,
            winkTime: 0
        };

        neuralGroup.add(node);
        neuralNodeMeshes.push(node);

        points.push(new THREE.Vector3(x * 2.2, y * 2.2, z * 2.2));
    }

    createConnections(points);
}

/* =====================================================
   CONNECTIONS
===================================================== */

function createConnections(points) {

    const lineMaterial = new THREE.LineBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.14
    });

    const maxDistance = 0.55;
    const linePairs = [];

    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            const distance = points[i].distanceTo(points[j]);
            if (distance < maxDistance) {
                linePairs.push({
                    i,
                    j,
                    maxIdx: Math.max(i, j),
                    p1: points[i],
                    p2: points[j]
                });
            }
        }
    }

    // Sort by maxIdx so lines draw outward in sync with nodes winking in
    linePairs.sort((a, b) => a.maxIdx - b.maxIdx);
    totalLinePairs = linePairs;

    const positions = new Float32Array(linePairs.length * 6);
    for (let k = 0; k < linePairs.length; k++) {
        const pair = linePairs[k];
        positions[k * 6 + 0] = pair.p1.x;
        positions[k * 6 + 1] = pair.p1.y;
        positions[k * 6 + 2] = pair.p1.z;
        positions[k * 6 + 3] = pair.p2.x;
        positions[k * 6 + 4] = pair.p2.y;
        positions[k * 6 + 5] = pair.p2.z;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setDrawRange(0, 0); // Initially 0 lines visible

    connectionLineSegments = new THREE.LineSegments(geometry, lineMaterial);
    neuralGroup.add(connectionLineSegments);
}

/* =====================================================
   INTERACTIVE NODES — one per feature, evenly spread
   on a Fibonacci sphere shell around the core.
===================================================== */

function createInteractiveNodes() {

    nodeGroup = new THREE.Group();
    neuralGroup.add(nodeGroup);

    const geometry = new THREE.SphereGeometry(0.18, 32, 32);
    const radius = 2.9;
    const count = NODE_KEYS.length;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));

    NODE_KEYS.forEach((def, i) => {

        // Fibonacci sphere point distribution
        const y = 1 - (i / (count - 1)) * 2;
        const radiusAtY = Math.sqrt(1 - y * y);
        const theta = goldenAngle * i;

        const x = Math.cos(theta) * radiusAtY;
        const z = Math.sin(theta) * radiusAtY;

        const mesh = new THREE.Mesh(
            geometry,
            new THREE.MeshBasicMaterial({ color: 0x00ffff })
        );

        mesh.position.set(x * radius, y * radius, z * radius);
        mesh.scale.set(0, 0, 0); // Start hidden for winking entry
        mesh.userData = {
            phaseOffset: i * 0.7,
            winkThreshold: Math.floor((i + 1) * (500 / count)), // Wink milestone
            wunk: false,
            winkTime: 0
        };

        nodeGroup.add(mesh);

        const ringGeometry = new THREE.RingGeometry(0.24, 0.27, 32);
        const ring = new THREE.Mesh(
            ringGeometry,
            new THREE.MeshBasicMaterial({
                color: 0x00ffff,
                transparent: true,
                opacity: 0.5,
                side: THREE.DoubleSide
            })
        );

        ring.position.copy(mesh.position);
        ring.lookAt(0, 0, 0);
        ring.scale.set(0, 0, 0); // Start hidden for winking entry
        nodeGroup.add(ring);

        const entry = { key: def.key, label: def.label, mesh, ring, callback: null };

        nodeEntries.push(entry);
        clickableObjects.push(mesh);
    });
}

/* =====================================================
   TOOLTIP (hover label)
===================================================== */

function createTooltip() {

    tooltipEl = document.createElement("div");
    tooltipEl.id = "sceneNodeTooltip";
    tooltipEl.style.display = "none";
    document.body.appendChild(tooltipEl);
}

function showTooltip(label, x, y) {

    if (!tooltipEl) return;

    tooltipEl.textContent = label;
    tooltipEl.style.left = `${x + 18}px`;
    tooltipEl.style.top = `${y - 12}px`;
    tooltipEl.style.display = "block";
}

function hideTooltip() {

    if (!tooltipEl) return;
    tooltipEl.style.display = "none";
}

/* =====================================================
   STARFIELD
===================================================== */

function createBackgroundParticles() {

    const count = 3000;

    const geometry =
        new THREE.BufferGeometry();

    const positions = [];

    for (let i = 0; i < count; i++) {

        positions.push(
            (Math.random() - 0.5) * 80,
            (Math.random() - 0.5) * 80,
            (Math.random() - 0.5) * 80
        );
    }

    geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
            positions,
            3
        )
    );

    const material =
        new THREE.PointsMaterial({
            color: 0x00ffff,
            size: 0.03,
            transparent: true,
            opacity: 0.7
        });

    const stars =
        new THREE.Points(
            geometry,
            material
        );

    scene.add(stars);
}

/* =====================================================
   INTERACTION
===================================================== */

function updateMouseFromEvent(event) {

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

function raycastNodes() {

    raycaster.setFromCamera(mouse, camera);

    const hits = raycaster.intersectObjects(clickableObjects);
    if (!hits.length) return null;

    return nodeEntries.find(entry => entry.mesh === hits[0].object) || null;
}

function handlePointerDown(event) {

    updateMouseFromEvent(event);

    const entry = raycastNodes();
    if (!entry) return;

    focusOnNode(entry);
}

function handlePointerMove(event) {

    updateMouseFromEvent(event);

    const entry = raycastNodes();

    if (entry !== hoveredEntry) {

        hoveredEntry = entry;
        document.body.style.cursor = entry ? "pointer" : "default";
    }

    if (entry) {
        showTooltip(entry.label, event.clientX, event.clientY);
    } else {
        hideTooltip();
    }
}

/* =====================================================
   FOCUS / ZOOM TO NODE
===================================================== */

function focusOnNode(entry) {

    // world-space direction of the node right now, so the swoop
    // heads toward wherever it currently is on the rotating sphere
    const worldPos = new THREE.Vector3();
    entry.mesh.getWorldPosition(worldPos);

    const dir = worldPos.clone().normalize();

    cameraFocus.set(dir.x * 2.2, dir.y * 2.2, 2.6 + dir.z * 0.6);

    targetScale = 6;

    window.setTimeout(() => {

        if (entry.callback) entry.callback();

    }, 480);
}

export function resetCameraFocus() {

    cameraFocus.copy(cameraHome);
    targetScale = 1;
}

/* =====================================================
   CALLBACKS
===================================================== */

export function setNodeCallback(key, fn) {

    const entry = nodeEntries.find(e => e.key === key);
    if (entry) entry.callback = fn;
}

/* =====================================================
   ZOOM (kept for compatibility with existing call sites)
===================================================== */

export function zoomIn() {
    targetScale = 8;
}

export function zoomOut() {
    resetCameraFocus();
}

/* =====================================================
   FPS
===================================================== */

let frameCounter = 0;
let lastFpsUpdate = performance.now();
let currentFPS = 0;

export function getFPS() {
    return currentFPS;
}

/* =====================================================
   ANIMATE
===================================================== */

let currentAgentState = "IDLE";
let isScenePaused = false;

document.addEventListener("agent-status", (e) => {
    currentAgentState = e.detail || "IDLE";
});

export function pauseScene() {
    isScenePaused = true;
}

export function resumeScene() {
    if (isScenePaused) {
        isScenePaused = false;
        animate();
    }
}

function animate() {

    if (isScenePaused) return;

    requestAnimationFrame(animate);

    const elapsed = animationClock.getElapsedTime();

    // Dynamically modulate rotation and pulse based on real agent lifecycle
    let rotSpeedY = 0.0016;
    let rotSpeedX = 0.0005;
    let pulseSpeed = 3.0;
    let pulseAmp = 0.15;

    if (currentAgentState === "THINKING") {
        rotSpeedY = 0.008;
        rotSpeedX = 0.003;
        pulseSpeed = 8.0;
        pulseAmp = 0.35;
    } else if (currentAgentState === "EXECUTING_TOOL") {
        rotSpeedY = 0.012;
        rotSpeedX = 0.005;
        pulseSpeed = 12.0;
        pulseAmp = 0.45;
    } else if (currentAgentState === "SPEAKING") {
        rotSpeedY = 0.003;
        rotSpeedX = 0.001;
        pulseSpeed = 5.0;
        pulseAmp = 0.25;
    }

    neuralGroup.rotation.y += rotSpeedY;
    neuralGroup.rotation.x += rotSpeedX;

    // Wink node-by-node creation animation loop
    if (!isWinkingComplete) {
        currentWinkIndex += 8; // Wink ~8 nodes per frame
        if (currentWinkIndex >= 500) {
            currentWinkIndex = 500;
            isWinkingComplete = true;
        }

        // Update line draw range
        if (connectionLineSegments) {
            let visibleLines = 0;
            for (let k = 0; k < totalLinePairs.length; k++) {
                if (totalLinePairs[k].maxIdx <= currentWinkIndex) {
                    visibleLines += 2; // 2 vertices per line segment
                } else {
                    break;
                }
            }
            connectionLineSegments.geometry.setDrawRange(0, visibleLines);
        }
    }

    // Animate neural nodes winking in with spring/pop effect
    for (let i = 0; i < currentWinkIndex && i < neuralNodeMeshes.length; i++) {
        const node = neuralNodeMeshes[i];
        if (!node.userData.wunk) {
            node.userData.wunk = true;
            node.userData.winkTime = elapsed;
        }

        const dt = elapsed - node.userData.winkTime;
        if (dt < 0.3) {
            const pop = Math.sin((dt / 0.3) * Math.PI) * 0.6 + (dt / 0.3);
            node.scale.setScalar(pop);
        } else {
            node.scale.setScalar(1.0);
        }
    }

    // Animate 10 feature nodes winking in as milestones are reached
    nodeEntries.forEach(entry => {
        const mesh = entry.mesh;
        const ring = entry.ring;

        if (currentWinkIndex >= mesh.userData.winkThreshold) {
            if (!mesh.userData.wunk) {
                mesh.userData.wunk = true;
                mesh.userData.winkTime = elapsed;
            }

            const dt = elapsed - mesh.userData.winkTime;
            if (dt < 0.4) {
                const pop = Math.sin((dt / 0.4) * Math.PI) * 0.8 + (dt / 0.4);
                mesh.scale.setScalar(pop);
                if (ring) ring.scale.setScalar(pop);
            } else {
                mesh.scale.setScalar(
                    1 + Math.sin(elapsed * pulseSpeed + mesh.userData.phaseOffset) * pulseAmp
                );
                if (ring) ring.scale.setScalar(1.0);
            }
        }
    });

    scaleVector.set(targetScale, targetScale, targetScale);
    neuralGroup.scale.lerp(scaleVector, 0.045);

    camera.position.lerp(cameraFocus, 0.055);
    camera.lookAt(0, 0, 0);

    frameCounter++;

    const now = performance.now();

    if (now - lastFpsUpdate > 1000) {

        currentFPS = frameCounter;
        frameCounter = 0;
        lastFpsUpdate = now;
    }

    composer.render();
}

/* =====================================================
   RESIZE
===================================================== */

function handleResize() {

    camera.aspect =
        window.innerWidth /
        window.innerHeight;

    camera.updateProjectionMatrix();

    renderer.setSize(
        window.innerWidth,
        window.innerHeight
    );

    composer.setSize(
        window.innerWidth,
        window.innerHeight
    );
}