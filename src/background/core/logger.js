// core/logger.js — Centralized logging with consistent prefix
// Every file imports this. No more scattered console.log.

const PREFIX = "[bg | device-flow]";

export function log(...args) {
    console.log(PREFIX, ...args);
}

export function warn(...args) {
    console.warn(PREFIX, ...args);
}

export function error(...args) {
    console.error(PREFIX, ...args);
}
