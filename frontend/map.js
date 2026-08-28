/* =====================================================
   JARVIS - GLOBE / MAPPING MODULE
===================================================== */

import * as THREE from "three";

import { OrbitControls }
from "https://unpkg.com/three@0.165.0/examples/jsm/controls/OrbitControls.js";

const EARTH_RADIUS = 2;
const EARTH_RADIUS_KM = 6371;

const PRIMARY_TEX_CDN = "https://threejs.org/examples/textures/planets/";
const BACKUP_TEX_CDN = "https://cdn.jsdelivr.net/gh/mrdoob/three.js@master/examples/textures/planets/";

const textureLoader = new THREE.TextureLoader();

function generateProceduralGlobeCanvas() {
    const canvas = document.createElement("canvas");
    canvas.width = 2048;
    canvas.height = 1024;
    const ctx = canvas.getContext("2d");

    const oceanGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    oceanGrad.addColorStop(0, "#081d38");
    oceanGrad.addColorStop(0.5, "#0d315e");
    oceanGrad.addColorStop(1, "#081d38");
    ctx.fillStyle = oceanGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const continents = [
        { x: 350, y: 300, rx: 220, ry: 150, color: "#22522c" },
        { x: 280, y: 220, rx: 180, ry: 120, color: "#2e6336" },
        { x: 550, y: 650, rx: 110, ry: 200, color: "#1e4d25" },
        { x: 1250, y: 280, rx: 380, ry: 170, color: "#2c572b" },
        { x: 1100, y: 240, rx: 140, ry: 90, color: "#376636" },
        { x: 1080, y: 520, rx: 160, ry: 210, color: "#7a6b3b" },
        { x: 1680, y: 700, rx: 130, ry: 90, color: "#8c6e3b" },
        { x: 680, y: 130, rx: 110, ry: 60, color: "#c8dadf" },
        { x: 1024, y: 970, rx: 950, ry: 70, color: "#e4f1f7" }
    ];

    continents.forEach(c => {
        ctx.fillStyle = c.color;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, c.rx, c.ry, Math.PI / 12, 0, Math.PI * 2);
        ctx.fill();
    });

    // Cyber grid lines across map
    ctx.strokeStyle = "rgba(0, 255, 255, 0.12)";
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 128) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 64) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }

    return canvas;
}

function loadGlobeTexture(filename) {
    const localMap = {
        "earth_atmos_2048.jpg": "./assets/textures/earth.jpg",
        "earth_lights_2048.png": "./assets/textures/earth_lights.png",
        "earth_specular_2048.jpg": "./assets/textures/earth_specular.jpg",
        "earth_normal_2048.jpg": "./assets/textures/earth_normal.jpg"
    };

    const texture = new THREE.CanvasTexture(generateProceduralGlobeCanvas());
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;

    const primaryUrl = localMap[filename] || (PRIMARY_TEX_CDN + filename);

    textureLoader.load(
        primaryUrl,
        (loaded) => {
            texture.image = loaded.image;
            texture.needsUpdate = true;
        },
        undefined,
        () => {
            textureLoader.load(
                BACKUP_TEX_CDN + filename,
                (bLoaded) => {
                    texture.image = bLoaded.image;
                    texture.needsUpdate = true;
                }
            );
        }
    );

    return texture;
}

let renderer;
let scene;
let camera;
let controls;
let raycaster;
let mouse;
let globeMesh;

let originMarker = null;
let destMarker = null;
let arcLine = null;
let markerGroup = null;

let origin = null; // { lat, lon, name }
let destination = null; // { lat, lon, name }

let initialized = false;
let lastPickedRole = "origin";

/* =====================================================
   INIT
===================================================== */

export function initMap() {

    document
        .getElementById("mapSearchBtn")
        ?.addEventListener("click", handleSearch);

    document
        .getElementById("mapGoogleBtn")
        ?.addEventListener("click", handleGoogleIt);

    document
        .getElementById("mapWikiBtn")
        ?.addEventListener("click", handleWikiSummary);

    document
        .getElementById("mapFlightsBtn")
        ?.addEventListener("click", handleFindFlights);

    ["originInput", "destInput"].forEach(id => {

        document.getElementById(id)
            ?.addEventListener("keydown", (event) => {

                if (event.key === "Enter") handleSearch();
            });
    });
}

