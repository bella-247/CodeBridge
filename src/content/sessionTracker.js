// content/sessionTracker.js — Session tracking entry point

import { SESSION_DEFAULTS } from "../shared/sessionDefaults.js";

const ADAPTERS = {
    codeforces: {
        module: "src/content/adapters/codeforcesAdapter.js",
        exportName: "CodeforcesSessionAdapter",
    },
    leetcode: {
        module: "src/content/adapters/leetcodeAdapter.js",
        exportName: "LeetCodeSessionAdapter",
    },
};

let settings = { ...SESSION_DEFAULTS };
const adapterCache = new Map();
const timerStartSent = new Set();
const lastSubmissionKeys = new Map();

let activeKey = null;
let cleanupFns = [];
let lastUrl = null;
let overlayDismissed = false;
let overlayState = null;

function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}

function storageGet(keys) {
    return new Promise((resolve) => {
        try {
            chrome.storage.local.get(keys, (items) => resolve(items || {}));
        } catch (e) {
            resolve({});
        }
    });
}

function storageSet(values) {
    return new Promise((resolve) => {
        try {
            chrome.storage.local.set(values, () => resolve());
        } catch (e) {
            resolve();
        }
    });
}

async function refreshSettings() {
    const keys = Object.keys(SESSION_DEFAULTS);
    const stored = await storageGet(keys);
    const merged = { ...SESSION_DEFAULTS, ...stored };
    if (!Array.isArray(merged.SUPPORTED_PLATFORMS_ENABLED)) {
        merged.SUPPORTED_PLATFORMS_ENABLED = SESSION_DEFAULTS.SUPPORTED_PLATFORMS_ENABLED;
    }
    if (typeof merged.SHOW_TIMER_OVERLAY !== "boolean") {
        merged.SHOW_TIMER_OVERLAY = SESSION_DEFAULTS.SHOW_TIMER_OVERLAY;
    }
    settings = merged;
    return settings;
}

function isPlatformEnabled(platformKey) {
    return settings.SUPPORTED_PLATFORMS_ENABLED.includes(platformKey);
}

function detectPlatformKey() {
    const host = location.hostname;
    if (host.includes("codeforces.com")) return "codeforces";
    if (host.includes("leetcode.com")) return "leetcode";
    return null;
}

async function loadAdapter(platformKey) {
    if (adapterCache.has(platformKey)) return adapterCache.get(platformKey);
    const meta = ADAPTERS[platformKey];
    if (!meta) return null;

    try {
        const mod = await import(chrome.runtime.getURL(meta.module));
        const adapter = mod[meta.exportName] || null;
        if (adapter) adapterCache.set(platformKey, adapter);
        return adapter;
    } catch (e) {
        console.warn("[CodeBridge] session adapter load failed", e);
        return null;
    }
}

function sendSessionEvent(type, payload) {
    try {
        chrome.runtime.sendMessage({
            action: "sessionEvent",
            event: { type, ...payload },
        });
    } catch (e) {
        // ignore
    }
}

function clearCleanup() {
    cleanupFns.forEach((fn) => {
        try {
            fn();
        } catch (e) {
            // ignore
        }
    });
    cleanupFns = [];
}

function setActiveKey(key) {
    activeKey = key;
}

async function getOverlayPosition(platformKey) {
    const items = await storageGet(["TIMER_OVERLAY_POSITIONS"]);
    const positions = items.TIMER_OVERLAY_POSITIONS || {};
    const pos = positions[platformKey];
    if (!pos) return null;
    if (typeof pos.x !== "number" || typeof pos.y !== "number") return null;
    return pos;
}

async function saveOverlayPosition(platformKey, pos) {
    const items = await storageGet(["TIMER_OVERLAY_POSITIONS"]);
    const positions = items.TIMER_OVERLAY_POSITIONS || {};
    positions[platformKey] = pos;
    await storageSet({ TIMER_OVERLAY_POSITIONS: positions });
}

function clampPosition(x, y, el) {
    const padding = 8;
    const maxX = window.innerWidth - el.offsetWidth - padding;
    const maxY = window.innerHeight - el.offsetHeight - padding;
    return {
        x: Math.min(Math.max(padding, x), Math.max(padding, maxX)),
        y: Math.min(Math.max(padding, y), Math.max(padding, maxY)),
    };
}

