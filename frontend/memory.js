/* =====================================================
   JARVIS - MEMORY & LIVE CONTEXT MODULE
   Real persistence (localStorage) and real live data
   (Date/Intl APIs, geolocation + Open-Meteo). Nothing
   here is simulated — if weather/location is unavailable
   it's simply omitted from context, never faked.
===================================================== */

const HISTORY_KEY = "jarvis_chat_history";
const MEMORY_KEY = "jarvis_long_term_memory";
const LOCATION_KEY = "jarvis_weather_location";
const WEATHER_CACHE_KEY = "jarvis_weather_cache";

const MAX_HISTORY_MESSAGES = 200; // rolling window so storage doesn't grow unbounded
const WEATHER_CACHE_MINUTES = 30;

const WMO_CODES = {
    0: "clear sky", 1: "mostly clear", 2: "partly cloudy", 3: "overcast",
    45: "fog", 48: "depositing rime fog",
    51: "light drizzle", 53: "moderate drizzle", 55: "dense drizzle",
    56: "light freezing drizzle", 57: "dense freezing drizzle",
    61: "slight rain", 63: "moderate rain", 65: "heavy rain",
    66: "light freezing rain", 67: "heavy freezing rain",
    71: "slight snow", 73: "moderate snow", 75: "heavy snow", 77: "snow grains",
    80: "slight rain showers", 81: "moderate rain showers", 82: "violent rain showers",
    85: "slight snow showers", 86: "heavy snow showers",
    95: "thunderstorm", 96: "thunderstorm with slight hail", 99: "thunderstorm with heavy hail"
};

/* =====================================================
   CHAT HISTORY (persists across reloads — "past convos")
===================================================== */

export function loadHistory() {

    try {

        const raw = localStorage.getItem(HISTORY_KEY);
        return raw ? JSON.parse(raw) : [];

    } catch {

        return [];
    }
}

export function saveHistory(history) {

    const trimmed = history.length > MAX_HISTORY_MESSAGES
        ? history.slice(history.length - MAX_HISTORY_MESSAGES)
        : history;

    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
}

export function clearHistory() {

    localStorage.removeItem(HISTORY_KEY);
}

/* =====================================================
   LONG-TERM MEMORY (distilled durable facts)
===================================================== */

export function loadLongTermMemory() {

    try {

        const raw = localStorage.getItem(MEMORY_KEY);
        return raw ? JSON.parse(raw) : [];

    } catch {

        return [];
    }
}

export function saveLongTermMemory(notes) {

    localStorage.setItem(MEMORY_KEY, JSON.stringify(notes));
}

export function clearLongTermMemory() {

    localStorage.removeItem(MEMORY_KEY);
}

export function mergeLongTermMemory(newNotes) {

    const existing = loadLongTermMemory();
    const combined = [...existing];

    newNotes.forEach(note => {

        const isDuplicate = combined.some(n => n.toLowerCase().trim() === note.toLowerCase().trim());

        if (!isDuplicate && note.trim()) combined.push(note.trim());
    });

    // keep the most recent ~40 facts so this doesn't grow forever
    const capped = combined.slice(-40);

    saveLongTermMemory(capped);

    return capped;
}

/* =====================================================
   LIVE DATE/TIME CONTEXT (real, from the browser clock)
===================================================== */

export function getDateTimeContext() {

    const now = new Date();

    const dateStr = now.toLocaleDateString(undefined, {
        weekday: "long", year: "numeric", month: "long", day: "numeric"
    });

    const timeStr = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

    let timezone = "";

    try {
        timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
        timezone = "";
    }

    return `${dateStr}, ${timeStr}${timezone ? ` (${timezone})` : ""}`;
}

/* =====================================================
   WEATHER (real — geolocation or manual city, Open-Meteo)
===================================================== */

export function getSavedLocation() {

    try {

        const raw = localStorage.getItem(LOCATION_KEY);
        return raw ? JSON.parse(raw) : null;

    } catch {

        return null;
    }
}

export function saveLocation(location) {

    localStorage.setItem(LOCATION_KEY, JSON.stringify(location));
}

export async function geocodeCity(name) {

    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1`;
    const res = await fetch(url);

    if (!res.ok) throw new Error(`Geocoding failed (HTTP ${res.status})`);

    const data = await res.json();
    const match = data.results?.[0];

    if (!match) throw new Error(`No location found matching "${name}"`);

    return {
        name: `${match.name}${match.admin1 ? ", " + match.admin1 : ""}${match.country ? ", " + match.country : ""}`,
        lat: match.latitude,
        lon: match.longitude
    };
}

export function requestBrowserLocation() {

    return new Promise((resolve, reject) => {

        if (!navigator.geolocation) {
            reject(new Error("Geolocation isn't supported in this browser."));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ name: "your current location", lat: pos.coords.latitude, lon: pos.coords.longitude }),
            (err) => reject(new Error(`Location permission denied or unavailable: ${err.message}`)),
            { timeout: 8000 }
        );
    });
}

async function fetchWeather(lat, lon) {

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&timezone=auto`;

    const res = await fetch(url);

    if (!res.ok) throw new Error(`Weather fetch failed (HTTP ${res.status})`);

    const data = await res.json();
    const current = data.current;

    return {
        temperatureC: current.temperature_2m,
        feelsLikeC: current.apparent_temperature,
        humidity: current.relative_humidity_2m,
        windKmh: current.wind_speed_10m,
        precipitationMm: current.precipitation,
        description: WMO_CODES[current.weather_code] || "unknown conditions",
        fetchedAt: Date.now()
    };
}

function getCachedWeather() {

    try {

        const raw = localStorage.getItem(WEATHER_CACHE_KEY);
        if (!raw) return null;

        const cached = JSON.parse(raw);

        const ageMinutes = (Date.now() - cached.weather.fetchedAt) / 60000;
        if (ageMinutes > WEATHER_CACHE_MINUTES) return null;

        return cached;

    } catch {

        return null;
    }
}

function setCachedWeather(location, weather) {

    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ location, weather }));
}

/**
 * Gets current weather, using (in order): fresh cache, saved manual
 * location, or a real browser geolocation prompt. Returns null rather
 * than fake data if nothing is available.
 */
export async function getWeatherContext({ allowGeolocationPrompt = false } = {}) {

    const cached = getCachedWeather();
    if (cached) return cached;

    let location = getSavedLocation();

    if (!location && allowGeolocationPrompt) {

        try {
            location = await requestBrowserLocation();
        } catch {
            return null;
        }
    }

    if (!location) return null;

    try {

        const weather = await fetchWeather(location.lat, location.lon);
        setCachedWeather(location, weather);

        return { location, weather };

    } catch {

        return null;
    }
}

export function formatWeatherContext(bundle) {

    if (!bundle) return null;

    const { location, weather } = bundle;

    return `Weather near ${location.name}: ${weather.description}, ${Math.round(weather.temperatureC)}°C `
        + `(feels like ${Math.round(weather.feelsLikeC)}°C), humidity ${weather.humidity}%, `
        + `wind ${Math.round(weather.windKmh)} km/h.`;
}