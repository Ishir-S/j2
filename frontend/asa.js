/* =====================================================
   JARVIS - AUTONOMOUS SOLUTION ARCHITECT (ASA)
   Orchestrates: discovery.js, intelligence.js,
   buildPipeline.js, deployment.js, projects.js
===================================================== */

import { getSettings, setSettings, checkStatus } from "./ollama.js";
import { notify, addSystemLog } from "./ui.js";
import * as discovery from "./discovery.js";
import * as intelligence from "./intelligence.js";
import { runBuildPipeline } from "./buildPipeline.js";
import * as deployment from "./deployment.js";
import { createProjectFromFiles } from "./projects.js";

const CAPABILITY_REGISTRY_KEY = "jarvis_asa_capabilities";

/* =====================================================
   STATE
===================================================== */

let state = resetState();

function resetState() {

    return {
        goal: "",
        intent: null,
        resources: null,
        hardware: [],
        solutions: [],
        chosen: null,
        board: null,
        gap: null,
        generatedCapabilities: [],
        buildResult: null,
        allFiles: []
    };
}

/* =====================================================
   INIT
===================================================== */

export function initASA() {

    document.getElementById("asaStartBtn")?.addEventListener("click", beginAnalysis);

    document.getElementById("asaConnectSerial")?.addEventListener("click", () => connectHardware(discovery.discoverSerialDevice));
    document.getElementById("asaConnectUsb")?.addEventListener("click", () => connectHardware(discovery.discoverUsbDevice));
    document.getElementById("asaConnectHid")?.addEventListener("click", () => connectHardware(discovery.discoverHidDevice));
    document.getElementById("asaConnectBluetooth")?.addEventListener("click", () => connectHardware(discovery.discoverBluetoothDevice));
    document.getElementById("asaConnectMidi")?.addEventListener("click", connectMidi);

    document.getElementById("asaContinueToSolutionsBtn")?.addEventListener("click", proceedToSolutions);

    document.getElementById("asaOllamaRefresh")?.addEventListener("click", refreshOllamaBar);
    document.getElementById("asaModelSelect")?.addEventListener("change", (e) => setSettings({ model: e.target.value }));

    document.getElementById("asaDeployProject")?.addEventListener("click", deployAsProject);
    document.getElementById("asaDeployZip")?.addEventListener("click", deployAsZip);
    document.getElementById("asaDeployFolder")?.addEventListener("click", deployToFolder);
    document.getElementById("asaSaveGithubToken")?.addEventListener("click", saveGithubToken);
    document.getElementById("asaDeployGithub")?.addEventListener("click", deployToGithub);

    const savedToken = deployment.getGithubToken();
    const tokenInput = document.getElementById("asaGithubToken");
    if (tokenInput && savedToken) tokenInput.placeholder = "Token saved (hidden)";

    renderCapabilityRegistry();
    refreshOllamaBar();
}

/* Called by main.js right after the panel becomes visible */
export function refreshASAPanel() {

    refreshOllamaBar();
}

/* =====================================================
   OLLAMA BAR
===================================================== */

async function refreshOllamaBar() {

    const dot = document.getElementById("asaOllamaDot");
    const label = document.getElementById("asaOllamaLabel");
    const select = document.getElementById("asaModelSelect");

    if (label) label.textContent = "Checking local AI engine...";

    const { host } = getSettings();
    const result = await checkStatus(host);

    if (result.connected) {

        dot?.classList.add("connected");

        if (label) {
            label.textContent = result.models.length
                ? `Connected — ${result.models.length} model(s) available`
                : "Connected, but no models are pulled yet";
        }

        if (select) {

            const current = getSettings().model;
            select.innerHTML = "";

            if (result.models.length) {

                result.models.forEach(name => {
                    const opt = document.createElement("option");
                    opt.value = name;
                    opt.textContent = name;
                    select.appendChild(opt);
                });

                const useModel = result.models.includes(current) ? current : result.models[0];
                select.value = useModel;
                setSettings({ model: useModel });

            } else {

                select.innerHTML = `<option value="">No models found</option>`;
            }
        }

    } else {

        dot?.classList.remove("connected");
        if (label) label.textContent = "Can't reach Ollama — ASA needs it for reasoning stages.";
        if (select) select.innerHTML = `<option value="">No models found</option>`;
    }
}

