import { computeCoreMetrics } from "../../analytics/metricsCore.js";
import {
    computeDifficultyBuckets,
    computeHardestSolved,
    computePlatformStats,
} from "../../analytics/metricsBreakdown.js";
import { computeWeeklySeries } from "../../analytics/metricsTrends.js";
import { computeInsights } from "../../analytics/insights.js";
import {
    formatCompactDate,
    formatDateLabel,
    formatDuration,
} from "../../analytics/timeUtils.js";
import {
    getSessionDurationSeconds,
    getSessionEndSeconds,
    isSessionEnded,
    isSolvedSession,
} from "../../analytics/sessionSelectors.js";
import {
    buildUserDataPayload,
    downloadBlob,
    sessionsToCsv,
} from "../../analytics/exporters.js";

const $ = (id) => document.getElementById(id);

const state = {
    sessions: [],
    settings: {
        maxSessions: 5000,
    },
    weeklySeries: [],
    weeklyMode: "count",
    filters: {
        platform: "all",
        range: "all",
        status: "all",
    },
};

const PLATFORM_LABELS = {
    leetcode: "LeetCode",
    codeforces: "Codeforces",
    hackerrank: "HackerRank",
};

function formatPlatformName(platform) {
    const key = (platform || "").toLowerCase();
    return PLATFORM_LABELS[key] || (platform || "Unknown");
}

function formatDifficultyLabel(value) {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value === "number") return String(value);
    const str = String(value);
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function sendMessage(action, payload = {}) {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({ action, ...payload }, (resp) => {
                if (chrome.runtime.lastError) {
                    resolve({ success: false, message: chrome.runtime.lastError.message });
                    return;
                }
                resolve(resp || { success: false, message: "No response" });
            });
        } catch (e) {
            resolve({ success: false, message: e.message || String(e) });
        }
    });
}

function setBannerVisible(visible) {
    const banner = $("storageBanner");
    if (!banner) return;
    banner.classList.toggle("hidden", !visible);
}

function renderMetrics(core, hardest) {
    const solvedEl = $("metricSolved");
    if (solvedEl) solvedEl.textContent = core.totalSolved.toLocaleString();
    const solvedSubEl = $("metricSolvedSub");
    if (solvedSubEl) {
        solvedSubEl.textContent = `${core.uniqueProblems} unique · ${core.totalAttempted} attempted`;
    }

    const timeEl = $("metricTime");
    if (timeEl) {
        timeEl.textContent = formatDuration(core.totalTimeSeconds, {
            short: true,
        });
    }
    const avgTimeEl = $("metricAvgTime");
    if (avgTimeEl) {
        avgTimeEl.textContent = `Solved ${formatDuration(
            core.solvedTimeSeconds,
            { short: true },
        )} · Attempted ${formatDuration(core.attemptedTimeSeconds, { short: true })}`;
    }

    const streakEl = $("metricStreak");
    if (streakEl) streakEl.textContent = `${core.streakDays} days`;
    const lastActivity = core.lastActivitySeconds
        ? `Last solved ${formatCompactDate(core.lastActivitySeconds)}`
        : "No recent activity";
    const streakSubEl = $("metricStreakSub");
    if (streakSubEl) streakSubEl.textContent = lastActivity;

    const hardestEl = $("metricHardest");
    if (hardestEl) hardestEl.textContent = hardest.label || "—";
    const hardestSubEl = $("metricHardestSub");
    if (hardestSubEl) hardestSubEl.textContent = hardest.detail || "";
}

function getFilteredSessions() {
    let list = [...state.sessions];

    if (state.filters.platform !== "all") {
        const platform = state.filters.platform;
        list = list.filter(
            (session) => (session.platform || "").toLowerCase() === platform,
        );
    }

    list = list.filter((session) => isSessionEnded(session));

    if (state.filters.status === "solved") {
        list = list.filter((session) => isSolvedSession(session));
    } else if (state.filters.status === "attempted") {
        list = list.filter((session) => !isSolvedSession(session));
    }

    if (state.filters.range !== "all") {
        const days = Number(state.filters.range);
        if (Number.isFinite(days) && days > 0) {
            const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
            list = list.filter((session) => {
                const endSeconds = getSessionEndSeconds(session);
                return Number.isFinite(endSeconds) && endSeconds >= cutoff;
            });
        }
    }

    return list;
}