function ensureTimerStyles() {
    if (document.getElementById("cb-timer-style")) return;
    const style = document.createElement("style");
    style.id = "cb-timer-style";
    style.textContent = `
        #cb-timer-overlay {
            position: fixed;
            top: 16px;
            right: 16px;
            z-index: 2147483650;
            background: rgba(15, 23, 42, 0.92);
            color: #f8fafc;
            border-radius: 12px;
            border: 1px solid rgba(148, 163, 184, 0.18);
            box-shadow: 0 14px 32px rgba(0,0,0,0.35);
            padding: 10px 12px;
            min-width: 160px;
            font-family: "JetBrains Mono", monospace;
            backdrop-filter: blur(8px);
            touch-action: none;
        }
        #cb-timer-overlay .cb-timer-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            cursor: grab;
            user-select: none;
            font-size: 11px;
            opacity: 0.75;
        }
        #cb-timer-overlay .cb-timer-time {
            font-size: 18px;
            font-weight: 700;
            letter-spacing: 0.06em;
            margin-top: 6px;
        }
        #cb-timer-overlay .cb-timer-status {
            font-size: 11px;
            color: rgba(226,232,240,0.8);
            margin-top: 4px;
        }
        #cb-timer-overlay .cb-timer-close {
            border: none;
            background: rgba(148,163,184,0.2);
            color: #e2e8f0;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            font-size: 12px;
            cursor: pointer;
        }
        #cb-timer-overlay .cb-timer-close:hover {
            background: rgba(148,163,184,0.35);
        }
        #cb-timer-overlay .cb-timer-start {
            margin-top: 8px;
            width: 100%;
            padding: 6px 8px;
            border-radius: 8px;
            border: none;
            background: #16a34a;
            color: #fff;
            font-size: 12px;
            cursor: pointer;
        }
        #cb-timer-overlay .cb-timer-start:disabled {
            opacity: 0.6;
            cursor: default;
        }
    `;
    (document.head || document.documentElement).appendChild(style);
}

async function ensureTimerOverlay(platformKey) {
    if (overlayDismissed) return null;
    ensureTimerStyles();

    if (!overlayState || !overlayState.el) {
        const overlay = document.createElement("div");
        overlay.id = "cb-timer-overlay";

        const header = document.createElement("div");
        header.className = "cb-timer-header";
        header.textContent = "Session Timer";

        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "cb-timer-close";
        closeBtn.textContent = "×";
        closeBtn.addEventListener("click", () => {
            overlayDismissed = true;
            overlay.remove();
            overlayState = null;
        });

        header.appendChild(closeBtn);

        const time = document.createElement("div");
        time.className = "cb-timer-time";
        time.textContent = "00:00:00";

        const status = document.createElement("div");
        status.className = "cb-timer-status";
        status.textContent = "Waiting to start";

        const startBtn = document.createElement("button");
        startBtn.type = "button";
        startBtn.className = "cb-timer-start";
        startBtn.textContent = "Start Timer";

        overlay.appendChild(header);
        overlay.appendChild(time);
        overlay.appendChild(status);
        overlay.appendChild(startBtn);

        document.body.appendChild(overlay);

        overlayState = {
            el: overlay,
            timeEl: time,
            statusEl: status,
            startBtn,
            headerEl: header,
            platformKey,
        };

        let isDragging = false;
        let dragOffset = { x: 0, y: 0 };

        const onPointerDown = (event) => {
            if (!overlayState || !overlayState.el) return;
            if (event.target && event.target.closest(".cb-timer-close")) return;
            isDragging = true;
            const rect = overlayState.el.getBoundingClientRect();
            dragOffset = {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top,
            };
            overlayState.el.setPointerCapture(event.pointerId);
            overlayState.el.style.cursor = "grabbing";
        };

        const onPointerMove = (event) => {
            if (!isDragging || !overlayState || !overlayState.el) return;
            const next = clampPosition(
                event.clientX - dragOffset.x,
                event.clientY - dragOffset.y,
                overlayState.el,
            );
            overlayState.el.style.left = `${next.x}px`;
            overlayState.el.style.top = `${next.y}px`;
            overlayState.el.style.right = "auto";
        };

        const onPointerUp = async (event) => {
            if (!isDragging || !overlayState || !overlayState.el) return;
            isDragging = false;
            overlayState.el.releasePointerCapture(event.pointerId);
            overlayState.el.style.cursor = "grab";
            const rect = overlayState.el.getBoundingClientRect();
            const key = overlayState.platformKey || platformKey;
            await saveOverlayPosition(key, {
                x: rect.left,
                y: rect.top,
            });
        };

        header.addEventListener("pointerdown", onPointerDown);
        overlay.addEventListener("pointermove", onPointerMove);
        overlay.addEventListener("pointerup", onPointerUp);

        cleanupFns.push(() => {
            header.removeEventListener("pointerdown", onPointerDown);
            overlay.removeEventListener("pointermove", onPointerMove);
            overlay.removeEventListener("pointerup", onPointerUp);
        });

        cleanupFns.push(() => {
            if (overlayState && overlayState.el) {
                overlayState.el.remove();
            }
            overlayState = null;
        });
    }

    if (overlayState && overlayState.platformKey !== platformKey) {
        overlayState.platformKey = platformKey;
    }

    if (overlayState && overlayState.el) {
        const pos = await getOverlayPosition(platformKey);
        if (pos) {
            const next = clampPosition(pos.x, pos.y, overlayState.el);
            overlayState.el.style.left = `${next.x}px`;
            overlayState.el.style.top = `${next.y}px`;
            overlayState.el.style.right = "auto";
        }
    }

    return overlayState;
}

