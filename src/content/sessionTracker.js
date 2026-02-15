// content/sessionTracker.js — Session tracking entry point

import { SESSION_DEFAULTS } from "../shared/sessionDefaults.js";
import { SUPPORTED_PLATFORMS } from "../utils/constants.js";

const ADAPTERS = {};
SUPPORTED_PLATFORMS.forEach(p => {
    ADAPTERS[p.key] = {
        module: p.adapterModule,
        exportName: p.adapterExport
    };
});

let settings = { ...SESSION_DEFAULTS };
const adapterCache = new Map();
const timerStartSent = new Set();
const lastSubmissionKeys = new Map();
let lastSubmissionPrune = 0;
const lastActivityByKey = new Map();
let inactivityIntervalId = null;

const SUBMISSION_DEDUP_MS = 5000;
const SUBMISSION_TTL_MS = 60 * 60 * 1000;
const INACTIVITY_CHECK_INTERVAL_MS = 30000;

let activeKey = null;
let cleanupFns = [];
let lastUrl = null;
let overlayDismissed = false;
let overlayState = null;
let lastSessionInfo = null;

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
    const allowedSizes = ["small", "medium", "large"];
    if (!allowedSizes.includes(merged.TIMER_OVERLAY_SIZE)) {
        merged.TIMER_OVERLAY_SIZE = SESSION_DEFAULTS.TIMER_OVERLAY_SIZE;
    }
    if (typeof merged.AUTO_STOP_ON_ACCEPTED !== "boolean") {
        merged.AUTO_STOP_ON_ACCEPTED = SESSION_DEFAULTS.AUTO_STOP_ON_ACCEPTED;
    }
    if (typeof merged.AUTO_STOP_ON_PROBLEM_SWITCH !== "boolean") {
        merged.AUTO_STOP_ON_PROBLEM_SWITCH = SESSION_DEFAULTS.AUTO_STOP_ON_PROBLEM_SWITCH;
    }
    if (typeof merged.ALLOW_MANUAL_STOP !== "boolean") {
        merged.ALLOW_MANUAL_STOP = SESSION_DEFAULTS.ALLOW_MANUAL_STOP;
    }
    if (!Number.isFinite(merged.INACTIVITY_TIMEOUT_MINUTES)) {
        merged.INACTIVITY_TIMEOUT_MINUTES = SESSION_DEFAULTS.INACTIVITY_TIMEOUT_MINUTES;
    }
    settings = merged;

    if (!settings.SHOW_TIMER_OVERLAY) {
        overlayDismissed = true;
        if (overlayState && overlayState.el) {
            overlayState.el.remove();
        }
        overlayState = null;
    } else {
        overlayDismissed = false;
    }
    return settings;
}

function isPlatformEnabled(platformKey) {
    return settings.SUPPORTED_PLATFORMS_ENABLED.includes(platformKey);
}

function detectPlatformKey() {
    const host = location.hostname;
    const platform = SUPPORTED_PLATFORMS.find(p => host.includes(p.hostPattern));
    return platform ? platform.key : null;
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
    if (key) {
        lastActivityByKey.set(key, Date.now());
    }
}

function isAcceptedVerdict(verdict) {
    if (!verdict) return false;
    const v = String(verdict).trim().toLowerCase();
    return v === "accepted" || v === "ok" || v === "ac" || v === "passed";
}

function markActivity(sessionKey) {
    if (!sessionKey) return;
    lastActivityByKey.set(sessionKey, Date.now());
}

async function stopSessionIfActive(platformKey, problemId, reason) {
    const session = await fetchSession(platformKey, problemId);
    if (!session || session.endTime) return false;
    const hasActiveTime =
        !!session.startTime ||
        !!session.isPaused ||
        (Number.isFinite(session.elapsedSeconds) && session.elapsedSeconds > 0);
    if (!hasActiveTime) return false;

    sendSessionEvent("timer_stop", {
        platform: platformKey,
        problemId,
        stoppedAt: nowSeconds(),
        reason,
    });
    return true;
}

