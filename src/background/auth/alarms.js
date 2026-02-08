// auth/alarms.js — Chrome alarms for Device Flow polling
// Isolates Chrome MV3 alarm weirdness into one place.
// 
// IMPORTANT NOTE: Chrome alarms have a minimum granularity of 1 minute.
// GitHub's Device Flow may expect 5s polling, but after SW restart we effectively
// poll slower (once per minute). This is unavoidable with MV3 limitations.

import { log, warn } from "../core/logger.js";

/**
 * Schedule a periodic alarm for device flow polling
 * @param {string} device_code - The device code from GitHub
 * @param {number} intervalSeconds - Polling interval in seconds
 */
export function scheduleAlarmForDeviceFlow(device_code, intervalSeconds) {
    try {
        // Convert seconds to minutes for alarms; ensure at least 1 minute to satisfy API
        // NOTE: This coarse granularity is unavoidable due to Chrome MV3 limitations
        const minutes = Math.max(1, Math.ceil(intervalSeconds / 60));
        const alarmName = `device-poll-${device_code}`;

        chrome.alarms.create(alarmName, { periodInMinutes: minutes });
        log("created alarm", { alarmName, periodInMinutes: minutes });
    } catch (e) {
        warn("failed to create alarm", e && e.message);
    }
}

/**
 * Clear the alarm for a device flow
 * @param {string} device_code - The device code
 */
export function clearAlarmForDeviceFlow(device_code) {
    try {
        const alarmName = `device-poll-${device_code}`;
        chrome.alarms.clear(alarmName, (wasCleared) => {
            log("cleared alarm", alarmName, wasCleared);
        });
    } catch (e) {
        warn("failed to clear alarm", e && e.message);
    }
}

/**
 * Check if an alarm name is a device flow alarm
 * @param {string} alarmName 
 * @returns {boolean}
 */
export function isDeviceFlowAlarm(alarmName) {
    return alarmName && alarmName.startsWith("device-poll-");
}

/**
 * Extract device code from alarm name
 * @param {string} alarmName 
 * @returns {string}
 */
export function getDeviceCodeFromAlarm(alarmName) {
    return alarmName.replace("device-poll-", "");
}
