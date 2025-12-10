// background.js — service worker implementing GitHub Device Flow with background polling
// - Polling runs in the background (setTimeout while active + chrome.alarms to wake when SW restarts)
// - Detailed diagnostic logging to service worker console and messages to popup
// - Token stored only if "remember" chosen
// IMPORTANT: Replace the CLIENT_ID placeholder with your GitHub OAuth App client id (no client secret).
const GITHUB_API_BASE = "https://api.github.com";
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";

// Replace with your GitHub OAuth App client id
const CLIENT_ID = "Ov23li9bvDT2DSjEfa5N";

let inMemoryToken = null;
// track active polling state in-memory while worker is alive
// structure: { device_code, intervalSeconds, expiresAt, remember }
let activeDeviceFlow = null;

// Helpers
function log(...args) {
    // prefix so logs are easy to find in SW consolek
    console.log("[bg | device-flow]", ...args);
}
function warn(...args) {
    console.warn("[bg | device-flow]", ...args);
}
function error(...args) {
    console.error("[bg | device-flow]", ...args);
}

function base64EncodeUnicode(str) {
    return btoa(unescape(encodeURIComponent(str || "")));
}

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

// Persist device flow state so alarms can continue polling after SW restarts
function persistDeviceFlowState(state) {
    if (!state) {
        chrome.storage.local.remove("device_flow_state", () => {
            log("cleared persisted device flow state");
        });
        return;
    }
    chrome.storage.local.set({ device_flow_state: state }, () => {
        log(
            "persisted device flow state",
            state && {
                device_code: state.device_code,
                expiresAt: state.expiresAt,
            }
        );
    });
}

function readPersistedDeviceFlowState() {
    return new Promise((resolve) => {
        chrome.storage.local.get(["device_flow_state"], (items) => {
            resolve(
                items && items.device_flow_state
                    ? items.device_flow_state
                    : null
            );
        });
    });
}

