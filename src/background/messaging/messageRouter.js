// messaging/messageRouter.js — Central message handler
// This replaces the giant onMessage block. Clean. Predictable. Testable.

import { log, error } from "../core/logger.js";
import { notify } from "../core/notifications.js";
import { getToken, clearToken, maskToken } from "../auth/tokenStore.js";
import { startDeviceFlow } from "../auth/deviceFlow.js";
import { uploadFilesToRepo } from "../github/uploadService.js";
import { ensureRepoExists, getFileShaIfExists } from "../github/repoService.js";
import { executeCodeExtraction } from "../leetcode/extractor.js";
import { generateUploadFiles } from "../../utils/fileStrategies.js";
import { fillTemplate } from "../../utils/templateEngine.js";

// ─────────────────────────────────────────────────────────────
// Message Handlers
// ─────────────────────────────────────────────────────────────

/**
 * Check if a solution already exists in the repo
 */
async function handleCheckSubmission(message) {
    const {
        problemData,
        owner,
        repo,
        branch,
        fileOrg // 'folder' or 'flat'
    } = message;

    if (!problemData || !owner || !repo) {
        return { success: false, message: "Missing required data" };
    }

    try {
        const ext = problemData.extension || "txt";
        // Generate expected files to find the path
        const files = generateUploadFiles(fileOrg, problemData, ext);
        if (!files || files.length === 0) return { exists: false };

        // The first file is always the solution (in both strategies)
        const checkPath = files[0].path;

        // Check against GitHub
        const sha = await getFileShaIfExists(owner, repo, checkPath, branch);

        return {
            success: true,
            exists: !!sha,
            path: checkPath,
            repo: repo,
            owner: owner
        };
    } catch (err) {
        // If repo doesn't exist or other API error
        return { success: false, message: err.message, exists: false };
    }
}

/**
 * Handle request to generate files from problem data and upload them
 * Centralizes the strategy logic (Folder vs Flat)
 */
async function handlePrepareAndUpload(message) {
    const {
        problemData,
        owner,
        repo,
        branch,
        fileOrg, // 'folder' or 'flat'
        allowUpdate
    } = message;

    if (!problemData || !owner || !repo) {
        return { success: false, message: "Missing required data (problemData, owner, repo)" };
    }

    try {
        // Fetch templates from storage
        const items = await new Promise(resolve => {
            chrome.storage.local.get(['template_commit', 'template_path', 'template_readme'], resolve);
        });

        const ext = problemData.extension || "txt";
        const templates = {
            path: items.template_path,
            readme: items.template_readme
        };

        const files = generateUploadFiles(fileOrg, problemData, ext, templates);

        // Commit message
        let commitMessage = `Solved ${problemData.id} - ${problemData.title} (${problemData.difficulty})`;
        if (items.template_commit) {
            commitMessage = fillTemplate(items.template_commit, { ...problemData, extension: ext });
        }

        const res = await uploadFilesToRepo({
            owner,
            repo,
            branch,
            files,
            folder: problemData.folderName,
            allowUpdate,
            commitMessage
        });

        // Notify
        if (res.success) {
            notify("LeetCode \u2192 GitHub", res.message);
        } else {
            notify("LeetCode \u2192 GitHub", "Upload failed: " + res.message);
        }

        notifyActiveTab(res);

        return {
            success: !!res.success,
            message: res.message,
            results: res.results,
        };

    } catch (err) {
        error("handlePrepareAndUpload error", err);
        notifyActiveTab({ success: false, message: err.message || String(err) });
        return { success: false, message: err.message || String(err) };
    }
}


async function handleStartDeviceFlow(message) {
    try {
        const device = await startDeviceFlow({ remember: !!message.remember });
        return { success: true, device };
    } catch (err) {
        error("startDeviceFlow failed", err && err.message);
        return { success: false, message: err.message || String(err) };
    }
}

