/* =====================================================
   JARVIS - PROJECT MANAGER + CODE EDITOR MODULE
===================================================== */

import { notify, addSystemLog } from "./ui.js";

const STORAGE_KEY = "jarvis_projects";

const TEXT_EXTENSIONS = [
    "js", "mjs", "cjs", "ts", "tsx", "jsx",
    "html", "htm", "css", "json", "md", "markdown",
    "py", "txt", "xml", "yml", "yaml", "sh", "bash",
    "c", "h", "cpp", "hpp", "java", "go", "rs", "rb", "php"
];

/* projects live in localStorage (serializable data only) */
let projects = [];
let activeProjectId = null;
let activeFileId = null;

/* real FileSystemFileHandle objects can't be serialized,
   so they only live in memory for the current session */
const fileHandles = new Map();

let editor = null;
let dirty = false;

/* =====================================================
   INIT
===================================================== */

export function initProjects() {

    loadProjects();
    renderProjectList();
    renderFileList();
    renderEditorState();

    document
        .getElementById("newProjectBtn")
        ?.addEventListener("click", createProject);

    document
        .getElementById("saveProjectBtn")
        ?.addEventListener("click", () => {
            saveProjects();
            notify("All Projects Saved");
        });

    document
        .getElementById("deleteProjectBtn")
        ?.addEventListener("click", deleteActiveProject);

    document
        .getElementById("newFileBtn")
        ?.addEventListener("click", createBlankFile);

    document
        .getElementById("importFilesBtn")
        ?.addEventListener("click", importFiles);

    document
        .getElementById("openFolderBtn")
        ?.addEventListener("click", openFolder);

    document
        .getElementById("importFilesInput")
        ?.addEventListener("change", handleInputImport);

    document
        .getElementById("saveFileBtn")
        ?.addEventListener("click", saveActiveFile);

    document
        .getElementById("downloadFileBtn")
        ?.addEventListener("click", downloadActiveFile);

    document.addEventListener("keydown", (event) => {

        const isSave =
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "s";

        if (isSave && document.getElementById("projectsPanel")?.classList.contains("active")) {

            event.preventDefault();
            saveActiveFile();
        }
    });
}

/* Called by main.js right after the Project Manager window is shown,
   since CodeMirror measures itself wrong inside a display:none container */
export function refreshEditor() {

    editor?.refresh();
}

/* =====================================================
   PERSISTENCE
===================================================== */

function loadProjects() {

    try {

        const raw = localStorage.getItem(STORAGE_KEY);

        projects = raw ? JSON.parse(raw) : [];

    } catch {

        projects = [];
    }
}

function saveProjects() {

    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(projects)
    );

    addSystemLog("Projects saved to browser storage");
}

/* =====================================================
   PROJECT CRUD
===================================================== */

function createProject() {

    const name = prompt("Project name:");

    if (!name) return;

    const project = {
        id: crypto.randomUUID(),
        name,
        createdAt: new Date().toISOString(),
        files: []
    };

    projects.push(project);

    activeProjectId = project.id;
    activeFileId = null;

    saveProjects();
    renderProjectList();
    renderFileList();
    closeEditor();

    addSystemLog(`Project created: ${name}`);
}

function deleteActiveProject() {

    if (!activeProjectId) {

        notify("No project selected");
        return;
    }

    const project =
        projects.find(p => p.id === activeProjectId);

    if (!project) return;

    if (!confirm(`Delete project "${project.name}"?`))
        return;

    project.files.forEach(f => fileHandles.delete(f.id));

    projects =
        projects.filter(p => p.id !== activeProjectId);

    activeProjectId = null;
    activeFileId = null;

    saveProjects();
    renderProjectList();
    renderFileList();
    closeEditor();

    addSystemLog(`Project deleted: ${project.name}`);
}

/* =====================================================
   FILE CRUD
===================================================== */

