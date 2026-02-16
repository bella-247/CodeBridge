// analytics/metricsCore.js — Core dashboard metrics

import {
    getProblemKey,
    getSessionDurationSeconds,
    getSessionEndSeconds,
    isSessionEnded,
    isSolvedSession,
} from "./sessionSelectors.js";
import { toDateKey } from "./timeUtils.js";

function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
}

export function computeCoreMetrics(sessions) {
    const ended = sessions.filter((session) => isSessionEnded(session));
    const solved = sessions.filter(
        (session) => isSolvedSession(session) && isSessionEnded(session),
    );
    const attempted = ended.filter((session) => !isSolvedSession(session));

    const solvedDurations = solved.map(getSessionDurationSeconds).filter((s) => s > 0);
    const attemptedDurations = attempted
        .map(getSessionDurationSeconds)
        .filter((s) => s > 0);

    const totalSolved = solved.length;
    const totalAttempted = attempted.length;

    const uniqueProblems = new Set(ended.map(getProblemKey)).size;
    const solvedTimeSeconds = solvedDurations.reduce((acc, value) => acc + value, 0);
    const attemptedTimeSeconds = attemptedDurations.reduce(
        (acc, value) => acc + value,
        0,
    );
    const totalTimeSeconds = solvedTimeSeconds + attemptedTimeSeconds;

    const avgTimeSeconds =
        solvedDurations.length > 0
            ? solvedTimeSeconds / solvedDurations.length
            : 0;
    const medianTimeSeconds = median(solvedDurations);
    const avgAttempts =
        totalSolved > 0
            ? solved.reduce((acc, session) => acc + (session.attemptCount || 0), 0) /
              totalSolved
            : 0;
    const completionRate =
        ended.length > 0 ? (solved.length / ended.length) * 100 : 0;

    const lastActivitySeconds =
        ended
        .map(getSessionEndSeconds)
        .filter((s) => Number.isFinite(s))
        .sort((a, b) => b - a)[0] || 0;

    return {
        totalSolved,
        totalAttempted,
        uniqueProblems,
        totalTimeSeconds,
        solvedTimeSeconds,
        attemptedTimeSeconds,
        avgTimeSeconds,
        medianTimeSeconds,
        avgAttempts,
        completionRate,
        lastActivitySeconds,
        streakDays: computeStreakDays(solved),
    };
}

export function computeStreakDays(sessions) {
    if (!sessions.length) return 0;
    const days = new Set(
        sessions
            .map((session) => toDateKey(getSessionEndSeconds(session)))
            .filter(Boolean),
    );

    if (!days.size) return 0;

    let streak = 0;
    const today = new Date();
    for (;;) {
        const key = toDateKey(today.getTime() / 1000);
        if (!days.has(key)) break;
        streak += 1;
        today.setDate(today.getDate() - 1);
    }
    return streak;
}
