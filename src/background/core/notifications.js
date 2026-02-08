// core/notifications.js — System notification wrapper

/**
 * Show a Chrome notification
 * @param {string} title - Notification title
 * @param {string} message - Notification body
 */
export function notify(title, message) {
    try {
        if (chrome && chrome.notifications && chrome.notifications.create) {
            chrome.notifications.create({
                type: "basic",
                iconUrl: "icons/icon.png",
                title,
                message,
            });
        }
    } catch (e) {
        /* ignore notification errors */
    }
}