function createBlankFile() {

    const project = getActiveProject();

    if (!project) {

        notify("Select a project first");
        return;
    }

    const name = prompt("File name (e.g. script.js):");

    if (!name) return;

    const file = {
        id: crypto.randomUUID(),
        name,
        content: "",
        createdAt: new Date().toISOString(),
        source: "manual"
    };

    project.files.push(file);

    saveProjects();
    renderFileList();
    openFile(project.id, file.id);

    addSystemLog(`File created: ${name}`);
}

function deleteFile(projectId, fileId) {

    const project = projects.find(p => p.id === projectId);

    if (!project) return;

    const file = project.files.find(f => f.id === fileId);

    if (!file) return;

    if (!confirm(`Delete "${file.name}"?`)) return;

    project.files = project.files.filter(f => f.id !== fileId);
    fileHandles.delete(fileId);

    if (activeFileId === fileId) {
        closeEditor();
    }

    saveProjects();
    renderFileList();

    addSystemLog(`File deleted: ${file.name}`);
}

function getActiveProject() {

    return projects.find(p => p.id === activeProjectId);
}

function getActiveFile() {

    const project = getActiveProject();

    return project?.files.find(f => f.id === activeFileId);
}

/* =====================================================
   RESEARCH AGENT / ASA HAND-OFF
===================================================== */

export function getAllProjectFiles() {

    return projects.flatMap(project =>
        project.files.map(file => ({
            projectName: project.name,
            projectId: project.id,
            fileName: file.name,
            fileId: file.id,
            content: file.content || ""
        }))
    );
}

export function createProjectFromResearch({ name, files }) {

    return createProjectFromFiles({ name, files, source: "ai-research" });
}

export function createProjectFromFiles({ name, files, source = "ai-generated" }) {

    const project = {
        id: crypto.randomUUID(),
        name: name || "Untitled Project",
        createdAt: new Date().toISOString(),
        files: (files || []).map(f => ({
            id: crypto.randomUUID(),
            name: f.name,
            content: f.content || "",
            createdAt: new Date().toISOString(),
            source
        }))
    };

    projects.push(project);

    activeProjectId = project.id;
    activeFileId = project.files[0]?.id || null;

    saveProjects();
    renderProjectList();
    renderFileList();

    if (activeFileId) {
        openFile(project.id, activeFileId);
    }

    addSystemLog(`Project created: ${project.name}`);

    return project;
}

/* =====================================================
   IMPORT REAL FILES FROM THE SYSTEM
===================================================== */

async function importFiles() {

    if (!activeProjectId) {

        notify("Select or create a project first");
        return;
    }

    if (window.showOpenFilePicker) {

        try {

            const handles =
                await window.showOpenFilePicker({ multiple: true });

            let count = 0;

            for (const handle of handles) {

                await addFileFromHandle(handle);
                count++;
            }

            notify(`Imported ${count} file(s) from your system`);
            addSystemLog(`Imported ${count} real file(s)`);

            return;

        } catch (err) {

            if (err.name === "AbortError") return;

            console.warn("File System Access API failed, falling back:", err);
        }
    }

    // Fallback for browsers without the File System Access API (Firefox, Safari)
    document.getElementById("importFilesInput")?.click();
}

async function handleInputImport(event) {

    const project = getActiveProject();

    if (!project) {

        notify("Select a project first");
        event.target.value = "";
        return;
    }

    const files = Array.from(event.target.files || []);

    for (const f of files) {

        const content = await f.text();

        project.files.push({
            id: crypto.randomUUID(),
            name: f.name,
            content,
            createdAt: new Date().toISOString(),
            source: "system"
        });
    }

    saveProjects();
    renderFileList();

    notify(`Imported ${files.length} file(s) from your system`);
    addSystemLog(`Imported ${files.length} real file(s) (read-only handle)`);

    event.target.value = "";
}

async function addFileFromHandle(handle) {

    const project = getActiveProject();

    if (!project) return;

    const fileObj = await handle.getFile();
    const content = await fileObj.text();

    const id = crypto.randomUUID();

    project.files.push({
        id,
        name: fileObj.name,
        content,
        createdAt: new Date().toISOString(),
        source: "system"
    });

    fileHandles.set(id, handle);

    saveProjects();
    renderFileList();
}

