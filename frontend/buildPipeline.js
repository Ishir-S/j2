/* =====================================================
   JARVIS - ASA: BUILD PIPELINE
   Real, genuinely-executed checks only. This does NOT
   claim to compile firmware, run a real test suite, or
   perform security/performance benchmarking — those need
   actual toolchains this browser sandbox doesn't have.
   What it DOES do, for real: parse/validate every
   generated file and report actual syntax errors.
===================================================== */

export function runBuildPipeline(files) {

    const results = files.map(file => validateFile(file));

    const passed = results.filter(r => r.status === "pass").length;
    const warned = results.filter(r => r.status === "warn").length;
    const failed = results.filter(r => r.status === "fail").length;

    return {
        results,
        summary: { total: files.length, passed, warned, failed },
        allClear: failed === 0
    };
}

function validateFile(file) {

    const ext = (file.path.split(".").pop() || "").toLowerCase();

    if (ext === "json") return validateJSON(file);
    if (["js", "mjs", "cjs"].includes(ext)) return validateJS(file);
    if (["ino", "c", "cpp", "h", "hpp"].includes(ext)) return validateCLike(file);

    return validateGeneric(file);
}

function validateJSON(file) {

    try {

        JSON.parse(file.content);

        return { path: file.path, status: "pass", message: "Valid JSON." };

    } catch (err) {

        return { path: file.path, status: "fail", message: `Invalid JSON: ${err.message}` };
    }
}

function validateJS(file) {

    try {

        // Real syntax check: this genuinely throws on malformed JS.
        // It does NOT execute the code, and does not validate imports/logic.
        // eslint-disable-next-line no-new-func
        new Function(file.content);

        const warnings = lintHeuristics(file.content);

        if (warnings.length) {

            return {
                path: file.path,
                status: "warn",
                message: `Syntax OK. Heuristic notes: ${warnings.join("; ")}`
            };
        }

        return { path: file.path, status: "pass", message: "Syntax OK (not executed)." };

    } catch (err) {

        // ES module syntax (import/export) throws in `new Function` even when
        // valid, since that constructor can't parse module syntax. Don't
        // report those as failures — just note the limitation honestly.
        if (/import|export/.test(file.content) && /Unexpected token/.test(err.message)) {

            return {
                path: file.path,
                status: "warn",
                message: "Contains ES module import/export syntax — JARVIS's in-browser checker can't parse modules, so syntax wasn't fully verified."
            };
        }

        return { path: file.path, status: "fail", message: `Syntax error: ${err.message}` };
    }
}

function validateCLike(file) {

    // We cannot compile C/C++/firmware in a browser sandbox. Be honest about
    // that, and only run cheap structural sanity checks.
    const warnings = [];

    const opens = (file.content.match(/{/g) || []).length;
    const closes = (file.content.match(/}/g) || []).length;

    if (opens !== closes) {
        warnings.push(`mismatched braces (${opens} '{' vs ${closes} '}')`);
    }

    if (!/void\s+setup\s*\(/.test(file.content) && file.path.endsWith(".ino")) {
        warnings.push("no setup() function found — unusual for Arduino-style firmware");
    }

    return {
        path: file.path,
        status: warnings.length ? "warn" : "pass",
        message: warnings.length
            ? `Not compiled (no in-browser C/C++ toolchain). Structural notes: ${warnings.join("; ")}`
            : "Not compiled (no in-browser C/C++ toolchain). Basic structure looks reasonable."
    };
}

function validateGeneric(file) {

    if (!file.content || !file.content.trim()) {

        return { path: file.path, status: "warn", message: "File is empty." };
    }

    return { path: file.path, status: "pass", message: `${file.content.split("\n").length} line(s), non-empty.` };
}

function lintHeuristics(code) {

    const notes = [];

    if (/console\.log\(/.test(code)) notes.push("contains console.log calls");
    if (/TODO|FIXME/.test(code)) notes.push("contains TODO/FIXME markers");
    if (/var\s+/.test(code)) notes.push("uses 'var' instead of let/const");

    return notes;
}