/* =====================================================
   LOGGING
===================================================== */

function log(message, level = "info") {

    document.getElementById("asaStageLogs")?.classList.remove("hidden");

    const console_ = document.getElementById("asaLogConsole");
    if (!console_) return;

    const line = document.createElement("div");
    line.className = `asaLogLine ${level === "error" ? "asaLogError" : level === "warn" ? "asaLogWarn" : ""}`;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;

    console_.appendChild(line);
    console_.scrollTop = console_.scrollHeight;

    addSystemLog(`ASA: ${message}`);
}

function showStage(id) {

    document.getElementById(id)?.classList.remove("hidden");
}

/* =====================================================
   STAGE 1-2-3: GOAL -> INTENT -> RESOURCES
===================================================== */

export function beginAnalysisOnGoal(goal) {

    const input = document.getElementById("asaGoalInput");
    if (input && goal) input.value = goal;

    return beginAnalysis();
}

async function beginAnalysis() {

    const goalInput = document.getElementById("asaGoalInput");
    const goal = goalInput?.value.trim();

    if (!goal) {
        notify("Describe a goal first");
        return;
    }

    const { model } = getSettings();

    if (!model) {
        log("No Ollama model selected — refresh the connection bar above.", "error");
        return;
    }

    state = resetState();
    state.goal = goal;

    toggleBtn("asaStartBtn", true, "ANALYZING...");
    log(`Received goal: "${goal}"`);

    try {

        log("Stage 1: Intent Engine — extracting the real underlying goal...");
        state.intent = await intelligence.decomposeIntent(goal);

        renderGoalResult(state.intent);
        log(`Real goal identified: "${state.intent.realGoal}" (type: ${state.intent.goalType})`);

        showStage("asaStageResources");
        log("Stage 2: Resource Discovery — reading real browser/device APIs...");

        state.resources = await discovery.detectResources();
        renderResources(state.resources);
        log("Resource discovery complete.");

        showStage("asaStageHardware");
        log("Stage 3: Hardware Discovery — waiting for you to connect any real devices (optional).");

    } catch (err) {

        console.error(err);
        log(`Intent/resource stage failed: ${err.message}`, "error");
        notify("ASA analysis failed");

    } finally {

        toggleBtn("asaStartBtn", false, "BEGIN ANALYSIS");
    }
}

function renderGoalResult(intent) {

    const box = document.getElementById("asaGoalResult");
    if (!box) return;

    box.classList.remove("hidden");

    box.innerHTML = `
        <strong>Real goal:</strong> ${escapeHtml(intent.realGoal)}<br>
        <strong>Type:</strong> ${escapeHtml(intent.goalType)}<br>
        ${intent.constraints?.length ? `<strong>Constraints:</strong> ${intent.constraints.map(escapeHtml).join(", ")}` : ""}
    `;
}

function renderResources(resources) {

    const grid = document.getElementById("asaResourceGrid");
    if (!grid) return;

    grid.innerHTML = "";

    const cards = [
        { title: "System", lines: [`OS: ${resources.os}`, `Browser: ${resources.browser}`] },
        { title: "Compute", lines: [
            `CPU cores: ${resources.cpuCores ?? "not exposed by browser"}`,
            `RAM estimate: ${resources.ramEstimateGB ? resources.ramEstimateGB + " GB+" : "not exposed by browser"}`
        ] },
        { title: "GPU", lines: [
            `Source: ${resources.gpu.source}`,
            resources.gpu.vendor ? `Vendor: ${resources.gpu.vendor}` : "",
            resources.gpu.renderer || resources.gpu.architecture ? `Detail: ${resources.gpu.renderer || resources.gpu.architecture}` : ""
        ].filter(Boolean) },
        { title: "Media Devices", lines: resources.mediaDevices.supported ? [
            `Cameras: ${resources.mediaDevices.cameras}`,
            `Microphones: ${resources.mediaDevices.microphones}`,
            `Speakers: ${resources.mediaDevices.speakers}`
        ] : ["Not supported in this browser"] },
        { title: "Network", lines: resources.network.supported ? [
            `Type: ${resources.network.effectiveType}`,
            `Downlink: ${resources.network.downlinkMbps ?? "?"} Mbps`
        ] : ["Not exposed by this browser"] },
        { title: "Hardware API Support", lines: Object.entries(resources.apiSupport).map(
            ([key, val]) => `${key}: ${val ? "available" : "unavailable"}`
        ) }
    ];

    cards.forEach(card => {

        const el = document.createElement("div");
        el.className = "asaCard";
        el.innerHTML = `<h4>${escapeHtml(card.title)}</h4>${card.lines.map(l => `<div class="asaMuted">${escapeHtml(l)}</div>`).join("")}`;

        grid.appendChild(el);
    });
}

