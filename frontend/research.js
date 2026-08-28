/* =====================================================
   JARVIS - RESEARCH AGENT MODULE
===================================================== */

import { getSettings, setSettings, checkStatus, generateJSON } from "./ollama.js";
import { createProjectFromResearch } from "./projects.js";
import { notify, addSystemLog } from "./ui.js";
import * as sources from "./sources.js";

let lastReport = null;
let lastSourceBundle = null;
let manualSources = [];

/* =====================================================
   INIT
===================================================== */

export function initResearch() {

    const settings = getSettings();

    const hostInput = document.getElementById("researchHostInput");
    if (hostInput) hostInput.value = settings.host;

    document.getElementById("startResearchBtn")?.addEventListener("click", runResearch);
    document.getElementById("draftProjectBtn")?.addEventListener("click", draftProject);
    document.getElementById("createProjectFromResearchBtn")?.addEventListener("click", handleCreateProject);

    document.getElementById("researchOllamaRefresh")?.addEventListener("click", refreshConnection);

    document.getElementById("researchModelSelect")?.addEventListener("change", (event) => {
        setSettings({ model: event.target.value });
    });

    hostInput?.addEventListener("change", () => {
        setSettings({ host: hostInput.value.trim() || "http://localhost:11434" });
        refreshConnection();
    });

    document.getElementById("researchFetchUrlBtn")?.addEventListener("click", handleFetchUrl);
    document.getElementById("researchAddPasteBtn")?.addEventListener("click", handleAddPaste);

    refreshConnection();
}

export function refreshResearchPanel() {

    refreshConnection();
}

/* =====================================================
   CONNECTION
===================================================== */

async function refreshConnection() {

    const dot = document.getElementById("researchOllamaDot");
    const label = document.getElementById("researchOllamaLabel");
    const select = document.getElementById("researchModelSelect");

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
        if (label) label.textContent = "Can't reach Ollama. Run 'ollama serve' locally (see hint below).";
        if (select) select.innerHTML = `<option value="">No models found</option>`;
    }
}

/* =====================================================
   MANUAL SOURCES
===================================================== */

async function handleFetchUrl() {

    const input = document.getElementById("researchUrlInput");
    const url = input?.value.trim();

    if (!url) return;

    setStatusLine(`Fetching ${url}...`);

    const result = await sources.fetchUrlSource(url);

    if (result.ok) {

        manualSources.push({ type: "url", label: url, text: result.text });
        renderManualList();
        input.value = "";
        setStatusLine(`Fetched ${url}.`);

    } else {

        setStatusLine(result.reason);
    }
}

function handleAddPaste() {

    const textarea = document.getElementById("researchPasteInput");
    const text = textarea?.value.trim();

    if (!text) return;

    manualSources.push({ type: "paste", label: `Pasted text (${text.length} chars)`, text });
    renderManualList();
    textarea.value = "";
}

function renderManualList() {

    const list = document.getElementById("researchManualList");
    if (!list) return;

    list.innerHTML = "";

    manualSources.forEach((src, i) => {

        const row = document.createElement("div");
        row.className = "researchManualItem";

        const label = document.createElement("span");
        label.textContent = src.label;

        const removeBtn = document.createElement("button");
        removeBtn.textContent = "✕";
        removeBtn.addEventListener("click", () => {
            manualSources.splice(i, 1);
            renderManualList();
        });

        row.appendChild(label);
        row.appendChild(removeBtn);
        list.appendChild(row);
    });
}

/* =====================================================
   RESEARCH PIPELINE
===================================================== */

export function startResearchOnTopic(topic) {

    const input = document.getElementById("researchTopicInput");
    if (input && topic) input.value = topic;

    return runResearch();
}

async function runResearch() {

    const topic = document.getElementById("researchTopicInput")?.value.trim();

    if (!topic) {
        notify("Describe a topic first");
        return;
    }

    const { model, host } = getSettings();

    if (!model) {
        setStatusLine("No Ollama model selected — refresh the connection above.");
        return;
    }

    toggleButton(true);
    setStatusLine("Gathering sources...");
    addSystemLog(`Research Agent: gathering sources for "${topic}"`);

    const useWikipedia = document.getElementById("srcWikipedia")?.checked;
    const useDuckDuckGo = document.getElementById("srcDuckDuckGo")?.checked;
    const useProjectFiles = document.getElementById("srcProjectFiles")?.checked;

    const bundle = { topic, wikipedia: null, related: null, duckduckgo: null, projectFiles: [], manual: manualSources };

    try {

        if (useWikipedia) {
            bundle.wikipedia = await sources.fetchWikipediaSummary(topic);
            bundle.related = await sources.fetchWikipediaRelated(topic);
        }

        if (useDuckDuckGo) {
            bundle.duckduckgo = await sources.fetchDuckDuckGo(topic);
        }

        if (useProjectFiles) {
            bundle.projectFiles = sources.findRelevantProjectFiles(topic);
        }

        lastSourceBundle = bundle;
        renderSourcesUsed(bundle);

        setStatusLine("Synthesizing report from gathered sources...");
        addSystemLog("Research Agent: synthesizing report with local model");

        const prompt = buildResearchPrompt(bundle);
        const data = await generateJSON(prompt, { model, host });

        lastReport = normalizeReport(data, topic);
        renderReport(lastReport);

        setStatusLine("Research complete.");
        notify("Research Complete");
        addSystemLog("Research Agent: report generated");

    } catch (err) {

        console.error(err);
        setStatusLine(`Research failed: ${err.message}`);
        notify("Research Failed");

    } finally {

        toggleButton(false);
    }
}

