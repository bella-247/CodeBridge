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
            const titleEl = document.querySelector('.problem-statement .header .title');
            const title = titleEl ? titleEl.innerText.trim() : document.title;

            const tags = Array.from(document.querySelectorAll('.tag-box')).map(el => el.innerText.trim());

            const difficultyTag = tags.find(t => t.startsWith('*'));
            const difficulty = difficultyTag ? difficultyTag.replace('*', '') : "Unknown";

            const contentEl = document.querySelector('.problem-statement');
            const contentHtml = contentEl ? contentEl.innerHTML : "";

            const urlSlug = this.getSlug(location.href);
            const idMatch = title.match(/^([A-Z0-9]+)\.\s+(.*)/);

            let id = urlSlug;
            let cleanTitle = title;

            if (idMatch) {
                const letter = idMatch[1];
                cleanTitle = idMatch[2];
                // If the slug already contains the letter (like 1850A), use it.
                // If slug is just a number, append the letter.
                if (urlSlug.endsWith(letter)) {
                    id = urlSlug;
                } else if (!isNaN(urlSlug)) {
                    id = urlSlug + letter;
                }
            }

            return {
                id: id,
                title: cleanTitle,
                content: contentHtml,
                difficulty: difficulty,
                topicTags: tags.map(t => ({ name: t.replace('*', '') })),
            };
        } catch (e) {
            console.error("Codeforces DOM scrape for metadata failed", e);
            return null;
        }
    },

    /**
     * Fetches a submission page and extracts the source code and language.
     * @param {string} submissionUrl - The URL of the submission to fetch.
     * @returns {Promise<{code: string, language: string}|null>}
     */
    async extractSolution(submissionUrl) {
        if (!submissionUrl) {
            console.warn("No submission URL provided to extractSolution.");
            return null;
        }

        try {
            console.log(`[CodeBridge] Fetching submission page: ${submissionUrl}`);
            const response = await fetch(submissionUrl);
            if (!response.ok) {
                console.error(`Failed to fetch submission page. Status: ${response.status}`);
                return null;
            }
            const html = await response.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');

            // The source code is inside a <pre> element with a specific ID.
            const codeEl = doc.querySelector('#program-source-text');
            if (!codeEl) {
                console.error("Could not find source code element on submission page.");
                return null;
            }
            const code = codeEl.innerText || "";

            // Find the language from the table of submission details.
            let language = "";
            const infoRows = doc.querySelectorAll('.datatable table tr');
            for (const row of infoRows) {
                const cells = row.getElementsByTagName('td');
                if (cells.length > 1 && cells[0].innerText.trim().toLowerCase() === 'lang') {
                    language = cells[1].innerText.trim();
                    break;
                }
            }


            console.log(`[CodeBridge] Successfully extracted code and language: ${language}`);
            return { code, language };

        } catch (error) {
            console.error("Error during submission fetch and parse:", error);
            return null;
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