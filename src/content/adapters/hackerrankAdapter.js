import { createAdapter, normalizeVerdict } from "./baseAdapter.js";

const VERDICT_KEYWORDS = [
    "Accepted",
    "All Test Cases Passed",
    "All tests passed",
    "All test cases passed",
    "Success",
    "Wrong Answer",
    "Time Limit Exceeded",
    "Runtime Error",
    "Compilation Error",
    "Memory Limit Exceeded",
];

const RESULT_SELECTORS = [
    ".challenge-result",
    ".result-view",
    ".result-status",
    ".status-text",
    "[data-automation*='result']",
    "[data-automation*='status']",
    "[class*='result']",
    "[class*='status']",
];

function isElementVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle ? getComputedStyle(el) : null;
    if (style) {
        if (style.display === "none" || style.visibility === "hidden")
            return false;
        if (style.opacity === "0") return false;
    }
    return el.getClientRects().length > 0;
}

function extractVerdictText() {
    const seen = new Set();
    const candidates = [];

    for (const selector of RESULT_SELECTORS) {
        try {
            document.querySelectorAll(selector).forEach((el) => {
                if (!seen.has(el)) {
                    seen.add(el);
                    candidates.push(el);
                }
            });
        } catch (e) {
            // ignore
        }
    }

    for (const el of candidates) {
        if (!isElementVisible(el)) continue;
        const text = (el.textContent || "").trim();
        if (!text) continue;
        const match = VERDICT_KEYWORDS.find((keyword) =>
            text.includes(keyword),
        );
        if (match) return match;
    }

    return null;
}

function extractSubmissionData() {
    const verdict = normalizeVerdict(extractVerdictText());
    if (!verdict) return null;
    return { verdict };
}

export const HackerRankSessionAdapter = createAdapter({
    platformKey: "hackerrank",

    matchesHostname: (hostname) => hostname.includes("hackerrank.com"),

    detectPageType: () => {
        const path = window.location.pathname;
        if (path.includes("/challenges/") && !path.includes("/submissions/")) {
            return "problem";
        }
        return "unknown";
    },

    extractProblemId: (pageType) => {
        if (pageType === "problem") {
            const parts = window.location.pathname.split("/");
            const idx = parts.indexOf("challenges");
            if (idx !== -1 && parts[idx + 1]) {
                return parts[idx + 1];
            }
        }
        return null;
    },

    getDifficulty: (pageType) => {
        const diffEl =
            document.querySelector(".difficulty-label") ||
            document.querySelector(".challenge-difficulty");
        return diffEl ? diffEl.innerText.trim() : "Unknown";
    },

    getSubmissionData: () => extractSubmissionData(),

    observeSubmissionData: (callback) => {
        const observer = new MutationObserver(() => {
            const data = extractSubmissionData();
            if (data && data.verdict) {
                callback(data);
            }
        });
        observer.observe(document.documentElement || document.body, {
            childList: true,
            subtree: true,
        });
        return () => observer.disconnect();
    },

    isSuccessfulSubmission: (data) => {
        if (!data || !data.verdict) return false;
        const verdict = String(data.verdict).trim().toLowerCase();
        return (
            verdict === "accepted" ||
            verdict === "success" ||
            verdict.includes("passed")
        );
    },

    getEditorSelectors: () => [
        ".monaco-editor",
        ".CodeMirror",
        "textarea.inputarea",
    ],
});
