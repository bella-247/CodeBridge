// shared/sessionSchema.js — Session schema + storage constants

export const SESSION_SCHEMA_VERSION = 2;

export const SESSION_DB = Object.freeze({
    NAME: "codebridge",
    VERSION: 1,
    STORE: "sessions",
});


export const LEGACY_SESSION_STORAGE_KEY = "cp_sessions";
export const SESSION_MIGRATION_FLAG_KEY = "cp_sessions_migrated_v2";

export const SESSION_STATUS = Object.freeze({
    IDLE: "IDLE",
    ACTIVE: "ACTIVE",
    PAUSED: "PAUSED",
    COMPLETED: "COMPLETED",
    ABANDONED: "ABANDONED",
    TIMED_OUT: "TIMED_OUT",
    SWITCHED: "SWITCHED",
});

export const SESSION_STOP_REASONS = Object.freeze({
    ACCEPTED: "accepted",
    MANUAL: "manual",
    TIMEOUT: "timeout",
    PROBLEM_SWITCH: "problem_switch",
    RESET: "reset",
    UNKNOWN: "unknown",
});

export const TERMINAL_SESSION_STATUSES = Object.freeze([
    SESSION_STATUS.COMPLETED,
    SESSION_STATUS.ABANDONED,
    SESSION_STATUS.TIMED_OUT,
    SESSION_STATUS.SWITCHED,
]);

export const ACTIVE_SESSION_STATUSES = Object.freeze([
    SESSION_STATUS.IDLE,
    SESSION_STATUS.ACTIVE,
    SESSION_STATUS.PAUSED,
]);