function startInactivityWatcher(sessionKey, basePayload) {
    if (inactivityIntervalId) {
        clearInterval(inactivityIntervalId);
        inactivityIntervalId = null;
    }

    const timeoutMinutes = Number(settings.INACTIVITY_TIMEOUT_MINUTES);
    if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) return;

    const timeoutMs = timeoutMinutes * 60 * 1000;
    inactivityIntervalId = setInterval(async () => {
        if (activeKey !== sessionKey) return;
        const last = lastActivityByKey.get(sessionKey);
        if (!last) return;
        if (Date.now() - last < timeoutMs) return;

        const stopped = await stopSessionIfActive(
            basePayload.platform,
            basePayload.problemId,
            "timeout",
        );
        if (stopped) {
            markActivity(sessionKey);
        }
    }, INACTIVITY_CHECK_INTERVAL_MS);

    cleanupFns.push(() => {
        if (inactivityIntervalId) {
            clearInterval(inactivityIntervalId);
            inactivityIntervalId = null;
        }
    });
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
            background: rgba(7, 12, 20, 0.96);
            color: #f8fafc;
            border-radius: 12px;
            border: 1px solid rgba(56, 189, 248, 0.35);
            box-shadow: 0 16px 34px rgba(0,0,0,0.45);
            padding: 10px 12px;
            min-width: 140px;
            font-family: "JetBrains Mono", monospace;
            backdrop-filter: blur(10px);
            touch-action: none;
        }
        #cb-timer-overlay[data-size="small"] {
            min-width: 120px;
            padding: 8px 10px;
        }
        #cb-timer-overlay[data-size="small"] .cb-timer-time {
            font-size: 16px;
        }
        #cb-timer-overlay[data-size="medium"] {
            min-width: 140px;
            padding: 10px 12px;
        }
        #cb-timer-overlay[data-size="medium"] .cb-timer-time {
            font-size: 19px;
        }
        #cb-timer-overlay[data-size="large"] {
            min-width: 168px;
            padding: 12px 14px;
        }
        #cb-timer-overlay[data-size="large"] .cb-timer-time {
            font-size: 22px;
        }
        #cb-timer-overlay .cb-timer-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            cursor: grab;
            user-select: none;
        }
        #cb-timer-overlay .cb-timer-drag {
            display: flex;
            align-items: center;
            gap: 6px;
            color: rgba(226, 232, 240, 0.65);
        }
        #cb-timer-overlay .cb-timer-indicator {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: rgba(148, 163, 184, 0.6);
        }
        #cb-timer-overlay[data-state="idle"] .cb-timer-indicator {
            box-shadow: none;
        }
        #cb-timer-overlay[data-state="running"] .cb-timer-indicator {
            background: #22c55e;
            box-shadow: 0 0 10px rgba(34, 197, 94, 0.6);
        }
        #cb-timer-overlay[data-state="paused"] .cb-timer-indicator {
            background: #f59e0b;
            box-shadow: 0 0 10px rgba(245, 158, 11, 0.6);
        }
        #cb-timer-overlay[data-state="completed"] .cb-timer-indicator {
            background: #38bdf8;
            box-shadow: 0 0 10px rgba(56, 189, 248, 0.6);
        }
        #cb-timer-overlay .cb-timer-time {
            font-size: 19px;
            font-weight: 700;
            letter-spacing: 0.08em;
            margin-top: 8px;
            margin-bottom: 8px;
            line-height: 1;
            text-shadow: 0 0 12px rgba(56, 189, 248, 0.2);
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
        #cb-timer-overlay .cb-timer-controls {
            display: flex;
            gap: 6px;
            margin-top: 8px;
        }
        #cb-timer-overlay .cb-timer-btn {
            width: 28px;
            height: 28px;
            border-radius: 8px;
            border: 1px solid rgba(148, 163, 184, 0.28);
            background: rgba(148, 163, 184, 0.15);
            color: #e2e8f0;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
        }
        #cb-timer-overlay .cb-timer-btn:hover {
            background: rgba(148, 163, 184, 0.28);
        }
        #cb-timer-overlay .cb-timer-btn:disabled {
            opacity: 0.45;
            cursor: default;
        }
        #cb-timer-overlay .cb-timer-btn svg {
            width: 14px;
            height: 14px;
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

        const dragWrap = document.createElement("div");
        dragWrap.className = "cb-timer-drag";
        dragWrap.innerHTML =
            '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="6" cy="7" r="1.6"/><circle cx="12" cy="7" r="1.6"/><circle cx="18" cy="7" r="1.6"/><circle cx="6" cy="17" r="1.6"/><circle cx="12" cy="17" r="1.6"/><circle cx="18" cy="17" r="1.6"/></svg>';

        const indicator = document.createElement("span");
        indicator.className = "cb-timer-indicator";
        indicator.title = "Idle";
        dragWrap.appendChild(indicator);

        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "cb-timer-close";
        closeBtn.textContent = "×";
        closeBtn.addEventListener("click", () => {
            overlayDismissed = true;
            overlay.remove();
            overlayState = null;
        });

        header.appendChild(dragWrap);
        header.appendChild(closeBtn);

        const time = document.createElement("div");
        time.className = "cb-timer-time";
        time.textContent = "00:00:00";

        const controls = document.createElement("div");
        controls.className = "cb-timer-controls";

        const playBtn = document.createElement("button");
        playBtn.type = "button";
        playBtn.className = "cb-timer-btn cb-timer-play";
        playBtn.title = "Start";
        playBtn.setAttribute("aria-label", "Start timer");
        playBtn.innerHTML =
            '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';

        const pauseBtn = document.createElement("button");
        pauseBtn.type = "button";
        pauseBtn.className = "cb-timer-btn cb-timer-pause";
        pauseBtn.title = "Pause";
        pauseBtn.setAttribute("aria-label", "Pause timer");
        pauseBtn.innerHTML =
            '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';

        const resetBtn = document.createElement("button");
        resetBtn.type = "button";
        resetBtn.className = "cb-timer-btn cb-timer-reset";
        resetBtn.title = "Reset";
        resetBtn.setAttribute("aria-label", "Reset timer");
        resetBtn.innerHTML =
            '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.34-5.66L4 4v6h6L7.86 7.86A6 6 0 1 1 6 12z"/></svg>';

        const stopBtn = document.createElement("button");
        stopBtn.type = "button";
        stopBtn.className = "cb-timer-btn cb-timer-stop";
        stopBtn.title = "End";
        stopBtn.setAttribute("aria-label", "End session");
        stopBtn.innerHTML =
            '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

        overlay.appendChild(header);
        overlay.appendChild(time);
        overlay.appendChild(controls);

        controls.appendChild(playBtn);
        controls.appendChild(pauseBtn);
        controls.appendChild(stopBtn);
        controls.appendChild(resetBtn);

        document.body.appendChild(overlay);

        overlayState = {
            el: overlay,
            timeEl: time,
            indicatorEl: indicator,
            playBtn,
            pauseBtn,
            stopBtn,
            resetBtn,
            headerEl: header,
            platformKey,
        };

        let isDragging = false;
        let dragOffset = { x: 0, y: 0 };

        const onPointerDown = (event) => {
            if (!overlayState || !overlayState.el) return;
            if (event.target && event.target.closest(".cb-timer-close")) return;
            if (event.target && event.target.closest(".cb-timer-btn")) return;
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

function getElapsedSecondsFromSession(session) {
    if (!session) return 0;
    const hasElapsed = Number.isFinite(session.elapsedSeconds);
    if (!hasElapsed) {
        if (!session.startTime) return 0;
        const end = session.endTime || nowSeconds();
        return Math.max(0, end - session.startTime);
    }
    const base = session.elapsedSeconds || 0;
    if (session.startTime && !session.endTime && !session.isPaused) {
        return base + Math.max(0, nowSeconds() - session.startTime);
    }
    return Math.max(0, base);
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

            markActivity(sessionKey);
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
            markActivity(sessionKey);
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
    if (now - lastSubmissionPrune > 60000) {
        for (const [key, value] of lastSubmissionKeys.entries()) {
            if (!value || now - value.ts > SUBMISSION_TTL_MS) {
                lastSubmissionKeys.delete(key);
            }
        }
        lastSubmissionPrune = now;
    }
    const last = lastSubmissionKeys.get(sessionKey);
    if (last && last.fingerprint === fingerprint && now - last.ts < SUBMISSION_DEDUP_MS) {
        return false;
    }
    lastSubmissionKeys.set(sessionKey, { fingerprint, ts: now });
    return true;
}

function isSuccessfulSubmission(adapter, data) {
    if (adapter && typeof adapter.isSuccessfulSubmission === "function") {
        return adapter.isSuccessfulSubmission(data);
    }
    return isAcceptedVerdict(data && data.verdict ? data.verdict : null);
}

function handleSubmission(adapter, sessionKey, basePayload, submission, submissionId) {
    if (!submission) return;
    if (!shouldSendSubmission(sessionKey, { ...submission, submissionId })) return;

    markActivity(sessionKey);

    const isSuccess = isSuccessfulSubmission(adapter, submission);

    sendSessionEvent("submission", {
        ...basePayload,
        submissionId,
        verdict: submission.verdict || null,
        language: submission.language || null,
        isSuccess,
        autoStop: !!settings.AUTO_STOP_ON_ACCEPTED,
        submittedAt: nowSeconds(),
    });
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
    if (
        snapshot &&
        (snapshot.startTime ||
            snapshot.endTime ||
            snapshot.isPaused ||
            (snapshot.elapsedSeconds || 0) > 0)
    ) {
        timerStartSent.add(sessionKey);
    }

    const updateDisplay = () => {
        if (!overlay || !overlay.el) return;

        const started = !!(snapshot && snapshot.startTime);
        const ended = !!(snapshot && snapshot.endTime);
        const paused = !!(snapshot && snapshot.isPaused);
        const elapsed = getElapsedSecondsFromSession(snapshot);

        overlay.el.dataset.size = settings.TIMER_OVERLAY_SIZE || "medium";

        let state = "idle";
        if (ended) state = "completed";
        else if (paused) state = "paused";
        else if (started) state = "running";
        overlay.el.dataset.state = state;

        overlay.timeEl.textContent = formatElapsed(elapsed);

        if (overlay.indicatorEl) {
            let title = "Waiting";
            if (state === "running") title = "Running";
            if (state === "paused") title = "Paused";
            if (state === "completed") title = "Completed";
            if (state === "idle" && settings.TIMER_START_MODE === "MANUAL") {
                title = "Manual start";
            }
            overlay.indicatorEl.title = title;
        }

        const canPlay = state !== "running";
        const canPause = state === "running";
        const hasAnyTime = elapsed > 0 || started || ended;

        overlay.playBtn.disabled = !canPlay;
        overlay.pauseBtn.disabled = !canPause;
        if (overlay.stopBtn) {
            overlay.stopBtn.disabled =
                !settings.ALLOW_MANUAL_STOP || ended || !hasAnyTime;
        }
        overlay.resetBtn.disabled = !hasAnyTime;

        let playTitle = "Start";
        if (state === "paused") playTitle = "Resume";
        if (state === "completed") playTitle = "Start new session";
        overlay.playBtn.title = playTitle;
        overlay.playBtn.setAttribute("aria-label", playTitle);
    };

    overlay.playBtn.onclick = () => {
        const now = nowSeconds();
        const ended = snapshot && snapshot.endTime;
        if (ended) {
            sendSessionEvent("timer_reset", {
                ...basePayload,
                resetAt: now,
            });
            snapshot = {
                ...(snapshot || {}),
                startTime: null,
                endTime: null,
                elapsedSeconds: 0,
                isPaused: false,
                pausedAt: null,
            };
        }

        if (timerStartSent.has(sessionKey) && snapshot && snapshot.startTime) {
            return;
        }

        markActivity(sessionKey);
        timerStartSent.add(sessionKey);
        sendSessionEvent("timer_start", {
            ...basePayload,
            startedAt: now,
        });
        snapshot = {
            ...(snapshot || {}),
            startTime: now,
            endTime: null,
            isPaused: false,
            pausedAt: null,
            elapsedSeconds:
                snapshot && Number.isFinite(snapshot.elapsedSeconds)
                    ? snapshot.elapsedSeconds
                    : 0,
        };
        updateDisplay();
    };

    overlay.pauseBtn.onclick = () => {
        if (!snapshot || !snapshot.startTime || snapshot.isPaused) return;
        const now = nowSeconds();
        markActivity(sessionKey);
        sendSessionEvent("timer_pause", {
            ...basePayload,
            pausedAt: now,
        });
        const baseElapsed = Number.isFinite(snapshot.elapsedSeconds)
            ? snapshot.elapsedSeconds
            : 0;
        snapshot = {
            ...(snapshot || {}),
            elapsedSeconds: baseElapsed + Math.max(0, now - snapshot.startTime),
            startTime: null,
            isPaused: true,
            pausedAt: now,
        };
        updateDisplay();
    };

    overlay.resetBtn.onclick = () => {
        const now = nowSeconds();
        markActivity(sessionKey);
        sendSessionEvent("timer_reset", {
            ...basePayload,
            resetAt: now,
        });
        snapshot = {
            ...(snapshot || {}),
            startTime: null,
            endTime: null,
            elapsedSeconds: 0,
            isPaused: false,
            pausedAt: null,
        };
        updateDisplay();
    };

    if (overlay.stopBtn) {
        overlay.stopBtn.onclick = () => {
            if (!settings.ALLOW_MANUAL_STOP) return;
            const now = nowSeconds();
            const elapsed = getElapsedSecondsFromSession(snapshot);
            markActivity(sessionKey);
            sendSessionEvent("timer_stop", {
                platform: basePayload.platform,
                problemId: basePayload.problemId,
                stoppedAt: now,
                reason: "manual",
            });
            snapshot = {
                ...(snapshot || {}),
                startTime: null,
                endTime: now,
                elapsedSeconds: elapsed,
                isPaused: false,
                pausedAt: null,
            };
            updateDisplay();
        };
    }

    updateDisplay();

    let tick = 0;
    const intervalId = setInterval(async () => {
        tick += 1;
        if (tick % 5 === 0) {
            const latest = await fetchSession(platformKey, problemId);
            if (latest) {
                snapshot = latest;
                if (
                    snapshot.startTime ||
                    snapshot.endTime ||
                    snapshot.isPaused ||
                    (snapshot.elapsedSeconds || 0) > 0
                ) {
                    timerStartSent.add(sessionKey);
                }
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

    if (
        settings.AUTO_STOP_ON_PROBLEM_SWITCH &&
        lastSessionInfo &&
        lastSessionInfo.sessionKey !== sessionKey
    ) {
        await stopSessionIfActive(
            lastSessionInfo.platformKey,
            lastSessionInfo.problemId,
            "problem_switch",
        );
    }

    setActiveKey(sessionKey);
    lastSessionInfo = { platformKey, problemId, sessionKey };

    const basePayload = {
        platform: platformKey,
        problemId,
        difficulty,
    };

    sendSessionEvent("page_view", basePayload);

    const activityHandler = () => markActivity(sessionKey);
    const onVisibility = () => {
        if (document.visibilityState === "visible") {
            markActivity(sessionKey);
        }
    };
    document.addEventListener("keydown", activityHandler, true);
    document.addEventListener("mousedown", activityHandler, true);
    document.addEventListener("visibilitychange", onVisibility);

    cleanupFns.push(() => {
        document.removeEventListener("keydown", activityHandler, true);
        document.removeEventListener("mousedown", activityHandler, true);
        document.removeEventListener("visibilitychange", onVisibility);
    });

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

    startInactivityWatcher(sessionKey, basePayload);

    const getSubmissionId = adapter.getSubmissionId
        ? adapter.getSubmissionId.bind(adapter)
        : null;
    const submissionId = getSubmissionId ? getSubmissionId() : null;
    const submission = adapter.getSubmissionData ? adapter.getSubmissionData() : null;
    if (submission) {
        handleSubmission(adapter, sessionKey, basePayload, submission, submissionId);
    } else if (adapter.observeSubmissionData) {
        const stop = adapter.observeSubmissionData((data) => {
            if (!data) return;
            const currentSubmissionId = getSubmissionId ? getSubmissionId() : null;
            handleSubmission(
                adapter,
                sessionKey,
                basePayload,
                data,
                currentSubmissionId,
            );
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