function formatElapsed(seconds) {
    const total = Math.max(0, seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function fetchSession(platform, problemId) {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage(
                { action: "getSession", platform, problemId },
                (resp) => {
                    if (chrome.runtime.lastError) {
                        resolve(null);
                        return;
                    }
                    resolve(resp && resp.success ? resp.session : null);
                },
            );
        } catch (e) {
            resolve(null);
        }
    });
}

function trackDelayedAuto(basePayload, sessionKey) {
    if (timerStartSent.has(activeKey)) return;
    const delaySeconds = Number(settings.AUTO_START_DELAY_SECONDS);
    if (!Number.isFinite(delaySeconds) || delaySeconds < 0) return;

    let timeoutId = null;

    const schedule = () => {
        if (timerStartSent.has(activeKey)) return;
        if (document.visibilityState !== "visible") return;

        timeoutId = setTimeout(() => {
            if (document.visibilityState !== "visible") return;
            if (timerStartSent.has(activeKey)) return;
            if (activeKey !== sessionKey) return;

            timerStartSent.add(activeKey);
            sendSessionEvent("timer_start", {
                ...basePayload,
                startedAt: nowSeconds(),
            });
        }, delaySeconds * 1000);
    };

    const onVisibility = () => {
        if (timeoutId) clearTimeout(timeoutId);
        if (document.visibilityState === "visible") {
            schedule();
        }
    };

    schedule();
    document.addEventListener("visibilitychange", onVisibility);

    cleanupFns.push(() => {
        if (timeoutId) clearTimeout(timeoutId);
        document.removeEventListener("visibilitychange", onVisibility);
    });
}

function trackTypingStart(adapter, basePayload, sessionKey) {
    if (timerStartSent.has(activeKey)) return;

    const onKeydown = (event) => {
        if (timerStartSent.has(activeKey)) return;
        if (activeKey !== sessionKey) return;

        if (adapter.isEditorTarget && adapter.isEditorTarget(event.target)) {
            timerStartSent.add(activeKey);
            sendSessionEvent("timer_start", {
                ...basePayload,
                startedAt: nowSeconds(),
            });
            document.removeEventListener("keydown", onKeydown, true);
        }
    };

    document.addEventListener("keydown", onKeydown, true);
    cleanupFns.push(() => document.removeEventListener("keydown", onKeydown, true));
}

function shouldSendSubmission(sessionKey, data) {
    const fingerprint = [
        data.submissionId || "",
        data.verdict || "",
        data.language || "",
    ].join("|");
    const now = Date.now();
    const last = lastSubmissionKeys.get(sessionKey);
    if (last && last.fingerprint === fingerprint && now - last.ts < 5000) {
        return false;
    }
    lastSubmissionKeys.set(sessionKey, { fingerprint, ts: now });
    return true;
}

