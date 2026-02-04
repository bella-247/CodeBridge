// leetcode/injector.js — Content script injection for LeetCode pages
// This file owns tab lifecycle - when to inject content scripts

import { log } from "../core/logger.js";
import { injectFallbackBubbleIfNeeded } from "./fallbackBubble.js";

/**
 * Check if a URL is a LeetCode page
 * @param {string} url 
 * @returns {boolean}
 */
function isLeetCodeUrl(url) {
    return url && url.startsWith("https://leetcode.com/");
}

/**
 * Inject content script into a LeetCode tab
 * @param {number} tabId - Tab ID to inject into
 */
function injectContentScriptIfLeetCode(tabId) {
    try {
        if (!tabId) return;

        chrome.tabs.get(tabId, (tab) => {
            if (!tab || !tab.url) return;

            try {
                const url = String(tab.url);
                if (!isLeetCodeUrl(url)) return;

                // Execute script in the tab's main world
                try {
                    chrome.scripting.executeScript(
                        {
                            target: { tabId, allFrames: true },
                            files: ["src/content.js"],
                            world: "MAIN",
                        },
                        (injectionResults) => {
                            if (chrome.runtime.lastError) {
                                log("injectContentScript failed:", chrome.runtime.lastError.message);
                            } else {
                                log("attempted injection of content script into tab", tabId, tab.url, {
                                    framesInjected: Array.isArray(injectionResults) ? injectionResults.length : null
                                });
                            }

                            // Check if bubble exists and inject fallback if needed
                            injectFallbackBubbleIfNeeded(tabId);
                        }
                    );
                } catch (e) {
                    log("scripting.executeScript threw", e && e.message);
                }
            } catch (e) {
                log("injectContentScriptIfLeetCode inner error", e && e.message);
            }
        });
    } catch (e) {
        log("injectContentScriptIfLeetCode error", e && e.message);
    }
}

/**
 * Register tab injection listeners
 * Call this on background script initialization
 */
export function registerTabInjection() {
    // Inject when a tab updates (navigation complete)
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        try {
            if (changeInfo && (changeInfo.status === "complete" || changeInfo.status === "loading")) {
                injectContentScriptIfLeetCode(tabId);
            }
        } catch (e) {
            log("tabs.onUpdated handler error", e && e.message);
        }
    });

    // Inject when user switches active tab
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
        try {
            if (!activeInfo || !activeInfo.tabId) return;
            injectContentScriptIfLeetCode(activeInfo.tabId);
        } catch (e) {
            log("tabs.onActivated handler error", e && e.message);
        }
    });

    // Also attempt to inject to the currently active tab at startup
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        try {
            if (tabs && tabs.length) {
                const tab = tabs[0];
                if (tab && tab.id) injectContentScriptIfLeetCode(tab.id);
            }
        } catch (e) {
            log("initial active tab injection error", e && e.message);
        }
    });

    log("tab injection listeners registered");
}