async function openFolder() {

    if (!window.showDirectoryPicker) {

        notify("Folder import isn't supported in this browser (try Chrome or Edge)");
        return;
    }

    if (!activeProjectId) {

        notify("Select or create a project first");
        return;
    }

    try {

        const dirHandle = await window.showDirectoryPicker();

        let count = 0;

        for await (const fileHandle of walkDirectory(dirHandle)) {

            await addFileFromHandle(fileHandle);
            count++;

            if (count >= 200) break; // safety cap for huge folders
        }

        notify(`Imported ${count} file(s) from "${dirHandle.name}"`);
        addSystemLog(`Imported folder: ${dirHandle.name} (${count} files)`);

    } catch (err) {

        if (err.name !== "AbortError") console.error(err);
    }
}

async function* walkDirectory(dirHandle) {

    for await (const [name, handle] of dirHandle.entries()) {

        if (name === "node_modules" || name === ".git" || name.startsWith(".")) {
            continue;
        }

        if (handle.kind === "file") {

            if (isTextFile(name)) yield handle;

        } else if (handle.kind === "directory") {

            yield* walkDirectory(handle);
        }
    }
}

function isTextFile(name) {

    const ext = name.split(".").pop().toLowerCase();

    return TEXT_EXTENSIONS.includes(ext);
}

/* =====================================================
   CODE EDITOR
===================================================== */

function ensureEditor() {

    if (editor) return editor;

    const container = document.getElementById("codeEditor");

    if (!container || !window.CodeMirror) return null;

    editor = window.CodeMirror(container, {
        value: "",
        lineNumbers: true,
        theme: "dracula",
        mode: null,
        tabSize: 2,
        indentUnit: 2,
        viewportMargin: Infinity
    });

    editor.on("change", () => {

        if (!activeFileId) return;

        markDirty(true);
    });

    return editor;
}

function getModeForFile(name) {

    const ext = name.split(".").pop().toLowerCase();

    const map = {
        js: "javascript", mjs: "javascript", cjs: "javascript",
        jsx: "javascript", ts: "javascript", tsx: "javascript",
        json: { name: "javascript", json: true },
        html: "htmlmixed", htm: "htmlmixed", xml: "xml",
        css: "css",
        py: "python",
        md: "markdown", markdown: "markdown",
        java: "text/x-java",
        c: "text/x-csrc", h: "text/x-csrc",
        cpp: "text/x-c++src", hpp: "text/x-c++src",
        sh: "shell", bash: "shell"
    };

    return map[ext] || null;
}

function openFile(projectId, fileId) {

    if (dirty && activeFileId && activeFileId !== fileId) {

        const discard = confirm("You have unsaved changes. Discard them?");

        if (!discard) return;
    }

    const project = projects.find(p => p.id === projectId);
    const file = project?.files.find(f => f.id === fileId);

    if (!project || !file) return;

    activeProjectId = projectId;
    activeFileId = fileId;

    const ed = ensureEditor();

    if (ed) {

        ed.setOption("mode", getModeForFile(file.name));
        ed.setValue(file.content || "");

        setTimeout(() => ed.refresh(), 30);
    }

    markDirty(false);
    renderEditorState();
    renderFileList();
}

function closeEditor() {

    activeFileId = null;

    editor?.setValue("");

    markDirty(false);
    renderEditorState();
}

function markDirty(state) {

    dirty = state;

    const dot = document.getElementById("unsavedDot");

    if (dot) dot.classList.toggle("hidden", !dirty);
}