export function refreshMap() {

    ensureRenderer();
    resizeMap();
}

function ensureRenderer() {

    if (initialized) return;

    initialized = true;

    const canvas = document.getElementById("mapCanvas");

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(
        50,
        (canvas.clientWidth || 1) / (canvas.clientHeight || 1),
        0.1,
        1000
    );

    camera.position.set(0, 0, 6);

    renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true
    });

    renderer.setPixelRatio(
        Math.min(window.devicePixelRatio, 2)
    );

    scene.add(new THREE.AmbientLight(0xffffff, 0.9));

    const sun = new THREE.PointLight(0xffffff, 2.2, 200);
    sun.position.set(8, 4, 8);
    scene.add(sun);

    buildGlobe();

    markerGroup = new THREE.Group();
    scene.add(markerGroup);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 3;
    controls.maxDistance = 14;
    controls.rotateSpeed = 0.5;

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    canvas.addEventListener("click", handleGlobeClick);
    window.addEventListener("resize", resizeMap);

    animateMap();
}

function buildGlobe() {

    const geometry = new THREE.SphereGeometry(EARTH_RADIUS, 96, 96);

    const material = new THREE.MeshPhongMaterial({
        map: loadGlobeTexture("earth_atmos_2048.jpg"),
        specularMap: loadGlobeTexture("earth_specular_2048.jpg"),
        bumpMap: loadGlobeTexture("earth_normal_2048.jpg"),
        bumpScale: 0.03,
        specular: new THREE.Color(0x333333),
        shininess: 6
    });

    globeMesh = new THREE.Mesh(geometry, material);
    scene.add(globeMesh);

    const glowGeometry = new THREE.SphereGeometry(EARTH_RADIUS * 1.02, 64, 64);
    const glowMaterial = new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.06,
        side: THREE.BackSide
    });

    scene.add(new THREE.Mesh(glowGeometry, glowMaterial));

    // faint starfield backdrop
    const starCount = 1500;
    const starPositions = [];

    for (let i = 0; i < starCount; i++) {

        starPositions.push(
            (Math.random() - 0.5) * 60,
            (Math.random() - 0.5) * 60,
            (Math.random() - 0.5) * 60
        );
    }

    const starGeom = new THREE.BufferGeometry();
    starGeom.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(starPositions, 3)
    );

    scene.add(new THREE.Points(
        starGeom,
        new THREE.PointsMaterial({ color: 0xffffff, size: 0.02 })
    ));
}

function resizeMap() {

    const canvas = document.getElementById("mapCanvas");

    if (!canvas || !renderer) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (!width || !height) return;

    renderer.setSize(width, height, false);

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
}

function animateMap() {

    requestAnimationFrame(animateMap);

    const panel = document.getElementById("mapPanel");
    if (!panel || !panel.classList.contains("active")) {
        return; // Skip rendering when globe panel is closed
    }

    if (globeMesh) globeMesh.rotation.y += 0.0007;
    if (markerGroup) markerGroup.rotation.y = globeMesh.rotation.y;

    controls?.update();

    renderer?.render(scene, camera);
}

/* =====================================================
   LAT/LON <-> 3D CONVERSION
===================================================== */

function latLonToVector3(lat, lon, radius) {

    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);

    return new THREE.Vector3(
        -radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta)
    );
}

function vector3ToLatLon(point) {

    const normalized = point.clone().normalize();

    const lat = 90 - (Math.acos(normalized.y) * 180 / Math.PI);

    let lon = (Math.atan2(normalized.z, -normalized.x) * 180 / Math.PI) - 180;

    if (lon < -180) lon += 360;
    if (lon > 180) lon -= 360;

    return { lat, lon };
}

/* =====================================================
   MARKERS + ARC
===================================================== */

function placeMarker(role, lat, lon) {

    const existing = role === "origin" ? originMarker : destMarker;

    if (existing) markerGroup.remove(existing);

    const color = role === "origin" ? 0x00ffff : 0xff9933;

    const pin = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 16, 16),
        new THREE.MeshBasicMaterial({ color })
    );

    const position = latLonToVector3(lat, lon, EARTH_RADIUS * 1.01);

    pin.position.copy(position);

    const glow = new THREE.PointLight(color, 1.2, 1);
    pin.add(glow);

    markerGroup.add(pin);

    if (role === "origin") {
        originMarker = pin;
    } else {
        destMarker = pin;
    }

    updateArc();
}

