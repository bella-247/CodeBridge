// background/session/eventRouter.js — Event processing for session tracking

import { ensureSessionDefaults, getSessionSettings, setSessionSettings } from "./storageManager.js";
import {
    upsertSession,
    startSessionTimer,
    stopSessionTimer,
    recordSubmission,
    getAllSessions,
    getSessionByKey,
    clearAllSessions,
    isAcceptedVerdict,
} from "./sessionManager.js";
import { pruneSessions } from "./pruneManager.js";

export async function initSessionTracking() {
    await ensureSessionDefaults();
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

    await upsertSession(base);

    let updated = null;
    let shouldPrune = false;

    switch (event.type) {
        case "timer_start":
            updated = await startSessionTimer({
                platform,
                problemId,
                startedAt: event.startedAt || null,
            });
            break;
        case "timer_stop":
            updated = await stopSessionTimer({
                platform,
                problemId,
                stoppedAt: event.stoppedAt || null,
            });
            shouldPrune = true;
            break;
        case "submission":
            updated = await recordSubmission({
                platform,
                problemId,
                verdict: event.verdict || null,
                language: event.language || null,
                submissionId: event.submissionId || null,
                submittedAt: event.submittedAt || null,
            });
            shouldPrune = isAcceptedVerdict(event.verdict);
            break;
        case "page_view":
        default:
            updated = await getSessionByKey(platform, problemId);
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
    const settings = await setSessionSettings(message && message.settings ? message.settings : {});
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