async function handleGetAuthStatus() {
    const token = await getToken();
    return {
        success: true,
        authenticated: !!token,
        tokenMasked: maskToken(token),
    };
}

async function handleSignOut() {
    await clearToken();
    // Broadcast sign out to all listeners
    chrome.runtime.sendMessage({ action: "signedOut" });
    return { success: true };
}

async function handleUploadFiles(message, sender) {
    const { owner, repo, branch, files, folder, allowUpdate } = message;

    if (!owner || !repo || !files || files.length === 0) {
        return { success: false, message: "Missing owner/repo/files" };
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

        // Notify via system notification
        if (res.success) {
            notify("LeetCode → GitHub", res.message);
        } else {
            notify("LeetCode → GitHub", "Upload failed: " + res.message);
        }

        // Inform the active tab so content script can show an in-page toast
        notifyActiveTab(res);

        return {
            success: !!res.success,
            message: res.message,
            results: res.results,
        };
    } catch (err) {
        // Notify active tab about failure
        notifyActiveTab({ success: false, message: err.message || String(err) });
        return { success: false, message: err.message || String(err) };
    }
}

/**
 * Notify the active tab about upload result
 */
function notifyActiveTab(res) {
    try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            try {
                const tabId = tabs && tabs[0] && tabs[0].id;
                if (!tabId) return;

                chrome.tabs.sendMessage(
                    tabId,
                    {
                        action: "showUploadToast",
                        success: !!res.success,
                        message: res.message || (res.results ? "Uploaded" : "Upload completed"),
                    },
                    () => {
                        if (chrome.runtime.lastError) {
                            log("sendMessage to tab failed:", chrome.runtime.lastError.message);
                        } else {
                            log("sent showUploadToast to tab", tabId);
                        }
                    }
                );
            } catch (e) {
                log("tabs.query/sendMessage inner error", e && e.message);
            }
        });
    } catch (e) {
        log("failed to notify tab about upload", e && e.message);
    }
}

function handleExecuteCodeExtraction(message, sender, sendResponse) {
    try {
        if (!sender || !sender.tab || !sender.tab.id) {
            sendResponse({ success: false, message: "No tab context" });
            return true;
        }

        const tabId = sender.tab.id;
        executeCodeExtraction(tabId, sendResponse);
        return true; // Async response
    } catch (err) {
        sendResponse({ success: false, message: err && err.message });
        return true;
    }
}

// ─────────────────────────────────────────────────────────────
// Main Router
// ─────────────────────────────────────────────────────────────

/**
 * Register the message handler
 * Call this on background script initialization
 */
export function registerMessageHandlers() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        log("onMessage received", message && message.action);

        (async () => {
            try {
                if (!message || !message.action) {
                    log("onMessage: no action specified", message);
                    sendResponse({ success: false, message: "No action specified" });
                    return;
                }

                switch (message.action) {
                    case "startDeviceFlow":
                        sendResponse(await handleStartDeviceFlow(message));
                        break;

                    case "getAuthStatus":
                        sendResponse(await handleGetAuthStatus());
                        break;

                    case "signOut":
                        sendResponse(await handleSignOut());
                        break;

                    case "checkSubmission":
                        sendResponse(await handleCheckSubmission(message));
                        break;

                    case "uploadFiles":
                        sendResponse(await handleUploadFiles(message, sender));
                        break;

                    case "prepareAndUpload":
                        sendResponse(await handlePrepareAndUpload(message));
                        break;

                    case "executeCodeExtraction":
                        // This one is special - needs direct sendResponse for async
                        handleExecuteCodeExtraction(message, sender, sendResponse);
                        return; // Don't call sendResponse again

                    default:
                        sendResponse({ success: false, message: "Unknown action" });
                }
            } catch (err) {
                sendResponse({ success: false, message: err.message || String(err) });
            }
        })();

        return true; // Indicate async response
    });

    log("message handlers registered");
}