function updateArc() {

    if (arcLine) {
        markerGroup.remove(arcLine);
        arcLine = null;
    }

    if (!origin || !destination) return;

    const start = latLonToVector3(origin.lat, origin.lon, EARTH_RADIUS * 1.01);
    const end = latLonToVector3(destination.lat, destination.lon, EARTH_RADIUS * 1.01);

    const points = [];
    const segments = 96;

    for (let i = 0; i <= segments; i++) {

        const t = i / segments;

        const point = new THREE.Vector3().lerpVectors(start, end, t);

        // lift the midpoint outward so the arc bulges above the surface
        const lift = Math.sin(Math.PI * t) * 0.6;

        point.normalize().multiplyScalar(EARTH_RADIUS * 1.01 + lift);

        points.push(point);
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);

    const material = new THREE.LineBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.8
    });

    arcLine = new THREE.Line(geometry, material);

    markerGroup.add(arcLine);
}

/* =====================================================
   CLICK TO PIN
===================================================== */

function handleGlobeClick(event) {

    const canvas = document.getElementById("mapCanvas");
    const rect = canvas.getBoundingClientRect();

    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const hits = raycaster.intersectObject(globeMesh);

    if (!hits.length) return;

    // account for the globe's own rotation
    const localPoint = hits[0].point.clone();
    globeMesh.worldToLocal(localPoint);

    const { lat, lon } = vector3ToLatLon(localPoint);

    setPoint(lastPickedRole, { lat, lon, name: null });

    reverseGeocode(lat, lon, lastPickedRole);

    lastPickedRole = lastPickedRole === "origin" ? "destination" : "origin";
}

/* =====================================================
   SEARCH / GEOCODING
===================================================== */

export function searchRoute(origin, destination) {

    const originInput = document.getElementById("originInput");
    const destInput = document.getElementById("destInput");

    if (originInput && origin) originInput.value = origin;
    if (destInput && destination) destInput.value = destination;

    return handleSearch();
}

async function handleSearch() {

    const originText = document.getElementById("originInput")?.value.trim();
    const destText = document.getElementById("destInput")?.value.trim();

    if (!originText && !destText) {

        setInfoBody("Enter at least one location to search.");
        return;
    }

    ensureRenderer();

    if (originText) {

        const result = await geocode(originText);

        if (result) {
            setPoint("origin", result);
        } else {
            setInfoBody(`Couldn't find "${originText}".`);
        }
    }

    if (destText) {

        const result = await geocode(destText);

        if (result) {
            setPoint("destination", result);
        } else {
            setInfoBody(`Couldn't find "${destText}".`);
        }
    }
}

const OFFLINE_CITIES = {
    "delhi": { lat: 28.6139, lon: 77.2090, name: "New Delhi", fullName: "New Delhi, India" },
    "new delhi": { lat: 28.6139, lon: 77.2090, name: "New Delhi", fullName: "New Delhi, India" },
    "mumbai": { lat: 19.0760, lon: 72.8777, name: "Mumbai", fullName: "Mumbai, Maharashtra, India" },
    "bangalore": { lat: 12.9716, lon: 77.5946, name: "Bengaluru", fullName: "Bengaluru, Karnataka, India" },
    "london": { lat: 51.5074, lon: -0.1278, name: "London", fullName: "London, United Kingdom" },
    "tokyo": { lat: 35.6762, lon: 139.6503, name: "Tokyo", fullName: "Tokyo, Japan" },
    "new york": { lat: 40.7128, lon: -74.0060, name: "New York", fullName: "New York, USA" },
    "paris": { lat: 48.8566, lon: 2.3522, name: "Paris", fullName: "Paris, France" },
    "dubai": { lat: 25.2048, lon: 55.2708, name: "Dubai", fullName: "Dubai, United Arab Emirates" },
    "singapore": { lat: 1.3521, lon: 103.8198, name: "Singapore", fullName: "Singapore" },
    "sydney": { lat: -33.8688, lon: 151.2093, name: "Sydney", fullName: "Sydney, Australia" },
    "san francisco": { lat: 37.7749, lon: -122.4194, name: "San Francisco", fullName: "San Francisco, CA, USA" },
    "beijing": { lat: 39.9042, lon: 116.4074, name: "Beijing", fullName: "Beijing, China" },
    "cairo": { lat: 30.0444, lon: 31.2357, name: "Cairo", fullName: "Cairo, Egypt" },
    "moscow": { lat: 55.7558, lon: 37.6173, name: "Moscow", fullName: "Moscow, Russia" },
    "berlin": { lat: 52.5200, lon: 13.4050, name: "Berlin", fullName: "Berlin, Germany" },
    "toronto": { lat: 43.6532, lon: -79.3832, name: "Toronto", fullName: "Toronto, Canada" }
};

