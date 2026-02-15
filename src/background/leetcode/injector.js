// leetcode/injector.js — Content script injection for LeetCode pages
// With manifest-based content scripts, we intentionally avoid any fallback injection
// to prevent duplicate bubbles and race conditions.

import { log } from "../../core/logger.js";

/**
 * Register tab injection listeners (No-op when manifest injection is enabled)
 */
export function registerTabInjection() {
    log("tab injection handled by manifest — no fallback injection registered");
}
