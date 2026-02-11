// auth/deviceFlow.js — GitHub Device Flow OAuth implementation
// This is your crown jewel. Spec-compliant, resilient, SW-restart safe.
//
// Handles:
// - Device code request
// - Token polling with proper error handling (authorization_pending, slow_down, expired_token, access_denied)
// - Persistence across service worker restarts

import { log, warn, error } from "../../core/logger.js";
import { notify } from "../../core/notifications.js";
import { setToken } from "./tokenStore.js";
import {
    scheduleAlarmForDeviceFlow,
    clearAlarmForDeviceFlow,
    isDeviceFlowAlarm,
    getDeviceCodeFromAlarm
} from "./alarms.js";
import { CLIENT_ID, DEVICE_CODE_URL, TOKEN_URL } from "../constants.js";

// Track active polling state in-memory while worker is alive
// Structure: { device_code, user_code, verification_uri, verification_uri_complete, intervalSeconds, expiresAt, remember }
let activeDeviceFlow = null;

// Timer for immediate polling (while SW is active)
let immediatePollTimer = null;

// ─────────────────────────────────────────────────────────────
// HTTP Helper
// ─────────────────────────────────────────────────────────────

async function postForm(url, params) {
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Accept: "application/json",
            },
            body: new URLSearchParams(params),
        });
        const text = await res.text();
        let json = null;
        try {
            json = text ? JSON.parse(text) : {};
        } catch (e) {
            json = { raw: text };
        }
        return { status: res.status, json, raw: text };
    } catch (err) {
        throw new Error(`Network error posting to ${url}: ${err.message}`);
    }
}

// ─────────────────────────────────────────────────────────────
// State Persistence (survives SW restarts)
// ─────────────────────────────────────────────────────────────

function persistDeviceFlowState(state) {
    if (!state) {
        chrome.storage.local.remove("device_flow_state", () => {
            log("cleared persisted device flow state");
        });
        return;
    }
    chrome.storage.local.set({ device_flow_state: state }, () => {
        log("persisted device flow state", state && {
            device_code: state.device_code,
            expiresAt: state.expiresAt,
        });
    });
}

export function readPersistedDeviceFlowState() {
    return new Promise((resolve) => {
        chrome.storage.local.get(["device_flow_state"], (items) => {
            resolve(items && items.device_flow_state ? items.device_flow_state : null);
        });
    });
}

// ─────────────────────────────────────────────────────────────
// Immediate Polling (while SW is active)
// ─────────────────────────────────────────────────────────────

function scheduleImmediatePoll(intervalSeconds) {
    if (immediatePollTimer) {
        clearTimeout(immediatePollTimer);
        immediatePollTimer = null;
    }
    const ms = Math.max(1000, intervalSeconds * 1000);
    log("scheduling immediate poll in ms", ms);
    immediatePollTimer = setTimeout(() => {
        immediatePollTimer = null;
        pollForTokenOnce().catch((err) => {
            warn("pollForTokenOnce error", err && err.message);
        });
    }, ms);
}

// ─────────────────────────────────────────────────────────────
// Main Device Flow API
// ─────────────────────────────────────────────────────────────

/**
 * Start the GitHub Device Flow
 * @param {Object} options
 * @param {boolean} options.remember - Whether to persist the token
 * @returns {Promise<Object>} Device flow data for display to user
 */
export async function startDeviceFlow({ remember = false } = {}) {
    if (!CLIENT_ID || CLIENT_ID.startsWith("<")) {
        throw new Error(
            "CLIENT_ID not set in constants.js. Set your GitHub OAuth App client id."
        );
    }

    log("requesting device code from GitHub");
    const { status, json, raw } = await postForm(DEVICE_CODE_URL, {
        client_id: CLIENT_ID,
        scope: "repo",
    });
    log("device code response", { status, json });

    if (!json || !json.device_code) {
        throw new Error(
            `Device flow start failed: ${JSON.stringify(json || raw)}`
        );
    }

    const now = Date.now();
    const interval = (json.interval && Number(json.interval)) || 5;
    const expiresIn = (json.expires_in && Number(json.expires_in)) || 900;

    activeDeviceFlow = {
        device_code: json.device_code,
        user_code: json.user_code,
        verification_uri: json.verification_uri,
        verification_uri_complete: json.verification_uri_complete,
        intervalSeconds: interval,
        expiresAt: now + expiresIn * 1000,
        remember: !!remember,
    };

    // Persist state so SW restarts can continue polling
    persistDeviceFlowState(activeDeviceFlow);

    // Start immediate short-term polling loop while SW is active
    scheduleImmediatePoll(activeDeviceFlow.intervalSeconds);

    // Schedule chrome.alarm to ensure polling continues even if SW is restarted
    scheduleAlarmForDeviceFlow(
        activeDeviceFlow.device_code,
        activeDeviceFlow.intervalSeconds
    );

    // Return user-facing data immediately
    return {
        device_code: activeDeviceFlow.device_code,
        user_code: activeDeviceFlow.user_code,
        verification_uri: activeDeviceFlow.verification_uri,
        verification_uri_complete: activeDeviceFlow.verification_uri_complete,
        interval: activeDeviceFlow.intervalSeconds,
        expires_in: expiresIn,
    };
}

/**
 * Poll the token endpoint once
 * Handles all OAuth error cases per spec
 */