function buildResearchPrompt(bundle) {

    const sections = [];

    if (bundle.wikipedia?.ok) {
        sections.push(`WIKIPEDIA SUMMARY:\n${bundle.wikipedia.extract}`);
    }

    if (bundle.related?.ok && bundle.related.related.length) {
        sections.push(`RELATED WIKIPEDIA TOPICS:\n${bundle.related.related.map(r => r.title).join(", ")}`);
    }

    if (bundle.duckduckgo?.ok) {

        if (bundle.duckduckgo.abstract) {
            sections.push(`DUCKDUCKGO ABSTRACT (source: ${bundle.duckduckgo.abstractSource}):\n${bundle.duckduckgo.abstract}`);
        }

        if (bundle.duckduckgo.relatedTopics.length) {
            sections.push(`DUCKDUCKGO RELATED FACTS:\n${bundle.duckduckgo.relatedTopics.map(t => `- ${t.text}`).join("\n")}`);
        }
    }

    if (bundle.projectFiles.length) {

        sections.push(`RELEVANT FILES ALREADY IN THE PROJECT MANAGER:\n` + bundle.projectFiles.map(f =>
            `--- ${f.projectName}/${f.fileName} ---\n${f.content.slice(0, 1500)}`
        ).join("\n\n"));
    }

    bundle.manual.forEach((src, i) => {
        sections.push(`MANUAL SOURCE ${i + 1} (${src.label}):\n${src.text.slice(0, 2000)}`);
    });

    const sourceBlock = sections.length
        ? sections.join("\n\n")
        : "No external sources were gathered (all sources disabled or unavailable) — reason from general knowledge, but say so plainly in the summary.";

    return `You are the synthesis stage of a research agent. Research topic:

"${bundle.topic}"

You have been given real material gathered from multiple sources. Base your
report primarily on this material — don't just recite generic knowledge, and
don't invent facts that aren't supported by the sources or well-established
general knowledge. If sources conflict or are thin, say so.

=== GATHERED SOURCE MATERIAL ===

${sourceBlock}

=== END SOURCE MATERIAL ===

Respond with ONLY valid JSON (no markdown fences, no commentary) matching
exactly this shape:

{
  "title": "short descriptive title for this research topic",
  "summary": "3-5 sentence synthesis of what the gathered sources say about this topic",
  "keyFindings": ["specific finding grounded in the sources", "..."],
  "sourceBreakdown": ["one short tag per source actually used, e.g. 'Wikipedia: background/history', 'Project file X: prior notes'"],
  "openQuestions": ["a genuine open question or gap the sources didn't resolve", "..."]
}`;
}

function normalizeReport(data, topic) {

    return {
        title: data.title || topic.slice(0, 60),
        summary: data.summary || "No summary was returned by the model.",
        keyFindings: Array.isArray(data.keyFindings) ? data.keyFindings : [],
        sourceBreakdown: Array.isArray(data.sourceBreakdown) ? data.sourceBreakdown : [],
        openQuestions: Array.isArray(data.openQuestions) ? data.openQuestions : [],
        fileStructure: [],
        starterFiles: []
    };
}

/* =====================================================
   RENDERING: SOURCES CONSULTED (transparency panel)
===================================================== */

