/**
 * LeetCode Scraper Adapter
 */
export const LeetCodeScraper = {
    platform: 'LeetCode',

    // Check if the current URL belongs to this platform
    matches(url) {
        return url.includes('leetcode.com');
    },

    // Get the problem slug from URL
    getSlug(url) {
        try {
            const parts = new URL(url).pathname.split("/").filter(Boolean);
            const idx = parts.indexOf("problems");
            if (idx !== -1 && parts.length > idx + 1) return parts[idx + 1];
            return parts[parts.length - 1] || "";
        } catch (e) {
            return "";
        }
    },

    // Fetch metadata via GraphQL or DOM
    async fetchMetadata(slug) {
        const url = "https://leetcode.com/graphql/";
        const query = {
            query: `
                query getQuestionDetail($titleSlug: String!) {
                    question(titleSlug: $titleSlug) {
                        questionId
                        title
                        content
                        difficulty
                        topicTags {
                            name
                            slug
                        }
                    }
                }
            `,
            variables: { titleSlug: slug },
        };

        try {
            const res = await fetch(url, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(query),
            });
            if (!res.ok) return null;
            const json = await res.json();
            return json?.data?.question || null;
        } catch (err) {
            console.error("LeetCode GraphQL fetch failed", err);
            return null;
        }
    },

    // Extract code from the page
    async extractCode() {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: "executeCodeExtraction" }, (response) => {
                if (chrome.runtime.lastError || !response || !response.success) {
                    resolve({ code: "", languageId: null });
                } else {
                    resolve(response.data);
                }
            });
        });
    },

    // Detect language from UI
    getLanguage() {
        try {
            const btn = document.querySelector('[data-cy="lang-select"] button span');
            if (btn) return btn.innerText.trim();
            const selected = document.querySelector(".ant-select-selection-item");
            if (selected) return selected.innerText.trim();
            return null;
        } catch (e) {
            return null;
        }
    },

    // Format folder name
    formatFolderName(id, title) {
        const pad = id ? String(id).padStart(4, "0") : "0000";
        const kebab = title
            .toLowerCase()
            .replace(/[`~!@#$%^&*()+=\[\]{};:'"\\|<>\/?]/g, "")
            .replace(/\s+/g, "-")
            .replace(/--+/g, "-")
            .replace(/^-+|-+$/g, "");
        return `${pad}-${kebab}`;
    }
};
