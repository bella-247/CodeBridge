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
            const parts = new URL(url).pathname.split("/").filter(Boolean);
            if (parts.includes("contest")) {
                const probIdx = parts.indexOf("problem");
                if (probIdx !== -1 && probIdx > 0) {
                    const contestId = parts[probIdx - 1];
                    const problemLetter = parts[probIdx + 1];
                    return `${contestId}${problemLetter}`;
                }
            } else if (parts.includes("problemset")) {
                const probIdx = parts.indexOf("problem");
                if (probIdx !== -1 && parts.length >= probIdx + 3) {
                    const contestId = parts[probIdx + 1];
                    const problemLetter = parts[probIdx + 2];
                    return `${contestId}${problemLetter}`;
                }
            }
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

            // Robust title selection
            const titleEl = document.querySelector('.problem-statement .header .title') ||
                document.querySelector('.header .title') ||
                document.querySelector('.title') ||
                document.querySelector('h1');

            const title = titleEl ? titleEl.innerText.trim() : document.title;

            const tags = Array.from(document.querySelectorAll('.tag-box'))
                .map(el => el.innerText.trim())
                .filter(t => !!t);

            const difficultyTag = tags.find(t => t.startsWith('*'));
            const difficulty = difficultyTag ? difficultyTag.replace('*', '') : "Unknown";

            const contentEl = document.querySelector('.problem-statement') || document.querySelector('#pageContent');
            let contentHtml = "";
            if (contentEl) {
                const clone = contentEl.cloneNode(true);
                const junk = ['.MathJax_Preview', '.MathJax_Display', '.MathJax', 'script', 'style', '.header', '.sample-tests .title', '.button-up'];
                junk.forEach(s => clone.querySelectorAll(s).forEach(n => n.remove()));
                contentHtml = clone.innerHTML;
            }

            const urlSlug = this.getSlug(location.href);
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
        } catch (e) {
            console.error("[CodeBridge] Codeforces metadata scrape failed:", e);
            return null;
        }
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
            console.log(`[CodeBridge] Fetching submission page (Credentials: include): ${submissionUrl}`);

            // In content script world, fetch will use the tab's cookies automatically.
            const response = await fetch(submissionUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const html = await response.text();
            console.log("[CodeBridge] Page fetched. Length:", html.length);

            // Step 1: Integrity Check (The CSRF Gate)
            // Look for any CSRF indicators: class, data-attribute, or hidden inputs.
            const hasCsrf = html.includes('csrf-token') || html.includes('data-csrf') || html.includes('name="_token"');

            if (!hasCsrf) {
                // Heuristic: If page is small, it might be an error or redirect
                if (html.length < 5000) {
                    throw new Error("Session Error: Page content too small. You might be seeing a login wall or a Cloudflare challenge.");
                }
                // Log warning but proceed if it looks like a full page? No, user asked for pessimistic.
                throw new Error("Session Error: Valid Codeforces page not found (missing CSRF indicators). Ensure you are logged in.");
            }
            console.log("[CodeBridge] CSRF indicators found in page.");

            // Step 2: Locate the Source Code container check
            if (!html.includes('id="program-source-text"')) {
                throw new Error("Structure Error: Submission code container (#program-source-text) not found. The submission might be private or the layout changed.");
            }

            // Step 3: Extract and Decode
            // Since we are in the content script, we can use DOMParser safely.
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const codeEl = doc.querySelector('#program-source-text');

            if (!codeEl) {
                throw new Error("Final Check Error: Code container disappeared during parsing.");
            }

            // innerText automatically decodes HTML entities.
            // However, CF sometimes puts escaped code in there.
            let code = codeEl.innerText || "";

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

            console.log("[CodeBridge] Code block extracted successfully.");

            // Step 4: Extract Metadata (Language)
            let language = "";
            const infoRows = doc.querySelectorAll('.datatable table tr');
            for (const row of infoRows) {
                const cells = row.getElementsByTagName('td');
                if (cells.length > 1) {
                    const label = cells[0].innerText.trim().toLowerCase();
                    if (label === 'lang' || label === 'language' || label.includes('язык')) {
                        language = cells[1].innerText.trim();
                        break;
                    }
                }
            }

            console.log(`[CodeBridge] Successfully extracted code and language: ${language}`);
            return { success: true, code, language };

        } catch (error) {
            console.error("[CodeBridge] Submission fetch/parse error:", error.message);
            return { success: false, message: error.message };
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