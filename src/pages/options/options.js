/**
 * options.js - Configuration management for CodeBridge
 */

import { SUPPORTED_PLATFORMS } from "../../utils/constants.js";
import { SESSION_DEFAULTS } from "../../shared/sessionDefaults.js";
import {
    buildUserDataPayload,
    downloadBlob,
    sessionsToCsv,
} from "../../analytics/exporters.js";

const $ = (id) => document.getElementById(id);
const SETTINGS_EXPORT_KEYS = new Set([
    "github_owner",
    "github_repo",
    "github_branch",
    "github_language",
    "github_file_structure",
    "template_commit",
    "template_path",
    "template_readme",
    "template_solution",
    "includeProblemStatement",
    "allowUpdateDefault",
    "showBubble",
    "autoSave",
    ...Object.keys(SESSION_DEFAULTS),
]);

const SETTINGS_EXPORT_FORMAT = "codebridge-settings";
const SETTINGS_EXPORT_VERSION = 1;
const EXCLUDED_SETTINGS_KEYS = ["github_token", "device_flow_state"];

function updateDelayedAutoLabel() {
    const option = document.querySelector(
        "#timerStartMode option[value='DELAYED_AUTO']",
    );
    if (!option) return;
    const delayEl = $("autoStartDelay");
    const raw = delayEl ? parseInt(delayEl.value, 10) : NaN;
    const delay = Number.isFinite(raw)
        ? Math.max(0, raw)
        : SESSION_DEFAULTS.AUTO_START_DELAY_SECONDS;
    option.textContent = `Delayed Auto (${delay}s)`;
}