/* =====================================================
   STAGE 3: HARDWARE DISCOVERY (real, user-gesture only)
===================================================== */

async function connectHardware(discoverFn) {

    try {

        const device = await discoverFn();

        state.hardware.push(device);
        renderHardwareList();

        log(`Hardware connected: ${device.label || device.name || device.type} ${device.vendorId ? `(${device.vendorId}/${device.productId})` : ""}`);

    } catch (err) {

        log(`Hardware discovery cancelled or failed: ${err.message}`, "warn");
    }
}

async function connectMidi() {

    try {

        const devices = await discovery.discoverMidiDevices();

        state.hardware.push(...devices);
        renderHardwareList();

        log(`MIDI scan found ${devices.length} device(s).`);

    } catch (err) {

        log(`MIDI discovery failed: ${err.message}`, "warn");
    }
}

function renderHardwareList() {

    const list = document.getElementById("asaHardwareList");
    if (!list) return;

    list.innerHTML = "";

    if (!state.hardware.length) {

        list.innerHTML = `<div class="asaMuted">No hardware connected yet — that's fine, ASA can still propose software-only solutions.</div>`;
        return;
    }

    state.hardware.forEach(device => {

        const el = document.createElement("div");
        el.className = "asaCard";

        el.innerHTML = `
            <h4>${escapeHtml(device.label || device.name || device.type)}</h4>
            ${device.vendorId ? `<div class="asaMuted">VID ${device.vendorId} / PID ${device.productId || "?"}</div>` : ""}
            <div class="asaMuted">${escapeHtml(device.identification || "")}</div>
        `;

        list.appendChild(el);
    });
}

function proceedToSolutions() {

    showStage("asaStageSolutions");
    generateSolutions();
}

/* =====================================================
   STAGE 4: SOLUTION ARCHITECT
===================================================== */

async function generateSolutions() {

    log("Stage 4: Solution Architect — generating and scoring candidate solutions...");

    const grid = document.getElementById("asaSolutionsGrid");
    if (grid) grid.innerHTML = `<div class="asaMuted">Thinking...</div>`;

    try {

        state.solutions = await intelligence.generateSolutions(state.intent, state.resources, state.hardware);

        renderSolutions();
        log(`Generated ${state.solutions.length} candidate solution(s).`);

    } catch (err) {

        console.error(err);
        log(`Solution generation failed: ${err.message}`, "error");
        if (grid) grid.innerHTML = `<div class="asaMuted">Failed to generate solutions: ${escapeHtml(err.message)}</div>`;
    }
}

