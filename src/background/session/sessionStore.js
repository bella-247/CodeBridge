// background/session/sessionStore.js — IndexedDB-backed session storage

import {
    LEGACY_SESSION_STORAGE_KEY,
    SESSION_DB,
    SESSION_MIGRATION_FLAG_KEY,
    SESSION_STOP_REASONS,
    SESSION_STATUS,
} from "../../shared/sessionSchema.js";
import { openSessionDb } from "./sessionDb.js";
import { nowSeconds } from "./timerEngine.js";
import { storageGet, storageRemove, storageSet } from "./storageManager.js";
import {
    buildProblemKey,
    inferStatus,
    isAcceptedVerdict,
    normalizeSessionRecord,
} from "./sessionUtils.js";

function requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function withStore(mode, action) {
    const db = await openSessionDb();
    return new Promise((resolve, reject) => {
        try {
            const tx = db.transaction([SESSION_DB.STORE], mode);
            const store = tx.objectStore(SESSION_DB.STORE);
            const result = action(store, tx);
            tx.oncomplete = () => resolve(result);
            tx.onerror = () => reject(tx.error || new Error("Session DB transaction failed"));
        } catch (err) {
            reject(err);
        }
    });
}

export async function initSessionStore() {
    await openSessionDb();
    await migrateLegacySessions();
    await upgradeSessionSchema();
}

export async function getSessionById(sessionId) {
    if (!sessionId) return null;
    const db = await openSessionDb();
    const tx = db.transaction([SESSION_DB.STORE], "readonly");
    const store = tx.objectStore(SESSION_DB.STORE);
    const req = store.get(sessionId);
    const result = await requestToPromise(req);
    return result || null;
}

export async function getAllSessions() {
    const db = await openSessionDb();
    const tx = db.transaction([SESSION_DB.STORE], "readonly");
    const store = tx.objectStore(SESSION_DB.STORE);
    const req = store.getAll();
    const result = await requestToPromise(req);
    return Array.isArray(result) ? result : [];
}

export async function getSessionsByProblem(platform, problemId) {
    const problemKey = buildProblemKey(platform, problemId);
    if (!problemKey) return [];
    const db = await openSessionDb();
    const tx = db.transaction([SESSION_DB.STORE], "readonly");
    const index = tx.objectStore(SESSION_DB.STORE).index("problemKey");
    const req = index.getAll(problemKey);
    const result = await requestToPromise(req);
    return Array.isArray(result) ? result : [];
}

export async function saveSession(session) {
    const normalized = normalizeSessionRecord(session);
    if (!normalized) return null;
    await withStore("readwrite", (store) => {
        store.put(normalized);
    });
    return normalized;
}

export async function saveSessions(sessions) {
    const payload = Array.isArray(sessions) ? sessions : [];
    if (!payload.length) return [];
    const normalized = payload
        .map((session) => normalizeSessionRecord(session))
        .filter(Boolean);
    if (!normalized.length) return [];
    await withStore("readwrite", (store) => {
        normalized.forEach((session) => {
            store.put(session);
        });
    });
    return normalized;
}

export async function replaceAllSessions(sessions) {
    const payload = Array.isArray(sessions) ? sessions : [];
    const normalized = payload
        .map((session) => normalizeSessionRecord(session))
        .filter(Boolean);
    await withStore("readwrite", (store) => {
        store.clear();
        normalized.forEach((session) => {
            store.put(session);
        });
    });
    return normalized;
}

export async function deleteSessionsByIds(ids) {
    const payload = Array.isArray(ids) ? ids.filter(Boolean) : [];
    if (!payload.length) return 0;
    await withStore("readwrite", (store) => {
        payload.forEach((id) => store.delete(id));
    });
    return payload.length;
}

export async function clearAllSessions() {
    await withStore("readwrite", (store) => {
        store.clear();
    });
}

export async function countSessions() {
    const db = await openSessionDb();
    const tx = db.transaction([SESSION_DB.STORE], "readonly");
    const store = tx.objectStore(SESSION_DB.STORE);
    const req = store.count();
    const result = await requestToPromise(req);
    return Number.isFinite(result) ? result : 0;
}

