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
        const extractHandle = (link) => {
            try {
                const href = link.getAttribute('href') || "";
                const url = new URL(href, location.origin);
                const parts = url.pathname.split('/').filter(Boolean);
                const idx = parts.indexOf('profile');
                const handle = idx !== -1 && parts[idx + 1] ? parts[idx + 1] : parts[parts.length - 1];
                return handle ? decodeURIComponent(handle).trim() : null;
            } catch (e) {
                return null;
            }
        };

        // Prefer header area to avoid picking authors from the statement
        const header = document.querySelector('#header') || document.querySelector('.header') || document.body;
        let profileLink = header ? header.querySelector('a[href^="/profile/"]') : null;
        if (profileLink) {
            const handle = extractHandle(profileLink);
            if (handle) {
                console.log(`[CodeBridge] Detected Codeforces handle: ${handle}`);
                return handle;
            }
        }

        // Fallback: use the only profile link if it's unambiguous
        const profileLinks = Array.from(document.querySelectorAll('a[href^="/profile/"]'));
        if (profileLinks.length === 1) {
            const handle = extractHandle(profileLinks[0]);
            if (handle) {
                console.log(`[CodeBridge] Detected Codeforces handle (fallback): ${handle}`);
                return handle;
            }
        }

        return null;
    },

    getSubmissionUrl() {
        console.log("[CodeBridge] Scanning for Codeforces submission URL (Layers of Truth)...");

        // If already on a submission page, use it directly
        if (location.pathname.includes('/submission/')) {
            return location.href;
        }
        if (document.querySelector('#program-source-text')) {
            return location.href;
        }

        const handle = this.getHandle();
        if (!handle) {
            console.warn("[CodeBridge] User handle not detected. Will only trust user-specific sidebar data.");
        }

        const handleLower = handle ? handle.toLowerCase() : "";
        const canVerifyUser = !!handleLower;

        const lastSubsBox = (() => {
            const boxes = Array.from(document.querySelectorAll('.sidebox'));
            const byCaption = boxes.find(b => {
                const cap = b.querySelector('.caption');
                return cap && /last submissions/i.test(cap.textContent || '');
            });
            if (byCaption) return byCaption;
            return boxes.find(b => {
                return b.querySelector('a[href*="/submission/"]') && b.querySelector('.verdict-accepted');
            }) || null;
        })();

        const inferredSubsBox = (() => {
            const sidebarRoot = document.querySelector('#sidebar') || document.body;
            const links = Array.from(sidebarRoot.querySelectorAll('a[href*="/submission/"]'));
            for (const link of links) {
                const row = link.closest('tr');
                if (row && row.querySelector('.verdict-accepted')) {
                    return link.closest('.sidebox') || null;
                }
            }
            return null;
        })();

        const trustedContainers = [lastSubsBox, inferredSubsBox]
            .filter(Boolean);

        // Strategy A: Sidebar Extraction (High Performance, High Trust)
        // Problems often have a "Last submissions" sidebar.
        const sideProblemSubs = document.querySelector('.side-problem-submissions');
        if (sideProblemSubs) trustedContainers.push(sideProblemSubs);

        const sidebar = lastSubsBox || sideProblemSubs || document.querySelector('#sidebar');
        if (sidebar && sidebar.querySelector('a[href*="/submission/"]') && sidebar.querySelector('.verdict-accepted')) {
            trustedContainers.push(sidebar);
        }
        if (sidebar) {
            console.log("[CodeBridge] Checking sidebar for submissions...");
            const sidebarLinks = Array.from(sidebar.querySelectorAll('a[href*="/submission/"]'));
            for (const link of sidebarLinks) {
                const row = link.closest('tr') || link.parentElement;
                const text = row.innerText || "";
                const textLower = text.toLowerCase();
                const isTrustedContext = trustedContainers.some(c => c && c.contains(link));

                // Integrity checks: 
                // 1. Is it 'Accepted'?
                // 2. If we have a handle, does it belong to the user?
                const isAccepted = /Accepted|OK/i.test(text) || row.querySelector('.verdict-accepted');
                const isUserSubmission = isTrustedContext || (canVerifyUser &&
                    (textLower.includes(handleLower) ||
                    Array.from(row.querySelectorAll('a[href^="/profile/"]'))
                        .some(a => (a.getAttribute('href') || '').toLowerCase() === `/profile/${handleLower}`)));

                if (isAccepted && isUserSubmission) {
                    const solUrl = new URL(link.getAttribute('href'), location.origin).href;
                    console.log(`[CodeBridge] Found user's accepted submission in sidebar: ${solUrl}`);
                    return solUrl;
                }
            }
        }

        // Strategy B: Full Page Scan (Fallback)
        if (!canVerifyUser) {
            console.warn("[CodeBridge] Skipping full-page scan without a verified handle.");
            return null;
        }

        console.log("[CodeBridge] Sidebar search failed. Scanning entire page...");
        const allLinks = Array.from(document.querySelectorAll('a[href*="/submission/"]'));

        for (const link of allLinks) {
            const row = link.closest('tr') || link.parentElement;
            if (!row) continue;

            const text = row.innerText || "";
            const textLower = text.toLowerCase();
            const isAccepted = /Accepted|OK/i.test(text) || row.querySelector('.verdict-accepted');
            const isUserSubmission = textLower.includes(handleLower) ||
                Array.from(row.querySelectorAll('a[href^="/profile/"]'))
                    .some(a => (a.getAttribute('href') || '').toLowerCase() === `/profile/${handleLower}`);

            if (isAccepted && isUserSubmission) {
                const absoluteUrl = new URL(link.getAttribute('href'), location.origin).href;
                console.log(`[CodeBridge] Found user's accepted submission link: ${absoluteUrl}`);
                return absoluteUrl;
            }
        }

        console.warn("[CodeBridge] No 'Accepted' submission link found for this user.");
        return null;
    },

    getProblemUrlFromSubmissionPage() {
        try {
            const rows = Array.from(
                document.querySelectorAll(".datatable tr, table tr"),
            );
            for (const row of rows) {
                const cells = row.querySelectorAll("td, th");
                if (!cells || cells.length < 2) continue;
                const label = (cells[0].textContent || "")
                    .trim()
                    .toLowerCase();
                if (!label.includes("problem")) continue;
                const link =
                    row.querySelector('a[href*="/problem/"]') ||
                    row.querySelector('a[href*="/problemset/problem/"]');
                if (link && link.getAttribute("href")) {
                    return new URL(link.getAttribute("href"), location.origin)
                        .href;
                }
            }

            const anyLink =
                document.querySelector('a[href*="/problemset/problem/"]') ||
                document.querySelector('a[href*="/contest/"][href*="/problem/"]') ||
                document.querySelector('a[href*="/gym/"][href*="/problem/"]');
            if (anyLink && anyLink.getAttribute("href")) {
                return new URL(anyLink.getAttribute("href"), location.origin)
                    .href;
            }
        } catch (e) {
            // ignore
        }
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
            console.warn("[CodeBridge] Could not detect Codeforces handle. Proceeding without user verification.");
        }

        let metadata = null;
        try {
            const isSubmissionPage =
                location.pathname.includes("/submission/") ||
                document.querySelector("#program-source-text");
            if (isSubmissionPage) {
                const problemUrl = this.getProblemUrlFromSubmissionPage();
                if (problemUrl) {
                    try {
                        const res = await fetch(problemUrl, {
                            credentials: "include",
                            cache: "no-store",
                        });
                        if (res.ok) {
                            const html = await res.text();
                            const doc = new DOMParser().parseFromString(
                                html,
                                "text/html",
                            );
                            metadata = CodeforcesScraper.parseMetadataFromDoc(
                                doc,
                                problemUrl,
                            );
                        }
                    } catch (e) {
                        console.warn(
                            "[CodeBridge] Failed to fetch problem page from submission. Falling back.",
                        );
                    }
                }
            }

            if (!metadata) {
                metadata = await CodeforcesScraper.fetchMetadata();
            }
        } catch (e) {
            console.warn("[CodeBridge] Metadata scrape threw. Using fallback.");
        }

        if (!metadata) {
            const fallbackId = CodeforcesScraper.getSlug(location.href);
            const fallbackTitle = (document.title || fallbackId || "unknown").replace(/\s*-\s*Codeforces\s*$/i, "");
            metadata = {
                id: fallbackId || "unknown",
                slug: fallbackId || "unknown",
                title: fallbackTitle || "unknown",
                contentHtml: "",
                difficulty: "Unknown",
                tags: [],
                platform: "Codeforces"
            };
        }

        return {
            ...metadata,
            platform: "Codeforces",
            userHandle: handle || null
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
