// analytics/metricsTrends.js — Trend metrics (weekly series)

import {
    getSessionDurationSeconds,
    getSessionEndSeconds,
    isSessionEnded,
} from "./sessionSelectors.js";
import { formatWeekLabel, getWeekKeyFromSeconds, getWeekStart } from "./timeUtils.js";

export function computeWeeklySeries(sessions, weeks = 12) {
    const ended = sessions.filter((session) => isSessionEnded(session));
    const map = new Map();

    ended.forEach((session) => {
        const endSeconds = getSessionEndSeconds(session);
        if (!Number.isFinite(endSeconds)) return;
        const key = getWeekKeyFromSeconds(endSeconds);
        if (!key) return;
        if (!map.has(key)) {
            map.set(key, { weekKey: key, count: 0, timeSeconds: 0 });
        }
        const entry = map.get(key);
        entry.count += 1;
        const dur = getSessionDurationSeconds(session);
        if (Number.isFinite(dur)) {
            entry.timeSeconds += dur;
        }
    });

    const now = new Date();
    const currentWeekStart = getWeekStart(now);
    const series = [];
    for (let i = weeks - 1; i >= 0; i -= 1) {
        const weekStart = new Date(currentWeekStart);
        weekStart.setDate(weekStart.getDate() - i * 7);
        const key = getWeekKeyFromSeconds(weekStart.getTime() / 1000);
        const entry = map.get(key) || { weekKey: key, count: 0, timeSeconds: 0 };
        series.push({
            ...entry,
            label: formatWeekLabel(entry.weekKey),
        });
    }

    return series;
}