function buildLegacySessionId(session) {
    const base = [
        "legacy",
        session.platform || "unknown",
        session.problemId || "unknown",
        session.firstSeen || session.startTime || session.lastUpdated || "0",
    ].join(":");
    return base;
}

function normalizeLegacySession(legacy) {
    if (!legacy || !legacy.platform || !legacy.problemId) return null;
    const platform = String(legacy.platform).toLowerCase();
    const problemId = String(legacy.problemId);
    const now = nowSeconds();
    const session = {
        sessionId: legacy.sessionId || buildLegacySessionId(legacy),
        platform,
        problemId,
        problemKey: buildProblemKey(platform, problemId),
        difficulty: legacy.difficulty ?? null,
        startTime: Number.isFinite(legacy.startTime) ? legacy.startTime : null,
        endTime: Number.isFinite(legacy.endTime) ? legacy.endTime : null,
        verdict: legacy.verdict || null,
        language: legacy.language || null,
        attemptCount: Number.isFinite(legacy.attemptCount) ? legacy.attemptCount : 0,
        elapsedSeconds: Number.isFinite(legacy.elapsedSeconds)
            ? legacy.elapsedSeconds
            : 0,
        isPaused: typeof legacy.isPaused === "boolean" ? legacy.isPaused : false,
        pausedAt: Number.isFinite(legacy.pausedAt) ? legacy.pausedAt : null,
        firstSeen: Number.isFinite(legacy.firstSeen) ? legacy.firstSeen : null,
        lastSeen: Number.isFinite(legacy.lastSeen) ? legacy.lastSeen : null,
        lastUpdated: Number.isFinite(legacy.lastUpdated) ? legacy.lastUpdated : null,
        lastSubmissionId: legacy.lastSubmissionId || null,
        stopReason: legacy.stopReason || null,
        status: legacy.status || null,
    };

    const normalized = normalizeSessionRecord(session);

    if (!normalized.endTime && normalized.status === SESSION_STATUS.ABANDONED) {
        normalized.endTime =
            normalized.lastUpdated || normalized.lastSeen || normalized.firstSeen || now;
    }

    if (!normalized.stopReason && normalized.endTime) {
        normalized.stopReason = isAcceptedVerdict(normalized.verdict)
            ? SESSION_STOP_REASONS.ACCEPTED
            : SESSION_STOP_REASONS.UNKNOWN;
    }

    return normalized;
}

export async function migrateLegacySessions() {
    const items = await storageGet([
        LEGACY_SESSION_STORAGE_KEY,
        SESSION_MIGRATION_FLAG_KEY,
    ]);
    if (items[SESSION_MIGRATION_FLAG_KEY]) return { migrated: false };

    const legacy = Array.isArray(items[LEGACY_SESSION_STORAGE_KEY])
        ? items[LEGACY_SESSION_STORAGE_KEY]
        : [];
    if (!legacy.length) {
        await storageSet({ [SESSION_MIGRATION_FLAG_KEY]: true });
        return { migrated: false };
    }

    const normalized = legacy
        .map((item) => normalizeLegacySession(item))
        .filter(Boolean);

    if (normalized.length) {
        await saveSessions(normalized);
    }

    await storageSet({ [SESSION_MIGRATION_FLAG_KEY]: true });
    await storageRemove(LEGACY_SESSION_STORAGE_KEY);
    return { migrated: true, count: normalized.length };
}

export async function upgradeSessionSchema() {
    const sessions = await getAllSessions();
    if (!sessions.length) return { upgraded: 0 };
    const upgrades = [];
    for (const session of sessions) {
        const normalized = normalizeSessionRecord(session);
        if (!normalized) continue;
        const needsUpgrade =
            normalized.schemaVersion !== session.schemaVersion ||
            normalized.status !== session.status ||
            normalized.stopReason !== session.stopReason;
        if (needsUpgrade) upgrades.push(normalized);
    }

    if (upgrades.length) {
        await saveSessions(upgrades);
    }
    return { upgraded: upgrades.length };
}