function renderSourcesUsed(bundle) {

    const wrap = document.getElementById("researchSourcesUsed");
    const grid = document.getElementById("researchSourcesGrid");

    if (!wrap || !grid) return;

    wrap.classList.remove("hidden");
    grid.innerHTML = "";

    if (bundle.wikipedia) {

        grid.appendChild(sourceCard(
            "Wikipedia",
            bundle.wikipedia.ok
                ? `${truncate(bundle.wikipedia.extract, 220)}`
                : bundle.wikipedia.reason,
            bundle.wikipedia.ok ? bundle.wikipedia.url : null,
            !bundle.wikipedia.ok
        ));
    }

    if (bundle.duckduckgo) {

        grid.appendChild(sourceCard(
            "DuckDuckGo",
            bundle.duckduckgo.ok
                ? truncate(bundle.duckduckgo.abstract || bundle.duckduckgo.relatedTopics.map(t => t.text).join(" / "), 220)
                : bundle.duckduckgo.reason,
            bundle.duckduckgo.ok ? bundle.duckduckgo.abstractUrl : null,
            !bundle.duckduckgo.ok
        ));
    }

    if (bundle.projectFiles.length) {

        bundle.projectFiles.forEach(f => {

            grid.appendChild(sourceCard(
                `Project file: ${f.fileName}`,
                `From project "${f.projectName}" — ${truncate(f.content, 160)}`,
                null,
                false
            ));
        });

    } else if (document.getElementById("srcProjectFiles")?.checked) {

        grid.appendChild(sourceCard("Project Manager Files", "No stored files matched this topic's keywords.", null, true));
    }

    bundle.manual.forEach(src => {

        grid.appendChild(sourceCard(src.label, truncate(src.text, 220), null, false));
    });

    if (!grid.children.length) {

        grid.innerHTML = `<div class="asaMuted">No sources were gathered — enable a source or add one manually.</div>`;
    }
}

function sourceCard(title, body, url, unavailable) {

    const el = document.createElement("div");
    el.className = `asaCard researchSourceCard${unavailable ? " unavailable" : ""}`;

    el.innerHTML = `
        <h4>${escapeHtml(title)}</h4>
        <div>${escapeHtml(body)}</div>
        ${url ? `<a href="${escapeAttr(url)}" target="_blank">${escapeHtml(url)}</a>` : ""}
    `;

    return el;
}

/* =====================================================
   RENDERING: REPORT
===================================================== */

function renderReport(report) {

    document.getElementById("researchReportEmpty")?.classList.add("hidden");
    document.getElementById("researchReport")?.classList.remove("hidden");
    document.getElementById("reportProjectSection")?.classList.add("hidden");
    document.getElementById("createProjectFromResearchBtn")?.classList.add("hidden");

    const draftBtn = document.getElementById("draftProjectBtn");
    if (draftBtn) {
        draftBtn.classList.remove("hidden");
        draftBtn.disabled = false;
        draftBtn.textContent = "DRAFT STARTER PROJECT FROM THIS";
    }

    setText("reportTitle", report.title);
    setText("reportSummary", report.summary);

    fillList("reportFeatures", report.keyFindings);
    fillList("reportNextSteps", report.openQuestions);

    const stackEl = document.getElementById("reportStack");

    if (stackEl) {

        stackEl.innerHTML = "";

        report.sourceBreakdown.forEach(tag => {

            const el = document.createElement("span");
            el.textContent = tag;
            stackEl.appendChild(el);
        });
    }
}