function renderWeeklyChart(series, mode) {
    const container = $("weeklyChart");
    if (!container) return;
    container.innerHTML = "";

    if (!series.length) {
        container.innerHTML =
            "<div class='metric-sub'>No data yet. Solve a problem to see trends.</div>";
        return;
    }

    const width = 640;
    const height = 220;
    const padding = 20;
    const values = series.map((item) =>
        mode === "time" ? item.timeSeconds / 3600 : item.count,
    );
    const maxValue = Math.max(...values, 1);

    if (values.every((value) => value === 0)) {
        container.innerHTML =
            "<div class='metric-sub'>No data yet. Solve a problem to see trends.</div>";
        return;
    }

    const points = values.map((value, index) => {
        const x =
            padding +
            (index / Math.max(1, values.length - 1)) * (width - padding * 2);
        const y =
            height -
            padding -
            (value / maxValue) * (height - padding * 2);
        return `${x},${y}`;
    });

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("class", "chart-svg");

    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "#38bdf8");
    line.setAttribute("stroke-width", "2");
    line.setAttribute("points", points.join(" "));
    svg.appendChild(line);

    points.forEach((point, index) => {
        const [x, y] = point.split(",");
        const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        dot.setAttribute("cx", x);
        dot.setAttribute("cy", y);
        dot.setAttribute("r", "3");
        dot.setAttribute("fill", "#22d3ee");
        const value = values[index];
        const weekLabel = series[index] ? series[index].label : "";
        const tooltip =
            mode === "time"
                ? `${weekLabel}: ${value.toFixed(1)}h`
                : `${weekLabel}: ${value} sessions`;
        const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
        title.textContent = tooltip;
        dot.appendChild(title);
        svg.appendChild(dot);
    });

    container.appendChild(svg);

    const labelRow = document.createElement("div");
    labelRow.style.display = "flex";
    labelRow.style.justifyContent = "space-between";
    labelRow.style.fontSize = "11px";
    labelRow.style.color = "rgba(255,255,255,0.5)";
    const first = series[0] ? series[0].label : "";
    const last = series[series.length - 1] ? series[series.length - 1].label : "";
    labelRow.innerHTML = `<span>${first}</span><span>${last}</span>`;
    container.appendChild(labelRow);
}

function renderDifficulty(buckets) {
    const chart = $("difficultyChart");
    const stats = $("difficultyStats");
    if (!chart || !stats) return;

    chart.innerHTML = "";
    stats.innerHTML = "";

    if (
        !buckets ||
        !buckets.buckets.length ||
        buckets.buckets.every((bucket) => bucket.count === 0)
    ) {
        chart.innerHTML = "<div class='metric-sub'>No difficulty data yet.</div>";
        return;
    }

    const maxCount = Math.max(...buckets.buckets.map((b) => b.count), 1);
    buckets.buckets.forEach((bucket) => {
        const row = document.createElement("div");
        row.className = "bar-row";
        row.title = `${formatDifficultyLabel(bucket.label)}: ${bucket.count} sessions · Avg ${formatDuration(
            bucket.avgSeconds,
            { short: true },
        )}`;
        row.innerHTML = `
            <span>${formatDifficultyLabel(bucket.label)}</span>
            <div class="bar-track"><div class="bar-fill" style="width: ${
                (bucket.count / maxCount) * 100
            }%"></div></div>
            <span>${bucket.count}</span>
        `;
        chart.appendChild(row);

        const stat = document.createElement("div");
        stat.textContent = `${formatDifficultyLabel(bucket.label)}: Avg ${formatDuration(
            bucket.avgSeconds,
            {
            short: true,
            },
        )}`;
        stats.appendChild(stat);
    });
}

function renderPlatforms(platformStats, totalSolved) {
    const container = $("platformGrid");
    if (!container) return;
    container.innerHTML = "";

    if (!platformStats.length) {
        container.innerHTML =
            "<div class='metric-sub'>No platform data yet.</div>";
        return;
    }

    platformStats.forEach((platform) => {
        const percent = totalSolved
            ? Math.round((platform.count / totalSolved) * 100)
            : 0;
        const card = document.createElement("div");
        card.className = "platform-card";
        const name = formatPlatformName(platform.platform);
        card.innerHTML = `
            <h4>${name}</h4>
            <p>${platform.count} solved · ${formatDuration(platform.timeSeconds, {
                short: true,
            })}</p>
            <p>${percent}% of solves</p>
        `;
        container.appendChild(card);
    });
}

