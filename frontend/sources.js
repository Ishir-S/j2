/* =====================================================
   JARVIS - RESEARCH AGENT: SOURCE GATHERING
   Every function here either does a real network fetch
   to a public, keyless, CORS-enabled API, or does a real
   local scan of files already stored in the Project
   Manager. Nothing here is templated or fabricated —
   if a source is unreachable it reports that honestly
   instead of returning fake data.
===================================================== */

import { getAllProjectFiles } from "./projects.js";

/* =====================================================
   WIKIPEDIA
===================================================== */

export async function fetchWikipediaSummary(topic) {

    try {

        const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`;
        const res = await fetch(url);

        if (!res.ok) {
            return { ok: false, reason: `No direct Wikipedia article found for "${topic}" (HTTP ${res.status}).` };
        }

        const data = await res.json();

        return {
            ok: true,
            title: data.title,
            extract: data.extract,
            url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(topic)}`
        };

    } catch (err) {

        return { ok: false, reason: `Wikipedia request failed: ${err.message}` };
    }
}

export async function fetchWikipediaRelated(topic, limit = 5) {

    try {

        const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(topic)}&limit=${limit}&format=json&origin=*`;
        const res = await fetch(url);

        if (!res.ok) {
            return { ok: false, reason: `Wikipedia search failed (HTTP ${res.status}).`, titles: [] };
        }

        const data = await res.json();
        const titles = data[1] || [];
        const links = data[3] || [];

        return {
            ok: true,
            related: titles.map((title, i) => ({ title, url: links[i] }))
        };

    } catch (err) {

        return { ok: false, reason: `Wikipedia search failed: ${err.message}`, related: [] };
    }
}

/* =====================================================
   DUCKDUCKGO INSTANT ANSWER
===================================================== */

export async function fetchDuckDuckGo(topic) {

    try {

        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(topic)}&format=json&no_html=1&skip_disambig=1`;
        const res = await fetch(url);

        if (!res.ok) {
            return { ok: false, reason: `DuckDuckGo request failed (HTTP ${res.status}).` };
        }

        const data = await res.json();

        const relatedTopics = (data.RelatedTopics || [])
            .filter(t => t.Text)
            .slice(0, 6)
            .map(t => ({ text: t.Text, url: t.FirstURL }));

        if (!data.AbstractText && !relatedTopics.length) {

            return { ok: false, reason: "DuckDuckGo returned no instant-answer data for this topic (it doesn't cover everything — that's expected for narrow or very new topics)." };
        }

        return {
            ok: true,
            abstract: data.AbstractText || "",
            abstractSource: data.AbstractSource || "",
            abstractUrl: data.AbstractURL || "",
            relatedTopics
        };

    } catch (err) {

        return { ok: false, reason: `DuckDuckGo request failed: ${err.message} (this can happen if the browser blocks the cross-origin request).` };
    }
}

/* =====================================================
   MANUAL / PASTED SOURCES
   Fetching arbitrary URLs from the browser only works
   when the target site sends permissive CORS headers —
   most news sites and many blogs don't. We attempt a
   real fetch and report honestly if it's blocked, rather
   than routing through an undisclosed third-party proxy.
===================================================== */

export async function fetchUrlSource(url) {

    try {

        const res = await fetch(url);

        if (!res.ok) {
            return { ok: false, reason: `Fetch failed (HTTP ${res.status}).` };
        }

        const contentType = res.headers.get("content-type") || "";

        if (contentType.includes("text/html")) {

            const html = await res.text();
            const text = stripHtml(html);

            return { ok: true, url, text: text.slice(0, 6000) };
        }

        const text = await res.text();
        return { ok: true, url, text: text.slice(0, 6000) };

    } catch (err) {

        return {
            ok: false,
            reason: `Couldn't fetch this URL directly from the browser (${err.message}). Most sites block cross-origin requests — paste the article text into the manual source box instead.`
        };
    }
}

function stripHtml(html) {

    const doc = new DOMParser().parseFromString(html, "text/html");

    doc.querySelectorAll("script,style,noscript,nav,header,footer,svg").forEach(el => el.remove());

    return (doc.body?.textContent || "").replace(/\s+/g, " ").trim();
}

/* =====================================================
   PROJECT MANAGER FILES — real local relevance scan
===================================================== */

export function findRelevantProjectFiles(topic, limit = 5) {

    const keywords = topic
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(w => w.length > 2);

    if (!keywords.length) return [];

    const files = getAllProjectFiles();

    const scored = files.map(file => {

        const haystack = `${file.fileName} ${file.projectName} ${file.content}`.toLowerCase();

        let score = 0;

        keywords.forEach(word => {

            const nameHits = (file.fileName.toLowerCase().match(new RegExp(escapeRegex(word), "g")) || []).length;
            const bodyHits = (haystack.match(new RegExp(escapeRegex(word), "g")) || []).length;

            score += nameHits * 5 + bodyHits;
        });

        return { ...file, score };
    });

    return scored
        .filter(f => f.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

function escapeRegex(str) {

    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}