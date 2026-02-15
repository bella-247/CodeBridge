// components/bubble/fallbackBubble.js — Emergency fallback bubble injection
// This file handles the last-resort DOM injection when content scripts fail
// You never want to touch this unless things break.

import { log } from "../../core/logger.js";

/**
 * The inline bubble HTML/CSS to inject as a last resort
 * This function runs in the page's MAIN world
 */
function injectFallbackBubble() {
    try {
        if (window.__cb_bubble_hidden) return false;
        if (document.getElementById("lcgh-bubble")) return false;

        // Minimal styles
        const existing = document.getElementById("lcgh-styles-inline");
        if (!existing) {
            const css = `
                #lcgh-bubble { position: fixed; right: 18px; bottom: 120px; width:56px; height:56px; border-radius:50%; background:#127c5a; color:#fff; display:flex; align-items:center; justify-content:center; z-index:2147483651; cursor:pointer; touch-action:none; }
                #lcgh-bubble .lcgh-close { position:absolute; top:4px; right:4px; width:18px; height:18px; border-radius:50%; background:rgba(0,0,0,0.35); color:#fff; display:flex; align-items:center; justify-content:center; font-size:12px; cursor:pointer; }
                #lcgh-toast { position: fixed; right:18px; bottom:190px; background: rgba(17,24,39,0.95); color:#fff; padding:8px 12px; border-radius:8px; z-index:2147483651; display:none; }
            `;
            const s = document.createElement("style");
            s.id = "lcgh-styles-inline";
            s.textContent = css;
            (document.head || document.documentElement).appendChild(s);
        }

        // Create wrapper
        const wrapper = document.createElement("div");
        wrapper.id = "lcgh-bubble";
        wrapper.title = "Upload solution to GitHub";
        wrapper.tabIndex = -1;
        wrapper.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L12 22" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 9L12 2L19 9" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

        // Close button
        const close = document.createElement("div");
        close.className = "lcgh-close";
        close.textContent = "×";
        close.addEventListener("click", (ev) => {
            try {
                ev.stopPropagation();
                wrapper.style.display = "none";
                window.__cb_bubble_hidden = true;
            } catch (e) { }
        });
        wrapper.appendChild(close);

        // Append toast container
        if (!document.getElementById("lcgh-toast")) {
            const toast = document.createElement("div");
            toast.id = "lcgh-toast";
            document.body.appendChild(toast);
        }

        // Attach click handler
        wrapper.addEventListener("click", () => {
            try {
                console.log("lcgh: fallback-bubble clicked");
                window.postMessage({ lcghAction: "bubbleClicked" }, "*");
            } catch (e) { }
        });

        document.body.appendChild(wrapper);
        console.log("lcgh: fallback bubble injected");
        return true;
    } catch (e) {
        console.log("lcgh: fallback injection error", e && e.message);
        return false;
    }
}

/**
 * Check if bubble exists in the page
 * Runs in the page's MAIN world
 */
function checkBubbleExists() {
    try {
        const exists = !!document.getElementById("lcgh-bubble");
        console.log("lcgh: injected-check bubbleExists=", exists);
        return exists;
    } catch (e) {
        console.log("lcgh: injected-check error", e && e.message);
        return false;
    }
}

/**
 * Inject fallback bubble if the main content script's bubble doesn't exist
 * @param {number} tabId - Tab ID to inject into
 */
export function injectFallbackBubbleIfNeeded(tabId) {
    try {
        // First check if bubble exists
        chrome.scripting.executeScript(
            {
                target: { tabId },
                world: "MAIN",
                func: checkBubbleExists,
            },
            (diagRes) => {
                if (chrome.runtime.lastError) {
                    log("diagnostic injection failed:", chrome.runtime.lastError.message);
                    return;
                }

                const bubbleExists = diagRes && diagRes[0] && typeof diagRes[0].result !== "undefined"
                    ? !!diagRes[0].result
                    : false;
                log("diagnostic injection executed", { bubbleExists });

                // If bubble doesn't exist, inject fallback
                if (!bubbleExists) {
                    try {
                        chrome.scripting.executeScript(
                            {
                                target: { tabId },
                                world: "MAIN",
                                func: injectFallbackBubble,
                            },
                            (fallbackRes) => {
                                if (chrome.runtime.lastError) {
                                    log("fallback injection failed:", chrome.runtime.lastError.message);
                                } else {
                                    const injected = fallbackRes && fallbackRes[0] && typeof fallbackRes[0].result !== "undefined"
                                        ? !!fallbackRes[0].result
                                        : false;
                                    log("fallback injection executed", { injected });
                                }
                            }
                        );
                    } catch (e) {
                        log("fallback executeScript error", e && e.message);
                    }
                }
            }
        );
    } catch (e) {
        log("injectFallbackBubbleIfNeeded error", e && e.message);
    }
}
