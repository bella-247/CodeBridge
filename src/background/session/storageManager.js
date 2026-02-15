// background/session/storageManager.js — Storage helpers for session settings

import { SESSION_DEFAULTS } from "../../shared/sessionDefaults.js";

export function storageGet(keys) {
    return new Promise((resolve, reject) => {
        try {
            chrome.storage.local.get(keys, (items) => {
                const err = chrome.runtime.lastError;
                if (err) {
                    console.error("storageGet failed:", err);
                    reject(err);
                    return;
                }
                resolve(items || {});
            });
        } catch (e) {
            console.error("storageGet exception:", e);
            reject(e);
        }
    });
}

export function storageSet(values) {
    return new Promise((resolve, reject) => {
        try {
            chrome.storage.local.set(values, () => {
                const err = chrome.runtime.lastError;
                if (err) {
                    console.error("storageSet failed:", err);
                    reject(err);
                    return;
                }
                resolve();
            });
        } catch (e) {
            console.error("storageSet exception:", e);
            reject(e);
        }
    });
}

export function storageRemove(keys) {
    const payload = Array.isArray(keys) ? keys : [keys];
    return new Promise((resolve, reject) => {
        try {
            chrome.storage.local.remove(payload, () => {
                const err = chrome.runtime.lastError;
                if (err) {
                    console.error("storageRemove failed:", err);
                    reject(err);
                    return;
                }
                resolve();
            });
        } catch (e) {
            console.error("storageRemove exception:", e);
            reject(e);
        }
    });
}

export async function ensureSessionDefaults() {
    const keys = Object.keys(SESSION_DEFAULTS);
    let items = null;
    try {
        items = await storageGet(keys);
    } catch (err) {
        throw err;
    }
    if (!items) {
        throw new Error("storageGet failed to return settings");
    }
    const toSet = {};
    for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(items, key)) {
            toSet[key] = SESSION_DEFAULTS[key];
        }
    }

    if (Object.keys(toSet).length > 0) {
        await storageSet(toSet);
    }

    return { ...SESSION_DEFAULTS, ...items, ...toSet };
}

export async function getSessionSettings() {
    const items = await storageGet(Object.keys(SESSION_DEFAULTS));
    return { ...SESSION_DEFAULTS, ...items };
}

export async function setSessionSettings(partial) {
    const keys = Object.keys(SESSION_DEFAULTS);
    const toSet = {};
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(partial, key)) {
            toSet[key] = partial[key];
        }
    }

    if (Object.keys(toSet).length > 0) {
        await storageSet(toSet);
    }

    return getSessionSettings();
}
