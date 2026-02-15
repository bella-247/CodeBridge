// background/session/sessionManager.js — Core session lifecycle (per-solve)

import {
    SESSION_SCHEMA_VERSION,
    SESSION_STATUS,
    SESSION_STOP_REASONS,
} from "../../shared/sessionSchema.js";
import {
    buildProblemKey,
    generateSessionId,
    getSortTimestamp,
    inferStatus,
    isAcceptedVerdict,
    isActiveStatus,
    mapStopReasonToStatus,
} from "./sessionUtils.js";
import {
    getAllSessions as getAllSessionsFromStore,
    getSessionsByProblem,
    saveSession,
    clearAllSessions as clearSessionsStore,
} from "./sessionStore.js";
import {
    nowSeconds,
    startTimer,
    stopTimer,
    pauseTimer,
    resumeTimer,
    resetTimer,
} from "./timerEngine.js";

let writeLock = Promise.resolve();

function withLock(action) {
    const run = async () => action();
    const next = writeLock.then(run, run);
    writeLock = next.catch(() => {});
    return next;
}

function normalizeDifficulty(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) return value.trim();
    return null;
}

function sortByLatest(a, b) {
    return getSortTimestamp(b) - getSortTimestamp(a);
}

function createSession({
    platform,
    problemId,
    difficulty = null,
    createdAt = null,
}) {
    const now = createdAt || nowSeconds();
    const normalizedDifficulty = normalizeDifficulty(difficulty);
    return {
        sessionId: generateSessionId(),
        platform,
        problemId,
        problemKey: buildProblemKey(platform, problemId),
        difficulty: normalizedDifficulty,
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
        status: SESSION_STATUS.IDLE,
        stopReason: null,
        schemaVersion: SESSION_SCHEMA_VERSION,
    };
}

async function getActiveSessionForProblem(platform, problemId) {
    const sessions = await getSessionsByProblem(platform, problemId);
    if (!sessions.length) return null;
    const active = sessions.filter((s) => isActiveStatus(inferStatus(s)));
    if (!active.length) return null;
    active.sort(sortByLatest);
    return active[0];
}

async function getLatestSessionForProblem(platform, problemId) {
    const sessions = await getSessionsByProblem(platform, problemId);
    if (!sessions.length) return null;
    sessions.sort(sortByLatest);
    return sessions[0];
}

function normalizeStopReason(reason) {
    if (!reason) return null;
    const r = String(reason).toLowerCase();
    if (r === SESSION_STOP_REASONS.MANUAL) return SESSION_STOP_REASONS.MANUAL;
    if (r === SESSION_STOP_REASONS.TIMEOUT) return SESSION_STOP_REASONS.TIMEOUT;
    if (r === SESSION_STOP_REASONS.PROBLEM_SWITCH)
        return SESSION_STOP_REASONS.PROBLEM_SWITCH;
    if (r === SESSION_STOP_REASONS.ACCEPTED)
        return SESSION_STOP_REASONS.ACCEPTED;
    if (r === SESSION_STOP_REASONS.RESET) return SESSION_STOP_REASONS.RESET;
    return SESSION_STOP_REASONS.UNKNOWN;
}

export { isAcceptedVerdict };

export async function touchSession({ platform, problemId, difficulty = null }) {
    return withLock(async () => {
        let session = await getLatestSessionForProblem(platform, problemId);
        if (!session) return null;
        const now = nowSeconds();
        session.lastSeen = now;
        session.lastUpdated = now;
        const normalizedDifficulty = normalizeDifficulty(difficulty);
        if (normalizedDifficulty !== null) {
            session.difficulty = normalizedDifficulty;
        }
        session = await saveSession(session);
        return session;
    });
}

export async function startSessionTimer({
    platform,
    problemId,
    startedAt = null,
    difficulty = null,
}) {
    return withLock(async () => {
        const now = startedAt || nowSeconds();
        let session = await getActiveSessionForProblem(platform, problemId);

        if (
            !session ||
            session.endTime ||
            !isActiveStatus(inferStatus(session))
        ) {
            session = createSession({
                platform,
                problemId,
                difficulty,
                createdAt: now,
            });
        }

        const normalizedDifficulty = normalizeDifficulty(difficulty);
        if (normalizedDifficulty !== null)
            session.difficulty = normalizedDifficulty;

        startTimer(session, now);
        session.status = SESSION_STATUS.ACTIVE;
        session.stopReason = null;
        session.lastSeen = now;
        session.lastUpdated = now;

        session = await saveSession(session);
        return session;
    });
}