export async function pollForTokenOnce() {
    // Load active flow (in-memory or persisted)
    if (!activeDeviceFlow) {
        activeDeviceFlow = await readPersistedDeviceFlowState();
        if (!activeDeviceFlow) {
            log("no active device flow to poll");
            return;
        }
    }

    const now = Date.now();

    // Check expiration
    if (activeDeviceFlow.expiresAt && now >= activeDeviceFlow.expiresAt) {
        const device_code = activeDeviceFlow.device_code;
        log("device flow expired for", device_code);

        persistDeviceFlowState(null);
        clearAlarmForDeviceFlow(device_code);
        activeDeviceFlow = null;

        chrome.runtime.sendMessage({
            action: "deviceFlowExpired",
            message: "Device flow expired. Please retry sign in.",
        });
        return;
    }

    log("polling token endpoint for device_code", activeDeviceFlow.device_code);

    let res;
    try {
        res = await postForm(TOKEN_URL, {
            client_id: CLIENT_ID,
            device_code: activeDeviceFlow.device_code,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        });
    } catch (err) {
        warn("token endpoint network error", err && err.message);
        // Retry later
        scheduleImmediatePoll(activeDeviceFlow.intervalSeconds);
        return;
    }

    log("token endpoint response", { status: res.status, json: res.json });

    const json = res.json || {};

    // Handle error responses
    if (json.error) {
        const err = json.error;

        if (err === "authorization_pending") {
            // Normal — user hasn't authorized yet, continue polling
            log("authorization_pending — will poll again");
            scheduleImmediatePoll(activeDeviceFlow.intervalSeconds);
            return;
        }

        if (err === "slow_down") {
            // Increase interval per OAuth spec
            log("slow_down — increasing interval and will poll again");
            activeDeviceFlow.intervalSeconds = (activeDeviceFlow.intervalSeconds || 5) + 5;
            persistDeviceFlowState(activeDeviceFlow);
            scheduleImmediatePoll(activeDeviceFlow.intervalSeconds);
            // Update alarm with new (coarse) interval
            scheduleAlarmForDeviceFlow(
                activeDeviceFlow.device_code,
                activeDeviceFlow.intervalSeconds
            );
            return;
        }

        if (err === "expired_token") {
            log("expired_token from server");
            const code = activeDeviceFlow.device_code;
            persistDeviceFlowState(null);
            clearAlarmForDeviceFlow(code);
            activeDeviceFlow = null;

            chrome.runtime.sendMessage({
                action: "deviceFlowExpired",
                message: "Device flow expired. Please retry sign in.",
            });
            return;
        }

        if (err === "access_denied") {
            log("access_denied by user");
            const code = activeDeviceFlow.device_code;
            persistDeviceFlowState(null);
            clearAlarmForDeviceFlow(code);
            activeDeviceFlow = null;

            chrome.runtime.sendMessage({
                action: "deviceFlowDenied",
                message: "Authorization denied.",
            });
            return;
        }

        // Unexpected error
        log("device flow error", json);
        chrome.runtime.sendMessage({
            action: "deviceFlowError",
            message: json.error_description || json.error || "Unknown error",
        });

        // Clear state to avoid tight loops
        const code = activeDeviceFlow.device_code;
        persistDeviceFlowState(null);
        clearAlarmForDeviceFlow(code);
        activeDeviceFlow = null;
        return;
    }

    // Success! We got a token
    if (json.access_token) {
        log("received access_token (success). storing token per remember flag");

        const token = json.access_token;
        const masked = token.slice(0, 4) + "..." + token.slice(-4);

        // Store token
        await setToken(token, activeDeviceFlow.remember);

        // Clean up persisted state and alarms
        const code = activeDeviceFlow.device_code;
        persistDeviceFlowState(null);
        clearAlarmForDeviceFlow(code);
        activeDeviceFlow = null;

        // Notify user
        try {
            notify(
                "GitHub authorization",
                "Signed in successfully. Return to CodeBridge to continue."
            );
        } catch (e) {
            log("notify failed", e && e.message);
        }

        chrome.runtime.sendMessage({
            action: "deviceFlowSuccess",
            tokenMasked: masked,
        });
        return;
    }

    // Fallback: unexpected response, schedule another poll
    log("unexpected token endpoint response — scheduling another poll", res);
    scheduleImmediatePoll(activeDeviceFlow.intervalSeconds);
}

/**
 * Restore device flow state on service worker startup
 * Call this when the background script initializes
 */
export async function restoreDeviceFlow() {
    try {
        const state = await readPersistedDeviceFlowState();
        if (state && state.device_code) {
            log("restoring persisted device flow state on startup", {
                device_code: state.device_code,
            });
            activeDeviceFlow = state;
            // Ensure alarm exists
            scheduleAlarmForDeviceFlow(
                state.device_code,
                state.intervalSeconds || 5
            );
        }
    } catch (e) {
        warn("restoreDeviceFlow error", e && e.message);
    }
}

/**
 * Handle alarm callback for device flow polling
 * @param {chrome.alarms.Alarm} alarm 
 */
export async function handleDeviceFlowAlarm(alarm) {
    try {
        log("alarm fired", alarm && alarm.name);
        if (!alarm || !alarm.name) return;
        if (!isDeviceFlowAlarm(alarm.name)) return;

        // Load persisted state and attempt a poll
        const state = await readPersistedDeviceFlowState();
        if (!state) {
            log("no persisted device flow state found for alarm", alarm.name);
            // Clear alarm just in case
            const device_code = getDeviceCodeFromAlarm(alarm.name);
            clearAlarmForDeviceFlow(device_code);
            return;
        }

        // Set activeDeviceFlow so pollForTokenOnce can use it
        activeDeviceFlow = state;
        // Perform a single poll attempt
        await pollForTokenOnce();
    } catch (err) {
        warn("alarm handler error", err && err.message);
    }
}
