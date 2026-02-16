// background/session/pruneManager.js — Session pruning policy

import { getSessionSettings, loadSessions, saveSessions } from "./storageManager.js";
import { nowSeconds } from "./timerEngine.js";

export async function pruneSessions() {
    const settings = await getSessionSettings();
    const sessions = await loadSessions();

    if (!sessions.length) {
        return { removed: 0, kept: 0 };
    }

    const pruneDays =
        typeof settings.SESSION_PRUNE_DAYS === "number" && settings.SESSION_PRUNE_DAYS > 0
            ? settings.SESSION_PRUNE_DAYS
            : 90;
    const maxSessions =
        typeof settings.MAX_SESSIONS_STORED === "number" && settings.MAX_SESSIONS_STORED > 0
            ? settings.MAX_SESSIONS_STORED
            : 1000;

    const cutoff = nowSeconds() - pruneDays * 86400;

    const active = sessions.filter((s) => s && !s.endTime);
    const completed = sessions.filter((s) => s && s.endTime);

    const recentCompleted = completed.filter((s) => {
        const ts = s.endTime || s.startTime || s.lastUpdated || 0;
        return ts >= cutoff;
    });

    const allowedCompletedCount = Math.max(
        0,
        maxSessions - active.length,
    );

    recentCompleted.sort((a, b) => {
        const ta = a.endTime || a.startTime || a.lastUpdated || 0;
        const tb = b.endTime || b.startTime || b.lastUpdated || 0;
        return tb - ta;
    });

    const trimmedCompleted = recentCompleted.slice(0, allowedCompletedCount);
    const nextSessions = [...active, ...trimmedCompleted];

    const removed = sessions.length - nextSessions.length;
    if (removed > 0) {
        await saveSessions(nextSessions);
    }

    return { removed, kept: nextSessions.length };
}