function renderSolutions() {

    const grid = document.getElementById("asaSolutionsGrid");
    if (!grid) return;

    grid.innerHTML = "";

    state.solutions.forEach((solution, index) => {

        const card = document.createElement("div");
        card.className = "asaSolutionCard";

        const scoreBars = Object.entries(solution.scores || {}).map(([key, val]) => `
            <div>
                ${escapeHtml(key)}: ${val}
                <div class="asaScoreBarTrack"><div class="asaScoreBarFill" style="width:${val}%"></div></div>
            </div>
        `).join("");

        card.innerHTML = `
            <span class="asaScorePill">Score: ${solution.totalScore}/100</span>
            <h4>${escapeHtml(solution.name)}</h4>
            <div class="asaMuted">${escapeHtml(solution.description)}</div>
            <div class="asaMuted"><strong>Components:</strong> ${(solution.components || []).map(escapeHtml).join(", ")}</div>
            ${solution.requiresHardware ? `<div class="asaMuted"><strong>Hardware needed:</strong> ${(solution.hardwareNeeded || []).map(escapeHtml).join(", ")}</div>` : `<div class="asaMuted">Software-only solution</div>`}
            <div class="asaScoreBars">${scoreBars}</div>
        `;

        const chooseBtn = document.createElement("button");
        chooseBtn.className = "asaChooseBtn";
        chooseBtn.textContent = index === 0 ? "CHOOSE (RECOMMENDED)" : "CHOOSE THIS";
        chooseBtn.addEventListener("click", () => chooseSolution(solution, card));

        card.appendChild(chooseBtn);
        grid.appendChild(card);
    });
}

/* =====================================================
   STAGE 5+: CHOSEN SOLUTION -> BOARD -> PIPELINE
===================================================== */

async function chooseSolution(solution, cardEl) {

    state.chosen = solution;

    document.querySelectorAll(".asaSolutionCard").forEach(c => c.classList.remove("chosen"));
    cardEl.classList.add("chosen");

    showStage("asaStageChosen");
    log(`Chose solution: ${solution.name}`);

    const chosenBox = document.getElementById("asaChosenBox");
    if (chosenBox) {

        chosenBox.innerHTML = `
            <strong>${escapeHtml(solution.name)}</strong><br>
            ${escapeHtml(solution.description)}<br>
            <strong>Components:</strong> ${(solution.components || []).map(escapeHtml).join(", ")}
        `;
    }

    if (solution.requiresHardware) {

        log("Stage 7: Hardware Decision Engine — this solution needs hardware, checking board fit...");

        try {

            state.board = await intelligence.selectBoard(solution, state.hardware);

            const boardBox = document.getElementById("asaBoardBox");

            if (boardBox) {

                boardBox.classList.remove("hidden");
                boardBox.innerHTML = `
                    <strong>Board:</strong> ${escapeHtml(state.board.board)}
                    ${state.board.usesDetectedHardware ? " (matches hardware you already connected)" : ""}<br>
                    ${escapeHtml(state.board.reason)}<br>
                    ${state.board.alternatives?.length ? `<strong>Alternatives:</strong> ${state.board.alternatives.map(escapeHtml).join("; ")}` : ""}
                `;
            }

            log(`Board selected: ${state.board.board}`);

        } catch (err) {

            log(`Board selection failed: ${err.message}`, "warn");
        }

    } else {

        log("Stage 7: Hardware Decision Engine — software alone is sufficient, skipping board selection.");
    }

    await runPipeline();
}

/* =====================================================
   STAGE 5 & 6: CAPABILITY GAP + GENERATION
===================================================== */