// Begin device flow: request device code, return user-facing fields and start polling in background
async function startDeviceFlow({ remember = false } = {}) {
    if (!CLIENT_ID || CLIENT_ID.startsWith("<")) {
        throw new Error(
            "CLIENT_ID not set in background.js. Set your GitHub OAuth App client id."
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

    // persist state so SW restarts can continue polling
    persistDeviceFlowState(activeDeviceFlow);

    // start immediate short-term polling loop while SW is active
    scheduleImmediatePoll(activeDeviceFlow.intervalSeconds);

    // schedule chrome.alarm to ensure polling continues even if SW is restarted
    scheduleAlarmForDeviceFlow(
        activeDeviceFlow.device_code,
        activeDeviceFlow.intervalSeconds
    );

    // return user-facing data immediately
    return {
        device_code: activeDeviceFlow.device_code,
        user_code: activeDeviceFlow.user_code,
        verification_uri: activeDeviceFlow.verification_uri,
        verification_uri_complete: activeDeviceFlow.verification_uri_complete,
        interval: activeDeviceFlow.intervalSeconds,
        expires_in: expiresIn,
    };
}

// schedule a one-off short setTimeout-based poll (keeps responsiveness while SW alive)
let immediatePollTimer = null;
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

// Use chrome.alarms to ensure wakeups across SW restarts. Alarm names use device_code
function scheduleAlarmForDeviceFlow(device_code, intervalSeconds) {
    try {
        // convert seconds to minutes for alarms; ensure at least 1 minute to satisfy API
        const minutes = Math.max(1, Math.ceil(intervalSeconds / 60));
        const alarmName = `device-poll-${device_code}`;
        chrome.alarms.create(alarmName, { periodInMinutes: minutes });
        log("created alarm", { alarmName, periodInMinutes: minutes });
    } catch (e) {
        warn("failed to create alarm", e && e.message);
    }
}

function clearAlarmForDeviceFlow(device_code) {
    try {
        const alarmName = `device-poll-${device_code}`;
        chrome.alarms.clear(alarmName, (wasCleared) => {
            log("cleared alarm", alarmName, wasCleared);
        });
    } catch (e) {
        warn("failed to clear alarm", e && e.message);
    }
}

// Poll once: call token endpoint and handle responses
async function pollForTokenOnce() {
    // load active flow (in-memory or persisted)
    if (!activeDeviceFlow) {
        activeDeviceFlow = await readPersistedDeviceFlowState();
        if (!activeDeviceFlow) {
            log("no active device flow to poll");
            return;
        }
    }

    const now = Date.now();
    if (activeDeviceFlow.expiresAt && now >= activeDeviceFlow.expiresAt) {
        // expired
        const device_code = activeDeviceFlow.device_code;
        log("device flow expired for", device_code);
        // clear persisted state and alarms
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
        // retry later
        scheduleImmediatePoll(activeDeviceFlow.intervalSeconds);
        return;
    }

    log("token endpoint response", { status: res.status, json: res.json });

    const json = res.json || {};
    if (json.error) {
        const err = json.error;
        if (err === "authorization_pending") {
            // normal — continue polling
            log("authorization_pending — will poll again");
            scheduleImmediatePoll(activeDeviceFlow.intervalSeconds);
            return;
        }
        if (err === "slow_down") {
            // increase interval slightly
            log("slow_down — increasing interval and will poll again");
            activeDeviceFlow.intervalSeconds =
                (activeDeviceFlow.intervalSeconds || 5) + 5;
            persistDeviceFlowState(activeDeviceFlow);
            scheduleImmediatePoll(activeDeviceFlow.intervalSeconds);
            // update alarm with new (coarse) interval
            scheduleAlarmForDeviceFlow(
                activeDeviceFlow.device_code,
                activeDeviceFlow.intervalSeconds
            );
            return;
        }
        if (err === "expired_token") {
            // expired
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

        // unexpected error
        log("device flow error", json);
        chrome.runtime.sendMessage({
            action: "deviceFlowError",
            message: json.error_description || json.error || "Unknown error",
        });
        // clear state since it's an unexpected error to avoid tight loops
        const code = activeDeviceFlow.device_code;
        persistDeviceFlowState(null);
        clearAlarmForDeviceFlow(code);
        activeDeviceFlow = null;
        return;
    }

    if (json.access_token) {
        log("received access_token (success). storing token per remember flag");
        inMemoryToken = json.access_token;
        const masked = inMemoryToken
            ? inMemoryToken.slice(0, 4) + "..." + inMemoryToken.slice(-4)
            : null;
        if (activeDeviceFlow && activeDeviceFlow.remember) {
            chrome.storage.local.set({ github_token: inMemoryToken }, () => {
                log("token saved to chrome.storage.local (remember=true)");
            });
        }
        // clean up persisted state and alarms
        const code = activeDeviceFlow.device_code;
        persistDeviceFlowState(null);
        clearAlarmForDeviceFlow(code);
        activeDeviceFlow = null;

        // notify popup and interested parties
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

    // fallback: if response didn't contain error or token, schedule another poll
    log("unexpected token endpoint response — scheduling another poll", res);
    scheduleImmediatePoll(activeDeviceFlow.intervalSeconds);
}

// Expose API for other parts (popup) via chrome.runtime.onMessage
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    log("onMessage received", message && message.action);
    (async () => {
        try {
            if (!message || !message.action) {
                log("onMessage: no action specified", message);
                sendResponse({
                    success: false,
                    message: "No action specified",
                });
                return;
            }

            if (message.action === "startDeviceFlow") {
                // start and immediately return user_code and verification links
                try {
                    const device = await startDeviceFlow({
                        remember: !!message.remember,
                    });
                    sendResponse({ success: true, device });
                } catch (err) {
                    error("startDeviceFlow failed", err && err.message);
                    sendResponse({
                        success: false,
                        message: err.message || String(err),
                    });
                }
                return;
            }

            if (message.action === "getAuthStatus") {
                const token = await (async () => {
                    if (inMemoryToken) return inMemoryToken;
                    return new Promise((resolve) => {
                        chrome.storage.local.get(["github_token"], (items) =>
                            resolve(
                                items && items.github_token
                                    ? items.github_token
                                    : null
                            )
                        );
                    });
                })();
                const masked = token
                    ? token.slice(0, 4) + "..." + token.slice(-4)
                    : null;
                sendResponse({
                    success: true,
                    authenticated: !!token,
                    tokenMasked: masked,
                });
                return;
            }

            if (message.action === "signOut") {
                inMemoryToken = null;
                chrome.storage.local.remove("github_token", () => {
                    log("signed out: removed github_token from storage");
                    sendResponse({ success: true });
                    // broadcast
                    chrome.runtime.sendMessage({ action: "signedOut" });
                });
                return;
            }

            if (message.action === "uploadFiles") {
                const { owner, repo, branch, files, folder, allowUpdate } =
                    message;
                if (!owner || !repo || !files || files.length === 0) {
                    sendResponse({
                        success: false,
                        message: "Missing owner/repo/files",
                    });
                    return;
                }
                try {
                    const res = await uploadFilesToRepo({
                        owner,
                        repo,
                        branch,
                        files,
                        folder,
                        allowUpdate,
                    });
                    if (res.success) {
                        notify("LeetCode → GitHub", res.message);
                        sendResponse({
                            success: true,
                            message: res.message,
                            results: res.results,
                        });
                    } else {
                        notify(
                            "LeetCode → GitHub",
                            "Upload failed: " + res.message
                        );
                        sendResponse({ success: false, message: res.message });
                    }
                } catch (err) {
                    sendResponse({
                        success: false,
                        message: err.message || String(err),
                    });
                }
                return;
            }

            if (message.action === "executeCodeExtraction") {
                try {
                    if (!sender || !sender.tab || !sender.tab.id) {
                        sendResponse({ success: false, message: "No tab context" });
                        return;
                    }
                    const tabId = sender.tab.id;
                    chrome.scripting.executeScript(
                        {
                            target: { tabId },
                            world: "MAIN",
                            func: () => {
                                try {
                                    // Robust Main-world extraction for Monaco editors
                                    // 1) If monaco.editor.getEditors exists, prefer editable editor instances
                                    if (window.monaco && window.monaco.editor) {
                                        try {
                                            const editors =
                                                (monaco.editor.getEditors &&
                                                    monaco.editor.getEditors()) ||
                                                [];
                                            if (editors && editors.length) {
                                                // pick editable editor with longest content
                                                let best = null;
                                                for (const ed of editors) {
                                                    try {
                                                        const val =
                                                            (ed.getValue &&
                                                                ed.getValue()) ||
                                                            (ed.getModel &&
                                                                ed.getModel().getValue &&
                                                                ed.getModel().getValue()) ||
                                                            "";
                                                        if (
                                                            !best ||
                                                            (val &&
                                                                val.length >
                                                                    (best.valLength ||
                                                                        0))
                                                        ) {
                                                            best = {
                                                                ed,
                                                                val,
                                                                valLength: val
                                                                    ? val.length
                                                                    : 0,
                                                            };
                                                        }
                                                    } catch (e) {
                                                        /* ignore per-editor errors */
                                                    }
                                                }
                                                if (best && best.val) {
                                                    const model =
                                                        (best.ed.getModel &&
                                                            best.ed.getModel()) ||
                                                        null;
                                                    const lang =
                                                        model &&
                                                        model.getLanguageIdentifier &&
                                                        model.getLanguageIdentifier().language
                                                            ? model.getLanguageIdentifier().language
                                                            : (model && model.getModeId
                                                                  ? model.getModeId()
                                                                  : null);
                                                    return {
                                                        code: best.val,
                                                        languageId: lang || null,
                                                    };
                                                }
                                            }
                                        } catch (e) {
                                            /* ignore editors API errors */
                                        }

                                        // 2) Fallback: use monaco models (choose longest)
                                        try {
                                            const models =
                                                (monaco.editor.getModels &&
                                                    monaco.editor.getModels()) ||
                                                [];
                                            if (models && models.length) {
                                                let bestModel = models[0];
                                                for (const m of models) {
                                                    try {
                                                        const aLen =
                                                            (bestModel.getValue &&
                                                                bestModel.getValue().length) ||
                                                            0;
                                                        const bLen =
                                                            (m.getValue &&
                                                                m.getValue().length) ||
                                                            0;
                                                        if (bLen > aLen) bestModel = m;
                                                    } catch (e) { /* ignore */ }
                                                }
                                                return {
                                                    code:
                                                        (bestModel.getValue &&
                                                            bestModel.getValue()) ||
                                                        "",
                                                    languageId:
                                                        (bestModel.getLanguageIdentifier &&
                                                            bestModel.getLanguageIdentifier().language) ||
                                                        (bestModel.getModeId
                                                            ? bestModel.getModeId()
                                                            : null),
                                                };
                                            }
                                        } catch (e) { /* ignore models errors */ }
                                    }

                                    // 3) window.editor fallback
                                    if (
                                        window.editor &&
                                        typeof window.editor.getValue === "function"
                                    ) {
                                        return {
                                            code: window.editor.getValue(),
                                            languageId: null,
                                        };
                                    }

                                    // 4) CodeMirror fallback
                                    const cmEl = document.querySelector(".CodeMirror");
                                    if (
                                        cmEl &&
                                        cmEl.CodeMirror &&
                                        typeof cmEl.CodeMirror.getValue === "function"
                                    ) {
                                        return {
                                            code: cmEl.CodeMirror.getValue(),
                                            languageId: cmEl.CodeMirror.getOption
                                                ? cmEl.CodeMirror.getOption("mode")
                                                : null,
                                        };
                                    }

                                    // 5) DOM reconstruction fallback (monaco view-line)
                                    try {
                                        const viewLines = Array.from(
                                            document.querySelectorAll(".monaco-editor .view-line")
                                        );
                                        if (viewLines && viewLines.length) {
                                            const domCode = viewLines
                                                .map((l) => l.textContent || "")
                                                .join("\n");
                                            if (domCode && domCode.length) {
                                                return { code: domCode, languageId: null };
                                            }
                                        }
                                    } catch (e) { /* ignore */ }

                                    return { code: "", languageId: null };
                                } catch (e) {
                                    return { code: "", languageId: null };
                                }
                            },
                        },
                        (results) => {
                            if (chrome.runtime.lastError || !results || !results.length) {
                                sendResponse({
                                    success: false,
                                    message: chrome.runtime.lastError
                                        ? chrome.runtime.lastError.message
                                        : "No result from page",
                                });
                                return;
                            }
                            sendResponse({ success: true, data: results[0].result });
                        }
                    );
                } catch (err) {
                    sendResponse({ success: false, message: err && err.message });
                }
                return true; // async response
            }

            sendResponse({ success: false, message: "Unknown action" });
        } catch (err) {
            sendResponse({
                success: false,
                message: err.message || String(err),
            });
        }
    })();

    return true; // indicate async response
});

// Alarm handler — wakes SW periodically to continue polling
chrome.alarms.onAlarm.addListener(async (alarm) => {
    try {
        log("alarm fired", alarm && alarm.name);
        if (!alarm || !alarm.name) return;
        if (!alarm.name.startsWith("device-poll-")) return;
        // load persisted state and attempt a poll
        const state = await readPersistedDeviceFlowState();
        if (!state) {
            log("no persisted device flow state found for alarm", alarm.name);
            // clear alarm just in case
            const device_code = alarm.name.replace("device-poll-", "");
            clearAlarmForDeviceFlow(device_code);
            return;
        }
        // set activeDeviceFlow so pollForTokenOnce can use it
        activeDeviceFlow = state;
        // perform a single poll attempt (this will reschedule immediate polling if needed)
        await pollForTokenOnce();
    } catch (err) {
        warn("alarm handler error", err && err.message);
    }
});

// ---------- GitHub file helpers (use Bearer Authorization) ----------
async function getTokenFromStorage() {
    if (inMemoryToken) return inMemoryToken;
    return new Promise((resolve) => {
        chrome.storage.local.get(["github_token"], (items) => {
            resolve(items && items.github_token ? items.github_token : null);
        });
    });
}

async function githubFetch(path, opts = {}, token) {
    token = token || (await getTokenFromStorage());
    if (!token) throw new Error("No GitHub token available");
    const headers = Object.assign({}, opts.headers || {}, {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
    });
    const res = await fetch(
        `${GITHUB_API_BASE}${path}`,
        Object.assign({}, opts, { headers })
    );
    const text = await res.text();
    let json = null;
    try {
        json = text && JSON.parse(text);
    } catch {
        json = text;
    }
    return { status: res.status, json, raw: text };
}

async function ensureRepoExists(owner, repo) {
    const getRes = await githubFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        { method: "GET" }
    );
    if (getRes.status === 200) return true;
    if (getRes.status === 404) {
        const createRes = await githubFetch(`/user/repos`, {
            method: "POST",
            body: JSON.stringify({
                name: repo,
                private: true,
                auto_init: false,
            }),
        });
        if (createRes.status === 201) return true;
        throw new Error(
            `Failed to create repo: ${
                createRes.json && createRes.json.message
                    ? createRes.json.message
                    : JSON.stringify(createRes.json)
            }`
        );
    }
    throw new Error(
        `Failed to check repo: ${
            getRes.json && getRes.json.message
                ? getRes.json.message
                : JSON.stringify(getRes.json)
        }`
    );
}

async function getFileShaIfExists(owner, repo, path, branch) {
    const res = await githubFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
            repo
        )}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(
            branch || "main"
        )}`,
        { method: "GET" }
    );
    if (res.status === 200 && res.json && res.json.sha) return res.json.sha;
    if (res.status === 404) return null;
    throw new Error(
        `GitHub GET file failed: ${
            res.json && res.json.message
                ? res.json.message
                : JSON.stringify(res.json)
        }`
    );
}

async function putFile(owner, repo, path, base64Content, message, branch, sha) {
    const body = { message, content: base64Content };
    if (branch) body.branch = branch;
    if (sha) body.sha = sha;
    const res = await githubFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
            repo
        )}/contents/${encodeURIComponent(path)}`,
        {
            method: "PUT",
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json" },
        }
    );
    if (res.status === 201 || res.status === 200) return res.json;
    throw new Error(
        res.json && res.json.message
            ? res.json.message
            : JSON.stringify(res.json)
    );
}

