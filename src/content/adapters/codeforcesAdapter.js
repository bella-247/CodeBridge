// content/adapters/codeforcesAdapter.js — Session tracking for Codeforces

import { createAdapter, parseDifficultyNumber, normalizeVerdict } from "./baseAdapter.js";

function extractSlugFromUrl(url) {
    try {
        const urlObj = new URL(url, location.origin);
        const path = urlObj.pathname;

        const contestMatch = path.match(/\/(contest|gym)\/(\d+)\/problem\/([A-Z0-9]+)/i);
        if (contestMatch) {
            return `${contestMatch[2]}${contestMatch[3]}`;
        }

        const problemsetMatch = path.match(/\/problemset\/problem\/(\d+)\/([A-Z0-9]+)/i);
        if (problemsetMatch) {
            return `${problemsetMatch[1]}${problemsetMatch[2]}`;
        }
    } catch (e) {
        // ignore
    }
    return null;
}

function findProblemLinkFromTable() {
    try {
        const tables = Array.from(document.querySelectorAll(".datatable, table"));
        for (const table of tables) {
            const rows = Array.from(table.querySelectorAll("tr"));
            if (!rows.length) continue;

            let headerCells = Array.from(rows[0].querySelectorAll("th, td"));
            let problemIdx = headerCells.findIndex((cell) =>
                /problem/i.test(cell.textContent || ""),
            );

            const headRow = table.querySelector("thead tr");
            if (problemIdx === -1 && headRow) {
                headerCells = Array.from(headRow.querySelectorAll("th, td"));
                problemIdx = headerCells.findIndex((cell) =>
                    /problem/i.test(cell.textContent || ""),
                );
            }

            if (problemIdx !== -1) {
                const bodyRows = rows.slice(1);
                for (const row of bodyRows) {
                    const cells = Array.from(row.querySelectorAll("td, th"));
                    if (cells.length <= problemIdx) continue;
                    const cell = cells[problemIdx];
                    const link =
                        cell.querySelector('a[href*="/problemset/problem/"]') ||
                        cell.querySelector('a[href*="/contest/"][href*="/problem/"]') ||
                        cell.querySelector('a[href*="/gym/"][href*="/problem/"]') ||
                        cell.querySelector('a[href*="/problem/"]');
                    if (link && link.getAttribute("href")) {
                        return new URL(link.getAttribute("href"), location.origin).href;
                    }
                }
            }
        }
    } catch (e) {
        // ignore
    }
    return null;
}

function findProblemLinkFallback() {
    const link =
        document.querySelector('a[href*="/problemset/problem/"]') ||
        document.querySelector('a[href*="/contest/"][href*="/problem/"]') ||
        document.querySelector('a[href*="/gym/"][href*="/problem/"]') ||
        document.querySelector('a[href*="/problem/"]');
    if (link && link.getAttribute("href")) {
        return new URL(link.getAttribute("href"), location.origin).href;
    }
    return null;
}

function extractSubmissionData() {
    try {
        let verdict = null;
        let language = null;

        const rows = Array.from(document.querySelectorAll(".datatable table tr, table tr"));
        for (const row of rows) {
            const cells = Array.from(row.querySelectorAll("td, th"));
            if (cells.length < 2) continue;
            const label = (cells[0].textContent || "").trim().toLowerCase();
            const value = (cells[1].textContent || "").trim();

            if (!verdict && (label.includes("verdict") || label.includes("result") || label.includes("status"))) {
                verdict = value;
            }
            if (!language && (label === "lang" || label.includes("language") || label.includes("язык"))) {
                language = value;
            }
        }

        verdict = normalizeVerdict(verdict);
        language = language ? language.trim() : null;

        if (!verdict && !language) return null;
        return { verdict, language };
    } catch (e) {
        return null;
    }
}

export const CodeforcesSessionAdapter = createAdapter({
    platformKey: "codeforces",
    matchesHostname: (hostname) => hostname.includes("codeforces.com"),
    detectPageType: () => {
        const path = location.pathname;
        if (/\/submission\//i.test(path)) return "submission";
        if (/\/status/i.test(path)) return "status";
        if (/\/problemset\/problem\//i.test(path)) return "problem";
        if (/\/(contest|gym)\/\d+\/problem\//i.test(path)) return "problem";
        return "unknown";
    },
    extractProblemId: (pageType) => {
        if (pageType === "problem") {
            return extractSlugFromUrl(location.href);
        }

        const link = findProblemLinkFromTable() || findProblemLinkFallback();
        if (link) return extractSlugFromUrl(link);
        return null;
    },
    getDifficulty: (pageType) => {
        if (pageType !== "problem") return null;
        const ratingEl =
            document.querySelector(".problem-statement .problem-rating") ||
            document.querySelector(".problem-rating");
        if (ratingEl && ratingEl.textContent) {
            const parsed = parseDifficultyNumber(ratingEl.textContent);
            if (parsed) return parsed;
        }

        const tags = Array.from(document.querySelectorAll(".tag-box"))
            .map((el) => (el.textContent || "").trim())
            .filter(Boolean);
        const ratingTag = tags.find((t) => t.startsWith("*"));
        if (ratingTag) {
            const parsed = parseDifficultyNumber(ratingTag);
            if (parsed) return parsed;
        }

        return null;
    },
    getSubmissionData: () => {
        return extractSubmissionData();
    },
    observeSubmissionData: (callback) => {
        const observer = new MutationObserver(() => {
            const data = extractSubmissionData();
            if (data && data.verdict) {
                observer.disconnect();
                callback(data);
            }
        });
        observer.observe(document.documentElement || document.body, {
            childList: true,
            subtree: true,
        });
        return () => observer.disconnect();
    },
    getEditorSelectors: () => [
        "textarea#source",
        "textarea[name='source']",
        "textarea#program-source-text",
        ".ace_editor textarea",
        ".CodeMirror textarea",
    ],
    getSubmissionId: () => {
        const match = location.pathname.match(/\/submission\/(\d+)/i);
        return match ? match[1] : null;
    },
});