async function runPipeline() {

    showStage("asaStagePipeline");

    const registry = loadCapabilityRegistry();

    log("Stage 5: Capability Gap Analyzer — comparing needs against installed capabilities...");

    let gap;

    try {

        gap = await intelligence.analyzeCapabilityGap(state.chosen, registry);
        state.gap = gap;

    } catch (err) {

        log(`Gap analysis failed: ${err.message}`, "error");
        return;
    }

    const gapBox = document.getElementById("asaGapBox");

    if (gapBox) {

        gapBox.innerHTML = `
            <strong>Already covered:</strong> ${gap.existingCapabilitiesUsed?.length ? gap.existingCapabilitiesUsed.map(escapeHtml).join(", ") : "none"}<br>
            <strong>Missing (to generate):</strong> ${gap.missingCapabilities?.length ? gap.missingCapabilities.map(c => escapeHtml(c.name)).join(", ") : "none"}
        `;
    }

    log(`Found ${gap.missingCapabilities?.length || 0} missing capability(ies) to generate.`);

    const progressEl = document.getElementById("asaCapabilityProgress");
    if (progressEl) progressEl.innerHTML = "";

    for (const capability of (gap.missingCapabilities || [])) {

        log(`Stage 6: Capability Generator — writing "${capability.name}"...`);

        try {

            const generated = await intelligence.generateCapability(capability, state.chosen);

            state.generatedCapabilities.push({ ...capability, ...generated, addedAt: new Date().toISOString() });

            if (progressEl) {

                const row = document.createElement("div");
                row.className = "asaMuted";
                row.textContent = `✓ ${capability.name} — ${generated.files?.length || 0} file(s) generated`;
                progressEl.appendChild(row);
            }

            log(`Generated capability "${capability.name}" (${generated.files?.length || 0} file(s)).`);

        } catch (err) {

            log(`Failed to generate capability "${capability.name}": ${err.message}`, "error");
        }
    }

    saveNewCapabilitiesToRegistry(state.generatedCapabilities);
    renderCapabilityRegistry();

    buildAllFiles();

    log("Stage 10: Build Pipeline — running real static validation on generated files...");
    state.buildResult = runBuildPipeline(state.allFiles);
    renderBuildResults(state.buildResult);

    showStage("asaStageFiles");
    renderFileList();

    showStage("asaStageDeploy");

    log(`Pipeline complete: ${state.buildResult.summary.passed} passed, ${state.buildResult.summary.warned} warned, ${state.buildResult.summary.failed} failed.`);
    notify("ASA pipeline complete — review files and deploy");
}

function buildAllFiles() {

    const files = [];

    files.push({ path: "README.md", content: buildReadme() });

    state.generatedCapabilities.forEach(cap => {

        (cap.files || []).forEach(f => files.push(f));

        if (cap.testFile) files.push(cap.testFile);

        if (cap.documentation) {
            files.push({ path: `docs/${slugForPath(cap.name)}.md`, content: cap.documentation });
        }
    });

    state.allFiles = files;
}

function buildReadme() {

    const board = state.board
        ? `\n## Selected Board\n\n**${state.board.board}** — ${state.board.reason}\n`
        : "";

    const capabilities = state.generatedCapabilities
        .map(c => `- **${c.name}** — ${c.description}`)
        .join("\n") || "- (none generated)";

    return `# ${state.chosen.name}

${state.chosen.description}

## Real Goal

${state.intent.realGoal}

## Components

${(state.chosen.components || []).map(c => `- ${c}`).join("\n")}
${board}
## Generated Capabilities

${capabilities}

---
*Generated by JARVIS Autonomous Solution Architect. Firmware/hardware files (if any)
are real generated source code, but have NOT been compiled or flashed — this
browser-based tool doesn't have a hardware toolchain. Review before use.*
`;
}

function renderBuildResults(build) {

    const el = document.getElementById("asaBuildResults");
    if (!el) return;

    el.innerHTML = `<div class="asaMuted" style="margin-bottom:8px;">
        ${build.summary.passed} passed / ${build.summary.warned} warned / ${build.summary.failed} failed
    </div>`;

    build.results.forEach(r => {

        const row = document.createElement("div");
        row.className = "asaBuildRow";
        row.innerHTML = `
            <span>${escapeHtml(r.path)}</span>
            <span class="asaBuildStatus ${r.status}">${r.status.toUpperCase()}</span>
        `;
        row.title = r.message;

        el.appendChild(row);
    });
}

function renderFileList() {

    const el = document.getElementById("asaFileList");
    if (!el) return;

    el.innerHTML = "";

    state.allFiles.forEach(f => {

        const row = document.createElement("div");
        row.className = "fileTreeRow";
        row.innerHTML = `
            <span class="fileTreePath">${escapeHtml(f.path)}</span>
            <span class="fileTreePurpose">${f.content.split("\n").length} line(s)</span>
        `;

        el.appendChild(row);
    });
}

/* =====================================================
   CAPABILITY REGISTRY (persisted)
===================================================== */

function loadCapabilityRegistry() {

    try {

        const raw = localStorage.getItem(CAPABILITY_REGISTRY_KEY);
        return raw ? JSON.parse(raw) : [];

    } catch {

        return [];
    }
}