export function flyCameraToPoint(lat, lon) {
    if (!controls || !camera) return;
    const targetVec = latLonToVector3(lat, lon, EARTH_RADIUS + 4.2);
    camera.position.copy(targetVec);
    controls.target.set(0, 0, 0);
    controls.update();
}

export async function locateCityOrPlace(query) {
    ensureRenderer();
    const result = await geocode(query);
    if (!result) return { success: false, error: `Could not geocode location "${query}"` };
    
    setPoint("origin", result);
    const originInput = document.getElementById("originInput");
    if (originInput) originInput.value = result.name || query;
    
    flyCameraToPoint(result.lat, result.lon);
    return {
        success: true,
        name: result.name,
        fullName: result.fullName,
        lat: result.lat,
        lon: result.lon
    };
}

export async function calculateDistanceBetween(originQuery, destQuery) {
    ensureRenderer();
    const [resA, resB] = await Promise.all([geocode(originQuery), geocode(destQuery)]);
    if (!resA || !resB) {
        return { success: false, error: `Could not resolve one or both locations ("${originQuery}", "${destQuery}")` };
    }

    setPoint("origin", resA);
    setPoint("destination", resB);
    
    const originInput = document.getElementById("originInput");
    const destInput = document.getElementById("destInput");
    if (originInput) originInput.value = resA.name;
    if (destInput) destInput.value = resB.name;

    const km = haversineDistanceKm(resA, resB);
    const miles = km * 0.621371;

    // Center camera between both points
    const midLat = (resA.lat + resB.lat) / 2;
    const midLon = (resA.lon + resB.lon) / 2;
    flyCameraToPoint(midLat, midLon);

    return {
        success: true,
        origin: resA.name,
        destination: resB.name,
        km: Math.round(km),
        miles: Math.round(miles)
    };
}

async function geocode(query) {

    const cleaned = (query || "").toLowerCase().trim();
    if (OFFLINE_CITIES[cleaned]) {
        return { ...OFFLINE_CITIES[cleaned] };
    }

    try {

        const url =
            `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;

        const res = await fetch(url, {
            headers: { "Accept": "application/json" }
        });

        const data = await res.json();

        if (!data.length) return null;

        return {
            lat: parseFloat(data[0].lat),
            lon: parseFloat(data[0].lon),
            name: data[0].display_name.split(",")[0],
            fullName: data[0].display_name
        };

    } catch (err) {

        console.error("Geocode error:", err);
        return null;
    }
}

async function reverseGeocode(lat, lon, role) {

    setInfoLoading(`Locating pin (${lat.toFixed(2)}, ${lon.toFixed(2)})...`);

    try {

        const url =
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`;

        const res = await fetch(url, {
            headers: { "Accept": "application/json" }
        });

        const data = await res.json();

        const name =
            data.display_name?.split(",")[0] || `${lat.toFixed(2)}, ${lon.toFixed(2)}`;

        const point = { lat, lon, name, fullName: data.display_name || name };

        if (role === "origin") {
            origin = point;
            const input = document.getElementById("originInput");
            if (input) input.value = name;
        } else {
            destination = point;
            const input = document.getElementById("destInput");
            if (input) input.value = name;
        }

        renderPointInfo(point, role);
        updateDistance();
        updateTicketSection();

    } catch (err) {

        console.error("Reverse geocode error:", err);
        setInfoBody("Couldn't resolve that location's name, but the pin is placed.");
    }
}

function setPoint(role, point) {

    if (role === "origin") {
        origin = point;
    } else {
        destination = point;
    }

    placeMarker(role, point.lat, point.lon);
    renderPointInfo(point, role);
    updateDistance();
    updateTicketSection();
}