async function setupTimerOverlay({
    platformKey,
    problemId,
    sessionKey,
    basePayload,
}) {
    if (!settings.SHOW_TIMER_OVERLAY || overlayDismissed) return;

    const overlay = await ensureTimerOverlay(platformKey);
    if (!overlay) return;

    let snapshot = await fetchSession(platformKey, problemId);
    if (snapshot && snapshot.startTime) {
        timerStartSent.add(sessionKey);
    }

    const updateDisplay = () => {
        const started = snapshot && snapshot.startTime;
        const ended = snapshot && snapshot.endTime;
        const elapsed = started
            ? (ended || nowSeconds()) - snapshot.startTime
            : 0;

        overlay.timeEl.textContent = formatElapsed(elapsed);

        if (!started) {
            overlay.statusEl.textContent =
                settings.TIMER_START_MODE === "MANUAL"
                    ? "Manual start"
                    : "Waiting to start";
        } else if (ended) {
            overlay.statusEl.textContent = "Completed";
        } else {
            overlay.statusEl.textContent = "Running";
        }

        if (settings.TIMER_START_MODE === "MANUAL") {
            overlay.startBtn.style.display = "block";
            overlay.startBtn.disabled = !!started;
            overlay.startBtn.textContent = started
                ? "Timer Running"
                : "Start Timer";
        } else {
            overlay.startBtn.style.display = "none";
        }
    };

    overlay.startBtn.onclick = () => {
        if (timerStartSent.has(sessionKey)) return;
        timerStartSent.add(sessionKey);
        sendSessionEvent("timer_start", {
            ...basePayload,
            startedAt: nowSeconds(),
        });
        snapshot = {
            ...(snapshot || {}),
            startTime: nowSeconds(),
            endTime: null,
        };
        updateDisplay();
    };

    updateDisplay();

    let tick = 0;
    const intervalId = setInterval(async () => {
        tick += 1;
        if (tick % 5 === 0) {
            const latest = await fetchSession(platformKey, problemId);
            if (latest) {
                snapshot = latest;
                if (snapshot.startTime) timerStartSent.add(sessionKey);
            }
        }
        updateDisplay();
    }, 1000);

    cleanupFns.push(() => clearInterval(intervalId));
}

async function handlePage() {
    clearCleanup();

    const platformKey = detectPlatformKey();
    if (!platformKey) return;

    await refreshSettings();
    if (!isPlatformEnabled(platformKey)) return;

    const adapter = await loadAdapter(platformKey);
    if (!adapter) return;

    const pageType = adapter.detectPageType();
    const problemId = adapter.extractProblemId(pageType);
    if (!problemId) return;

    const difficulty = adapter.getDifficulty ? adapter.getDifficulty(pageType) : null;
    const sessionKey = `${platformKey}:${problemId}`;

    setActiveKey(sessionKey);

    const basePayload = {
        platform: platformKey,
        problemId,
        difficulty,
    };

    sendSessionEvent("page_view", basePayload);

    if (settings.TIMER_START_MODE === "DELAYED_AUTO" && pageType === "problem") {
        trackDelayedAuto(basePayload, sessionKey);
    }

    if (settings.TIMER_START_MODE === "TYPING") {
        trackTypingStart(adapter, basePayload, sessionKey);
    }

    if (pageType === "problem") {
        setupTimerOverlay({
            platformKey,
            problemId,
            sessionKey,
            basePayload,
        }).catch(() => {});
    }

    const submissionId = adapter.getSubmissionId ? adapter.getSubmissionId() : null;
    const submission = adapter.getSubmissionData ? adapter.getSubmissionData() : null;
    if (submission && shouldSendSubmission(sessionKey, { ...submission, submissionId })) {
        sendSessionEvent("submission", {
            ...basePayload,
            submissionId,
            verdict: submission.verdict || null,
            language: submission.language || null,
            submittedAt: nowSeconds(),
        });
    } else if (adapter.observeSubmissionData) {
        const stop = adapter.observeSubmissionData((data) => {
            if (!data) return;
            if (!shouldSendSubmission(sessionKey, { ...data, submissionId })) return;
            sendSessionEvent("submission", {
                ...basePayload,
                submissionId,
                verdict: data.verdict || null,
                language: data.language || null,
                submittedAt: nowSeconds(),
            });
        });
        if (typeof stop === "function") cleanupFns.push(stop);
    }
}

export async function initSessionTracker() {
    if (window.__codebridge_session_tracker) return;
    window.__codebridge_session_tracker = true;

    await refreshSettings();

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        const keys = Object.keys(SESSION_DEFAULTS);
        const touched = keys.some((key) => Object.prototype.hasOwnProperty.call(changes, key));
        if (touched) {
            refreshSettings().then(() => handlePage());
        }
    });

    lastUrl = location.href;
    await handlePage();

    setInterval(async () => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            await handlePage();
        }
    }, 800);
}
