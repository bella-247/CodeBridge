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
     * Finds the currently logged-in user handle on Codeforces.
     */
    getHandle() {
        // Look for the user profile link, specifically in the header to ensure it's the logged-in user
        const profileLink = document.querySelector('#header a[href^="/profile/"]') || 
                           document.querySelector('a[href^="/profile/"]');
        if (profileLink) {
            const handle = profileLink.getAttribute('href').replace('/profile/', '').trim();
            console.log(`[CodeBridge] Detected Codeforces handle: ${handle}`);
            return handle;
        }
        return null;
    },

    getSubmissionUrl() {
        console.log("[CodeBridge] Scanning for Codeforces submission URL (Layers of Truth)...");

        const handle = this.getHandle();
        if (!handle) {
            console.warn("[CodeBridge] User not logged in. Cannot verify submission ownership.");
            // We proceed, but we should ideally notify the user. 
            // The content script will handle the red error if no code is found.
        }

        // Strategy A: Sidebar Extraction (High Performance, High Trust)
        // Problems often have a "Last submissions" sidebar.
        const sidebar = document.querySelector('.side-problem-submissions') || document.querySelector('#sidebar');
        if (sidebar) {
            console.log("[CodeBridge] Checking sidebar for submissions...");
            const sidebarLinks = Array.from(sidebar.querySelectorAll('a[href*="/submission/"]'));
            for (const link of sidebarLinks) {
                const row = link.closest('tr') || link.parentElement;
                const text = row.innerText || "";

                // Integrity checks: 
                // 1. Is it 'Accepted'?
                // 2. If we have a handle, does it belong to the user?
                const isAccepted = /Accepted|OK/i.test(text) || row.querySelector('.verdict-accepted');
                const isUserSubmission = !handle || text.includes(handle) || row.querySelector(`a[href="/profile/${handle}"]`);

                if (isAccepted && isUserSubmission) {
                    const solUrl = new URL(link.getAttribute('href'), location.origin).href;
                    console.log(`[CodeBridge] Found user's accepted submission in sidebar: ${solUrl}`);
                    return solUrl;
                }
            }
        }

        // Strategy B: Full Page Scan (Fallback)
        console.log("[CodeBridge] Sidebar search failed. Scanning entire page...");
        const allLinks = Array.from(document.querySelectorAll('a[href*="/submission/"]'));

        for (const link of allLinks) {
            const row = link.closest('tr') || link.parentElement;
            if (!row) continue;

            const text = row.innerText || "";
            const isAccepted = /Accepted|OK/i.test(text) || row.querySelector('.verdict-accepted');
            const isUserSubmission = !handle || text.includes(handle) || row.querySelector(`a[href="/profile/${handle}"]`);

            if (isAccepted && isUserSubmission) {
                const absoluteUrl = new URL(link.getAttribute('href'), location.origin).href;
                console.log(`[CodeBridge] Found user's accepted submission link: ${absoluteUrl}`);
                return absoluteUrl;
            }
        }

        console.warn("[CodeBridge] No 'Accepted' submission link found for this user.");
        return null;
    },

    /**
     * Main function to gather all required data for a Codeforces problem.
     * Focuses on metadata, delegating code extraction to core content.js logic.
     */
    async gather() {
        console.log("[CodeBridge] Gathering Codeforces metadata...");

        const handle = this.getHandle();
        if (!handle) {
            // This will be caught by gatherProblemData and displayed to the user
            throw new Error("Login Error: Please log into Codeforces first so we can identify your solutions.");
        }

        const metadata = await CodeforcesScraper.fetchMetadata();
        if (!metadata) {
            console.error("[CodeBridge] Failed to scrape problem metadata.");
            return null;
        }

        return {
            ...metadata,
            platform: "Codeforces",
            userHandle: handle
        };
    },

    /**
     * Fetches a submission page and extracts the source code and language.
     * This method directly uses the CodeforcesScraper.
     * @param {string} submissionUrl - The URL of the submission to fetch.
     * @returns {Promise<{code: string, language: string}|null>}
     */
    async fetchSolution(submissionUrl) {
        console.log("[CodeBridge] Adapter fetching solution via scraper:", submissionUrl);
        return CodeforcesScraper.extractSolution(submissionUrl);
    }
};