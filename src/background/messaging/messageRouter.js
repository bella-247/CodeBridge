// messaging/messageRouter.js — Central message handler
// This replaces the giant onMessage block. Clean. Predictable. Testable.

import { log, error } from "../core/logger.js";
import { notify } from "../core/notifications.js";
import { getToken, clearToken, maskToken } from "../auth/tokenStore.js";
import { startDeviceFlow } from "../auth/deviceFlow.js";
import { uploadFilesToRepo } from "../github/uploadService.js";
import { executeCodeExtraction } from "../leetcode/extractor.js";

// ─────────────────────────────────────────────────────────────
// Message Handlers
// ─────────────────────────────────────────────────────────────

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

                    case "uploadFiles":
                        sendResponse(await handleUploadFiles(message, sender));
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
