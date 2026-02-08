export const LeetCodeAdapter = {
    name: "LeetCode",
    matches: () => location.hostname.includes("leetcode.com"),

    getSubmissionUrl() {
        return null; // LeetCode editor extraction is usually sufficient/different API
    },

    async gather() {
        const parts = location.pathname.split("/").filter(Boolean);
        const idx = parts.indexOf("problems");
        const slug = (idx !== -1 && parts.length > idx + 1) ? parts[idx + 1] : (parts[parts.length - 1] || "");

        // Fetch via GraphQL
        const gql = await (async (s) => {
            const url = "https://leetcode.com/graphql/";
            const query = {
                query: `query getQuestionDetail($titleSlug: String!) { question(titleSlug: $titleSlug) { questionId title content difficulty topicTags { name } } }`,
                variables: { titleSlug: s },
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
            } catch (err) { return null; }
        })(slug);

        const uiLang = (() => {
            const btn = document.querySelector('[data-cy="lang-select"] button span');
            if (btn) return btn.innerText.trim();
            const selected = document.querySelector(".ant-select-selection-item");
            return selected ? selected.innerText.trim() : null;
        })();

        const title = gql?.title || document.title || slug || "unknown";
        const id = gql?.questionId || null;

        return {
            platform: "LeetCode",
            slug,
            id,
            title,
            difficulty: gql?.difficulty || "Unknown",
            tags: (gql?.topicTags || []).map(t => t.name),
            contentHtml: gql?.content || "",
            language: uiLang || "",
            folderName: ""
        };
    }
};
