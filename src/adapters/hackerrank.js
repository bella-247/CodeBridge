export const HackerRankAdapter = {
    name: "HackerRank",
    matches: () => location.hostname.includes("hackerrank.com"),

    getSubmissionUrl() {
        const links = Array.from(document.querySelectorAll('a[href*="/submissions/code/"]'));
        // Prioritize "Accepted" if visible, but HR status is often an icon
        // For now, return the latest (first) submission link found
        // Improvements can parse the status icon class
        return links[0] ? links[0].href : null;
    },

    async gather() {
        // Title
        const titleEl = document.querySelector('.challenge-title') || document.querySelector('h1.hr_header-title') || document.querySelector('.page-label');
        const title = titleEl ? titleEl.innerText.trim() : document.title;

        // Difficulty
        const diffEl = document.querySelector('.difficulty-label') || document.querySelector('.challenge-difficulty');
        const difficulty = diffEl ? diffEl.innerText.trim() : "Unknown";

        // Tags
        const tags = Array.from(document.querySelectorAll('.challenge-categories-list a, .breadcrumb-item a')).map(a => a.innerText.trim());

        // Language
        const langEl = document.querySelector('.language-selector .ant-select-selection-item') || document.querySelector('.select-language');
        const language = langEl ? langEl.innerText.trim() : "";

        return {
            platform: "HackerRank",
            slug: location.pathname.split('/').filter(p => p && p !== 'challenges' && p !== 'submissions' && p !== 'show')[0] || "unknown",
            id: null,
            title: title.replace(/\s+Solution$/i, ""),
            difficulty,
            tags,
            contentHtml: (document.querySelector('.challenge-body-html') || document.querySelector('.problem-statement') || document.querySelector('.challenge-description'))?.innerHTML || "",
            language,
            folderName: ""
        };
    }
};
