/**
 * options.js - Configuration management for CodeBridge
 */

import { SUPPORTED_PLATFORMS } from "../../utils/constants.js";
import { SESSION_DEFAULTS } from "../../shared/sessionDefaults.js";
import { SESSION_EXPORT_VERSION } from "../../shared/sessionSchema.js";

const $ = (id) => document.getElementById(id);
const EXCLUDED_EXPORT_KEYS = new Set(["github_token", "device_flow_state"]);

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
                    $("allowUpdateDefault").checked = !!items.allowUpdateDefault;
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
                if ($("timerStartMode"))
                    $("timerStartMode").value = timerMode;
                if ($("autoStartDelay"))
                    $("autoStartDelay").value = String(autoDelay);

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
                        label.appendChild(document.createTextNode(" " + platform.name));
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
                    $("autoStopOnProblemSwitch").checked = !!autoStopOnProblemSwitch;
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
                    resolve({ success: false, message: chrome.runtime.lastError.message });
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
    status.style.color =
        tone === "error" ? "var(--error)" : "var(--accent)";
    setTimeout(() => {
        if (status.textContent === message) status.textContent = "";
    }, 4000);
}

async function exportData() {
    const [settings, sessionsResp] = await Promise.all([
        new Promise((resolve) => chrome.storage.local.get(null, (items) => resolve(items || {}))),
        sendMessage("getSessions"),
    ]);

    const filteredSettings = Object.fromEntries(
        Object.entries(settings).filter(([key]) => !EXCLUDED_EXPORT_KEYS.has(key)),
    );

    const sessions = sessionsResp && sessionsResp.success ? sessionsResp.sessions || [] : [];
    const payload = {
        formatVersion: SESSION_EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        settings: filteredSettings,
        sessions,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `codebridge-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);

    setStatus("Backup exported.", "accent");
}

async function importData() {
    const fileInput = $("importFile");
    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
        setStatus("Select a backup file first.", "error");
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

    if (
        parsed &&
        typeof parsed.formatVersion === "number" &&
        parsed.formatVersion !== SESSION_EXPORT_VERSION
    ) {
        setStatus("Unsupported backup format version.", "error");
        return;
    }

    const settings = parsed && parsed.settings ? parsed.settings : {};
    if (settings.github_token) {
        delete settings.github_token;
    }

    const sessions = Array.isArray(parsed && parsed.sessions) ? parsed.sessions : [];
    const replace = $("replaceSessions") ? $("replaceSessions").checked : true;
    const mode = replace ? "replace" : "merge";

    await new Promise((resolve) => chrome.storage.local.set(settings, resolve));
    const resp = await sendMessage("importSessions", { sessions, mode });

    if (resp && resp.success) {
        loadOptions();
        setStatus(`Import completed (${resp.imported || 0} sessions).`, "accent");
    } else {
        setStatus(resp.message || "Import failed.", "error");
    }
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

async function clearExtensionStorage() {
    if (!confirm("This will clear ALL settings and sign you out. Are you sure?")) {
        return;
    }
    await sendMessage("clearSessions");
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
    if ($("exportDataBtn")) {
        $("exportDataBtn").addEventListener("click", exportData);
    }
    if ($("importDataBtn")) {
        $("importDataBtn").addEventListener("click", importData);
    }
});