function saveNewCapabilitiesToRegistry(newCapabilities) {

    if (!newCapabilities.length) return;

    const registry = loadCapabilityRegistry();

    newCapabilities.forEach(cap => {

        registry.push({
            name: cap.name,
            description: cap.description,
            addedAt: cap.addedAt
        });
    });

    localStorage.setItem(CAPABILITY_REGISTRY_KEY, JSON.stringify(registry));
}

function renderCapabilityRegistry() {

    const grid = document.getElementById("asaCapabilityList");
    if (!grid) return;

    const registry = loadCapabilityRegistry();

    grid.innerHTML = "";

    if (!registry.length) {

        grid.innerHTML = `<div class="asaMuted">No capabilities generated yet. They'll accumulate here as ASA builds solutions, and future runs will reuse them instead of regenerating.</div>`;
        return;
    }

    registry.forEach(cap => {

        const el = document.createElement("div");
        el.className = "asaCard";
        el.innerHTML = `
            <h4>${escapeHtml(cap.name)}</h4>
            <div class="asaMuted">${escapeHtml(cap.description)}</div>
            <div class="asaMuted">Added ${new Date(cap.addedAt).toLocaleDateString()}</div>
        `;

        grid.appendChild(el);
    });
}

/* =====================================================
   STAGE 9: DEPLOYMENT
===================================================== */

function deployAsProject() {

    if (!state.allFiles.length) {
        notify("Nothing to deploy yet");
        return;
    }

    createProjectFromFiles({ name: state.chosen.name, files: state.allFiles.map(f => ({ name: f.path, content: f.content })), source: "ai-asa" });

    notify(`Project "${state.chosen.name}" saved`);
    log(`Deployed as project: ${state.chosen.name}`);
    showDeployStatus(`Saved as a project in the Project Manager: ${state.chosen.name}`);
}

async function deployAsZip() {

    try {

        const result = await deployment.exportAsZip(state.chosen.name, state.allFiles);
        log(`Deployment (ZIP): ${result.detail}`);
        showDeployStatus(result.detail);

    } catch (err) {

        log(`ZIP export failed: ${err.message}`, "error");
        showDeployStatus(`ZIP export failed: ${err.message}`);
    }
}

async function deployToFolder() {

    try {

        const result = await deployment.saveToFolder(state.allFiles);
        log(`Deployment (folder): ${result.detail}`);
        showDeployStatus(result.detail);

    } catch (err) {

        log(`Folder save failed: ${err.message}`, "error");
        showDeployStatus(`Folder save failed: ${err.message}`);
    }
}

function saveGithubToken() {

    const input = document.getElementById("asaGithubToken");
    const token = input?.value.trim();

    if (!token) {
        notify("Enter a token first");
        return;
    }

    deployment.setGithubToken(token);
    input.value = "";
    input.placeholder = "Token saved (hidden)";

    notify("GitHub token saved locally");
    log("GitHub token saved (stored only in this browser's localStorage).");
}

async function deployToGithub() {

    if (!state.allFiles.length) {
        notify("Nothing to deploy yet");
        return;
    }

    log("Deployment (GitHub): pushing files via the real GitHub REST API...");

    try {

        const result = await deployment.pushToGithub(state.chosen.name, state.allFiles);
        log(`Deployment (GitHub): ${result.detail}`);
        showDeployStatus(`${result.detail} — <a href="${result.url}" target="_blank" style="color:cyan;">${result.url}</a>`);

    } catch (err) {

        log(`GitHub push failed: ${err.message}`, "error");
        showDeployStatus(`GitHub push failed: ${err.message}`);
    }
}

function showDeployStatus(html) {

    const box = document.getElementById("asaDeployStatus");
    if (!box) return;

    box.classList.remove("hidden");
    box.innerHTML = html;
}

/* =====================================================
   HELPERS
===================================================== */

function toggleBtn(id, disabled, text) {

    const btn = document.getElementById(id);
    if (!btn) return;

    btn.disabled = disabled;
    if (text) btn.textContent = text;
}

function slugForPath(name) {

    return (name || "capability").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function escapeHtml(str) {

    return String(str ?? "").replace(/[&<>"']/g, ch => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
}