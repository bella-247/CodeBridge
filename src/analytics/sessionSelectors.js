// analytics/sessionSelectors.js — Session normalization helpers

import {
    SESSION_STOP_REASONS,
    TERMINAL_SESSION_STATUSES,
} from "../shared/sessionSchema.js";

const ACCEPTED_VERDICTS = new Set(["accepted", "ok", "ac", "passed"]);
const TERMINAL_STOP_REASONS = new Set([
    SESSION_STOP_REASONS.ACCEPTED,
    SESSION_STOP_REASONS.MANUAL,
    SESSION_STOP_REASONS.TIMEOUT,
    SESSION_STOP_REASONS.PROBLEM_SWITCH,
]);

function isTerminalSession(session) {
    if (!session) return false;
    const status = session.status ? String(session.status).toUpperCase() : "";
    const stopReason = session.stopReason
        ? String(session.stopReason).toLowerCase()
        : "";
    return (
        TERMINAL_SESSION_STATUSES.includes(status) ||
        TERMINAL_STOP_REASONS.has(stopReason)
    );
}

export function getSessionEndSeconds(session) {
    if (!session) return null;
    if (Number.isFinite(session.endTime)) return session.endTime;
    if (isTerminalSession(session)) {
        if (Number.isFinite(session.lastUpdated)) return session.lastUpdated;
        if (Number.isFinite(session.lastSeen)) return session.lastSeen;
        if (Number.isFinite(session.startTime)) return session.startTime;
        if (Number.isFinite(session.firstSeen)) return session.firstSeen;
    }
    return null;
}

export function getSessionStartSeconds(session) {
    if (!session) return null;
    if (Number.isFinite(session.startTime)) return session.startTime;
    if (Number.isFinite(session.firstSeen)) return session.firstSeen;
    return null;
}

export function getSessionDurationSeconds(session) {
    if (!session) return 0;
    if (Number.isFinite(session.elapsedSeconds)) {
        return Math.max(0, session.elapsedSeconds);
    }
    const start = getSessionStartSeconds(session);
    const end = getSessionEndSeconds(session);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
    return Math.max(0, end - start);
}

export function isSessionEnded(session) {
    if (!session) return false;
    if (Number.isFinite(session.endTime)) return true;
    return isTerminalSession(session);
}

export function isSolvedSession(session) {
    if (!session) return false;
    if (isTerminalSession(session)) {
        const stopReason = session.stopReason
            ? String(session.stopReason).toLowerCase()
            : "";
        // Treat only explicit success signals as solved to avoid false positives.
        if (stopReason === "accepted") return true;
    }
    if (session.verdict) {
        const verdict = String(session.verdict).trim().toLowerCase();
        if (ACCEPTED_VERDICTS.has(verdict)) return true;
    }
    return false;
}

export function getProblemKey(session) {
    if (!session) return "";
    const platform = session.platform || "unknown";
    const problemId = session.problemId || "unknown";
    return `${platform}:${problemId}`;
}
