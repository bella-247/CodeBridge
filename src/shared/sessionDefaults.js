// shared/sessionDefaults.js — Session tracker defaults

export const SESSION_DEFAULTS = Object.freeze({
    SESSION_PRUNE_DAYS: 90,
    MAX_SESSIONS_STORED: 1000,
    TIMER_START_MODE: "DELAYED_AUTO", // DELAYED_AUTO | TYPING | MANUAL
    AUTO_START_DELAY_SECONDS: 10,
    SUPPORTED_PLATFORMS_ENABLED: ["codeforces", "leetcode"],
    SHOW_TIMER_OVERLAY: true,
});

export const TIMER_START_MODES = Object.freeze({
    DELAYED_AUTO: "DELAYED_AUTO",
    TYPING: "TYPING",
    MANUAL: "MANUAL",
});

export const SESSION_STORAGE_KEYS = Object.freeze({
    SESSIONS: "cp_sessions",
});

export const PLATFORM_KEYS = Object.freeze({
    CODEFORCES: "codeforces",
    LEETCODE: "leetcode",
});
