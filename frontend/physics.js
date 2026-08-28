/* =====================================================
   JARVIS - PHYSICS SIMULATION MODULE
   Real rigid-body physics via cannon-es, rendered with
   Three.js. Gravity, mass, friction, and restitution are
   genuine simulation parameters, not scripted animation.
===================================================== */

import * as THREE from "three";
import * as CANNON from "cannon-es";

import { OrbitControls }
from "https://unpkg.com/three@0.165.0/examples/jsm/controls/OrbitControls.js";

import { addSystemLog } from "./ui.js";

let renderer, scene, camera, controls;
let world;
let groundMaterial;

let objects = []; // { id, name, mesh, body, type, material, isCar, vehicle, wheelMeshes }
let nextId = 1;

let selected = null;
let raycaster, mouse;

let initialized = false;
let paused = false;
let stepOnce = false;
let timeScale = 1;

let activeVehicle = null;
const keyState = {};

const clock = new THREE.Clock();

/* =====================================================
   INIT
===================================================== */

export function initPhysics() {

    document.getElementById("addBoxBtn")?.addEventListener("click", () => spawnBox());
    document.getElementById("addSphereBtn")?.addEventListener("click", () => spawnSphere());
    document.getElementById("addCylinderBtn")?.addEventListener("click", () => spawnCylinder());
    document.getElementById("addWallBtn")?.addEventListener("click", () => spawnWall());
    document.getElementById("addRampBtn")?.addEventListener("click", () => spawnRamp());
    document.getElementById("addCarBtn")?.addEventListener("click", () => spawnCar());

    document.getElementById("applyGravityBtn")?.addEventListener("click", applyGravity);

    const timeScaleInput = document.getElementById("timeScale");
    timeScaleInput?.addEventListener("input", () => {

        timeScale = parseFloat(timeScaleInput.value);
        document.getElementById("timeScaleValue").textContent = `${timeScale.toFixed(1)}x`;
    });

    document.getElementById("pausePhysicsBtn")?.addEventListener("click", togglePause);
    document.getElementById("stepPhysicsBtn")?.addEventListener("click", () => { stepOnce = true; });
    document.getElementById("resetPhysicsBtn")?.addEventListener("click", resetScene);

    document.getElementById("applySelectedBtn")?.addEventListener("click", applySelectedProperties);
    document.getElementById("teleportUpBtn")?.addEventListener("click", nudgeSelectedUp);
    document.getElementById("freezeToggleBtn")?.addEventListener("click", toggleFreezeSelected);
    document.getElementById("deleteSelectedBtn")?.addEventListener("click", deleteSelected);

    window.addEventListener("keydown", (e) => { keyState[e.key.toLowerCase()] = true; });
    window.addEventListener("keyup", (e) => { keyState[e.key.toLowerCase()] = false; });
}

function ensureWorld() {

    if (initialized) return;

    initialized = true;

    const canvas = document.getElementById("physicsCanvas");

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x02060a);

    camera = new THREE.PerspectiveCamera(
        60,
        (canvas.clientWidth || 1) / (canvas.clientHeight || 1),
        0.1,
        500
    );

    camera.position.set(10, 8, 14);

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 1, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(15, 25, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -30;
    sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -30;
    scene.add(sun);

    const grid = new THREE.GridHelper(60, 60, 0x00ffff, 0x113344);
    grid.position.y = 0.01;
    scene.add(grid);

    // --- physics world ---
    world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.allowSleep = true;
    world.solver.iterations = 12;

    groundMaterial = new CANNON.Material("ground");
    world.defaultContactMaterial.friction = 0.5;
    world.defaultContactMaterial.restitution = 0.2;

    buildGround();

    window.addEventListener("resize", resizePhysics);
    resizePhysics();

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    canvas.addEventListener("click", handleCanvasClick);

    clock.start();
    animate();
}

function createGridFloorTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#041018";
    ctx.fillRect(0, 0, 512, 512);

    ctx.strokeStyle = "rgba(0, 255, 255, 0.15)";
    ctx.lineWidth = 2;
    for (let i = 0; i <= 512; i += 32) {
        ctx.beginPath();
        ctx.moveTo(i, 0); ctx.lineTo(i, 512);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i); ctx.lineTo(512, i);
        ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(15, 15);
    return tex;
}

function createBoxTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#2a3b4c";
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = "rgba(0, 255, 255, 0.4)";
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, 248, 248);

    ctx.beginPath();
    ctx.moveTo(4, 4); ctx.lineTo(252, 252);
    ctx.moveTo(252, 4); ctx.lineTo(4, 252);
    ctx.stroke();

    return new THREE.CanvasTexture(canvas);
}

function buildGround() {

    const groundBody = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Plane(),
        material: groundMaterial
    });

    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(groundBody);

    const groundMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 60),
        new THREE.MeshStandardMaterial({
            map: createGridFloorTexture(),
            roughness: 0.6,
            metalness: 0.2
        })
    );

    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);
}

function resizePhysics() {

    const canvas = document.getElementById("physicsCanvas");
    if (!canvas || !renderer) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;

    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
}

/* Called by main.js right after the panel becomes visible */
export function refreshPhysicsPanel() {

    ensureWorld();
    resizePhysics();
}

/* =====================================================
   ANIMATION LOOP
===================================================== */

const FIXED_STEP = 1 / 60;

function animate() {

    requestAnimationFrame(animate);

    const panel = document.getElementById("physicsPanel");
    if (!panel || !panel.classList.contains("active")) {
        return; // Skip simulation and rendering when physics panel is closed
    }

    const delta = Math.min(clock.getDelta(), 0.1);

    if (world && (!paused || stepOnce)) {

        world.step(FIXED_STEP, delta * timeScale, 5);
        stepOnce = false;
    }

    syncMeshesToBodies();

    controls?.update();
    renderer?.render(scene, camera);
}

function syncMeshesToBodies() {

    objects.forEach(obj => {

        obj.mesh.position.copy(obj.body.position);
        obj.mesh.quaternion.copy(obj.body.quaternion);

        if (obj.isCar) {

            for (let i = 0; i < obj.vehicle.wheelInfos.length; i++) {

                obj.vehicle.updateWheelTransform(i);

                const t = obj.vehicle.wheelInfos[i].worldTransform;
                obj.wheelMeshes[i].position.copy(t.position);
                obj.wheelMeshes[i].quaternion.copy(t.quaternion);
            }

            if (obj === activeVehicle) updateCarControls(obj);
        }
    });
}

/* =====================================================
   OBJECT SPAWNING
===================================================== */

function registerObject(entry) {

    entry.id = nextId++;
    objects.push(entry);

    scene.add(entry.mesh);
    world.addBody(entry.body);

    entry.mesh.userData.physicsId = entry.id;

    renderObjectList();

    return entry;
}

export function spawnByName(name) {

    ensureWorld();

    const spawners = {
        box: spawnBox,
        ball: spawnSphere,
        sphere: spawnSphere,
        cylinder: spawnCylinder,
        wall: spawnWall,
        ramp: spawnRamp,
        car: spawnCar
    };

    const fn = spawners[(name || "").toLowerCase()];
    if (!fn) return false;

    fn();
    return true;
}

function spawnBox() {

    const size = { x: 1, y: 1, z: 1 };
    const material = new CANNON.Material("box" + nextId);

    const body = new CANNON.Body({
        mass: 1,
        shape: new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)),
        position: new CANNON.Vec3(randomSpread(), 5, randomSpread()),
        material
    });

    linkMaterial(material, 0.3, 0.3);

    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        new THREE.MeshStandardMaterial({
            map: createBoxTexture(),
            roughness: 0.4,
            metalness: 0.3
        })
    );
    mesh.castShadow = true;

    registerObject({ name: `Box ${nextId}`, mesh, body, type: "box", material });
}

function spawnSphere() {

    const radius = 0.6;
    const material = new CANNON.Material("sphere" + nextId);

    const body = new CANNON.Body({
        mass: 1,
        shape: new CANNON.Sphere(radius),
        position: new CANNON.Vec3(randomSpread(), 6, randomSpread()),
        material
    });

    linkMaterial(material, 0.4, 0.6);

    const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 24, 24),
        new THREE.MeshStandardMaterial({ color: 0xffaa33 })
    );
    mesh.castShadow = true;

    registerObject({ name: `Ball ${nextId}`, mesh, body, type: "sphere", material });
}

