// content/adapters/leetcodeAdapter.js — Session tracking for LeetCode

import { createAdapter, normalizeVerdict } from "./baseAdapter.js";

const VERDICT_KEYWORDS = [
    "Accepted",
    "Passed",
    "Wrong Answer",
    "Time Limit Exceeded",
    "Runtime Error",
    "Compilation Error",
    "Memory Limit Exceeded",
    "Output Limit Exceeded",
    "Presentation Error",
];

const RESULT_SELECTORS = [
    "[data-e2e-locator='submission-result']",
    "[data-testid='submission-result']",
    ".result__title",
    ".result__status",
];

function isElementVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle ? getComputedStyle(el) : null;
    if (style) {
        if (style.display === "none" || style.visibility === "hidden") return false;
        if (style.opacity === "0") return false;
    }
    return el.getClientRects().length > 0;
}

function extractSlugFromUrl(url) {
    try {
        const urlObj = new URL(url, location.origin);
        const match = urlObj.pathname.match(/\/problems\/([^/]+)/i);
        return match ? match[1] : null;
    } catch (e) {
        return null;
    }
}

function extractDifficulty() {
    const candidates = [
        "[data-e2e-locator='difficulty']",
        "[data-difficulty]",
        "[class*='difficulty']",
    ];

    for (const selector of candidates) {
        try {
            const el = document.querySelector(selector);
            if (el && el.textContent) {
                const text = el.textContent.trim();
                if (/^(Easy|Medium|Hard)$/i.test(text)) return text;
            }
        } catch (e) {
            // ignore
        }
    }

    // Fallback: scan for exact difficulty labels in small text blocks
    const nodes = Array.from(document.querySelectorAll("span, div"));
    for (const node of nodes) {
        const text = (node.textContent || "").trim();
        if (/^(Easy|Medium|Hard)$/i.test(text)) return text;
    }

    return null;
}

function extractVerdictText() {
    for (const selector of RESULT_SELECTORS) {
        const el = document.querySelector(selector);
        if (!el || !isElementVisible(el)) continue;
        const text = (el.textContent || "").trim();
        if (!text) continue;
        const match = VERDICT_KEYWORDS.find((keyword) => text.includes(keyword));
        if (match) return match;
    }
    return null;
}

function extractLanguage() {
    const direct =
        document.querySelector("[data-e2e-locator='submission-language']") ||
        document.querySelector("[data-testid='submission-language']") ||
        document.querySelector(".submission-language");

    if (direct && direct.textContent) {
        return direct.textContent.trim();
    }

    const nodes = Array.from(document.querySelectorAll("span, div"));
    for (const node of nodes) {
        const text = (node.textContent || "").trim();
        if (/^Language\s*:/i.test(text)) {
            return text.replace(/^Language\s*:/i, "").trim();
        }
    }

    return null;
}

function extractSubmissionData() {
    const verdict = normalizeVerdict(extractVerdictText());
    const language = extractLanguage();
    if (!verdict) return null;
    return { verdict, language };
}

export const LeetCodeSessionAdapter = createAdapter({
    platformKey: "leetcode",
    matchesHostname: (hostname) =>
        hostname === "leetcode.com" || hostname.endsWith(".leetcode.com"),
    detectPageType: () => {
        const path = location.pathname;
        if (/\/problems\//i.test(path)) return "problem";
        return "unknown";
    },
    extractProblemId: () => {
        return extractSlugFromUrl(location.href);
    },
    getDifficulty: () => extractDifficulty(),
    getSubmissionData: () => extractSubmissionData(),
    observeSubmissionData: (callback) => {
        // Inject interceptor
        if (!document.getElementById("cb-leetcode-interceptor")) {
            const script = document.createElement("script");
            script.id = "cb-leetcode-interceptor";
            script.src = chrome.runtime.getURL("src/content/injected/leetcode-interceptor.js");
            (document.head || document.documentElement).appendChild(script);
        }

        const messageHandler = (event) => {
            if (event.source !== window) return;
            if (event.data && event.data.type === "CODEBRIDGE_LEETCODE_SUBMISSION") {
                const payload = event.data.payload;
                if (payload) {
                    callback({
                        verdict: normalizeVerdict(payload.status_msg),
                        language: payload.lang,
                        runtime: payload.status_runtime,
                        memory: payload.status_memory,
                        submissionId: payload.submission_id
                    });
                }
            }
        };

        window.addEventListener("message", messageHandler);

        // Fallback: DOM observer
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

        return () => {
            window.removeEventListener("message", messageHandler);
            observer.disconnect();
        };
    },
    isSuccessfulSubmission: (data) => {
        if (!data || !data.verdict) return false;
        const verdict = String(data.verdict).trim().toLowerCase();
        return verdict === "accepted" || verdict === "ac" || verdict === "passed";
    },
    getEditorSelectors: () => [
        ".monaco-editor textarea",
        ".CodeMirror textarea",
        ".ace_editor textarea",
        "textarea",
    ],
});
