import { $ } from "./popupDom.js";
import { createUi } from "./popupUi.js";
import { createActions } from "./popupActions.js";
import { createSettings } from "./popupSettings.js";

export function initPopup() {
    const state = {
        lastProblemData: null,
        signInPending: false,
        detectInFlight: false,
        autoDetectedOnce: false,
    };

    const ui = createUi(state);
    const getFormValues = () => {
        const owner = ($("owner") && $("owner").value.trim()) || "";
        const repo = ($("repo") && $("repo").value.trim()) || "";
        const branch = ($("branch") && $("branch").value.trim()) || "";
        const fileOrgSel = document.getElementById("fileOrg");
        const fileOrg =
            fileOrgSel && fileOrgSel.value ? fileOrgSel.value : "folder";
        const allowUpdate = !!(
            document.getElementById("allowUpdate") &&
            document.getElementById("allowUpdate").checked
        );
        const showBubble = !!(
            document.getElementById("showBubble") &&
            document.getElementById("showBubble").checked
        );
        const langSel = document.getElementById("language");
        const language =
            (langSel && langSel.value) ||
            (state.lastProblemData && state.lastProblemData.extension) ||
            "txt";
        const solveTimeEl = document.getElementById("solveTime");
        const solveTimeRaw = solveTimeEl
            ? (solveTimeEl.value || "").trim()
            : "";
        const noteEl = document.getElementById("note");
        const note = noteEl ? (noteEl.value || "").trim() : "";
        const commitEl = document.getElementById("commitMessage");
        const commitMessage = commitEl
            ? (commitEl.value || "").trim()
            : "";

        return {
            owner,
            repo,
            branch,
            fileOrg,
            allowUpdate,
            showBubble,
            language,
            solveTimeRaw,
            note,
            commitMessage,
        };
    };

    const actions = createActions({ state, ui, getFormValues });
    const settings = createSettings({ state, ui, getFormValues, actions });

    bindUiEvents(actions, ui);
    ui.clearDeviceInfo();
    settings.init();
    actions.autoDetectOnOpen();
    actions.initAuthStatus();
    chrome.runtime.onMessage.addListener(actions.handleBackgroundMessage);
}

function bindUiEvents(actions, ui) {
    const signInBtn = $("signInBtn");
    if (signInBtn) signInBtn.addEventListener("click", actions.startDeviceFlow);

    const copyBtn = $("copyCodeBtn");
    if (copyBtn)
        copyBtn.addEventListener("click", () => {
            const code = $("deviceCode").textContent || "";
            if (!code || code === "—") {
                ui.updateStatus("No code to copy", true);
                return;
            }
            navigator.clipboard.writeText(code).then(
                () => ui.updateStatus("Code copied"),
                () => ui.updateStatus("Copy failed", true),
            );
        });

    const openBtn = $("openUrlBtn");
    if (openBtn)
        openBtn.addEventListener("click", () => {
            const url = $("deviceUrl").href || "";
            if (!url || url === "#") {
                ui.updateStatus("No URL", true);
                return;
            }
            try {
                chrome.tabs.create({ url, active: true });
            } catch (e) {
                window.open(url, "_blank", "noopener");
            }
        });

    const signOutBtn = $("signOutBtn");
    if (signOutBtn)
        signOutBtn.addEventListener("click", () => {
            chrome.runtime.sendMessage({ action: "signOut" }, () => {
                ui.setAuthUi({ authenticated: false });
                ui.clearDeviceInfo();
                ui.updateStatus("");
                ui.setSignInEnabled(true);
            });
        });

    const detectBtn = $("detectBtn");
    if (detectBtn) detectBtn.addEventListener("click", actions.onDetect);

    const saveBtn = $("saveBtn");
    if (saveBtn)
        saveBtn.addEventListener("click", () =>
            actions.onSave({ copyAfter: false }),
        );

    const copyUrlBtn = $("copyUrlBtn");
    if (copyUrlBtn)
        copyUrlBtn.addEventListener("click", () =>
            actions.onSave({ copyAfter: true }),
        );

    const help = $("helpLink");
    if (help)
        help.addEventListener("click", (e) => {
            e.preventDefault();
            chrome.tabs.create({
                url: chrome.runtime.getURL("src/pages/help/help.html"),
            });
        });
}