function loadOptions() {
    chrome.storage.local.get(
        [
            "github_owner",
            "github_repo",
            "github_branch",
            "template_commit",
            "template_path",
            "template_readme",
            "template_solution",
            "includeProblemStatement",
            "allowUpdateDefault",
            "showBubble",
            "SESSION_PRUNE_DAYS",
            "MAX_SESSIONS_STORED",
            "TIMER_START_MODE",
            "AUTO_START_DELAY_SECONDS",
            "SUPPORTED_PLATFORMS_ENABLED",
            "SHOW_TIMER_OVERLAY",
            "TIMER_OVERLAY_SIZE",
            "AUTO_STOP_ON_ACCEPTED",
            "AUTO_STOP_ON_PROBLEM_SWITCH",
            "INACTIVITY_TIMEOUT_MINUTES",
            "ALLOW_MANUAL_STOP",
        ],
        (items) => {
            if (items) {
                if (items.github_owner) $("owner").value = items.github_owner;
                if (items.github_repo) $("repo").value = items.github_repo;
                if (items.github_branch)
                    $("branch").value = items.github_branch;

                if (items.template_commit)
                    $("templateCommit").value = items.template_commit;
                if (items.template_path)
                    $("templatePath").value = items.template_path;
                if (items.template_readme)
                    $("templateReadme").value = items.template_readme;
                if (items.template_solution)
                    $("templateSolution").value = items.template_solution;

                if (
                    typeof items.includeProblemStatement !== "undefined" &&
                    $("includeProblemStatement")
                ) {
                    $("includeProblemStatement").checked =
                        !!items.includeProblemStatement;
                } else if ($("includeProblemStatement")) {
                    $("includeProblemStatement").checked = true;
                }

                if (
                    typeof items.allowUpdateDefault !== "undefined" &&
                    $("allowUpdateDefault")
                ) {
                    $("allowUpdateDefault").checked =
                        !!items.allowUpdateDefault;
                }

                if (
                    typeof items.showBubble !== "undefined" &&
                    $("showBubble")
                ) {
                    $("showBubble").checked = !!items.showBubble;
                } else if ($("showBubble")) {
                    $("showBubble").checked = true;
                }

                const pruneDays =
                    typeof items.SESSION_PRUNE_DAYS === "number"
                        ? items.SESSION_PRUNE_DAYS
                        : SESSION_DEFAULTS.SESSION_PRUNE_DAYS;
                const maxSessions =
                    typeof items.MAX_SESSIONS_STORED === "number"
                        ? items.MAX_SESSIONS_STORED
                        : SESSION_DEFAULTS.MAX_SESSIONS_STORED;
                const timerMode =
                    items.TIMER_START_MODE || SESSION_DEFAULTS.TIMER_START_MODE;
                const autoDelay =
                    typeof items.AUTO_START_DELAY_SECONDS === "number"
                        ? items.AUTO_START_DELAY_SECONDS
                        : SESSION_DEFAULTS.AUTO_START_DELAY_SECONDS;
                const platforms = Array.isArray(
                    items.SUPPORTED_PLATFORMS_ENABLED,
                )
                    ? items.SUPPORTED_PLATFORMS_ENABLED
                    : SESSION_DEFAULTS.SUPPORTED_PLATFORMS_ENABLED;
                const showTimerOverlay =
                    typeof items.SHOW_TIMER_OVERLAY === "boolean"
                        ? items.SHOW_TIMER_OVERLAY
                        : SESSION_DEFAULTS.SHOW_TIMER_OVERLAY;
                const timerOverlaySize =
                    typeof items.TIMER_OVERLAY_SIZE === "string"
                        ? items.TIMER_OVERLAY_SIZE
                        : SESSION_DEFAULTS.TIMER_OVERLAY_SIZE;
                const autoStopOnAccepted =
                    typeof items.AUTO_STOP_ON_ACCEPTED === "boolean"
                        ? items.AUTO_STOP_ON_ACCEPTED
                        : SESSION_DEFAULTS.AUTO_STOP_ON_ACCEPTED;
                const autoStopOnProblemSwitch =
                    typeof items.AUTO_STOP_ON_PROBLEM_SWITCH === "boolean"
                        ? items.AUTO_STOP_ON_PROBLEM_SWITCH
                        : SESSION_DEFAULTS.AUTO_STOP_ON_PROBLEM_SWITCH;
                const allowManualStop =
                    typeof items.ALLOW_MANUAL_STOP === "boolean"
                        ? items.ALLOW_MANUAL_STOP
                        : SESSION_DEFAULTS.ALLOW_MANUAL_STOP;
                const inactivityTimeout =
                    typeof items.INACTIVITY_TIMEOUT_MINUTES === "number"
                        ? items.INACTIVITY_TIMEOUT_MINUTES
                        : SESSION_DEFAULTS.INACTIVITY_TIMEOUT_MINUTES;

                if ($("sessionPruneDays"))
                    $("sessionPruneDays").value = String(pruneDays);
                if ($("maxSessionsStored"))
                    $("maxSessionsStored").value = String(maxSessions);
                if ($("timerStartMode")) $("timerStartMode").value = timerMode;
                if ($("autoStartDelay"))
                    $("autoStartDelay").value = String(autoDelay);
                updateDelayedAutoLabel();

                // Dynamic Platform List
                const container = $("platformsContainer");
                if (container) {
                    container.innerHTML = "";
                    SUPPORTED_PLATFORMS.forEach((platform) => {
                        const label = document.createElement("label");
                        label.className = "checkbox-row";

                        const input = document.createElement("input");
                        input.type = "checkbox";
                        input.id = `platform_${platform.key}`;
                        input.checked = platforms.includes(platform.key);

                        label.appendChild(input);
                        label.appendChild(
                            document.createTextNode(" " + platform.name),
                        );
                        container.appendChild(label);
                    });
                }

                if ($("showTimerOverlay"))
                    $("showTimerOverlay").checked = !!showTimerOverlay;
                if ($("timerOverlaySize"))
                    $("timerOverlaySize").value = timerOverlaySize;
                if ($("autoStopOnAccepted"))
                    $("autoStopOnAccepted").checked = !!autoStopOnAccepted;
                if ($("autoStopOnProblemSwitch"))
                    $("autoStopOnProblemSwitch").checked =
                        !!autoStopOnProblemSwitch;
                if ($("allowManualStop"))
                    $("allowManualStop").checked = !!allowManualStop;
                if ($("inactivityTimeout"))
                    $("inactivityTimeout").value = String(inactivityTimeout);
            }
        },
    );
}

