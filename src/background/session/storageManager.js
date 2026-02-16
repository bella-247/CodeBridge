// background/session/storageManager.js — Storage helpers for session tracking

import { SESSION_DEFAULTS, SESSION_STORAGE_KEYS } from "../../shared/sessionDefaults.js";

let _sessionsCache = null;

function storageGet(keys) {
    return new Promise((resolve) => {
        try {
            chrome.storage.local.get(keys, (items) => resolve(items || {}));
        } catch (e) {
            resolve({});
        }
    });
}

function storageSet(values) {
    return new Promise((resolve) => {
        try {
            chrome.storage.local.set(values, () => resolve());
        } catch (e) {
            resolve();
        }
    });
}

export async function ensureSessionDefaults() {
    const keys = Object.keys(SESSION_DEFAULTS);
    const items = await storageGet(keys);
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

export async function loadSessions() {
    if (_sessionsCache) return _sessionsCache;
    const items = await storageGet([SESSION_STORAGE_KEYS.SESSIONS]);
    const sessions = Array.isArray(items[SESSION_STORAGE_KEYS.SESSIONS])
        ? items[SESSION_STORAGE_KEYS.SESSIONS]
        : [];
    _sessionsCache = sessions;
    return sessions;
}

export async function saveSessions(sessions) {
    const payload = Array.isArray(sessions) ? sessions : [];
    _sessionsCache = payload;
    await storageSet({ [SESSION_STORAGE_KEYS.SESSIONS]: payload });
    return payload;
}

export function clearSessionsCache() {
    _sessionsCache = null;
}