/* =====================================================
   DISTANCE
===================================================== */

function haversineDistanceKm(a, b) {

    const toRad = (deg) => (deg * Math.PI) / 180;

    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);

    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);

    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

    return EARTH_RADIUS_KM * c;
}

function updateDistance() {

    const section = document.getElementById("mapDistanceSection");
    const valueEl = document.getElementById("mapDistanceValue");

    if (!origin || !destination) {

        if (section) section.style.display = "none";
        return;
    }

    const km = haversineDistanceKm(origin, destination);
    const miles = km * 0.621371;

    if (valueEl) {

        valueEl.textContent =
            `${km.toFixed(0)} km  /  ${miles.toFixed(0)} mi`;
    }

    if (section) section.style.display = "block";
}

/* =====================================================
   INFO PANEL
===================================================== */

function renderPointInfo(point, role) {

    const section = document.getElementById("mapInfoSection");
    const title = document.getElementById("mapInfoTitle");
    const body = document.getElementById("mapInfoBody");

    if (!section || !title || !body) return;

    section.style.display = "block";
    section.dataset.activeName = point.name;
    section.dataset.role = role;

    title.textContent = `${role === "origin" ? "ORIGIN" : "DESTINATION"}: ${point.name}`;

    body.textContent =
        point.fullName ||
        `Lat ${point.lat.toFixed(3)}, Lon ${point.lon.toFixed(3)}`;
}

function setInfoBody(text) {

    const section = document.getElementById("mapInfoSection");
    const body = document.getElementById("mapInfoBody");

    if (section) section.style.display = "block";
    if (body) body.textContent = text;
}

function setInfoLoading(text) {

    const body = document.getElementById("mapInfoBody");
    const section = document.getElementById("mapInfoSection");

    if (section) section.style.display = "block";

    if (body) {
        body.textContent = text;
        body.classList.add("mapLoading");
    }
}

/* =====================================================
   GOOGLE IT
===================================================== */

function handleGoogleIt() {

    const section = document.getElementById("mapInfoSection");
    const name = section?.dataset.activeName;

    if (!name) {

        setInfoBody("Pick or search a location first.");
        return;
    }

    const url = `https://www.google.com/search?q=${encodeURIComponent(name)}`;

    window.open(url, "_blank", "noopener");
}

/* =====================================================
   WIKIPEDIA SUMMARY
===================================================== */

async function handleWikiSummary() {

    const section = document.getElementById("mapInfoSection");
    const name = section?.dataset.activeName;
    const body = document.getElementById("mapInfoBody");

    if (!name) {

        setInfoBody("Pick or search a location first.");
        return;
    }

    if (body) {
        body.textContent = "Fetching summary...";
        body.classList.add("mapLoading");
    }

    try {

        const url =
            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`;

        const res = await fetch(url);

        if (!res.ok) throw new Error("Not found");

        const data = await res.json();

        if (body) {

            body.classList.remove("mapLoading");
            body.textContent = data.extract || "No summary available.";
        }

    } catch (err) {

        if (body) {

            body.classList.remove("mapLoading");
            body.textContent =
                `No Wikipedia summary found for "${name}". Try "Google It" instead.`;
        }
    }
}

/* =====================================================
   TICKETS / FLIGHTS
===================================================== */

function updateTicketSection() {

    const section = document.getElementById("mapTicketSection");
    const body = document.getElementById("mapTicketBody");

    if (!section || !body) return;

    section.style.display = "block";

    if (origin && destination) {

        body.textContent =
            `${origin.name} → ${destination.name}. Click below to check live fares.`;

    } else if (origin || destination) {

        body.textContent =
            "Set both an origin and a destination to search flights.";

    } else {

        body.textContent =
            "Set an origin and a destination to search flights.";
    }
}

function handleFindFlights() {

    if (!origin || !destination) {

        const body = document.getElementById("mapTicketBody");

        if (body) {
            body.textContent =
                "Set both an origin and a destination first.";
        }

        return;
    }

    // Google Flights doesn't have a stable public query API, so we deep-link
    // into its search UI, which reliably interprets plain city names.
    const query =
        `Flights from ${origin.name} to ${destination.name}`;

    const url =
        `https://www.google.com/travel/flights?q=${encodeURIComponent(query)}`;

    window.open(url, "_blank", "noopener");
}