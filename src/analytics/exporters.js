// analytics/exporters.js — Export helpers for user data

import {
    SESSION_SCHEMA_VERSION,
    SESSION_STATUS,
    SESSION_STOP_REASONS,
    TERMINAL_SESSION_STATUSES,
} from "../shared/sessionSchema.js";

const USER_DATA_EXPORT_FORMAT = "codebridge-user-data";
const USER_DATA_EXPORT_VERSION = 1;
const ACCEPTED_VERDICTS = new Set(["accepted", "ok", "ac", "passed"]);

function normalizeSession(session) {
    if (!session || typeof session !== "object") return null;
    const platform = session.platform ? String(session.platform).toLowerCase() : "";
    const problemId = session.problemId ? String(session.problemId) : "";
    const problemKey = session.problemKey || (platform && problemId ? `${platform}:${problemId}` : "");

    const fallbackId = `${platform || "unknown"}:${problemId || "unknown"}:${session.firstSeen || session.startTime || session.lastUpdated || ""}`;
    const normalized = {
        sessionId: session.sessionId || fallbackId,
        platform: platform || "unknown",
        problemId: problemId || "unknown",
        problemKey,
        difficulty:
            session.difficulty !== undefined && session.difficulty !== null
                ? session.difficulty
                : null,
        status: session.status ? String(session.status).toUpperCase() : null,
        stopReason: session.stopReason
            ? String(session.stopReason).toLowerCase()
            : null,
        verdict: session.verdict || null,
        language: typeof session.language === "string" ? session.language.trim() : null,
        attemptCount: Number.isFinite(session.attemptCount) ? session.attemptCount : 0,
        elapsedSeconds: Number.isFinite(session.elapsedSeconds)
            ? session.elapsedSeconds
            : 0,
        startTime: Number.isFinite(session.startTime) ? session.startTime : null,
        endTime: Number.isFinite(session.endTime) ? session.endTime : null,
        firstSeen: Number.isFinite(session.firstSeen) ? session.firstSeen : null,
        lastSeen: Number.isFinite(session.lastSeen) ? session.lastSeen : null,
        lastUpdated: Number.isFinite(session.lastUpdated) ? session.lastUpdated : null,
        schemaVersion: Number.isFinite(session.schemaVersion)
            ? session.schemaVersion
            : SESSION_SCHEMA_VERSION,
    };

    if (!normalized.status) {
        if (normalized.endTime) {
            if (normalized.verdict) {
                const verdict = String(normalized.verdict).trim().toLowerCase();
                normalized.status = ACCEPTED_VERDICTS.has(verdict)
                    ? SESSION_STATUS.COMPLETED
                    : SESSION_STATUS.ABANDONED;
            } else {
                normalized.status = SESSION_STATUS.ABANDONED;
            }
        } else if (normalized.elapsedSeconds > 0 || normalized.attemptCount > 0) {
            normalized.status = SESSION_STATUS.ACTIVE;
        } else {
            normalized.status = SESSION_STATUS.IDLE;
        }
    }

    if (!normalized.stopReason && TERMINAL_SESSION_STATUSES.includes(normalized.status)) {
        if (normalized.status === SESSION_STATUS.COMPLETED) {
            normalized.stopReason = SESSION_STOP_REASONS.ACCEPTED;
        } else {
            normalized.stopReason = SESSION_STOP_REASONS.UNKNOWN;
        }
    }

    return normalized;
}

function normalizeSessions(sessions) {
    return (Array.isArray(sessions) ? sessions : [])
        .map((session) => normalizeSession(session))
        .filter(Boolean);
}

export function buildUserDataPayload(sessions) {
    return {
        format: USER_DATA_EXPORT_FORMAT,
        version: USER_DATA_EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        sessions: normalizeSessions(sessions),
    };
}

export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function createCsvValue(value) {
    if (value === null || value === undefined) return "";
    const str = String(value);
    if (/[,"\n]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function secondsToIso(seconds) {
    if (!Number.isFinite(seconds)) return "";
    try {
        return new Date(seconds * 1000).toISOString();
    } catch (e) {
        return "";
    }
}

export function sessionsToCsv(sessions) {
    const columns = [
        "sessionId",
        "platform",
        "problemId",
        "difficulty",
        "status",
        "stopReason",
        "verdict",
        "language",
        "attemptCount",
        "elapsedSeconds",
        "startTime",
        "endTime",
        "firstSeen",
        "lastSeen",
        "lastUpdated",
        "problemKey",
        "schemaVersion",
    ];

    const timeColumns = new Set([
        "startTime",
        "endTime",
        "firstSeen",
        "lastSeen",
        "lastUpdated",
    ]);

    const rows = normalizeSessions(sessions).map((session) => {
        return columns
            .map((key) => {
                const value = session ? session[key] : "";
                if (timeColumns.has(key)) {
                    return createCsvValue(secondsToIso(value));
                }
                return createCsvValue(value);
            })
            .join(",");
    });

    return [columns.join(","), ...rows].join("\n");
}