function spawnCylinder() {

    const radius = 0.6, height = 1.4;
    const material = new CANNON.Material("cyl" + nextId);

    const shape = new CANNON.Cylinder(radius, radius, height, 16);

    const body = new CANNON.Body({
        mass: 1,
        shape,
        position: new CANNON.Vec3(randomSpread(), 5, randomSpread()),
        material
    });

    linkMaterial(material, 0.3, 0.3);

    const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, height, 16),
        new THREE.MeshStandardMaterial({ color: 0x9966ff })
    );
    mesh.castShadow = true;

    registerObject({ name: `Cylinder ${nextId}`, mesh, body, type: "cylinder", material });
}

function spawnWall() {

    const size = { x: 4, y: 2, z: 0.4 };
    const material = new CANNON.Material("wall" + nextId);

    const body = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)),
        position: new CANNON.Vec3(randomSpread(), size.y / 2, randomSpread()),
        material
    });

    linkMaterial(material, 0.6, 0.1);

    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        new THREE.MeshStandardMaterial({ color: 0x556677 })
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    registerObject({ name: `Wall ${nextId}`, mesh, body, type: "wall", material });
}

function spawnRamp() {

    const size = { x: 5, y: 0.3, z: 3 };
    const material = new CANNON.Material("ramp" + nextId);

    const body = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)),
        position: new CANNON.Vec3(randomSpread(), 1, randomSpread()),
        material
    });

    body.quaternion.setFromEuler(0, 0, Math.PI / 8);

    linkMaterial(material, 0.4, 0.2);

    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        new THREE.MeshStandardMaterial({ color: 0x888833 })
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    registerObject({ name: `Ramp ${nextId}`, mesh, body, type: "ramp", material });
}

function linkMaterial(material, friction, restitution) {

    material.friction = friction;
    material.restitution = restitution;

    const contact = new CANNON.ContactMaterial(groundMaterial, material, {
        friction,
        restitution
    });

    world.addContactMaterial(contact);
}

function randomSpread() {

    return (Math.random() - 0.5) * 8;
}

/* =====================================================
   CAR (real raycast-suspension vehicle physics)
===================================================== */

function spawnCar() {

    const chassisShape = new CANNON.Box(new CANNON.Vec3(1, 0.4, 2));
    const chassisBody = new CANNON.Body({ mass: 150 });

    chassisBody.addShape(chassisShape);
    chassisBody.position.set(randomSpread(), 2, randomSpread());

    const vehicle = new CANNON.RaycastVehicle({
        chassisBody,
        indexRightAxis: 0,
        indexUpAxis: 1,
        indexForwardAxis: 2
    });

    const wheelOptions = {
        radius: 0.4,
        directionLocal: new CANNON.Vec3(0, -1, 0),
        suspensionStiffness: 30,
        suspensionRestLength: 0.4,
        frictionSlip: 1.6,
        dampingRelaxation: 2.3,
        dampingCompression: 4.4,
        maxSuspensionForce: 100000,
        rollInfluence: 0.02,
        axleLocal: new CANNON.Vec3(-1, 0, 0),
        chassisConnectionPointLocal: new CANNON.Vec3(1, 0, 1),
        maxSuspensionTravel: 0.3
    };

    const wheelPositions = [
        [-1, 0, -1.4],  // front left
        [1, 0, -1.4],   // front right
        [-1, 0, 1.4],   // rear left
        [1, 0, 1.4]     // rear right
    ];

    wheelPositions.forEach(pos => {

        const opts = { ...wheelOptions, chassisConnectionPointLocal: new CANNON.Vec3(...pos) };
        vehicle.addWheel(opts);
    });

    vehicle.addToWorld(world);

    const chassisMesh = new THREE.Mesh(
        new THREE.BoxGeometry(2, 0.8, 4),
        new THREE.MeshStandardMaterial({ color: 0xff3355 })
    );
    chassisMesh.castShadow = true;
    scene.add(chassisMesh);

    const wheelMeshes = wheelPositions.map(() => {

        const wheelMesh = new THREE.Mesh(
            new THREE.CylinderGeometry(0.4, 0.4, 0.3, 20),
            new THREE.MeshStandardMaterial({ color: 0x111111 })
        );
        wheelMesh.rotation.z = Math.PI / 2;
        wheelMesh.castShadow = true;
        scene.add(wheelMesh);

        return wheelMesh;
    });

    const entry = registerObject({
        name: `Car ${nextId}`,
        mesh: chassisMesh,
        body: chassisBody,
        type: "car",
        material: null,
        isCar: true,
        vehicle,
        wheelMeshes
    });

    activeVehicle = entry;
}

