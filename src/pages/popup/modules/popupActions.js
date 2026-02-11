import { $ } from "./popupDom.js";

const SIGNIN_TIMEOUT_MS = 20000;

export function createActions({ state, ui, getFormValues }) {
    function getAutoRedirectSetting() {
        return new Promise((resolve) => {
            chrome.storage.local.get(
                ["cf_auto_redirect_submission"],
                (items) =>
                    resolve(!!items.cf_auto_redirect_submission),
            );
        });
    }

    function setAutoRedirectSetting(value) {
        return new Promise((resolve) => {
            chrome.storage.local.set(
                { cf_auto_redirect_submission: !!value },
                () => resolve(true),
            );
        });
    }

    function requestSubmissionUrl(tabId) {
        return new Promise((resolve) => {
            chrome.tabs.sendMessage(
                tabId,
                { action: "getSubmissionUrl" },
                (response) => {
                    if (chrome.runtime.lastError) {
                        resolve({ error: chrome.runtime.lastError });
                    } else {
                        resolve({ response });
                    }
                },
            );
        });
    }

    async function handleCodeforcesRedirect(tabId, data) {
        if (!data || data.platform !== "Codeforces") return;
        if (data.isSubmissionPage) return;
        if (data.code && data.code.trim()) return;

        ui.updateStatus("Checking for accepted submission...");

        const autoRedirect = await getAutoRedirectSetting();
        const result = await requestSubmissionUrl(tabId);

        if (result.error) {
            ui.updateStatus(
                "Script not ready. Try re-opening the popup or refreshing this page.",
                true,
            );
            return;
        }

        const resp = result.response;
        if (!resp || !resp.success || !resp.url) {
            ui.showNoSubmissionModal();
            ui.updateStatus("No accepted submission found.", true);
            return;
        }

        if (state.lastProblemData) {
            state.lastProblemData.submissionUrl = resp.url;
        }

        if (autoRedirect) {
            ui.updateStatus("Redirecting to accepted submission...");
            chrome.tabs.update(tabId, { url: resp.url });
            return;
        }

        ui.updateStatus("Open your accepted submission to load the code.");

        const choice = await ui.promptCodeforcesRedirect({
            submissionUrl: resp.url,
            autoRedirectEnabled: autoRedirect,
        });

        if (choice && choice.autoRedirect) {
            await setAutoRedirectSetting(true);
        }

        if (choice && choice.action === "open") {
            chrome.tabs.update(tabId, { url: resp.url });
        }
    }
    function startDeviceFlow() {
        if (state.signInPending) return;
        ui.setSignInEnabled(false);
        ui.updateAuthStatus("Starting authorization...");
        ui.updateStatus("Requesting sign-in code...");

        const remember = true;

        ui.showDeviceInfo({
            user_code: "Waiting…",
            verification_uri: "",
            verification_uri_complete: "",
        });

        let didRespond = false;
        const timeoutId = setTimeout(() => {
            if (!didRespond) {
                ui.updateStatus("No response from background. Try again.", true);
                ui.setSignInEnabled(true);
                ui.clearDeviceInfo();
            }
        }, SIGNIN_TIMEOUT_MS);

        try {
            chrome.runtime.sendMessage(
                { action: "startDeviceFlow", remember },
                (resp) => {
                    didRespond = true;
                    clearTimeout(timeoutId);
                    if (chrome.runtime.lastError) {
                        ui.updateStatus(
                            "Background error: " +
                                chrome.runtime.lastError.message,
                            true,
                        );
                        ui.setSignInEnabled(true);
                        ui.clearDeviceInfo();
                        return;
                    }
                    if (!resp || !resp.success) {
                        ui.updateStatus(
                            "Failed to start device flow: " +
                                (resp && resp.message
                                    ? resp.message
                                    : "unknown"),
                            true,
                        );
                        ui.setSignInEnabled(true);
                        ui.clearDeviceInfo();
                        return;
                    }

                    ui.showDeviceInfo(resp.device);
                    const url =
                        resp.device.verification_uri_complete ||
                        resp.device.verification_uri ||
                        "";
                    if (url) {
                        try {
                            chrome.tabs.create({ url, active: false }, () => {});
                        } catch (e) {
                            // ignore
                        }
                    }
                },
            );
        } catch (err) {
            clearTimeout(timeoutId);
            ui.updateStatus(
                "Failed to send start request: " + (err && err.message),
                true,
            );
            ui.setSignInEnabled(true);
            ui.clearDeviceInfo();
        }
    }

    function queryActiveTab() {
        return new Promise((resolve) =>
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) =>
                resolve(tabs),
            ),
        );
    }

    async function onDetect() {
        if (state.detectInFlight) return;
        state.detectInFlight = true;
        ui.updateStatus("Detecting problem...");
        const detectBtn = $("detectBtn");
        ui.setButtonState(detectBtn, true, "Detecting...");
        try {
            const tabs = await queryActiveTab();
            if (!tabs || tabs.length === 0)
                throw new Error("No active tab found");
            const tab = tabs[0];
            const tabId = tab.id;
            const isCodeforcesTab = /codeforces\.com/i.test(tab.url || "");

            const isSupportedUrl = (url) => {
                if (!url) return false;
                return /leetcode\.com|codeforces\.com|hackerrank\.com/i.test(url);
            };

            const sendProblemRequest = () =>
                new Promise((resolve) => {
                    const payload = {
                        action: "getProblemData",
                    };
                    if (isCodeforcesTab) {
                        payload.options = { skipSolutionFetch: true };
                    }
                    chrome.tabs.sendMessage(
                        tabId,
                        payload,
                        (response) => {
                            if (chrome.runtime.lastError) {
                                resolve({ error: chrome.runtime.lastError });
                            } else {
                                resolve({ response });
                            }
                        },
                    );
                });

            const injectContentScript = () =>
                new Promise((resolve) => {
                    try {
                        chrome.scripting.executeScript(
                            {
                                target: { tabId },
                                files: ["src/content.js"],
                            },
                            () => {
                                if (chrome.runtime.lastError) resolve(false);
                                else resolve(true);
                            },
                        );
                    } catch (e) {
                        resolve(false);
                    }
                });

            if (!isSupportedUrl(tab.url)) {
                ui.updateStatus(
                    "Open a LeetCode, Codeforces, or HackerRank problem page to detect.",
                    true,
                );
                ui.showMeta(null);
                return;
            }

            let result = await sendProblemRequest();

            if (result.error) {
                console.warn(
                    "[popup] detected message error:",
                    result.error.message,
                );
                if (isSupportedUrl(tab.url)) {
                    const injected = await injectContentScript();
                    if (injected) await new Promise((r) => setTimeout(r, 300));
                    result = await sendProblemRequest();
                }
            }

            if (result.error) {
                ui.updateStatus(
                    "Script not ready. Try re-opening the popup or refreshing this page.",
                    true,
                );
                ui.showMeta(null);
                return;
            }

            const response = result.response;
            if (
                !response ||
                !response.success ||
                !response.data ||
                !response.data.title
            ) {
                const errorMsg =
                    (response && response.message) ||
                    "Unable to detect problem. Check if you are on a problem page.";
                ui.updateStatus(errorMsg, true);
                ui.showMeta(null);
                return;
            }

            ui.showMeta(response.data);
            if (response.data && response.data.platform === "Codeforces") {
                handleCodeforcesRedirect(tabId, response.data);
            }
            checkExistingSubmission();
            if (!response.data.codeError) {
                const isCfProblemPage =
                    response.data.platform === "Codeforces" &&
                    !response.data.isSubmissionPage;
                if (!isCfProblemPage) {
                    ui.updateStatus("Problem detected.");
                }
            }
            state.autoDetectedOnce = true;
        } catch (err) {
            ui.updateStatus(err.message || "Detect failed", true);
        } finally {
            ui.setButtonState(detectBtn, false);
            state.detectInFlight = false;
        }
    }

    async function copyTextToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (e) {
            try {
                const ta = document.createElement("textarea");
                ta.value = text;
                ta.setAttribute("readonly", "");
                ta.style.position = "absolute";
                ta.style.left = "-9999px";
                document.body.appendChild(ta);
                ta.select();
                const ok = document.execCommand("copy");
                document.body.removeChild(ta);
                return ok;
            } catch (err) {
                return false;
            }
        }
    }

    function onSave({ copyAfter = false } = {}) {
        ui.updateStatus("Preparing upload...");
        if (!state.lastProblemData) {
            ui.updateStatus("No detected problem. Click Detect first.", true);
            return;
        }

        if (
            !state.lastProblemData.code ||
            state.lastProblemData.code.trim().length === 0
        ) {
            const extra = state.lastProblemData.codeError
                ? ` Cause: ${state.lastProblemData.codeError}`
                : "";
            ui.updateStatus(
                `Error: Solution code not found. Cannot upload.${extra}`,
                true,
            );
            return;
        }

        const {
            owner,
            repo,
            branch,
            fileOrg,
            allowUpdate,
            language,
            solveTimeRaw,
        } = getFormValues();

        if (!owner || !repo) {
            ui.updateStatus("Please provide GitHub owner and repository.", true);
            return;
        }

        if (!solveTimeRaw) {
            ui.updateStatus("Please enter time to solve (e.g., 45 min).", true);
            const solveTimeEl = $("solveTime");
            if (solveTimeEl) solveTimeEl.focus();
            return;
        }

        const solveTime = /^\d+$/.test(solveTimeRaw)
            ? `${solveTimeRaw} min`
            : solveTimeRaw;

        const problemData = {
            ...state.lastProblemData,
            extension: language,
            solveTime,
        };

        const payload = {
            action: "prepareAndUpload",
            problemData,
            owner,
            repo,
            branch,
            fileOrg,
            allowUpdate,
        };

        ui.setSaveButtonsBusy(true);
        try {
            chrome.runtime.sendMessage(payload, (resp) => {
                ui.setSaveButtonsBusy(false);
                if (chrome.runtime.lastError) {
                    ui.updateStatus(
                        "Background request failed: " +
                            chrome.runtime.lastError.message,
                        true,
                    );
                    return;
                }
                if (!resp) {
                    ui.updateStatus("No response from background", true);
                    return;
                }
                if (resp.success) {
                    const uploadedUrl =
                        resp &&
                        resp.results &&
                        resp.results[0] &&
                        resp.results[0].url
                            ? resp.results[0].url
                            : null;
                    if (copyAfter) {
                        const urlToCopy =
                            uploadedUrl || `https://github.com/${owner}/${repo}`;
                        copyTextToClipboard(urlToCopy).then((ok) => {
                            ui.updateStatus(
                                ok
                                    ? "Upload succeeded. URL copied."
                                    : "Upload succeeded, but failed to copy URL.",
                                !ok,
                            );
                        });
                    } else {
                        ui.updateStatus("Upload succeeded");
                    }
                    if (state.lastProblemData) ui.showMeta(state.lastProblemData);
                } else {
                    ui.updateStatus(
                        "Upload failed: " + (resp.message || "unknown"),
                        true,
                    );
                }
            });
        } catch (err) {
            ui.setSaveButtonsBusy(false);
            ui.updateStatus(
                "Upload failed: " +
                    (err && err.message ? err.message : "unknown error"),
                true,
            );
        }
    }

    function checkExistingSubmission() {
        const data = state.lastProblemData;
        if (!data || !data.id) {
            ui.clearSubmissionStatus();
            return;
        }

        const { owner, repo, branch, fileOrg, language } = getFormValues();
        if (!owner || !repo) {
            ui.clearSubmissionStatus();
            return;
        }

        ui.setSubmissionStatus("Checking GitHub...", "var(--text-muted)");

        const checkData = { ...data, extension: language };
        chrome.runtime.sendMessage(
            {
                action: "checkSubmission",
                problemData: checkData,
                owner,
                repo,
                branch,
                fileOrg,
            },
            (resp) => {
                if (chrome.runtime.lastError) {
                    ui.clearSubmissionStatus();
                    return;
                }
                if (state.lastProblemData && state.lastProblemData.id === data.id) {
                    if (resp && resp.success && resp.exists) {
                        const url =
                            resp && resp.path
                                ? `https://github.com/${owner}/${repo}/blob/${branch}/${resp.path}`
                                : `https://github.com/${owner}/${repo}`;
                        ui.setSubmissionStatusLink(
                            "✓ Solution exists",
                            url,
                            "var(--accent)",
                        );
                    } else {
                        ui.clearSubmissionStatus();
                    }
                }
            },
        );
    }

    function initAuthStatus() {
        chrome.runtime.sendMessage({ action: "getAuthStatus" }, (resp) => {
            if (!resp || !resp.success || !resp.authenticated) {
                ui.setAuthUi({ authenticated: false });
                return;
            }
            ui.setAuthUi({
                authenticated: true,
                tokenMasked: resp.tokenMasked || "",
            });
            if (!state.lastProblemData && !state.autoDetectedOnce) {
                try {
                    onDetect();
                } catch (e) {
                    console.warn("auto-detect after auth failed", e && e.message);
                }
            }
        });
    }

    function handleBackgroundMessage(message) {
        if (!message || !message.action) return;
        if (message.action === "deviceFlowSuccess") {
            ui.setAuthUi({
                authenticated: true,
                tokenMasked: message.tokenMasked || "",
            });
            ui.clearDeviceInfo();
            if (!state.lastProblemData && !state.autoDetectedOnce) {
                try {
                    onDetect();
                } catch (e) {
                    console.warn(
                        "auto-detect after sign-in failed",
                        e && e.message,
                    );
                }
            }
        } else if (message.action === "deviceFlowError") {
            ui.updateAuthStatus("Authorization error");
            ui.updateStatus(message.message || "Authorization error", true);
            ui.clearDeviceInfo();
            ui.setSignInEnabled(true);
        } else if (message.action === "deviceFlowExpired") {
            ui.updateAuthStatus("Device flow expired");
            ui.updateStatus("Device flow expired. Please retry sign in.", true);
            ui.clearDeviceInfo();
            ui.setSignInEnabled(true);
        } else if (message.action === "deviceFlowDenied") {
            ui.updateAuthStatus("Authorization denied");
            ui.updateStatus("Authorization denied by user.", true);
            ui.clearDeviceInfo();
            ui.setSignInEnabled(true);
        } else if (message.action === "signedOut") {
            ui.setAuthUi({ authenticated: false });
            ui.clearDeviceInfo();
            ui.setSignInEnabled(true);
        }
    }

    function autoDetectOnOpen() {
        try {
            onDetect();
        } catch (e) {
            console.warn("auto-detect on popup open failed", e && e.message);
        }
    }

    return {
        startDeviceFlow,
        onDetect,
        onSave,
        checkExistingSubmission,
        initAuthStatus,
        handleBackgroundMessage,
        autoDetectOnOpen,
    };
}
