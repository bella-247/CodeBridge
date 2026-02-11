import { $ } from "./popupDom.js";

export function createSettings({ state, ui, getFormValues, actions }) {
    let saveTimer = null;

    function persistPopupSettings() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            try {
                const {
                    owner,
                    repo,
                    branch,
                    language,
                    fileOrg,
                    allowUpdate,
                    showBubble,
                } = getFormValues();

                chrome.storage.local.set(
                    {
                        github_owner: owner,
                        github_repo: repo,
                        github_branch: branch,
                        github_language: language,
                        github_file_structure: fileOrg,
                        allowUpdateDefault: allowUpdate,
                        showBubble: showBubble,
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
        if (items.github_owner) $("owner").value = items.github_owner;
        if (items.github_repo) $("repo").value = items.github_repo;
        if (items.github_branch) $("branch").value = items.github_branch;

        if (
            typeof items.allowUpdateDefault !== "undefined" &&
            document.getElementById("allowUpdate")
        ) {
            document.getElementById("allowUpdate").checked =
                !!items.allowUpdateDefault;
        }
        if (
            typeof items.showBubble !== "undefined" &&
            document.getElementById("showBubble")
        ) {
            try {
                document.getElementById("showBubble").checked =
                    !!items.showBubble;
            } catch (e) {
                // ignore
            }
        }
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
    }

    function attachListeners() {
        try {
            const ownerEl = $("owner");
            if (ownerEl)
                ownerEl.addEventListener("input", () => {
                    persistPopupSettings();
                    refreshMeta();
                });
            const repoEl = $("repo");
            if (repoEl)
                repoEl.addEventListener("input", () => {
                    persistPopupSettings();
                    refreshMeta();
                });
            const branchEl = $("branch");
            if (branchEl)
                branchEl.addEventListener("input", () => {
                    persistPopupSettings();
                    refreshMeta();
                });
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
            const allowEl = document.getElementById("allowUpdate");
            if (allowEl) allowEl.addEventListener("change", persistPopupSettings);
            const showEl = document.getElementById("showBubble");
            if (showEl) showEl.addEventListener("change", persistPopupSettings);
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
                "showBubble",
            ],
            (items) => {
                applySettings(items);
                attachListeners();
            },
        );
    }

    return { init };
}