export async function stopSessionTimer({
    platform,
    problemId,
    stoppedAt = null,
    reason = null,
}) {
    return withLock(async () => {
        let session = await getActiveSessionForProblem(platform, problemId);
        if (!session) return null;

        const ts = stoppedAt || nowSeconds();
        stopTimer(session, ts);
        const normalizedReason = normalizeStopReason(reason);
        session.stopReason = normalizedReason || session.stopReason;
        session.status = mapStopReasonToStatus(normalizedReason, false);
        session.lastUpdated = ts;

        session = await saveSession(session);
        return session;
    });
}

export async function pauseSessionTimer({
    platform,
    problemId,
    pausedAt = null,
}) {
    return withLock(async () => {
        let session = await getActiveSessionForProblem(platform, problemId);
        if (!session) return null;

        const effectiveTime = pausedAt || nowSeconds();
        pauseTimer(session, effectiveTime);
        session.status = SESSION_STATUS.PAUSED;
        session.lastUpdated = effectiveTime;
        session = await saveSession(session);
        return session;
    });
}

export async function resumeSessionTimer({
    platform,
    problemId,
    resumedAt = null,
}) {
    return withLock(async () => {
        let session = await getActiveSessionForProblem(platform, problemId);
        if (!session) return null;

        const effectiveTime = resumedAt || nowSeconds();
        resumeTimer(session, effectiveTime);
        session.status = SESSION_STATUS.ACTIVE;
        session.stopReason = null;
        session.lastUpdated = effectiveTime;
        session = await saveSession(session);
        return session;
    });
}

export async function resetSessionTimer({ platform, problemId }) {
    return withLock(async () => {
        let session = await getActiveSessionForProblem(platform, problemId);
        if (!session) return null;

        resetTimer(session);
        session.status = SESSION_STATUS.IDLE;
        session.stopReason = SESSION_STOP_REASONS.RESET;
        session.lastUpdated = nowSeconds();
        session = await saveSession(session);
        return session;
    });
}

export async function recordSubmission({
    platform,
    problemId,
    verdict,
    language,
    submissionId = null,
    submittedAt = null,
    isSuccess = null,
    autoStop = true,
    difficulty = null,
}) {
    return withLock(async () => {
        const now = submittedAt || nowSeconds();
        const success =
            typeof isSuccess === "boolean"
                ? isSuccess
                : isAcceptedVerdict(verdict);

        let session = await getActiveSessionForProblem(platform, problemId);

        if (
            !session ||
            session.endTime ||
            !isActiveStatus(inferStatus(session))
        ) {
            if (!success) {
                return null;
            }
            session = createSession({
                platform,
                problemId,
                difficulty,
                createdAt: now,
            });
        }

        if (submissionId && session.lastSubmissionId === submissionId) {
            return session;
        }

        if (submissionId) session.lastSubmissionId = submissionId;
        session.attemptCount = (session.attemptCount || 0) + 1;
        if (verdict) session.verdict = verdict;
        if (language) session.language = language;
        if (difficulty !== null && difficulty !== undefined) {
            const normalizedDifficulty = normalizeDifficulty(difficulty);
            if (normalizedDifficulty !== null)
                session.difficulty = normalizedDifficulty;
        }
        session.lastSeen = now;
        session.lastUpdated = now;

        const shouldStop = success && (autoStop || !session.startTime);
        if (shouldStop) {
            const elapsed = Number.isFinite(session.elapsedSeconds)
                ? session.elapsedSeconds
                : 0;
            if (!session.startTime && elapsed === 0) {
                session.startTime = session.firstSeen || now;
            }
            stopTimer(session, now);
            session.status = SESSION_STATUS.COMPLETED;
            session.stopReason = SESSION_STOP_REASONS.ACCEPTED;
        }

        session = await saveSession(session);
        return session;
    });
}

export async function getSessionByKey(platform, problemId) {
    const active = await getActiveSessionForProblem(platform, problemId);
    if (active) return active;
    return getLatestSessionForProblem(platform, problemId);
}

export async function getAllSessions() {
    return getAllSessionsFromStore();
}

export async function clearAllSessions() {
    return withLock(async () => {
        await clearSessionsStore();
        return [];
    });
}
