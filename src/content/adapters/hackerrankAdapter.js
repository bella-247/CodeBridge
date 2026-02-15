import { createAdapter } from "./baseAdapter.js";

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
        const diffEl = document.querySelector('.difficulty-label') || document.querySelector('.challenge-difficulty');
        return diffEl ? diffEl.innerText.trim() : "Unknown";
    },

    getEditorSelectors: () => [
        ".monaco-editor",
        ".CodeMirror",
        "textarea.inputarea"
    ]
});
