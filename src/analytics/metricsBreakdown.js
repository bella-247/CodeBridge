// analytics/metricsBreakdown.js — Difficulty/platform breakdowns

import {
    getSessionDurationSeconds,
    isSessionEnded,
    isSolvedSession,
} from "./sessionSelectors.js";

const DIFF_LABELS = ["easy", "medium", "hard", "beginner", "advanced"];

function normalizeDifficultyValue(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return { type: "rating", value };
    }
    if (typeof value === "string") {
        const lower = value.trim().toLowerCase();
        if (DIFF_LABELS.includes(lower)) {
            return { type: "label", value: lower };
        }
        const numberMatch = lower.match(/(\d{2,5})/);
        if (numberMatch) {
            const numeric = Number(numberMatch[1]);
            if (Number.isFinite(numeric)) {
                return { type: "rating", value: numeric };
            }
        }
    }
    return { type: "unknown", value: null };
}

export function computePlatformStats(sessions) {
    const ended = sessions.filter((session) => isSessionEnded(session));
    const stats = {};

    ended.forEach((session) => {
        const key = session.platform || "unknown";
        if (!stats[key]) {
            stats[key] = { platform: key, count: 0, timeSeconds: 0 };
        }
        stats[key].count += 1;
        stats[key].timeSeconds += getSessionDurationSeconds(session);
    });

    return Object.values(stats).sort((a, b) => b.count - a.count);
}

export function computeDifficultyBuckets(sessions) {
    const ended = sessions.filter((session) => isSessionEnded(session));
    const normalized = ended.map((session) => ({
        session,
        diff: normalizeDifficultyValue(session.difficulty),
    }));

    const ratingSessions = normalized.filter((item) => item.diff.type === "rating");
    const labelSessions = normalized.filter((item) => item.diff.type === "label");
    const unknownSessions = normalized.filter((item) => item.diff.type === "unknown");

    if (ratingSessions.length === 0 && labelSessions.length === 0) {
        return {
            mode: "label",
            buckets: DIFF_LABELS.map((label) => ({
                label,
                count: 0,
                timeSeconds: 0,
                avgSeconds: 0,
            })),
        };
    }

    if (ratingSessions.length === labelSessions.length && ratingSessions.length > 0) {
        return buildRatingBuckets(ratingSessions, unknownSessions);
    }

    if (ratingSessions.length > labelSessions.length) {
        return buildRatingBuckets(ratingSessions, unknownSessions);
    }

    return buildLabelBuckets(normalized);
}

function buildRatingBuckets(items, unknownItems = []) {
    const buckets = new Map();
    items.forEach(({ session, diff }) => {
        const rating = diff.value;
        if (!Number.isFinite(rating)) return;
        const bucketStart = Math.floor(rating / 200) * 200;
        const label = `${bucketStart}-${bucketStart + 199}`;
        if (!buckets.has(label)) {
            buckets.set(label, { label, count: 0, timeSeconds: 0 });
        }
        const entry = buckets.get(label);
        entry.count += 1;
        entry.timeSeconds += getSessionDurationSeconds(session);
    });

    if (unknownItems.length) {
        const unknown = { label: "unknown", count: 0, timeSeconds: 0 };
        unknownItems.forEach(({ session }) => {
            unknown.count += 1;
            unknown.timeSeconds += getSessionDurationSeconds(session);
        });
        buckets.set("unknown", unknown);
    }

    const list = Array.from(buckets.values()).sort((a, b) => {
        const aStart = parseInt(a.label.split("-")[0], 10);
        const bStart = parseInt(b.label.split("-")[0], 10);
        if (Number.isNaN(aStart)) return 1;
        if (Number.isNaN(bStart)) return -1;
        return aStart - bStart;
    });

    return {
        mode: "rating",
        buckets: list.map((bucket) => ({
            ...bucket,
            avgSeconds: bucket.count ? bucket.timeSeconds / bucket.count : 0,
        })),
    };
}

function buildLabelBuckets(items) {
    const buckets = new Map();
    DIFF_LABELS.forEach((label) => {
        buckets.set(label, { label, count: 0, timeSeconds: 0 });
    });
    buckets.set("unknown", { label: "unknown", count: 0, timeSeconds: 0 });

    items.forEach(({ session, diff }) => {
        let key = "unknown";
        if (diff.type === "label") {
            key = diff.value;
        }
        if (!buckets.has(key)) {
            buckets.set(key, { label: key, count: 0, timeSeconds: 0 });
        }
        const entry = buckets.get(key);
        entry.count += 1;
        entry.timeSeconds += getSessionDurationSeconds(session);
    });

    const list = Array.from(buckets.values());
    return {
        mode: "label",
        buckets: list.map((bucket) => ({
            ...bucket,
            avgSeconds: bucket.count ? bucket.timeSeconds / bucket.count : 0,
        })),
    };
}

export function computeHardestSolved(sessions) {
    const solved = sessions.filter(
        (session) => isSolvedSession(session) && isSessionEnded(session),
    );
    if (!solved.length) return { label: "—", detail: "" };

    let bestRating = null;
    let bestLabel = null;
    solved.forEach((session) => {
        const diff = normalizeDifficultyValue(session.difficulty);
        if (diff.type === "rating") {
            if (!bestRating || bestRating.score < diff.value) {
                bestRating = {
                    score: diff.value,
                    label: `${session.platform || "Platform"} ${diff.value}`,
                    detail: `Problem ${session.problemId || "unknown"}`,
                };
            }
        } else if (diff.type === "label") {
            const scoreMap = { beginner: 0.5, easy: 1, medium: 2, hard: 3, advanced: 4 };
            const score = scoreMap[diff.value] || 0;
            if (!bestLabel || bestLabel.score < score) {
                const label = diff.value.charAt(0).toUpperCase() + diff.value.slice(1);
                bestLabel = {
                    score,
                    label: `${session.platform || "Platform"} ${label}`,
                    detail: `Problem ${session.problemId || "unknown"}`,
                };
            }
        }
    });

    const best = bestRating || bestLabel;
    if (!best) return { label: "—", detail: "" };
    return { label: best.label, detail: best.detail };
}