async function saveActiveFile() {

    const project = getActiveProject();
    const file = getActiveFile();

    if (!project || !file || !editor) {

        notify("No file open");
        return;
    }

    file.content = editor.getValue();
    file.modifiedAt = new Date().toISOString();

    saveProjects();

    let handle = fileHandles.get(file.id);

    // Handles don't survive a page reload — offer to re-link a system file
    if (!handle && file.source === "system" && window.showOpenFilePicker) {

        const relink = confirm(
            `"${file.name}" was imported from your system, but its live link isn't available in this session (browsers don't persist file access across reloads).\n\nPick it again to write your changes directly to disk? (Cancel just saves inside JARVIS.)`
        );

        if (relink) {

            try {

                const [picked] = await window.showOpenFilePicker();

                handle = picked;
                fileHandles.set(file.id, handle);

            } catch {
                // user cancelled the picker — fall through to in-app save
            }
        }
    }

    if (handle) {

        try {

            const writable = await handle.createWritable();

            await writable.write(file.content);
            await writable.close();

            notify(`Saved to disk: ${file.name}`);
            addSystemLog(`Wrote real file to disk: ${file.name}`);

        } catch (err) {

            console.error(err);
            notify("Could not write to disk (check permissions)");
        }

    } else {

        notify(`Saved: ${file.name}`);
        addSystemLog(`Saved file: ${file.name}`);
    }

    markDirty(false);
    renderFileList();
}

function downloadActiveFile() {

    const file = getActiveFile();

    if (!file || !editor) {

        notify("No file open");
        return;
    }

    const content = editor.getValue();

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");

    a.href = url;
    a.download = file.name;
    a.click();

    URL.revokeObjectURL(url);

    addSystemLog(`Downloaded file: ${file.name}`);
}

/* =====================================================
   RENDERING
===================================================== */

function renderProjectList() {

    const list = document.getElementById("projectList");

    if (!list) return;

    list.innerHTML = "";

    projects.forEach(project => {

        const card = document.createElement("div");

        card.className = "projectCard";
        card.textContent = project.name;

        if (project.id === activeProjectId) {
            card.style.background = "rgba(0,255,255,.12)";
        }

        card.addEventListener("click", () => {

            activeProjectId = project.id;
            activeFileId = null;

            renderProjectList();
            renderFileList();
            closeEditor();
        });

        list.appendChild(card);
    });
}

function renderFileList() {

    const list = document.getElementById("fileList");

    if (!list) return;

    list.innerHTML = "";

    const project = getActiveProject();

    if (!project) return;

    project.files.forEach(file => {

        const card = document.createElement("div");

        card.className = "fileCard";

        if (file.id === activeFileId) {
            card.classList.add("activeFile");
        }

        const nameSpan = document.createElement("span");
        nameSpan.className = "fileCardName";
        nameSpan.textContent = file.name;

        card.appendChild(nameSpan);

        if (file.source === "system") {

            const tag = document.createElement("span");
            tag.className = "sourceTag";
            tag.textContent = fileHandles.has(file.id) ? "LINKED" : "SYSTEM";

            card.appendChild(tag);

        } else if (file.source?.startsWith("ai-")) {

            const tag = document.createElement("span");
            tag.className = "sourceTag";
            tag.textContent = file.source === "ai-asa" ? "ASA" : "AI";

            card.appendChild(tag);
        }

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "fileDeleteBtn";
        deleteBtn.textContent = "✕";
        deleteBtn.title = "Delete file";

        deleteBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            deleteFile(project.id, file.id);
        });

        card.appendChild(deleteBtn);

        card.addEventListener("click", () => {
            openFile(project.id, file.id);
        });

        list.appendChild(card);
    });
}

function renderEditorState() {

    const nameEl = document.getElementById("editorFileName");
    const metaEl = document.getElementById("projectMeta");

    const project = getActiveProject();
    const file = getActiveFile();

    if (nameEl) {
        nameEl.textContent = file ? file.name : "No File Selected";
    }

    if (!metaEl) return;

    if (!project) {

        metaEl.textContent = "No Project Selected";
        return;
    }

    if (!file) {

        metaEl.textContent =
            `${project.name} — ${project.files.length} file(s)`;
        return;
    }

    const sourceLabel =
        file.source === "system"
            ? (fileHandles.has(file.id) ? "system file (linked, saves to disk)" : "system file (imported copy)")
            : file.source === "ai-research"
                ? "generated by Research Agent"
                : file.source === "ai-asa"
                    ? "generated by Autonomous Solution Architect"
                    : "created in JARVIS";

    metaEl.textContent =
        `${project.name} / ${file.name} — ${sourceLabel}`;
}