import { $ } from "./popupDom.js";

let storageListenerRegistered = false;
let applySettingsRef = null;

function handleStorageChange(changes, area) {
    if (area !== "local" || !applySettingsRef) return;
    if (
        changes.github_owner ||
        changes.github_repo ||
        changes.github_branch ||
        changes.allowUpdateDefault
    ) {
        chrome.storage.local.get(
            [
                "github_owner",
                "github_repo",
                "github_branch",
                "allowUpdateDefault",
            ],
            (items) => applySettingsRef(items),
        );
    }
}

export function createSettings({ state, ui, getFormValues, actions }) {
    let saveTimer = null;

    function persistPopupSettings() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            try {
                const { language, fileOrg } = getFormValues();

                chrome.storage.local.set(
                    {
                        github_language: language,
                        github_file_structure: fileOrg,
                    },
                    () => {
                        console.log("[popup] persisted settings");
                    },
                );
            } catch (e) {
                console.warn("[popup] persist failed", e && e.message);
            }
        }, 250);
    }

    function applySettings(items) {
        if (!items) return;
        if (items.github_language) {
            const sel = document.getElementById("language");
            if (sel) {
                try {
                    sel.value = items.github_language;
                    sel.dataset.userSet = "1";
                } catch (e) {
                    // ignore
                }
            }
        }
        if (items.github_file_structure) {
            const sel = document.getElementById("fileOrg");
            if (sel) {
                try {
                    sel.value = items.github_file_structure;
                } catch (e) {
                    // ignore
                }
            }
        }

        if (ui && typeof ui.updateRepoSummary === "function") {
            ui.updateRepoSummary(items);
        }
    }

    function attachListeners() {
        try {
            const langEl = document.getElementById("language");
            if (langEl)
                langEl.addEventListener("change", () => {
                    langEl.dataset.userSet = "1";
                    persistPopupSettings();
                    refreshMeta();
                });
            const fileOrgEl = document.getElementById("fileOrg");
            if (fileOrgEl)
                fileOrgEl.addEventListener("change", () => {
                    persistPopupSettings();
                    refreshMeta();
                });
        } catch (e) {
            // ignore
        }
    }

    function refreshMeta() {
        if (state.lastProblemData) {
            ui.showMeta(state.lastProblemData);
            actions.checkExistingSubmission();
        }
    }

    function init() {
        chrome.storage.local.get(
            [
                "github_owner",
                "github_repo",
                "github_branch",
                "github_language",
                "github_file_structure",
                "allowUpdateDefault",
            ],
            (items) => {
                applySettings(items);
                attachListeners();
            },
        );

        applySettingsRef = applySettings;
        if (!storageListenerRegistered) {
            chrome.storage.onChanged.addListener(handleStorageChange);
            storageListenerRegistered = true;
        }
    }

    return { init };
}
