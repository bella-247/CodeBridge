/**
 * options.js - Configuration management for CodeBridge
 */

const $ = (id) => document.getElementById(id);

const SESSION_DEFAULTS = {
    SESSION_PRUNE_DAYS: 90,
    MAX_SESSIONS_STORED: 1000,
    TIMER_START_MODE: "DELAYED_AUTO",
    AUTO_START_DELAY_SECONDS: 10,
    SUPPORTED_PLATFORMS_ENABLED: ["codeforces", "leetcode"],
    SHOW_TIMER_OVERLAY: true,
    TIMER_OVERLAY_SIZE: "medium",
};

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

                if ($("sessionPruneDays"))
                    $("sessionPruneDays").value = String(pruneDays);
                if ($("maxSessionsStored"))
                    $("maxSessionsStored").value = String(maxSessions);
                if ($("timerStartMode"))
                    $("timerStartMode").value = timerMode;
                if ($("autoStartDelay"))
                    $("autoStartDelay").value = String(autoDelay);
                if ($("platformCodeforces"))
                    $("platformCodeforces").checked =
                        platforms.includes("codeforces");
                if ($("platformLeetCode"))
                    $("platformLeetCode").checked =
                        platforms.includes("leetcode");
                if ($("showTimerOverlay"))
                    $("showTimerOverlay").checked = !!showTimerOverlay;
                if ($("timerOverlaySize"))
                    $("timerOverlaySize").value = timerOverlaySize;
            }
        },
    );
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
    if ($("platformCodeforces") && $("platformCodeforces").checked) {
        platformsEnabled.push("codeforces");
    }
    if ($("platformLeetCode") && $("platformLeetCode").checked) {
        platformsEnabled.push("leetcode");
    }
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

    const autoStartDelay = Number.isFinite(autoStartDelayRaw)
        ? Math.max(0, autoStartDelayRaw)
        : SESSION_DEFAULTS.AUTO_START_DELAY_SECONDS;
    const sessionPruneDays = Number.isFinite(sessionPruneRaw)
        ? Math.max(1, sessionPruneRaw)
        : SESSION_DEFAULTS.SESSION_PRUNE_DAYS;
    const maxSessionsStored = Number.isFinite(maxSessionsRaw)
        ? Math.max(1, maxSessionsRaw)
        : SESSION_DEFAULTS.MAX_SESSIONS_STORED;

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
        SUPPORTED_PLATFORMS_ENABLED: platformsEnabled.length
            ? platformsEnabled
            : SESSION_DEFAULTS.SUPPORTED_PLATFORMS_ENABLED,
        SHOW_TIMER_OVERLAY: !!showTimerOverlay,
        TIMER_OVERLAY_SIZE: timerOverlaySize,
    };

    chrome.storage.local.set(toSave, () => {
        const status = $("status");
        status.textContent = "Configuration saved successfully!";
        status.style.color = "var(--accent)";
        setTimeout(() => (status.textContent = ""), 3000);
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

function clearExtensionStorage() {
    if (
        confirm("This will clear ALL settings and sign you out. Are you sure?")
    ) {
        chrome.storage.local.clear(() => {
            alert("Storage cleared.");
            location.reload();
        });
    }
}

document.addEventListener("DOMContentLoaded", () => {
    loadOptions();
    $("saveBtn").addEventListener("click", saveOptions);
    $("resetTemplates").addEventListener("click", resetTemplates);
    $("clearStorageBtn").addEventListener("click", clearExtensionStorage);
});
