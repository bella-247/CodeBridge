// background/session/sessionUtils.js — Session helpers

import {
    ACTIVE_SESSION_STATUSES,
    SESSION_SCHEMA_VERSION,
    SESSION_STATUS,
    SESSION_STOP_REASONS,
    TERMINAL_SESSION_STATUSES,
} from "../../shared/sessionSchema.js";

import { nowSeconds } from "./timerEngine.js";

export function buildProblemKey(platform, problemId) {
    if (!platform || !problemId) return "";
    return `${String(platform).toLowerCase()}:${String(problemId)}`;
}

export function generateSessionId() {
    try {
        if (crypto && typeof crypto.randomUUID === "function") {
            return crypto.randomUUID();
        }
    } catch (e) {
        // ignore
    }
    const rand = Math.random().toString(36).slice(2, 10);
    return `sess_${Date.now().toString(36)}_${rand}`;
}

export function isActiveStatus(status) {
    return ACTIVE_SESSION_STATUSES.includes(status);
}

export function isTerminalStatus(status) {
    return TERMINAL_SESSION_STATUSES.includes(status);
}

export function isAcceptedVerdict(verdict) {
    if (!verdict) return false;
    const v = String(verdict).trim().toLowerCase();
    return v === "accepted" || v === "ok" || v === "ac" || v === "passed";
}

export function getSortTimestamp(session) {
    if (!session) return 0;
    return (
        session.endTime ||
        session.startTime ||
        session.lastUpdated ||
        session.lastSeen ||
        session.firstSeen ||
        0
    );
}

export function mapStopReasonToStatus(reason, isSuccess = false) {
    if (isSuccess || reason === SESSION_STOP_REASONS.ACCEPTED) {
        return SESSION_STATUS.COMPLETED;
    }
    if (reason === SESSION_STOP_REASONS.TIMEOUT) {
        return SESSION_STATUS.TIMED_OUT;
    }
    if (reason === SESSION_STOP_REASONS.PROBLEM_SWITCH) {
        return SESSION_STATUS.SWITCHED;
    }
    if (reason === SESSION_STOP_REASONS.MANUAL) {
        return SESSION_STATUS.ABANDONED;
    }
    return SESSION_STATUS.ABANDONED;
}

export function inferStatus(session) {
    if (!session) return SESSION_STATUS.IDLE;
    if (session.status && Object.values(SESSION_STATUS).includes(session.status)) {
        return session.status;
    }
    if (session.endTime) {
        if (isAcceptedVerdict(session.verdict)) {
            return SESSION_STATUS.COMPLETED;
        }
        return SESSION_STATUS.ABANDONED;
    }
    if (session.isPaused) return SESSION_STATUS.PAUSED;
    if (session.startTime || (session.elapsedSeconds || 0) > 0) {
        return SESSION_STATUS.ACTIVE;
    }
    return SESSION_STATUS.IDLE;
}

export function normalizeSessionRecord(session) {
    if (!session) return null;
    const now = nowSeconds();
    const platform = String(session.platform || "").toLowerCase();
    const problemId = String(session.problemId || "");
    const firstSeen =
        Number.isFinite(session.firstSeen) && session.firstSeen > 0
            ? session.firstSeen
            : Number.isFinite(session.startTime) && session.startTime > 0
                ? session.startTime
                : now;
    const lastSeen =
        Number.isFinite(session.lastSeen) && session.lastSeen > 0
            ? session.lastSeen
            : firstSeen;
    const lastUpdated =
        Number.isFinite(session.lastUpdated) && session.lastUpdated > 0
            ? session.lastUpdated
            : lastSeen;

    const normalized = {
        ...session,
        sessionId: session.sessionId || generateSessionId(),
        platform,
        problemId,
        problemKey: buildProblemKey(platform, problemId),
        elapsedSeconds: Number.isFinite(session.elapsedSeconds)
            ? session.elapsedSeconds
            : 0,
        attemptCount: Number.isFinite(session.attemptCount)
            ? session.attemptCount
            : 0,
        isPaused: typeof session.isPaused === "boolean" ? session.isPaused : false,
        pausedAt: Number.isFinite(session.pausedAt) ? session.pausedAt : null,
        firstSeen,
        lastSeen,
        lastUpdated,
        schemaVersion: SESSION_SCHEMA_VERSION,
    };

    normalized.status = inferStatus(normalized);

    if (!normalized.stopReason && isTerminalStatus(normalized.status)) {
        normalized.stopReason = isAcceptedVerdict(normalized.verdict)
            ? SESSION_STOP_REASONS.ACCEPTED
            : SESSION_STOP_REASONS.UNKNOWN;
    }

    return normalized;
}
