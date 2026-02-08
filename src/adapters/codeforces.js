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

    getSubmissionUrl() {
        console.log("[CodeBridge] Scanning for Codeforces submission URL (Ultra-Robust)...");

        // Strategy A: Check all links on the page that point to a submission
        // We look for any link containing '/submission/' and check if its 
        // surrounding container (row) contains 'Accepted'.
        const allLinks = Array.from(document.querySelectorAll('a[href*="/submission/"]'));

        for (const link of allLinks) {
            // Find the closest table row or relevant container
            const row = link.closest('tr') || link.parentElement;
            if (!row) continue;

            const text = row.innerText || "";
            // Check for verdict-accepted class or the word "Accepted" in the row
            const isAccepted = row.querySelector('.verdict-accepted') ||
                row.querySelector('.verdict_accepted') ||
                /Accepted/i.test(text);

            if (isAccepted) {
                // Return absolute URL
                const absoluteUrl = new URL(link.getAttribute('href'), location.origin).href;
                console.log(`[CodeBridge] Found accepted submission link: ${absoluteUrl}`);
                return absoluteUrl;
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