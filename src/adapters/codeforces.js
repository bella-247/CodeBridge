import { CodeforcesScraper } from '../scrapers/codeforces.js';

/**
 * Codeforces Adapter
 *
 * This adapter orchestrates the process of finding a submission, scraping the
 * problem metadata, and extracting the solution code.
 */
export const CodeforcesAdapter = {
    name: "Codeforces",
    matches: () => location.hostname.includes("codeforces.com"),

    /**
     * Finds the URL of the latest "Accepted" submission on the current page.
     * Strategy:
     * 1. Locate Sidebar: table.rtable.smaller
     * 2. Find "Accepted": row containing .verdict-accepted
     * 3. Extract Link: <a> tag in that row
     * @returns {string|null} The submission URL or null if not found.
     */
    getSubmissionUrl() {
        console.log("[CodeBridge] Scanning for Codeforces submission URL (Sidebar Priority)...");

        // 1. Target the sidebars specifically (rtable smaller is standard)
        const sidebarTables = Array.from(document.querySelectorAll('table.rtable.smaller, .sidebar table'));

        for (const table of sidebarTables) {
            // 2. Look for the row containing the span/class 'verdict-accepted'
            const acceptedVerdict = table.querySelector('.verdict-accepted');
            if (acceptedVerdict) {
                const row = acceptedVerdict.closest('tr');
                if (row) {
                    // 3. Find the submission link in that row
                    const link = row.querySelector('a[href*="/submission/"]');
                    if (link) {
                        // link.href automatically returns the absolute URL
                        console.log(`[CodeBridge] Found accepted submission in sidebar: ${link.href}`);
                        return link.href;
                    }
                }
            }
        }

        // Fallback: Robust scan of all links if sidebar check fails (covers status pages, etc.)
        const allLinks = Array.from(document.querySelectorAll('a[href*="/submission/"]'));
        for (const link of allLinks) {
            const container = link.closest('tr') || link.parentElement;
            if (container && (container.querySelector('.verdict-accepted') || /Accepted/i.test(container.innerText))) {
                console.log(`[CodeBridge] Found accepted submission (Fallback Scan): ${link.href}`);
                return link.href;
            }
        }

        console.warn("[CodeBridge] No 'Accepted' submission link found on the page.");
        return null;
    },

    /**
     * Main function to gather all required data for a Codeforces problem.
     * Focuses on metadata, delegating code extraction to core content.js logic.
     */
    async gather() {
        console.log("[CodeBridge] Gathering Codeforces metadata...");

        const metadata = await CodeforcesScraper.fetchMetadata();
        if (!metadata) {
            console.error("[CodeBridge] Failed to scrape problem metadata.");
            return null;
        }

        return {
            ...metadata,
            platform: "Codeforces"
        };
    }
};