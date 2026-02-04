// github/repoService.js — Repository operations
// Handles repository existence checks and creation

import { githubFetch } from "./githubClient.js";

/**
 * Ensure a repository exists, creating it if necessary
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {Promise<boolean>} True if repo exists or was created
 */
export async function ensureRepoExists(owner, repo) {
    const getRes = await githubFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        { method: "GET" }
    );

    if (getRes.status === 200) return true;

    if (getRes.status === 404) {
        const createRes = await githubFetch(`/user/repos`, {
            method: "POST",
            body: JSON.stringify({
                name: repo,
                private: true,
                auto_init: false,
            }),
        });

        if (createRes.status === 201) return true;

        throw new Error(
            `Failed to create repo: ${createRes.json && createRes.json.message
                ? createRes.json.message
                : JSON.stringify(createRes.json)
            }`
        );
    }

    throw new Error(
        `Failed to check repo: ${getRes.json && getRes.json.message
            ? getRes.json.message
            : JSON.stringify(getRes.json)
        }`
    );
}

/**
 * Get the SHA of a file if it exists in the repo
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name  
 * @param {string} path - File path
 * @param {string} [branch="main"] - Branch name
 * @returns {Promise<string|null>} File SHA or null if not found
 */
export async function getFileShaIfExists(owner, repo, path, branch = "main") {
    const res = await githubFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
            repo
        )}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(
            branch
        )}`,
        { method: "GET" }
    );

    if (res.status === 200 && res.json && res.json.sha) return res.json.sha;
    if (res.status === 404) return null;

    throw new Error(
        `GitHub GET file failed: ${res.json && res.json.message
            ? res.json.message
            : JSON.stringify(res.json)
        }`
    );
}
