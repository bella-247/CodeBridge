// content/adapters/baseAdapter.js — Base helpers for session adapters

function closestMatch(el, selectors) {
    if (!el || typeof el.closest !== "function" || !selectors || selectors.length === 0) {
        return null;
    }
    for (const selector of selectors) {
        try {
            const match = el.closest(selector);
            if (match) return match;
        } catch (e) {
            // ignore invalid selector
        }
    }
    return null;
}

export function createAdapter(definition) {
    return {
        platformKey: "",
        matchesHostname: () => false,
        detectPageType: () => "unknown",
        extractProblemId: () => null,
        getDifficulty: () => null,
        getSubmissionData: () => null,
        observeSubmissionData: () => null,
        getEditorSelectors: () => [],
        isSuccessfulSubmission: () => false,
        isEditorTarget: (el) => {
            const selectors = definition.getEditorSelectors
                ? definition.getEditorSelectors()
                : [];
            if (!selectors.length) return false;
            return !!closestMatch(el, selectors);
        },
        ...definition,
    };
}

export function parseDifficultyNumber(text) {
    if (!text) return null;
    const match = String(text).match(/(\d{3,4})/);
    if (!match) return null;
    const num = Number(match[1]);
    return Number.isFinite(num) ? num : null;
}

export function normalizeVerdict(text) {
    if (!text) return null;
    return String(text).trim();
}
