import { $ } from "./popupDom.js";

const SIGNIN_TIMEOUT_MS = 20000;

export function createActions({ state, ui, getFormValues }) {
    const CF_SUBMISSION_PROMPT_KEY = "cf_skip_submission_prompt";

    function getRepoSettings() {
        return new Promise((resolve) => {
            chrome.storage.local.get(
                [
                    "github_owner",
                    "github_repo",
                    "github_branch",
                    "allowUpdateDefault",
                ],
                (items) => resolve(items || {}),
            );
        });
    }

    function getSkipSubmissionPromptSetting() {
        return new Promise((resolve) => {
            chrome.storage.local.get([CF_SUBMISSION_PROMPT_KEY], (items) =>
                resolve(!!items[CF_SUBMISSION_PROMPT_KEY]),
            );
        });
    }

    function setSkipSubmissionPromptSetting(value) {
        return new Promise((resolve) => {
            chrome.storage.local.set(
                { [CF_SUBMISSION_PROMPT_KEY]: !!value },
                () => resolve(true),
            );
        });
    }

    async function handleCodeforcesSubmissionNotice(data) {
        if (!data || data.platform !== "Codeforces") return;
        if (data.isSubmissionPage) return;
        if (data.code && data.code.trim()) return;

        ui.updateStatus(
            "Open your accepted submission dialog (or page) and reopen the popup.",
        );

        const skipPrompt = await getSkipSubmissionPromptSetting();
        if (skipPrompt) return;

        const choice = await ui.promptCodeforcesSubmissionNotice();
        if (choice && choice.dontAskAgain) {
            await setSkipSubmissionPromptSetting(true);
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
                ui.updateStatus(
                    "No response from background. Try again.",
                    true,
                );
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
                            chrome.tabs.create(
                                { url, active: false },
                                () => {},
                            );
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
                return /leetcode\.com|codeforces\.com|hackerrank\.com/i.test(
                    url,
                );
            };

            const sendProblemRequest = () =>
                new Promise((resolve) => {
                    const payload = {
                        action: "getProblemData",
                    };
                    if (isCodeforcesTab) {
                        payload.options = { skipSolutionFetch: true };
                    }
                    chrome.tabs.sendMessage(tabId, payload, (response) => {
                        if (chrome.runtime.lastError) {
                            resolve({ error: chrome.runtime.lastError });
                        } else {
                            resolve({ response });
                        }
                    });
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
                handleCodeforcesSubmissionNotice(response.data);
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

    async function onSave({ copyAfter = false } = {}) {
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
            fileOrg,
            language,
            solveTimeRaw,
            attemptCountRaw,
            note,
            commitMessage,
        } = getFormValues();

        const repoSettings = await getRepoSettings();
        const owner = repoSettings.github_owner || "";
        const repo = repoSettings.github_repo || "";
        const branch = repoSettings.github_branch || "main";
        const allowUpdate = !!repoSettings.allowUpdateDefault;

        if (!owner || !repo) {
            const choice = await ui.promptMissingRepoSettings();
            if (choice === "open") {
                chrome.tabs.create({
                    url: chrome.runtime.getURL(
                        "src/pages/options/options.html",
                    ),
                });
            }
            ui.updateStatus(
                "GitHub owner/repo not configured — save canceled.",
                true,
            );
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

        const parsedAttempts = attemptCountRaw
            ? parseInt(attemptCountRaw, 10)
            : null;
        const attemptCount =
            Number.isFinite(parsedAttempts) && parsedAttempts >= 0
                ? parsedAttempts
                : null;

        const problemData = {
            ...state.lastProblemData,
            extension: language,
            solveTime,
            note,
            attemptCount,
        };

        const payload = {
            action: "prepareAndUpload",
            problemData,
            owner,
            repo,
            branch,
            fileOrg,
            allowUpdate,
            commitMessage,
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
                            uploadedUrl ||
                            `https://github.com/${owner}/${repo}`;
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
                    if (state.lastProblemData)
                        ui.showMeta(state.lastProblemData);
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

        getRepoSettings().then((repoSettings) => {
            const owner = repoSettings.github_owner || "";
            const repo = repoSettings.github_repo || "";
            const branch = repoSettings.github_branch || "main";
            const { fileOrg, language } = getFormValues();

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
                    if (
                        state.lastProblemData &&
                        state.lastProblemData.id === data.id
                    ) {
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
        });
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
                    console.warn(
                        "auto-detect after auth failed",
                        e && e.message,
                    );
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
