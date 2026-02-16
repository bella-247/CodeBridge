// analytics/timeUtils.js — Date and time helpers

export function formatDuration(seconds, { short = false } = {}) {
    const total = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = Math.floor(total % 60);

    if (short) {
        if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
        if (minutes > 0) return `${minutes}m`;
        return `${secs}s`;
    }

    if (hours > 0) {
        return `${hours}h ${String(minutes).padStart(2, "0")}m`;
    }
    if (minutes > 0) {
        return `${minutes}m ${String(secs).padStart(2, "0")}s`;
    }
    return `${secs}s`;
}

export function formatDateLabel(seconds) {
    if (!Number.isFinite(seconds)) return "—";
    const date = new Date(seconds * 1000);
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
    }).format(date);
}

export function formatCompactDate(seconds) {
    if (!Number.isFinite(seconds)) return "—";
    const date = new Date(seconds * 1000);
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
    }).format(date);
}

export function toDateKey(seconds) {
    if (!Number.isFinite(seconds)) return "";
    const date = new Date(seconds * 1000);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export function getWeekStart(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return new Date(0);
    }
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    return d;
}

export function getWeekKeyFromSeconds(seconds) {
    if (!Number.isFinite(seconds)) return "";
    const date = new Date(seconds * 1000);
    const weekStart = getWeekStart(date);
    return toDateKey(weekStart.getTime() / 1000);
}

export function formatWeekLabel(weekKey) {
    if (!weekKey) return "";
    const [year, month, day] = weekKey.split("-").map(Number);
    if (!year || !month || !day) return weekKey;
    const date = new Date(year, month - 1, day);
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
    }).format(date);
}