function sendMessage(action, payload = {}) {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({ action, ...payload }, (resp) => {
                if (chrome.runtime.lastError) {
                    resolve({
                        success: false,
                        message: chrome.runtime.lastError.message,
                    });
                    return;
                }
                resolve(resp || { success: false, message: "No response" });
            });
        } catch (e) {
            resolve({ success: false, message: e.message || String(e) });
        }
    });
}

function setStatus(message, tone = "accent") {
    const status = $("status");
    if (!status) return;
    status.textContent = message || "";
    if (!message) return;
    status.style.color = tone === "error" ? "var(--error)" : "var(--accent)";
    setTimeout(() => {
        if (status.textContent === message) status.textContent = "";
    }, 4000);
}

function saveOptions() {
    const owner = $("owner").value.trim();
    const repo = $("repo").value.trim();
    const branch = $("branch").value.trim();

    const templateCommit = $("templateCommit").value.trim();
    const templatePath = $("templatePath").value.trim();
    const templateReadme = $("templateReadme").value.trim();
    const templateSolution = $("templateSolution").value.trim();
    const includeProblemStatement = $("includeProblemStatement")
        ? $("includeProblemStatement").checked
        : true;
    const allowUpdateDefault = $("allowUpdateDefault")
        ? $("allowUpdateDefault").checked
        : false;
    const showBubble = $("showBubble") ? $("showBubble").checked : true;

    const rawTimerMode = $("timerStartMode")
        ? $("timerStartMode").value
        : SESSION_DEFAULTS.TIMER_START_MODE;
    const allowedModes = ["DELAYED_AUTO", "TYPING", "MANUAL"];
    const timerStartMode = allowedModes.includes(rawTimerMode)
        ? rawTimerMode
        : SESSION_DEFAULTS.TIMER_START_MODE;
    const autoStartDelayRaw = $("autoStartDelay")
        ? parseInt($("autoStartDelay").value, 10)
        : SESSION_DEFAULTS.AUTO_START_DELAY_SECONDS;
    const sessionPruneRaw = $("sessionPruneDays")
        ? parseInt($("sessionPruneDays").value, 10)
        : SESSION_DEFAULTS.SESSION_PRUNE_DAYS;
    const maxSessionsRaw = $("maxSessionsStored")
        ? parseInt($("maxSessionsStored").value, 10)
        : SESSION_DEFAULTS.MAX_SESSIONS_STORED;

    const platformsEnabled = [];
    SUPPORTED_PLATFORMS.forEach((platform) => {
        const el = $(`platform_${platform.key}`);
        if (el && el.checked) {
            platformsEnabled.push(platform.key);
        }
    });

    const showTimerOverlay = $("showTimerOverlay")
        ? $("showTimerOverlay").checked
        : SESSION_DEFAULTS.SHOW_TIMER_OVERLAY;
    const timerOverlaySizeRaw = $("timerOverlaySize")
        ? $("timerOverlaySize").value
        : SESSION_DEFAULTS.TIMER_OVERLAY_SIZE;
    const allowedSizes = ["small", "medium", "large"];
    const timerOverlaySize = allowedSizes.includes(timerOverlaySizeRaw)
        ? timerOverlaySizeRaw
        : SESSION_DEFAULTS.TIMER_OVERLAY_SIZE;
    const autoStopOnAccepted = $("autoStopOnAccepted")
        ? $("autoStopOnAccepted").checked
        : SESSION_DEFAULTS.AUTO_STOP_ON_ACCEPTED;
    const autoStopOnProblemSwitch = $("autoStopOnProblemSwitch")
        ? $("autoStopOnProblemSwitch").checked
        : SESSION_DEFAULTS.AUTO_STOP_ON_PROBLEM_SWITCH;
    const allowManualStop = $("allowManualStop")
        ? $("allowManualStop").checked
        : SESSION_DEFAULTS.ALLOW_MANUAL_STOP;
    const inactivityTimeoutRaw = $("inactivityTimeout")
        ? parseInt($("inactivityTimeout").value, 10)
        : SESSION_DEFAULTS.INACTIVITY_TIMEOUT_MINUTES;

    const autoStartDelay = Number.isFinite(autoStartDelayRaw)
        ? Math.max(0, autoStartDelayRaw)
        : SESSION_DEFAULTS.AUTO_START_DELAY_SECONDS;
    const sessionPruneDays = Number.isFinite(sessionPruneRaw)
        ? Math.max(1, sessionPruneRaw)
        : SESSION_DEFAULTS.SESSION_PRUNE_DAYS;
    const maxSessionsStored = Number.isFinite(maxSessionsRaw)
        ? Math.max(1, maxSessionsRaw)
        : SESSION_DEFAULTS.MAX_SESSIONS_STORED;
    const inactivityTimeoutMinutes = Number.isFinite(inactivityTimeoutRaw)
        ? Math.max(0, inactivityTimeoutRaw)
        : SESSION_DEFAULTS.INACTIVITY_TIMEOUT_MINUTES;

    const toSave = {
        github_owner: owner,
        github_repo: repo,
        github_branch: branch,
        template_commit: templateCommit,
        template_path: templatePath,
        template_readme: templateReadme,
        template_solution: templateSolution,
        includeProblemStatement,
        allowUpdateDefault,
        showBubble,
        TIMER_START_MODE: timerStartMode,
        AUTO_START_DELAY_SECONDS: autoStartDelay,
        SESSION_PRUNE_DAYS: sessionPruneDays,
        MAX_SESSIONS_STORED: maxSessionsStored,
        SUPPORTED_PLATFORMS_ENABLED: platformsEnabled,
        SHOW_TIMER_OVERLAY: !!showTimerOverlay,
        TIMER_OVERLAY_SIZE: timerOverlaySize,
        AUTO_STOP_ON_ACCEPTED: !!autoStopOnAccepted,
        AUTO_STOP_ON_PROBLEM_SWITCH: !!autoStopOnProblemSwitch,
        ALLOW_MANUAL_STOP: !!allowManualStop,
        INACTIVITY_TIMEOUT_MINUTES: inactivityTimeoutMinutes,
    };

    chrome.storage.local.set(toSave, () => {
        setStatus("Configuration saved successfully!", "accent");
    });
}

