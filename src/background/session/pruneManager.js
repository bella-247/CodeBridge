// background/session/pruneManager.js — Session pruning policy

import { getSessionSettings } from "./storageManager.js";
import { nowSeconds } from "./timerEngine.js";
import { deleteSessionsByIds, getAllSessions } from "./sessionStore.js";
import { getSortTimestamp, inferStatus, isActiveStatus } from "./sessionUtils.js";
import { TERMINAL_SESSION_STATUSES } from "../../shared/sessionSchema.js";

export async function pruneSessions() {
    const settings = await getSessionSettings();
    const sessions = await getAllSessions();

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

    const active = sessions.filter((s) => s && isActiveStatus(inferStatus(s)));
    const completed = sessions.filter(
        (s) => s && TERMINAL_SESSION_STATUSES.includes(inferStatus(s)),
    );

    const recentCompleted = completed.filter((s) => {
        const ts = getSortTimestamp(s);
        return ts >= cutoff;
    });

    const allowedCompletedCount = Math.max(
        0,
        maxSessions - active.length,
    );

    recentCompleted.sort((a, b) => getSortTimestamp(b) - getSortTimestamp(a));

    const trimmedCompleted = recentCompleted.slice(0, allowedCompletedCount);
    const keepIds = new Set(
        [...active, ...trimmedCompleted].map((session) => session.sessionId),
    );

    const removedIds = sessions
        .filter((session) => session && !keepIds.has(session.sessionId))
        .map((session) => session.sessionId);

    if (removedIds.length) {
        await deleteSessionsByIds(removedIds);
    }

    return { removed: removedIds.length, kept: keepIds.size };
}
