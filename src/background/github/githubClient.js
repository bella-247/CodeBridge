// github/githubClient.js — Low-level GitHub HTTP client
// Only handles HTTP requests with authentication. No business logic.

import { getToken } from "../auth/tokenStore.js";
import { GITHUB_API_BASE } from "../constants.js";

/**
 * Make an authenticated request to the GitHub API
 * @param {string} path - API path (e.g., "/repos/owner/repo")
 * @param {Object} opts - Fetch options (method, body, headers, etc.)
 * @param {string} [token] - Optional token override
 * @returns {Promise<{status: number, json: any, raw: string}>}
 */
export async function githubFetch(path, opts = {}, token = null) {
    token = token || (await getToken());
    if (!token) throw new Error("No GitHub token available");

    const headers = Object.assign({}, opts.headers || {}, {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
    });

    const res = await fetch(
        `${GITHUB_API_BASE}${path}`,
        Object.assign({}, opts, { headers })
    );

    const text = await res.text();
    let json = null;
    try {
        json = text && JSON.parse(text);
    } catch {
        json = text;
    }

    return { status: res.status, json, raw: text };
}