function updateCarControls(obj) {

    const { vehicle } = obj;

    const engineForce = 900;
    const maxSteer = 0.5;
    const brakeForce = 25;

    const forward = keyState["w"] || keyState["arrowup"];
    const back = keyState["s"] || keyState["arrowdown"];
    const left = keyState["a"] || keyState["arrowleft"];
    const right = keyState["d"] || keyState["arrowright"];
    const brake = keyState[" "];

    vehicle.setBrake(0, 0);
    vehicle.setBrake(0, 1);
    vehicle.setBrake(0, 2);
    vehicle.setBrake(0, 3);

    if (brake) {

        [0, 1, 2, 3].forEach(i => vehicle.setBrake(brakeForce, i));

    } else {

        const force = forward ? -engineForce : back ? engineForce : 0;
        vehicle.applyEngineForce(force, 2);
        vehicle.applyEngineForce(force, 3);
    }

    const steer = left ? maxSteer : right ? -maxSteer : 0;
    vehicle.setSteeringValue(steer, 0);
    vehicle.setSteeringValue(steer, 1);
}

/* =====================================================
   SELECTION + PROPERTY EDITING
===================================================== */

function handleCanvasClick(event) {

    const canvas = document.getElementById("physicsCanvas");
    const rect = canvas.getBoundingClientRect();

    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const meshes = objects.map(o => o.mesh);
    const hits = raycaster.intersectObjects(meshes);

    if (!hits.length) {
        deselect();
        return;
    }

    const hitMesh = hits[0].object;
    const obj = objects.find(o => o.mesh === hitMesh);

    if (obj) select(obj);
}

function select(obj) {

    if (selected) unhighlight(selected);

    selected = obj;
    highlight(obj);

    if (obj.isCar) activeVehicle = obj;

    document.getElementById("physicsNoSelection")?.classList.add("hidden");
    document.getElementById("physicsSelected")?.classList.remove("hidden");

    document.getElementById("selName").textContent = obj.name;
    document.getElementById("selMass").value = obj.body.mass;
    document.getElementById("selRestitution").value = obj.material?.restitution ?? world.defaultContactMaterial.restitution;
    document.getElementById("selFriction").value = obj.material?.friction ?? world.defaultContactMaterial.friction;
    document.getElementById("selLinearDamping").value = obj.body.linearDamping;
    document.getElementById("selAngularDamping").value = obj.body.angularDamping;

    renderObjectList();
}

function deselect() {

    if (selected) unhighlight(selected);

    selected = null;

    document.getElementById("physicsNoSelection")?.classList.remove("hidden");
    document.getElementById("physicsSelected")?.classList.add("hidden");

    renderObjectList();
}

function highlight(obj) {

    obj.mesh.traverse(child => {

        if (child.material) {

            child.userData._origEmissive = child.material.emissive?.getHex();
            child.material.emissive?.setHex(0x00ffff);
        }
    });
}

function unhighlight(obj) {

    obj.mesh.traverse(child => {

        if (child.material && child.userData._origEmissive !== undefined) {
            child.material.emissive?.setHex(child.userData._origEmissive);
        }
    });
}

function applySelectedProperties() {

    if (!selected) return;

    const mass = parseFloat(document.getElementById("selMass").value) || 0;
    const restitution = parseFloat(document.getElementById("selRestitution").value) || 0;
    const friction = parseFloat(document.getElementById("selFriction").value) || 0;
    const linearDamping = parseFloat(document.getElementById("selLinearDamping").value) || 0;
    const angularDamping = parseFloat(document.getElementById("selAngularDamping").value) || 0;

    selected.body.mass = mass;
    selected.body.updateMassProperties();
    selected.body.linearDamping = clamp01(linearDamping);
    selected.body.angularDamping = clamp01(angularDamping);

    if (selected.material) {

        selected.material.friction = friction;
        selected.material.restitution = restitution;

        // update the contact pair against the ground so changes take effect immediately
        const contact = world.contactmaterials.find(cm =>
            (cm.materials[0] === groundMaterial && cm.materials[1] === selected.material) ||
            (cm.materials[1] === groundMaterial && cm.materials[0] === selected.material)
        );

        if (contact) {
            contact.friction = friction;
            contact.restitution = restitution;
        }
    }

    selected.body.wakeUp();
    notifyLog(`Updated ${selected.name}: mass=${mass}, restitution=${restitution}, friction=${friction}`);
}

