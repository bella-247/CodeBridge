import { CodeforcesScraper } from '../scrapers/codeforces.js';

/**
 * Codeforces Adapter
 *
 * This adapter orchestrates the process of scraping the problem metadata
 * and extracting the solution code.
 */
export const CodeforcesAdapter = {
    name: "Codeforces",
    matches: () => location.hostname.includes("codeforces.com"),

    /**
     * Checks visibility for dialog containers (Codeforces facebox).
     */
    isElementVisible(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.opacity === "0"
        ) {
            return false;
        }
        return !!(el.getClientRects && el.getClientRects().length);
    },

    /**
     * Attempts to read the problem link from the open Codeforces dialog.
     */
    getProblemUrlFromDialog() {
        try {
            const dialog =
                document.querySelector("#facebox") ||
                document.querySelector(".facebox");
            if (!dialog || !this.isElementVisible(dialog)) return null;

            const root = dialog.querySelector(".content") || dialog;
            const link =
                root.querySelector('a[href*="/problemset/problem/"]') ||
                root.querySelector('a[href*="/contest/"][href*="/problem/"]') ||
                root.querySelector('a[href*="/gym/"][href*="/problem/"]') ||
                root.querySelector('a[href*="/problem/"]');
            if (link && link.getAttribute("href")) {
                return new URL(link.getAttribute("href"), location.origin).href;
            }
        } catch (e) {
            // ignore
        }
        return null;
    },

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

    getProblemUrlFromSubmissionPage() {
        try {
            const tables = Array.from(
                document.querySelectorAll(".datatable, table"),
            );

            for (const table of tables) {
                const rows = Array.from(table.querySelectorAll("tr"));
                if (!rows.length) continue;

                let headerCells = Array.from(
                    rows[0].querySelectorAll("th, td"),
                );
                let problemIdx = headerCells.findIndex((cell) =>
                    /problem/i.test(cell.textContent || ""),
                );

                const headRow = table.querySelector("thead tr");
                if (problemIdx === -1 && headRow) {
                    headerCells = Array.from(
                        headRow.querySelectorAll("th, td"),
                    );
                    problemIdx = headerCells.findIndex((cell) =>
                        /problem/i.test(cell.textContent || ""),
                    );
                }

                if (problemIdx !== -1) {
                    const bodyRows = rows.slice(1);
                    for (const row of bodyRows) {
                        const cells = Array.from(
                            row.querySelectorAll("td, th"),
                        );
                        if (cells.length <= problemIdx) continue;
                        const cell = cells[problemIdx];
                        const link =
                            cell.querySelector(
                                'a[href*="/problemset/problem/"]',
                            ) ||
                            cell.querySelector(
                                'a[href*="/contest/"][href*="/problem/"]',
                            ) ||
                            cell.querySelector(
                                'a[href*="/gym/"][href*="/problem/"]',
                            ) ||
                            cell.querySelector('a[href*="/problem/"]');
                        if (link && link.getAttribute("href")) {
                            return new URL(
                                link.getAttribute("href"),
                                location.origin,
                            ).href;
                        }
                    }
                }
            }

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

            const hasProblemStatement = !!document.querySelector(
                ".problem-statement",
            );
            if (isSubmissionPage || !hasProblemStatement) {
                const problemUrl = isSubmissionPage
                    ? this.getProblemUrlFromSubmissionPage()
                    : this.getProblemUrlFromDialog() ||
                      this.getProblemUrlFromSubmissionPage();
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
                            if (metadata) metadata.url = problemUrl;
                        }
                    } catch (e) {
                        console.warn(
                            "[CodeBridge] Failed to fetch problem page from submission/dialog. Falling back.",
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
