// github/uploadService.js — File upload logic
// This file only thinks about "files → repo"

import { log } from "../../core/logger.js";
import { getToken } from "../auth/tokenStore.js";
import { githubFetch } from "./githubClient.js";
import { ensureRepoExists, getFileShaIfExists } from "./repoService.js";

/**
 * Base64 encode a string (handles unicode)
 * @param {string} str 
 * @returns {string}
 */
function base64EncodeUnicode(str) {
    return btoa(unescape(encodeURIComponent(str || "")));
}

/**
 * Upload or update a single file in a repository
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} path - File path in repo
 * @param {string} base64Content - Base64 encoded content
 * @param {string} message - Commit message
 * @param {string} [branch="main"] - Branch name
 * @param {string} [sha] - Existing file SHA for updates
 * @returns {Promise<Object>} GitHub API response
 */
async function putFile(owner, repo, path, base64Content, message, branch, sha) {
    const body = { message, content: base64Content };
    if (branch) body.branch = branch;
    if (sha) body.sha = sha;

    const res = await githubFetch(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
            repo
        )}/contents/${encodeURIComponent(path)}`,
        {
            method: "PUT",
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json" },
        }
    );

    if (res.status === 201 || res.status === 200) return res.json;

    throw new Error(
        res.json && res.json.message
            ? res.json.message
            : JSON.stringify(res.json)
    );
}

/**
 * Upload multiple files to a GitHub repository
 * @param {Object} options
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {string} [options.branch="main"] - Branch name
 * @param {Array} options.files - Files to upload [{path, content, isBase64?}]
 * @param {string} [options.folder=""] - Optional folder prefix
 * @param {boolean} [options.allowUpdate=false] - Allow overwriting existing files
 * @returns {Promise<{success: boolean, message: string, results?: Array}>}
 */
export async function uploadFilesToRepo({
    owner,
    repo,
    branch = "main",
    files = [],
    folder = "",
    allowUpdate = false,
    commitMessage = null,
}) {
    const token = await getToken();
    if (!token) {
        return { success: false, message: "Not authenticated with GitHub" };
    }

    await ensureRepoExists(owner, repo);

    const conflicts = [];
    const existingMap = {};

    // Check for existing files
    for (const f of files) {
        const path = String(f.path).replace(/^\/+/, "");
        try {
            const sha = await getFileShaIfExists(owner, repo, path, branch);
            if (sha) {
                existingMap[path] = sha;
                conflicts.push(path);
            }
        } catch (err) {
            return {
                success: false,
                message: `Failed to check existing file ${path}: ${err.message}`,
            };
        }
    }

    // Handle conflicts
    if (conflicts.length > 0 && !allowUpdate) {
        return {
            success: false,
            message: `Conflicts: the following files already exist. Enable 'Allow overwrite' to update them: ${conflicts.join(
                ", "
            )}`,
        };
    }

    // Upload files
    const results = [];
    for (const f of files) {
        const path = String(f.path).replace(/^\/+/, "");
        try {
            const contentBase64 = f.isBase64
                ? f.content
                : base64EncodeUnicode(f.content || "");

            // Use custom message if provided, else defaults
            let finalMessage = commitMessage;
            if (!finalMessage) {
                finalMessage = existingMap[path]
                    ? `Update solution for ${path}`
                    : `Add solution for ${path}`;
            }

            const sha = existingMap[path];

            const json = await putFile(
                owner,
                repo,
                path,
                contentBase64,
                finalMessage,
                branch,
                sha
            );

            results.push({
                path,
                url:
                    json && json.content && json.content.html_url
                        ? json.content.html_url
                        : null,
            });
        } catch (err) {
            return {
                success: false,
                message: `Failed to upload ${path}: ${err.message}`,
            };
        }
    }

    return {
        success: true,
        message: `Uploaded ${results.length} files`,
        results,
    };
}
