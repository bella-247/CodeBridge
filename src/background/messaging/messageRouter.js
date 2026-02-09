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
import { TemplateManager } from "../../utils/templateManager.js";
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
            chrome.storage.local.get([
                'template_commit',
                'template_path',
                'template_readme',
                'template_solution',
                'includeProblemStatement'
            ], resolve);
        });

        const ext = problemData.extension || "txt";
        const templates = {
            path: items.template_path,
            readme: items.template_readme,
            solutionHeader: items.template_solution
        };
        const includeProblemStatement = typeof items.includeProblemStatement === "undefined"
            ? true
            : !!items.includeProblemStatement;

        const files = generateUploadFiles(fileOrg, problemData, ext, templates, { includeProblemStatement });

        // Commit message
        const commitMessage = TemplateManager.populateAll(problemData, templates, ext).commit;

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


/**
 * Decodes common HTML entities in a string.
 * Codeforces source code is always HTML-escaped.
 * @param {string} text
 * @returns {string}
 */
function decodeHtmlEntities(text) {
    return text
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'") // for single quotes
        .replace(/&apos;/g, "'"); // for single quotes
}

async function handleFetchSubmissionCode(message) {
    const { url } = message;
    if (!url) return { success: false, message: "Missing URL" };

    try {
        console.log("[CodeBridge] Background fetching submission with credentials:", url);
        // CRITICAL: We MUST include credentials to use the user's session cookies
        const response = await fetch(url, { credentials: 'include' });
        console.log("[CodeBridge] Fetch response status:", response.status);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const text = await response.text();
        console.log("[CodeBridge] Page fetched. Text length:", text.length);

        // Step 1: Integrity Check (The CSRF Gate)
        if (!text.includes('class="csrf-token"')) {
            throw new Error("Session Error: Valid Codeforces page not found (missing CSRF token). User might be logged out or redirected.");
        }
        console.log("[CodeBridge] CSRF token found.");

        // Step 2: Locate the Source Code
        if (!text.includes('id="program-source-text"')) {
            throw new Error("Structure Error: Submission code container not found. The submission might be hidden or the website layout changed.");
        }
        console.log("[CodeBridge] Code block ID found.");


        // Step 3: Extract and Decode
        // Use a Regex to capture the content inside <pre id="program-source-text"...>(.*?)</pre>.
        const codeRegex = /<pre[^>]*id="program-source-text"[^>]*>([\s\S]*?)<\/pre>/i;
        const codeMatch = text.match(codeRegex);

        let code = "";
        if (codeMatch && codeMatch[1]) {
            code = decodeHtmlEntities(codeMatch[1]);
            console.log("[CodeBridge] Code block extracted and decoded.");
        } else {
            // This case should theoretically be covered by the includes check above,
            // but good to have as a fallback if regex fails after includes.
            throw new Error("Structure Error: Failed to extract code content from the identified block.");
        }

        // Step 4: Extract Metadata (Language)
        const langRegex = /<td>Language:<\/td>\s*<td>(.*?)<\/td>/i;
        const langMatch = text.match(langRegex);
        const language = langMatch ? langMatch[1].trim() : null;
        console.log("[CodeBridge] Language detected:", language);

        console.log("[CodeBridge] Code extraction process completed successfully.");
        return { success: true, code, language };

    } catch (err) {
        console.error("[CodeBridge] Fetch error:", err);
        return { success: false, message: err.message };
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

                    case "fetchSubmissionCode":
                        sendResponse(await handleFetchSubmissionCode(message));
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
