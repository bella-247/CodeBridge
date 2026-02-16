// analytics/insights.js — Small insight generator

import {
    getSessionDurationSeconds,
    getSessionEndSeconds,
    isSessionEnded,
    isSolvedSession,
} from "./sessionSelectors.js";

function daysBetween(dateA, dateB) {
    const ms = Math.abs(dateA.getTime() - dateB.getTime());
    return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export function computeInsights(sessions, coreMetrics) {
    const ended = sessions.filter((session) => isSessionEnded(session));
    const solved = ended.filter((session) => isSolvedSession(session));
    if (!ended.length) {
        return [
            {
                title: "Start your first session",
                body: "Solve a problem to unlock insights and trends.",
                tone: "info",
            },
        ];
    }

    const insights = [];
    const durations = ended.map(getSessionDurationSeconds).filter((s) => s > 0);
    const avg = durations.reduce((acc, v) => acc + v, 0) / Math.max(1, durations.length);

    const recent = ended.slice(-20);
    const previous = ended.slice(-40, -20);
    if (recent.length >= 5 && previous.length >= 5) {
        const recentDurations = recent
            .map(getSessionDurationSeconds)
            .filter((s) => s > 0);
        const previousDurations = previous
            .map(getSessionDurationSeconds)
            .filter((s) => s > 0);
        const recentAvg = recentDurations.length
            ? recentDurations.reduce((a, v) => a + v, 0) / recentDurations.length
            : 0;
        const prevAvg = previousDurations.length
            ? previousDurations.reduce((a, v) => a + v, 0) / previousDurations.length
            : 0;
        const delta = prevAvg - recentAvg;
        if (delta > avg * 0.1) {
            insights.push({
                title: "Faster solves",
                body: "Your recent solves are noticeably faster than your earlier ones.",
                tone: "positive",
            });
        } else if (delta < -avg * 0.1) {
            insights.push({
                title: "Slower recently",
                body: "Your recent solves are taking longer than your earlier ones.",
                tone: "warning",
            });
        }
    }

    if (coreMetrics && coreMetrics.streakDays >= 7) {
        insights.push({
            title: `${coreMetrics.streakDays}-day streak`,
            body: "Consistency is showing up. Keep the streak alive.",
            tone: "positive",
        });
    }

    const last = ended
        .map(getSessionEndSeconds)
        .filter((s) => Number.isFinite(s))
        .sort((a, b) => b - a)[0];
    if (Number.isFinite(last)) {
        const days = daysBetween(new Date(), new Date(last * 1000));
        if (days >= 3) {
            insights.push({
                title: "Time to get back in",
                body: `It's been ${days} days since your last solve.`,
                tone: "warning",
            });
        }
    }

    return insights.length
        ? insights
        : [
              {
                  title: "Keep it up",
                  body: "You are building steady momentum with your solves.",
                  tone: "info",
              },
          ];
}