async function uploadFilesToRepo({
    owner,
    repo,
    branch = "main",
    files = [],
    folder = "",
    allowUpdate = false,
}) {
    const token = await getTokenFromStorage();
    if (!token)
        return { success: false, message: "Not authenticated with GitHub" };

    await ensureRepoExists(owner, repo);

    const conflicts = [];
    const existingMap = {};

    for (const f of files) {
        const path = String(f.path).replace(/^\/+/, "");
        try {
            const sha = await getFileShaIfExists(owner, repo, path, branch);
            if (sha) {
                existingMap[path] = sha;
                conflicts.push(path);
            }
        } catch (err) {
            return {
                success: false,
                message: `Failed to check existing file ${path}: ${err.message}`,
            };
        }
    }

    if (conflicts.length > 0 && !allowUpdate) {
        return {
            success: false,
            message: `Conflicts: the following files already exist. Enable 'Allow overwrite' to update them: ${conflicts.join(
                ", "
            )}`,
        };
    }

    const results = [];
    for (const f of files) {
        const path = String(f.path).replace(/^\/+/, "");
        try {
            const contentBase64 = f.isBase64
                ? f.content
                : base64EncodeUnicode(f.content || "");
            const message = existingMap[path]
                ? `Update solution for ${path}`
                : `Add solution for ${path}`;
            const sha = existingMap[path];
            const json = await putFile(
                owner,
                repo,
                path,
                contentBase64,
                message,
                branch,
                sha
            );
            results.push({
                path,
                url:
                    json && json.content && json.content.html_url
                        ? json.content.html_url
                        : null,
            });
        } catch (err) {
            return {
                success: false,
                message: `Failed to upload ${path}: ${err.message}`,
            };
        }
    }

    return {
        success: true,
        message: `Uploaded ${results.length} files`,
        results,
    };
}

function notify(title, message) {
    try {
        if (chrome && chrome.notifications && chrome.notifications.create) {
            chrome.notifications.create({
                type: "basic",
                iconUrl: "icons/icon.png",
                title,
                message,
            });
        }
    } catch (e) {
        /* ignore */
    }
}

// On startup, if there is a persisted device flow state, restore and ensure alarm exists
(async function restoreOnStartup() {
    try {
        const state = await readPersistedDeviceFlowState();
        if (state && state.device_code) {
            log("restoring persisted device flow state on startup", {
                device_code: state.device_code,
            });
            activeDeviceFlow = state;
            // ensure alarm exists
            scheduleAlarmForDeviceFlow(
                state.device_code,
                state.intervalSeconds || 5
            );
        }
    } catch (e) {
        warn("restoreOnStartup error", e && e.message);
    }
})();
