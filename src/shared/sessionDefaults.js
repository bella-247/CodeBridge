// shared/sessionDefaults.js — Session tracker defaults

import { SUPPORTED_PLATFORMS } from "../utils/constants.js";

export const SESSION_DEFAULTS = Object.freeze({
    SESSION_PRUNE_DAYS: 90,
    MAX_SESSIONS_STORED: 1000,
    TIMER_START_MODE: "DELAYED_AUTO", // DELAYED_AUTO | TYPING | MANUAL
    AUTO_START_DELAY_SECONDS: 10,
    SUPPORTED_PLATFORMS_ENABLED: SUPPORTED_PLATFORMS.map(p => p.key),
    SHOW_TIMER_OVERLAY: true,
    TIMER_OVERLAY_SIZE: "medium", // small | medium | large
    AUTO_STOP_ON_ACCEPTED: true,
    AUTO_STOP_ON_PROBLEM_SWITCH: true,
    INACTIVITY_TIMEOUT_MINUTES: 30,
    ALLOW_MANUAL_STOP: true,
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
