// background/index.js — Thin orchestrator (the "boring" entry point)
// 
// The best background file is BORING. If it's boring, it's good.
// All the complexity lives in the modules. This file just wires them together.

import { restoreDeviceFlow, handleDeviceFlowAlarm } from "./auth/deviceFlow.js";
import { registerMessageHandlers } from "./messaging/messageRouter.js";
import { registerTabInjection } from "./leetcode/injector.js";
import { initSessionTracking } from "./session/eventRouter.js";
import { log } from "../core/logger.js";

// ─────────────────────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────────────────────

log("background script initializing...");

// Restore any in-progress Device Flow from storage
restoreDeviceFlow();

// Register message handlers (popup ↔ background ↔ content)
registerMessageHandlers();

// Initialize session tracking defaults + prune
initSessionTracking().catch((err) => {
    log("session tracking init failed:", err?.message ?? String(err));
});

// Register tab injection for LeetCode pages
registerTabInjection();

// ─────────────────────────────────────────────────────────────
// Alarm Handler
// ─────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(handleDeviceFlowAlarm);

log("background script initialized");