function resetTemplates() {
    if (confirm("Restore all templates to default?")) {
        $("templateCommit").value = "Solved [id] - [title] ([difficulty])";
        $("templatePath").value = "[id]-[slug]/solution.[ext]";
        $("templateReadme").value =
            "# [title]\n\n**Difficulty:** [difficulty]\n\n**Time:** [time]\n\n**URL:** [url]\n\n## Problem\n\n[description]";
        $("templateSolution").value =
            "[title]\n\n[url]\n\nDifficulty: [difficulty]";
        if ($("includeProblemStatement"))
            $("includeProblemStatement").checked = true;
        saveOptions();
    }
}

function pickSettings(items) {
    const output = {};
    SETTINGS_EXPORT_KEYS.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(items, key)) {
            output[key] = items[key];
        }
    });
    return output;
}

async function exportSettings() {
    const settings = await new Promise((resolve) =>
        chrome.storage.local.get(Array.from(SETTINGS_EXPORT_KEYS), (items) =>
            resolve(items || {}),
        ),
    );

    const payload = {
        format: SETTINGS_EXPORT_FORMAT,
        version: SETTINGS_EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        settings: pickSettings(settings),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `codebridge-settings-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 800);
    setStatus("Settings exported.", "accent");
}

async function importSettings() {
    const fileInput = $("importSettingsFile");
    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
        setStatus("Select a settings file first.", "error");
        return;
    }

    let parsed = null;
    try {
        const text = await fileInput.files[0].text();
        parsed = JSON.parse(text);
    } catch (err) {
        setStatus("Invalid JSON file.", "error");
        return;
    }

    if (parsed && parsed.format && parsed.format !== SETTINGS_EXPORT_FORMAT) {
        setStatus("Unsupported settings format.", "error");
        return;
    }

    const settingsPayload =
        parsed && typeof parsed === "object"
            ? parsed.settings && typeof parsed.settings === "object"
                ? parsed.settings
                : parsed
            : null;

    if (!settingsPayload || typeof settingsPayload !== "object") {
        setStatus("No settings found in file.", "error");
        return;
    }

    const sanitized = { ...settingsPayload };
    EXCLUDED_SETTINGS_KEYS.forEach((key) => {
        if (key in sanitized) {
            delete sanitized[key];
        }
    });
    const toSave = pickSettings(sanitized);
    if (!Object.keys(toSave).length) {
        setStatus("No valid settings found to import.", "error");
        return;
    }

    await new Promise((resolve) => chrome.storage.local.set(toSave, resolve));
    loadOptions();
    setStatus("Settings imported.", "accent");
}

async function exportUserData() {
    const format = $("userDataFormat") ? $("userDataFormat").value : "json";
    const resp = await sendMessage("getSessions");
    if (!resp || !resp.success) {
        setStatus(resp.message || "Failed to load sessions.", "error");
        return;
    }

    const sessions = Array.isArray(resp.sessions) ? resp.sessions : [];
    const dateTag = new Date().toISOString().slice(0, 10);

    if (format === "csv") {
        const csv = sessionsToCsv(sessions);
        const blob = new Blob([csv], { type: "text/csv" });
        downloadBlob(blob, `codebridge-user-data-${dateTag}.csv`);
        setStatus("User data exported (CSV).", "accent");
        return;
    }

    const payload = buildUserDataPayload(sessions);
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
    });
    downloadBlob(blob, `codebridge-user-data-${dateTag}.json`);
    setStatus("User data exported (JSON).", "accent");
}

async function clearExtensionStorage() {
    if (
        !confirm("This will clear ALL settings and sign you out. Are you sure?")
    ) {
        return;
    }
    try {
        const resp = await sendMessage("clearSessions");
        if (!resp || !resp.success) {
            alert(resp && resp.message ? resp.message : "Failed to clear sessions.");
            return;
        }
    } catch (err) {
        alert(err && err.message ? err.message : "Failed to clear sessions.");
        return;
    }

    chrome.storage.local.clear(() => {
        alert("Storage cleared.");
        location.reload();
    });
}

document.addEventListener("DOMContentLoaded", () => {
    loadOptions();
    $("saveBtn").addEventListener("click", saveOptions);
    $("resetTemplates").addEventListener("click", resetTemplates);
    $("clearStorageBtn").addEventListener("click", clearExtensionStorage);
    if ($("autoStartDelay")) {
        $("autoStartDelay").addEventListener("input", updateDelayedAutoLabel);
        $("autoStartDelay").addEventListener("change", updateDelayedAutoLabel);
    }
    if ($("exportSettingsBtn")) {
        $("exportSettingsBtn").addEventListener("click", exportSettings);
    }
    if ($("importSettingsBtn")) {
        $("importSettingsBtn").addEventListener("click", importSettings);
    }
    if ($("exportUserDataBtn")) {
        $("exportUserDataBtn").addEventListener("click", exportUserData);
    }
});
