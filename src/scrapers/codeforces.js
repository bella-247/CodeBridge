/**
 * Codeforces Scraper Adapter
 */
export const CodeforcesScraper = {
    platform: 'Codeforces',

    matches(url) {
        return url.includes('codeforces.com');
    },

    getSlug(url) {
        // Example: https://codeforces.com/contest/1850/problem/A
        try {
            const parts = new URL(url).pathname.split("/").filter(Boolean);
            if (parts.includes("contest") || parts.includes("problemset")) {
                const id = parts[parts.indexOf("problem") - 1] || parts[parts.indexOf("problem") + 1] || "";
                const letter = parts[parts.indexOf("problem") + 1] || "";
                return `${id}${letter}`;
            }
            return parts[parts.length - 1] || "unknown";
        } catch (e) {
            return "unknown";
        }
    },

    async fetchMetadata(slug) {
        // Scrape from DOM since CF doesn't have a public GraphQL for this easily
        try {
            const titleEl = document.querySelector('.problem-statement .header .title');
            const title = titleEl ? titleEl.innerText.trim() : document.title;

            const timeLimit = document.querySelector('.time-limit')?.innerText || "";
            const memoryLimit = document.querySelector('.memory-limit')?.innerText || "";

            const tags = Array.from(document.querySelectorAll('.tag-box')).map(el => el.innerText.trim());

            // Difficulty is often a tag like "*800"
            const difficultyTag = tags.find(t => t.startsWith('*'));
            const difficulty = difficultyTag ? difficultyTag.replace('*', '') : "Unknown";

            const contentEl = document.querySelector('.problem-statement');
            const contentHtml = contentEl ? contentEl.innerHTML : "";

            // Extract ID from title (e.g. "A. Waterberry")
            const idMatch = title.match(/^([A-Z0-9]+)\.\s+(.*)/);
            const id = idMatch ? idMatch[1] : slug;
            const cleanTitle = idMatch ? idMatch[2] : title;

            return {
                questionId: id,
                title: cleanTitle,
                content: contentHtml,
                difficulty: difficulty,
                topicTags: tags.map(t => ({ name: t }))
            };
        } catch (e) {
            console.error("Codeforces DOM scrape failed", e);
            return null;
        }
    },

    async extractCode() {
        // On CF, users often use a textarea in the "Submit" tab or a local file.
        // If we are on the problem page, there might not be an editor.
        // We'll look for any common editor class or textarea.
        const textarea = document.querySelector('textarea#editor') || document.querySelector('.ace_text-input') || document.querySelector('textarea');
        if (textarea) {
            // If it's Ace Editor
            if (window.ace && textarea.parentElement && textarea.parentElement.classList.contains('ace_editor')) {
                const editor = ace.edit(textarea.parentElement);
                return { code: editor.getValue(), languageId: null };
            }
            return { code: textarea.value, languageId: null };
        }
        return { code: "", languageId: null };
    },

    getLanguage() {
        // Try to find a language dropdown
        const langSelect = document.querySelector('select[name="programTypeId"]');
        if (langSelect) {
            return langSelect.options[langSelect.selectedIndex].text.trim();
        }
        return null;
    },

    formatFolderName(id, title) {
        const kebab = title
            .toLowerCase()
            .replace(/[`~!@#$%^&*()+=\[\]{};:'"\\|<>\/?]/g, "")
            .replace(/\s+/g, "-")
            .replace(/--+/g, "-")
            .replace(/^-+|-+$/g, "");
        return `CF-${id}-${kebab}`;
    }
};
