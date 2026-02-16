// background/session/eventRouter.js — Event processing for session tracking

import {
    ensureSessionDefaults,
    getSessionSettings,
    setSessionSettings,
} from "./storageManager.js";
import {
    startSessionTimer,
    stopSessionTimer,
    pauseSessionTimer,
    resumeSessionTimer,
    resetSessionTimer,
    recordSubmission,
    getAllSessions,
    getSessionByKey,
    clearAllSessions,
    isAcceptedVerdict,
    touchSession,
} from "./sessionManager.js";
import { pruneSessions, trimSessionsToCount } from "./pruneManager.js";
import { initSessionStore } from "./sessionStore.js";

export async function initSessionTracking() {
    await ensureSessionDefaults();
    await initSessionStore();
    await pruneSessions();
}

export async function handleSessionEvent(message) {
    const event = message && (message.event || message.payload);
    if (!event || !event.platform || !event.problemId) {
        return { success: false, message: "Missing platform/problemId" };
    }

    const platform = String(event.platform).toLowerCase();
    const problemId = String(event.problemId);
    const base = {
        platform,
        problemId,
        difficulty:
            typeof event.difficulty === "number" || typeof event.difficulty === "string"
                ? event.difficulty
                : null,
    };

    let updated = null;
    let shouldPrune = false;

    switch (event.type) {
        case "timer_start":
            updated = await startSessionTimer({
                platform,
                problemId,
                startedAt: event.startedAt || null,
                difficulty: base.difficulty,
            });
            break;
        case "timer_stop":
            updated = await stopSessionTimer({
                platform,
                problemId,
                stoppedAt: event.stoppedAt || null,
                reason: event.reason || event.stopReason || null,
            });
            shouldPrune = true;
            break;
        case "timer_pause":
            updated = await pauseSessionTimer({
                platform,
                problemId,
                pausedAt: event.pausedAt || null,
            });
            break;
        case "timer_resume":
            updated = await resumeSessionTimer({
                platform,
                problemId,
                resumedAt: event.resumedAt || null,
            });
            break;
        case "timer_reset":
            updated = await resetSessionTimer({
                platform,
                problemId,
            });
            break;
        case "submission":
            updated = await recordSubmission({
                platform,
                problemId,
                verdict: event.verdict || null,
                language: event.language || null,
                submissionId: event.submissionId || null,
                submittedAt: event.submittedAt || null,
                isSuccess:
                    typeof event.isSuccess === "boolean" ? event.isSuccess : null,
                autoStop:
                    typeof event.autoStop === "boolean" ? event.autoStop : true,
                difficulty: base.difficulty,
            });
            shouldPrune =
                typeof event.isSuccess === "boolean"
                    ? event.isSuccess
                    : isAcceptedVerdict(event.verdict);
            break;
        case "page_view":
        default:
            updated = await touchSession(base);
            if (!updated) {
                updated = await getSessionByKey(platform, problemId);
            }
            break;
    }

    if (shouldPrune) {
        await pruneSessions();
    }

    return { success: true, session: updated };
}

export async function handleGetSessionSettings() {
    const settings = await getSessionSettings();
    return { success: true, settings };
}

export async function handleSetSessionSettings(message) {
    if (!message || !message.settings) {
        return { success: false, message: "Missing session settings" };
    }
    const settings = await setSessionSettings(message.settings);
    return { success: true, settings };
}

export async function handleGetSessions() {
    const sessions = await getAllSessions();
    return { success: true, sessions };
}

export async function handleGetSession(message) {
    const platform = message && message.platform ? String(message.platform).toLowerCase() : "";
    const problemId = message && message.problemId ? String(message.problemId) : "";
    if (!platform || !problemId) {
        return { success: false, message: "Missing platform/problemId" };
    }
    const session = await getSessionByKey(platform, problemId);
    return { success: true, session };
}

export async function handleClearSessions() {
    await clearAllSessions();
    return { success: true };
}

export async function handleTrimSessions(message) {
    const keepCount =
        message && Number.isFinite(message.keepCount)
            ? Math.max(0, message.keepCount)
            : null;
    if (keepCount === null) {
        return { success: false, message: "Missing keepCount" };
    }
    const result = await trimSessionsToCount(keepCount);
    return { success: true, ...result };
}
