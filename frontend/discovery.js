/* =====================================================
   JARVIS - ASA: RESOURCE & HARDWARE DISCOVERY
   Every value here comes from a real browser API call.
   Nothing in this file is simulated.
===================================================== */

/* Common USB vendor IDs seen on microcontroller dev boards.
   Note: most boards expose the USB-to-serial BRIDGE chip's
   VID/PID, not the microcontroller itself, so these are
   labeled as heuristics, not guarantees. */
const USB_VENDOR_HINTS = {
    0x2341: "Arduino (official)",
    0x2A03: "Arduino (official, alt VID)",
    0x1A86: "WCH CH340/CH341 USB-serial (common on ESP32/Arduino clones)",
    0x10C4: "Silicon Labs CP210x USB-serial (common on ESP32/ESP8266 boards)",
    0x0403: "FTDI USB-serial (common on many dev boards)",
    0x0483: "STMicroelectronics (STM32)",
    0x2E8A: "Raspberry Pi Foundation (RP2040 / Pico)",
    0x239A: "Adafruit (SAMD/RP2040 boards)",
    0x303A: "Espressif Systems (native USB ESP32-S2/S3/C3)",
    0x1D6B: "Linux Foundation (generic USB device class)"
};

/* =====================================================
   RESOURCE DISCOVERY
===================================================== */

export async function detectResources() {

    const resources = {
        os: detectOS(),
        browser: detectBrowser(),
        cpuCores: navigator.hardwareConcurrency || null,
        ramEstimateGB: navigator.deviceMemory || null,
        gpu: await detectGPU(),
        network: detectNetwork(),
        mediaDevices: await detectMediaDevices(),
        apiSupport: detectApiSupport()
    };

    return resources;
}

function detectOS() {

    if (navigator.userAgentData?.platform) {
        return navigator.userAgentData.platform;
    }

    const ua = navigator.userAgent;

    if (/Windows/i.test(ua)) return "Windows";
    if (/Mac OS X/i.test(ua)) return "macOS";
    if (/Android/i.test(ua)) return "Android";
    if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
    if (/Linux/i.test(ua)) return "Linux";

    return navigator.platform || "Unknown";
}

function detectBrowser() {

    const ua = navigator.userAgent;

    if (/Edg\//.test(ua)) return "Edge";
    if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return "Chrome";
    if (/Firefox\//.test(ua)) return "Firefox";
    if (/Safari\//.test(ua) && !/Chrome/.test(ua)) return "Safari";

    return "Unknown browser";
}

async function detectGPU() {

    // Try WebGPU first (gives real vendor/architecture strings when available)
    if (navigator.gpu) {

        try {

            const adapter = await navigator.gpu.requestAdapter();
            const info = adapter && "requestAdapterInfo" in adapter
                ? await adapter.requestAdapterInfo()
                : null;

            if (info?.vendor || info?.architecture) {

                return {
                    source: "WebGPU",
                    vendor: info.vendor || "unknown vendor",
                    architecture: info.architecture || "unknown"
                };
            }

        } catch {
            // fall through to WebGL fallback
        }
    }

    // Fallback: WEBGL_debug_renderer_info (widely supported, real GPU string)
    try {

        const canvas = document.createElement("canvas");
        const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");

        const ext = gl?.getExtension("WEBGL_debug_renderer_info");

        if (gl && ext) {

            return {
                source: "WebGL",
                vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL),
                renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
            };
        }

    } catch {
        // ignore
    }

    return { source: "unavailable", vendor: "Unknown", renderer: "Could not detect GPU" };
}

function detectNetwork() {

    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

    if (!conn) return { supported: false };

    return {
        supported: true,
        effectiveType: conn.effectiveType || "unknown",
        downlinkMbps: conn.downlink ?? null,
        saveData: !!conn.saveData
    };
}

async function detectMediaDevices() {

    if (!navigator.mediaDevices?.enumerateDevices) {
        return { supported: false };
    }

    try {

        const devices = await navigator.mediaDevices.enumerateDevices();

        return {
            supported: true,
            cameras: devices.filter(d => d.kind === "videoinput").length,
            microphones: devices.filter(d => d.kind === "audioinput").length,
            speakers: devices.filter(d => d.kind === "audiooutput").length
        };

    } catch {

        return { supported: false };
    }
}

function detectApiSupport() {

    return {
        webSerial: "serial" in navigator,
        webUSB: "usb" in navigator,
        webHID: "hid" in navigator,
        webBluetooth: "bluetooth" in navigator,
        webMIDI: "requestMIDIAccess" in navigator,
        webGPU: "gpu" in navigator
    };
}

/* =====================================================
   HARDWARE DISCOVERY
   Every function here must be called from a real user
   click (browser permission prompts require a user
   gesture) — so these are wired directly to button
   handlers in asa.js, not run automatically.
===================================================== */

export async function discoverSerialDevice() {

    if (!("serial" in navigator)) {
        throw new Error("Web Serial isn't supported in this browser (use Chrome or Edge).");
    }

    const port = await navigator.serial.requestPort();
    const info = port.getInfo();

    return describeUsbDevice("Serial device", info.usbVendorId, info.usbProductId, { port });
}

export async function discoverUsbDevice() {

    if (!("usb" in navigator)) {
        throw new Error("WebUSB isn't supported in this browser (use Chrome or Edge).");
    }

    const device = await navigator.usb.requestDevice({ filters: [] });

    return describeUsbDevice(
        device.productName || "USB device",
        device.vendorId,
        device.productId,
        { manufacturer: device.manufacturerName }
    );
}

export async function discoverHidDevice() {

    if (!("hid" in navigator)) {
        throw new Error("WebHID isn't supported in this browser (use Chrome or Edge).");
    }

    const [device] = await navigator.hid.requestDevice({ filters: [] });

    if (!device) throw new Error("No HID device selected.");

    return describeUsbDevice(device.productName || "HID device", device.vendorId, device.productId);
}

export async function discoverBluetoothDevice() {

    if (!("bluetooth" in navigator)) {
        throw new Error("Web Bluetooth isn't supported in this browser (use Chrome or Edge).");
    }

    const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true
    });

    return {
        type: "bluetooth",
        name: device.name || "Unnamed Bluetooth device",
        id: device.id,
        identification: "Identified by BLE advertisement name only (no VID/PID over BLE)."
    };
}

export async function discoverMidiDevices() {

    if (!("requestMIDIAccess" in navigator)) {
        throw new Error("Web MIDI isn't supported in this browser (use Chrome or Edge).");
    }

    const access = await navigator.requestMIDIAccess();

    const devices = [];

    access.inputs.forEach(input => devices.push({ type: "midi-input", name: input.name, id: input.id }));
    access.outputs.forEach(output => devices.push({ type: "midi-output", name: output.name, id: output.id }));

    if (!devices.length) {
        throw new Error("Web MIDI is supported, but no MIDI devices were found.");
    }

    return devices;
}

function describeUsbDevice(label, vendorId, productId, extra = {}) {

    const vendorHex = typeof vendorId === "number" ? `0x${vendorId.toString(16).padStart(4, "0")}` : null;
    const productHex = typeof productId === "number" ? `0x${productId.toString(16).padStart(4, "0")}` : null;

    const hint = vendorId != null ? USB_VENDOR_HINTS[vendorId] : null;

    return {
        type: "usb",
        label,
        vendorId: vendorHex,
        productId: productHex,
        identification: hint
            ? `Heuristic match: ${hint} (based on known USB vendor ID — the actual board/chip may still differ)`
            : "No known vendor-ID match in JARVIS's lookup table — treat as an unidentified device.",
        ...extra
    };
}
