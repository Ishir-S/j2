/* =====================================================
   JARVIS - COMMAND BRIDGE
   main.js registers what JARVIS is capable of doing;
   commander.js (driven by chat) looks it up and runs it.
   Keeping this as its own tiny module avoids a circular
   import between main.js and chat.js.
===================================================== */

const registry = {};

export function registerCommands(map) {

    Object.assign(registry, map);
}

export function hasCommand(name) {

    return typeof registry[name] === "function";
}

export function runCommand(name, params) {

    if (!hasCommand(name)) {
        throw new Error(`Unknown command: ${name}`);
    }

    return registry[name](params || {});
}

export function listCommandNames() {

    return Object.keys(registry);
}
