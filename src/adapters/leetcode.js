export const LeetCodeAdapter = {
    name: "LeetCode",
    matches: () => location.hostname.includes("leetcode.com"),
    _cache: {
        slug: null,
        fetchedAt: 0,
        question: null
    },
    _cacheTtlMs: 10000,

    getSubmissionUrl() {
        return null; // LeetCode editor extraction is usually sufficient/different API
    },

    async gather() {
        const parts = location.pathname.split("/").filter(Boolean);
        const idx = parts.indexOf("problems");
        const slug = (idx !== -1 && parts.length > idx + 1) ? parts[idx + 1] : (parts[parts.length - 1] || "");

        // Try to read from in-page data first (no network)
        const fromDom = readQuestionFromPage();
        if (fromDom) {
            return {
                platform: "LeetCode",
                slug,
                id: fromDom.questionId || null,
                title: fromDom.title || document.title || slug || "unknown",
                difficulty: fromDom.difficulty || "Unknown",
                tags: (fromDom.topicTags || []).map(t => t.name).filter(Boolean),
                contentHtml: fromDom.content || "",
                language: getUiLanguage(),
                folderName: ""
            };
        }

        // Fetch via GraphQL (cached to reduce rate limits)
        const now = Date.now();
        let gql = null;
        const cacheValid = this._cache.question && this._cache.slug === slug && (now - this._cache.fetchedAt) < this._cacheTtlMs;
        if (cacheValid) {
            gql = this._cache.question;
        } else {
            gql = await (async (s) => {
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
            if (gql) {
                this._cache.slug = slug;
                this._cache.fetchedAt = now;
                this._cache.question = gql;
            } else if (this._cache.question && this._cache.slug === slug) {
                // fallback to cached data if rate limited
                gql = this._cache.question;
            }
        }

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
            language: getUiLanguage() || "",
            folderName: ""
        };
    }
};

function getUiLanguage() {
    const btn = document.querySelector('[data-cy="lang-select"] button span');
    if (btn) return btn.innerText.trim();
    const selected = document.querySelector(".ant-select-selection-item");
    return selected ? selected.innerText.trim() : null;
}

function readQuestionFromPage() {
    try {
        const script = document.getElementById("__NEXT_DATA__");
        if (!script || !script.textContent) return null;
        const data = JSON.parse(script.textContent);
        return findQuestionNode(data);
    } catch (e) {
        return null;
    }
}

function findQuestionNode(root) {
    if (!root || typeof root !== "object") return null;
    const stack = [root];
    const seen = new Set();
    let steps = 0;
    while (stack.length && steps < 10000) {
        const node = stack.pop();
        steps += 1;
        if (!node || typeof node !== "object") continue;
        if (seen.has(node)) continue;
        seen.add(node);

        if (node.questionId && node.title && node.content && node.difficulty) {
            return node;
        }

        if (Array.isArray(node)) {
            for (const item of node) {
                if (item && typeof item === "object") stack.push(item);
            }
        } else {
            for (const key of Object.keys(node)) {
                const val = node[key];
                if (val && typeof val === "object") stack.push(val);
            }
        }
    }
    return null;
}
