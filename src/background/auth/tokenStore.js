// auth/tokenStore.js — Token persistence logic
// All token access goes through this module. Nobody else touches chrome.storage for tokens.

import { log } from "../../core/logger.js";

// In-memory cache for faster access
let inMemoryToken = null;

/**
 * Get the current GitHub token (from memory or storage)
 * @returns {Promise<string|null>}
 */
export async function getToken() {
    if (inMemoryToken) return inMemoryToken;

    return new Promise((resolve) => {
        chrome.storage.local.get(["github_token"], (items) => {
            const token = items && items.github_token ? items.github_token : null;
            if (token) {
                inMemoryToken = token; // Cache it
            }
            resolve(token);
        });
    });
}

/**
 * Store a GitHub token
 * @param {string} token - The access token
 * @param {boolean} remember - If true, persist to storage; otherwise memory-only
 */
export async function setToken(token, remember = false) {
    inMemoryToken = token;

    if (remember) {
        return new Promise((resolve) => {
            chrome.storage.local.set({ github_token: token }, () => {
                log("token saved to chrome.storage.local (remember=true)");
                resolve();
            });
        });
    }
}

/**
 * Clear the stored token (sign out)
 * @returns {Promise<void>}
 */
export async function clearToken() {
    inMemoryToken = null;

    return new Promise((resolve) => {
        chrome.storage.local.remove("github_token", () => {
            log("signed out: removed github_token from storage");
            resolve();
        });
    });
}

/**
 * Get a masked version of the token for display
 * @param {string|null} token 
 * @returns {string|null}
 */
export function maskToken(token) {
    if (!token) return null;
    return token.slice(0, 4) + "..." + token.slice(-4);
}
