// background/session/sessionManager.js — Core session lifecycle

import { loadSessions, saveSessions } from "./storageManager.js";
import {
    nowSeconds,
    startTimer,
    stopTimer,
    pauseTimer,
    resumeTimer,
    resetTimer,
} from "./timerEngine.js";

function normalizeDifficulty(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) return value.trim();
    return null;
}

function findSessionIndex(sessions, platform, problemId) {
    return sessions.findIndex(
        (s) => s && s.platform === platform && s.problemId === problemId,
    );
}

export function isAcceptedVerdict(verdict) {
    if (!verdict) return false;
    const v = String(verdict).trim().toLowerCase();
    return v === "accepted" || v === "ok" || v === "ac" || v === "passed";
}

export async function upsertSession({
    platform,
    problemId,
    difficulty = null,
}) {
    const sessions = await loadSessions();
    const idx = findSessionIndex(sessions, platform, problemId);
    const now = nowSeconds();

    if (idx === -1) {
        const session = {
            platform,
            problemId,
            difficulty: normalizeDifficulty(difficulty),
            startTime: null,
            endTime: null,
            verdict: null,
            language: null,
            attemptCount: 0,
            elapsedSeconds: 0,
            isPaused: false,
            pausedAt: null,
            firstSeen: now,
            lastSeen: now,
            lastUpdated: now,
        };
        sessions.push(session);
        await saveSessions(sessions);
        return session;
    }

    const session = sessions[idx];
    session.lastSeen = now;
    session.lastUpdated = now;
    const normalizedDifficulty = normalizeDifficulty(difficulty);
    if (normalizedDifficulty !== null) session.difficulty = normalizedDifficulty;

    await saveSessions(sessions);
    return session;
}

export async function startSessionTimer({ platform, problemId, startedAt = null }) {
    const sessions = await loadSessions();
    const idx = findSessionIndex(sessions, platform, problemId);
    const now = startedAt || nowSeconds();

    let session = null;
    if (idx === -1) {
        session = {
            platform,
            problemId,
            difficulty: null,
            startTime: now,
            endTime: null,
            verdict: null,
            language: null,
            attemptCount: 0,
            elapsedSeconds: 0,
            isPaused: false,
            pausedAt: null,
            firstSeen: now,
            lastSeen: now,
            lastUpdated: now,
        };
        sessions.push(session);
    } else {
        session = sessions[idx];
        startTimer(session, now);
        session.lastUpdated = now;
    }

    await saveSessions(sessions);
    return session;
}

export async function stopSessionTimer({ platform, problemId, stoppedAt = null }) {
    const sessions = await loadSessions();
    const idx = findSessionIndex(sessions, platform, problemId);
    if (idx === -1) return null;

    const session = sessions[idx];
    stopTimer(session, stoppedAt || nowSeconds());
    session.lastUpdated = nowSeconds();
    await saveSessions(sessions);
    return session;
}

export async function pauseSessionTimer({ platform, problemId, pausedAt = null }) {
    const sessions = await loadSessions();
    const idx = findSessionIndex(sessions, platform, problemId);
    if (idx === -1) return null;

    const session = sessions[idx];
    pauseTimer(session, pausedAt || nowSeconds());
    session.lastUpdated = nowSeconds();
    await saveSessions(sessions);
    return session;
}

export async function resumeSessionTimer({ platform, problemId, resumedAt = null }) {
    const sessions = await loadSessions();
    const idx = findSessionIndex(sessions, platform, problemId);
    if (idx === -1) return null;

    const session = sessions[idx];
    resumeTimer(session, resumedAt || nowSeconds());
    session.lastUpdated = nowSeconds();
    await saveSessions(sessions);
    return session;
}

export async function resetSessionTimer({ platform, problemId }) {
    const sessions = await loadSessions();
    const idx = findSessionIndex(sessions, platform, problemId);
    if (idx === -1) return null;

    const session = sessions[idx];
    resetTimer(session);
    session.lastUpdated = nowSeconds();
    await saveSessions(sessions);
    return session;
}

export async function recordSubmission({
    platform,
    problemId,
    verdict,
    language,
    submissionId = null,
    submittedAt = null,
}) {
    const sessions = await loadSessions();
    const idx = findSessionIndex(sessions, platform, problemId);
    const now = submittedAt || nowSeconds();

    let session = null;
    if (idx === -1) {
        session = {
            platform,
            problemId,
            difficulty: null,
            startTime: null,
            endTime: null,
            verdict: null,
            language: null,
            attemptCount: 0,
            elapsedSeconds: 0,
            isPaused: false,
            pausedAt: null,
            firstSeen: now,
            lastSeen: now,
            lastUpdated: now,
            lastSubmissionId: null,
        };
        sessions.push(session);
    } else {
        session = sessions[idx];
    }

    if (submissionId && session.lastSubmissionId === submissionId) {
        return session;
    }

    if (submissionId) session.lastSubmissionId = submissionId;
    session.attemptCount = (session.attemptCount || 0) + 1;
    if (verdict) session.verdict = verdict;
    if (language) session.language = language;
    session.lastSeen = now;
    session.lastUpdated = now;

    if (isAcceptedVerdict(verdict)) {
        const elapsed = Number.isFinite(session.elapsedSeconds)
            ? session.elapsedSeconds
            : 0;
        if (!session.startTime && elapsed === 0) {
            session.startTime = session.firstSeen || now;
        }
        stopTimer(session, now);
    }

    await saveSessions(sessions);
    return session;
}

export async function getSessionByKey(platform, problemId) {
    const sessions = await loadSessions();
    const idx = findSessionIndex(sessions, platform, problemId);
    return idx === -1 ? null : sessions[idx];
}

export async function getAllSessions() {
    return loadSessions();
}

export async function clearAllSessions() {
    await saveSessions([]);
    return [];
}
