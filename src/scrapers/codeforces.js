/**
 * Codeforces Scraper
 *
 * - Scrapes problem metadata from the problem page.
 * - Fetches and parses a submission page to extract the solution code.
 */
export const CodeforcesScraper = {
    platform: 'Codeforces',

    /**
     * Check if the URL matches a Codeforces problem or submission page.
     */
    matches(url) {
        return url.includes('codeforces.com');
    },

    /**
     * Extracts a problem's slug from a URL.
     * e.g., "1850A" from "/contest/1850/problem/A"
     */
    getSlug(url) {
        try {
            const urlObj = new URL(url);
            const path = urlObj.pathname;

            // Handle /contest/{id}/problem/{index}
            // Handle /gym/{id}/problem/{index}
            const contestMatch = path.match(/\/(contest|gym)\/(\d+)\/problem\/([A-Z0-9]+)/i);
            if (contestMatch) {
                return `${contestMatch[2]}${contestMatch[3]}`;
            }

            // Handle /problemset/problem/{id}/{index}
            const problemsetMatch = path.match(/\/problemset\/problem\/(\d+)\/([A-Z0-9]+)/i);
            if (problemsetMatch) {
                return `${problemsetMatch[1]}${problemsetMatch[2]}`;
            }

            // Fallback: splitting
            const parts = path.split("/").filter(Boolean);
            return parts[parts.length - 1] || "unknown";
        } catch (e) {
            console.error("Failed to parse slug from URL:", url, e);
            return "unknown";
        }
    },

    /**
     * Scrapes metadata from the current problem page DOM.
     * This must be run on the problem page itself.
     */
    async fetchMetadata() {
        try {
            console.log("[CodeBridge] CodeforcesScraper: Scraping metadata...");
            return this.parseMetadataFromDoc(document, location.href);
        } catch (e) {
            console.error("[CodeBridge] Codeforces metadata scrape failed:", e);
            return null;
        }
    },

    /**
     * Parses metadata from a provided document (supports DOMParser docs).
     */
    parseMetadataFromDoc(doc, url) {
        const root = doc || document;
        const pageUrl = url || (typeof location !== "undefined" ? location.href : "");

        const titleEl = root.querySelector('.problem-statement .header .title') ||
            root.querySelector('.header .title') ||
            root.querySelector('.title') ||
            root.querySelector('h1');

        const title = titleEl ? (titleEl.textContent || "").trim() : (root.title || "");

        const tags = Array.from(root.querySelectorAll('.tag-box'))
            .map(el => (el.textContent || "").trim())
            .filter(t => !!t);

        const difficultyTag = tags.find(t => t.startsWith('*'));
        const difficulty = difficultyTag ? difficultyTag.replace('*', '') : "Unknown";

        const contentEl = root.querySelector('.problem-statement') || root.querySelector('#pageContent');
        let contentHtml = "";
        if (contentEl) {
            const clone = contentEl.cloneNode(true);
            const junk = ['.MathJax_Preview', '.MathJax_Display', '.MathJax', 'script', 'style', '.header', '.sample-tests .title', '.button-up'];
            junk.forEach(s => clone.querySelectorAll(s).forEach(n => n.remove()));
            contentHtml = clone.innerHTML;
        }

        const urlSlug = this.getSlug(pageUrl);
        const idMatch = title.match(/^([A-Z0-9]+)\.\s+(.*)/);

        let id = urlSlug;
        let cleanTitle = title;

        if (idMatch) {
            const letter = idMatch[1];
            cleanTitle = idMatch[2];
            if (urlSlug.endsWith(letter)) {
                id = urlSlug;
            } else if (!isNaN(urlSlug)) {
                id = urlSlug + letter;
            }
        }

        return {
            id: id,
            slug: id,
            title: cleanTitle,
            contentHtml: contentHtml && contentHtml.length > 50 ? contentHtml : (contentEl ? contentEl.innerHTML : ""),
            difficulty: difficulty,
            tags: tags.map(t => t.replace('*', '').trim()),
            platform: "Codeforces"
        };
    },

    /**
     * Fetches a submission page and extracts the source code and language.
     * Pessimistic approach with robust validation as requested.
     */
    async extractSolution(submissionUrl) {
        if (!submissionUrl) {
            console.warn("[CodeBridge] No submission URL provided to extractSolution.");
            return null;
        }

        try {
            const waitMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const looksLikeWaitGate = (doc, html) => {
                const title = (doc && doc.title ? doc.title : "").toLowerCase();
                const bodyText = (doc && doc.body && doc.body.textContent
                    ? doc.body.textContent
                    : "").toLowerCase();
                const metaRefresh = doc && doc.querySelector('meta[http-equiv="refresh"]');
                if (metaRefresh) return true;
                const combined = `${title} ${bodyText}`;
                return /please wait|redirecting|just a moment|checking your browser|one more step|verifying your browser|browser check/i.test(combined) ||
                    /cf-browser-verification|cf-challenge|cloudflare/i.test(html || "");
            };

            const retryScheduleMs = [0, 2000, 3500, 5000, 7000];
            const retryableStatuses = new Set([429, 502, 503, 504]);
            const maxAttempts = retryScheduleMs.length;

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                if (attempt > 1) {
                    await waitMs(retryScheduleMs[attempt - 1]);
                }

                console.log(`[CodeBridge] Fetching submission page (attempt ${attempt}/${maxAttempts}) (Credentials: include): ${submissionUrl}`);

                // In content script world, fetch will use the tab's cookies automatically.
                const response = await fetch(submissionUrl, {
                    credentials: "include",
                    cache: "no-store"
                });

                const finalUrl = response.url || submissionUrl;
                if (!response.ok) {
                    if (retryableStatuses.has(response.status)) {
                        if (attempt < maxAttempts) {
                            console.warn(`[CodeBridge] Temporary HTTP ${response.status} on submission fetch. Retrying...`);
                            continue;
                        }
                        const err = new Error(
                            `Temporary Codeforces gate detected (HTTP ${response.status}). Open the last accepted submission once, then return to the problem page and retry.`,
                        );
                        err.kind = "temporary_gate";
                        throw err;
                    }
                    throw new Error(`Fetch Error: HTTP ${response.status} (${finalUrl})`);
                }

                if (/\/(enter|login|register)(\/|$)/i.test(finalUrl)) {
                    throw new Error(`Session Error: Redirected to login (${finalUrl}). Please sign in and retry.`);
                }

                const html = await response.text();
                console.log("[CodeBridge] Page fetched. Length:", html.length);

                // Parse early so we can detect wait gates before failing hard.
                const doc = new DOMParser().parseFromString(html, 'text/html');

                if (looksLikeWaitGate(doc, html)) {
                    if (attempt < maxAttempts) {
                        console.warn("[CodeBridge] Temporary Codeforces gate detected. Waiting before retry...");
                        continue;
                    }
                    const err = new Error(
                        "Temporary Codeforces gate detected. Open the last accepted submission once, then return to the problem page and retry.",
                    );
                    err.kind = "temporary_gate";
                    throw err;
                }

                // Step 1: Integrity Check (The CSRF Gate)
                // Look for any CSRF indicators: class, data-attribute, or hidden inputs.
                const hasCsrf = html.includes('csrf-token') || html.includes('data-csrf') || html.includes('csrf') || html.includes('name="_token"');

                if (!hasCsrf) {
                    // Heuristic: If page is small, it might be an error or redirect
                    if (html.length < 5000) {
                        throw new Error("Session Error: Page content too small. You might be seeing a login wall or a Cloudflare challenge.");
                    }
                    // Log warning but proceed if it looks like a full page? No, user asked for pessimistic.
                    console.warn("[CodeBridge] CSRF indicators missing. Continuing with structural checks.");
                } else {
                    console.log("[CodeBridge] CSRF indicators found in page.");
                }

                // Step 2: Locate the Source Code container check
                // Step 3: Extract and Decode
                const codeEl = doc.querySelector('#program-source-text') || doc.querySelector('pre.prettyprint');
                if (!codeEl) {
                    const title = doc.title || "";
                    const isLoginPage = !!(
                        doc.querySelector('form[action*="/enter"]') ||
                        doc.querySelector('input[name="handleOrEmail"]') ||
                        /just a moment|cloudflare/i.test(title)
                    );
                    if (isLoginPage) {
                        throw new Error(`Session Error: Login/challenge page detected (${title}). Please sign in and retry.`);
                    }
                    throw new Error("Structure Error: Submission code container not found. The submission might be private or the layout changed.");
                }

                // innerText automatically decodes HTML entities.
                // However, CF sometimes puts escaped code in there.
                let code = (codeEl.textContent || "").replace(/\u00a0/g, " ");

                // Double check for common entities just in case innerText wasn't enough (Codeforces quirks)
                if (code.includes("&lt;") || code.includes("&amp;")) {
                    code = code
                        .replace(/&lt;/g, "<")
                        .replace(/&gt;/g, ">")
                        .replace(/&amp;/g, "&")
                        .replace(/&quot;/g, '"')
                        .replace(/&#39;/g, "'")
                        .replace(/&apos;/g, "'");
                }

                if (!code.trim()) {
                    throw new Error("Structure Error: Extracted code was empty.");
                }

                console.log("[CodeBridge] Code block extracted successfully.");

                // Step 4: Extract Metadata (Language)
                let language = "";
                const infoRows = doc.querySelectorAll('.datatable table tr');
                for (const row of infoRows) {
                    const cells = row.getElementsByTagName('td');
                    if (cells.length > 1) {
                        const label = cells[0].innerText.trim().toLowerCase().replace(/:$/, "");
                        if (label === 'lang' || label === 'language' || label.includes('language') || label.includes('язык')) {
                            language = cells[1].innerText.trim();
                            break;
                        }
                    }
                }

                console.log(`[CodeBridge] Successfully extracted code and language: ${language}`);
                return { success: true, code, language };
            }

            throw new Error("Failed to fetch submission after retries.");

        } catch (error) {
            console.error("[CodeBridge] Submission fetch/parse error:", error.message);
            return { success: false, message: error.message, kind: error.kind };
        }
    },

    /**
     * Formats a folder name for the repository.
     */
    formatFolderName(id, title) {
        // Handle ID padding for numeric contest parts if needed
        const pad = id && !isNaN(id) ? String(id).padStart(4, "0") : id || "0000";
        const kebab = title
            .toLowerCase()
            .replace(/[`~!@#$%^&*()+=\[\]{};:'"\\|<>\/?]/g, "")
            .replace(/\s+/g, "-")
            .replace(/--+/g, "-")
            .replace(/^-+|-+$/g, "");
        return `CF-${pad}-${kebab}`;
    }
};