function setText(id, text) {

    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function fillList(id, items) {

    const el = document.getElementById(id);
    if (!el) return;

    el.innerHTML = "";

    if (!items.length) {

        const li = document.createElement("li");
        li.textContent = "None identified.";
        el.appendChild(li);
        return;
    }

    items.forEach(item => {

        const li = document.createElement("li");
        li.textContent = item;
        el.appendChild(li);
    });
}

function setStatusLine(text) {

    const el = document.getElementById("researchStatusLine");
    if (el) el.textContent = text;
}

function toggleButton(disabled) {

    const btn = document.getElementById("startResearchBtn");
    if (!btn) return;

    btn.disabled = disabled;
    btn.textContent = disabled ? "RESEARCHING..." : "GATHER & RESEARCH";
}

/* =====================================================
   OPTIONAL FOLLOW-UP: DRAFT A STARTER PROJECT
===================================================== */

async function draftProject() {

    if (!lastReport) {
        notify("Run research first");
        return;
    }

    const { model, host } = getSettings();
    const btn = document.getElementById("draftProjectBtn");

    if (btn) {
        btn.disabled = true;
        btn.textContent = "DRAFTING...";
    }

    setStatusLine("Drafting a starter project from this research...");

    const prompt = `Based on this research report, decide whether a small starter
software project would meaningfully help someone act on it (it might not —
say so honestly if this topic isn't really a "build something" topic).

RESEARCH REPORT:
Title: ${lastReport.title}
Summary: ${lastReport.summary}
Key findings: ${lastReport.keyFindings.join("; ")}

Respond with ONLY valid JSON:
{
  "applicable": true or false,
  "reasonIfNotApplicable": "explanation if applicable is false, else empty string",
  "fileStructure": [{ "path": "relative/file/path", "purpose": "one line" }],
  "starterFiles": [{ "path": "relative/file/path", "content": "full real file contents" }]
}

Keep starterFiles to at most 4 files with real, runnable content — not placeholders.`;

    try {

        const data = await generateJSON(prompt, { model, host });

        if (!data.applicable) {

            setStatusLine(data.reasonIfNotApplicable || "This topic doesn't map well to a starter project.");
            if (btn) {
                btn.textContent = "NOT APPLICABLE TO THIS TOPIC";
            }
            return;
        }

        lastReport.fileStructure = Array.isArray(data.fileStructure) ? data.fileStructure : [];
        lastReport.starterFiles = Array.isArray(data.starterFiles) ? data.starterFiles : [];

        renderFileStructure(lastReport.fileStructure);

        document.getElementById("reportProjectSection")?.classList.remove("hidden");
        document.getElementById("createProjectFromResearchBtn")?.classList.remove("hidden");

        if (btn) btn.classList.add("hidden");

        setStatusLine("Starter project drafted — review below.");

    } catch (err) {

        console.error(err);
        setStatusLine(`Couldn't draft a project: ${err.message}`);
        if (btn) {
            btn.disabled = false;
            btn.textContent = "DRAFT STARTER PROJECT FROM THIS";
        }
    }
}

function renderFileStructure(fileStructure) {

    const filesEl = document.getElementById("reportFiles");
    if (!filesEl) return;

    filesEl.innerHTML = "";

    fileStructure.forEach(entry => {

        const row = document.createElement("div");
        row.className = "fileTreeRow";

        row.innerHTML = `
            <span class="fileTreePath">${escapeHtml(entry.path || "(unnamed)")}</span>
            <span class="fileTreePurpose">${escapeHtml(entry.purpose || "")}</span>
        `;

        filesEl.appendChild(row);
    });
}

/* =====================================================
   HAND-OFF TO PROJECT MANAGER
===================================================== */

function handleCreateProject() {

    if (!lastReport || !lastReport.starterFiles.length) {
        notify("Draft a starter project first");
        return;
    }

    const files = [
        { name: "README.md", content: buildReadme(lastReport) },
        { name: "SOURCES.md", content: buildSourcesDoc(lastSourceBundle) },
        ...lastReport.starterFiles.map(f => ({ name: f.path, content: f.content || "" }))
    ];

    createProjectFromResearch({ name: lastReport.title, files });

    notify(`Project "${lastReport.title}" created`);
    addSystemLog(`Research project handed off to Project Manager: ${lastReport.title}`);
}

function buildReadme(report) {

    const findings = report.keyFindings.map(f => `- ${f}`).join("\n") || "- (none)";
    const questions = report.openQuestions.map(q => `- ${q}`).join("\n") || "- (none)";
    const structure = report.fileStructure.map(f => `- \`${f.path}\` — ${f.purpose}`).join("\n") || "- (none)";

    return `# ${report.title}

${report.summary}

## Key Findings

${findings}

## Open Questions

${questions}

## File Structure

${structure}

---
*Generated by JARVIS Research Agent. See SOURCES.md for exactly what was consulted.*
`;
}

function buildSourcesDoc(bundle) {

    if (!bundle) return "No source bundle recorded.";

    const lines = [`# Sources Consulted for "${bundle.topic}"`, ""];

    if (bundle.wikipedia) {

        lines.push("## Wikipedia");
        lines.push(bundle.wikipedia.ok
            ? `${bundle.wikipedia.extract}\n\nSource: ${bundle.wikipedia.url}`
            : `Not available: ${bundle.wikipedia.reason}`);
        lines.push("");
    }

    if (bundle.duckduckgo) {

        lines.push("## DuckDuckGo");
        lines.push(bundle.duckduckgo.ok
            ? `${bundle.duckduckgo.abstract}\n\nSource: ${bundle.duckduckgo.abstractUrl}`
            : `Not available: ${bundle.duckduckgo.reason}`);
        lines.push("");
    }

    if (bundle.projectFiles?.length) {

        lines.push("## Project Manager Files Used");
        bundle.projectFiles.forEach(f => lines.push(`- ${f.projectName}/${f.fileName}`));
        lines.push("");
    }

    if (bundle.manual?.length) {

        lines.push("## Manually Added Sources");
        bundle.manual.forEach(s => lines.push(`- ${s.label}`));
    }

    return lines.join("\n");
}

/* =====================================================
   HELPERS
===================================================== */

function truncate(str, len) {

    if (!str) return "";
    return str.length > len ? str.slice(0, len) + "…" : str;
}

function escapeHtml(str) {

    return String(str ?? "").replace(/[&<>"']/g, ch => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
}

function escapeAttr(str) {

    return String(str ?? "").replace(/"/g, "&quot;");
}