function renderRecentSessions(sessions) {
    const tbody = $("recentTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    const rows = sessions
        .filter((session) => isSessionEnded(session))
        .map((session) => ({
            session,
            endSeconds: getSessionEndSeconds(session),
        }))
        .sort((a, b) => (b.endSeconds || 0) - (a.endSeconds || 0))
        .slice(0, 10);

    if (!rows.length) {
        const emptyRow = document.createElement("tr");
        emptyRow.innerHTML =
            "<td colspan='6' class='metric-sub'>No sessions yet.</td>";
        tbody.appendChild(emptyRow);
        return;
    }

    rows.forEach(({ session, endSeconds }) => {
        const row = document.createElement("tr");
        const duration = formatDuration(getSessionDurationSeconds(session), {
            short: true,
        });
        const difficulty = formatDifficultyLabel(session.difficulty);
        const statusLabel =
            session.status === "COMPLETED" ? "Solved" : session.status || "Solved";
        row.innerHTML = `
            <td>${formatDateLabel(endSeconds)}</td>
            <td>${formatPlatformName(session.platform)}</td>
            <td>${session.problemId || "—"}</td>
            <td>${difficulty}</td>
            <td>${duration}</td>
            <td><span class="pill">${statusLabel}</span></td>
        `;
        tbody.appendChild(row);
    });
}

function renderInsights(insights) {
    const container = $("insightsList");
    if (!container) return;
    container.innerHTML = "";

    insights.forEach((insight) => {
        const card = document.createElement("div");
        card.className = "insight-card";
        card.innerHTML = `
            <h5>${insight.title}</h5>
            <p>${insight.body}</p>
        `;
        container.appendChild(card);
    });
}

async function loadData() {
    const [sessionsResp, settings] = await Promise.all([
        sendMessage("getSessions"),
        new Promise((resolve) =>
            chrome.storage.local.get(["MAX_SESSIONS_STORED"], (items) =>
                resolve(items || {}),
            ),
        ),
    ]);

    const sessions = sessionsResp && sessionsResp.success ? sessionsResp.sessions : [];
    state.sessions = Array.isArray(sessions) ? sessions : [];
    state.settings.maxSessions =
        typeof settings.MAX_SESSIONS_STORED === "number"
            ? settings.MAX_SESSIONS_STORED
            : 5000;
}

function renderDashboard() {
    const filtered = getFilteredSessions();
    const core = computeCoreMetrics(filtered);
    const hardest = computeHardestSolved(filtered);
    const platforms = computePlatformStats(filtered);
    const difficulty = computeDifficultyBuckets(filtered);
    state.weeklySeries = computeWeeklySeries(filtered, 12);

    renderMetrics(core, hardest);
    renderWeeklyChart(state.weeklySeries, state.weeklyMode);
    renderDifficulty(difficulty);
    renderPlatforms(platforms, core.totalSolved);
    renderRecentSessions(filtered);
    renderInsights(computeInsights(filtered, core));

    const threshold = Math.floor(state.settings.maxSessions * 0.9);
    setBannerVisible(state.sessions.length >= threshold && threshold > 0);
}

async function exportData() {
    const format = $("exportFormat") ? $("exportFormat").value : "json";
    const sessions = state.sessions;
    const dateTag = new Date().toISOString().slice(0, 10);

    if (format === "csv") {
        const csv = sessionsToCsv(sessions);
        const blob = new Blob([csv], { type: "text/csv" });
        downloadBlob(blob, `codebridge-user-data-${dateTag}.csv`);
        return;
    }

    const payload = buildUserDataPayload(sessions);
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
    });
    downloadBlob(blob, `codebridge-user-data-${dateTag}.json`);
}

async function clearOldest() {
    const keepCount = Math.floor(state.settings.maxSessions * 0.8);
    if (state.sessions.length <= keepCount) {
        alert("Nothing to clear yet.");
        return;
    }
    if (!confirm(`Clear oldest sessions and keep the newest ${keepCount}?`)) {
        return;
    }
    try {
        const resp = await sendMessage("trimSessions", { keepCount });
        if (!resp || !resp.success) {
            alert(resp && resp.message ? resp.message : "Failed to trim sessions.");
            return;
        }
        await refresh();
    } catch (err) {
        alert(err && err.message ? err.message : "Failed to trim sessions.");
    }
}

async function clearAll() {
    if (!confirm("Clear all session data? This cannot be undone.")) return;
    try {
        const resp = await sendMessage("clearSessions");
        if (!resp || !resp.success) {
            alert(resp && resp.message ? resp.message : "Failed to clear sessions.");
            return;
        }
        await refresh();
    } catch (err) {
        alert(err && err.message ? err.message : "Failed to clear sessions.");
    }
}

async function refresh() {
    await loadData();
    renderDashboard();
}

function bindEvents() {
    const toggleButtons = document.querySelectorAll(".toggle-btn");
    toggleButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
            toggleButtons.forEach((node) => {
                node.classList.remove("is-active");
                node.setAttribute("aria-pressed", "false");
            });
            btn.classList.add("is-active");
            btn.setAttribute("aria-pressed", "true");
            state.weeklyMode = btn.dataset.mode || "count";
            renderWeeklyChart(state.weeklySeries, state.weeklyMode);
        });
    });

    $("exportBtn")?.addEventListener("click", exportData);
    $("clearOldBtn")?.addEventListener("click", clearOldest);
    $("clearAllBtn")?.addEventListener("click", clearAll);
    $("bannerClearOldBtn")?.addEventListener("click", clearOldest);

    $("filterPlatform")?.addEventListener("change", (event) => {
        state.filters.platform = event.target.value || "all";
        renderDashboard();
    });
    $("filterRange")?.addEventListener("change", (event) => {
        state.filters.range = event.target.value || "all";
        renderDashboard();
    });
    $("filterStatus")?.addEventListener("change", (event) => {
        state.filters.status = event.target.value || "all";
        renderDashboard();
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    bindEvents();
    await refresh();
});