function clamp01(v) {
    return Math.max(0, Math.min(1, v));
}

function nudgeSelectedUp() {

    if (!selected) return;

    selected.body.position.y += 2;
    selected.body.velocity.set(0, 0, 0);
    selected.body.angularVelocity.set(0, 0, 0);
    selected.body.wakeUp();
}

function toggleFreezeSelected() {

    if (!selected) return;

    const btn = document.getElementById("freezeToggleBtn");

    if (selected.body.mass === 0) {

        selected.body.mass = selected._savedMass || 1;
        selected.body.type = CANNON.Body.DYNAMIC;
        if (btn) btn.textContent = "FREEZE";

    } else {

        selected._savedMass = selected.body.mass;
        selected.body.mass = 0;
        selected.body.type = CANNON.Body.STATIC;
        selected.body.velocity.set(0, 0, 0);
        selected.body.angularVelocity.set(0, 0, 0);
        if (btn) btn.textContent = "UNFREEZE";
    }

    selected.body.updateMassProperties();
    selected.body.wakeUp();

    document.getElementById("selMass").value = selected.body.mass;
}

function deleteSelected() {

    if (!selected) return;

    removeObject(selected);
    deselect();
}

function removeObject(obj) {

    scene.remove(obj.mesh);

    if (obj.isCar) {

        obj.vehicle.removeFromWorld(world);
        obj.wheelMeshes.forEach(w => scene.remove(w));

        if (activeVehicle === obj) activeVehicle = null;

    } else {

        world.removeBody(obj.body);
    }

    objects = objects.filter(o => o !== obj);

    renderObjectList();
}

/* =====================================================
   WORLD SETTINGS
===================================================== */

export function setGravity(x, y, z) {

    ensureWorld();

    const gx = Number.isFinite(x) ? x : 0;
    const gy = Number.isFinite(y) ? y : -9.82;
    const gz = Number.isFinite(z) ? z : 0;

    world.gravity.set(gx, gy, gz);
    objects.forEach(o => o.body.wakeUp());

    const xInput = document.getElementById("gravityX");
    const yInput = document.getElementById("gravityY");
    const zInput = document.getElementById("gravityZ");

    if (xInput) xInput.value = gx;
    if (yInput) yInput.value = gy;
    if (zInput) zInput.value = gz;

    notifyLog(`Gravity set to (${gx}, ${gy}, ${gz})`);
}

function applyGravity() {

    const x = parseFloat(document.getElementById("gravityX").value) || 0;
    const y = parseFloat(document.getElementById("gravityY").value) || 0;
    const z = parseFloat(document.getElementById("gravityZ").value) || 0;

    world.gravity.set(x, y, z);

    objects.forEach(o => o.body.wakeUp());

    notifyLog(`Gravity set to (${x}, ${y}, ${z})`);
}

function togglePause() {

    paused = !paused;

    const btn = document.getElementById("pausePhysicsBtn");
    const stepBtn = document.getElementById("stepPhysicsBtn");

    if (btn) btn.textContent = paused ? "RESUME" : "PAUSE";
    if (stepBtn) stepBtn.disabled = !paused;
}

function resetScene() {

    [...objects].forEach(obj => removeObject(obj));

    selected = null;
    activeVehicle = null;

    document.getElementById("physicsNoSelection")?.classList.remove("hidden");
    document.getElementById("physicsSelected")?.classList.add("hidden");

    renderObjectList();
    notifyLog("Physics scene reset");
}

/* =====================================================
   OBJECT LIST UI
===================================================== */

function renderObjectList() {

    const list = document.getElementById("physicsObjectList");
    const count = document.getElementById("physicsObjectCount");

    if (count) count.textContent = `(${objects.length})`;

    if (!list) return;

    list.innerHTML = "";

    objects.forEach(obj => {

        const row = document.createElement("div");
        row.className = `physicsObjectRow${obj === selected ? " selected" : ""}`;
        row.textContent = `${obj.name} — mass ${obj.body.mass}`;

        row.addEventListener("click", () => select(obj));

        list.appendChild(row);
    });
}

/* =====================================================
   LOGGING
===================================================== */

function notifyLog(message) {

    addSystemLog(`Physics: ${message}`);
}