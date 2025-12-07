# LeetCode → GitHub Chrome Extension

Exports solved LeetCode problems into a GitHub repository as organized folders with a solution file and README.

Features
- Detects problem metadata on LeetCode (ID, title, URL, difficulty, tags, description).
- Extracts your solution code from the in-page editor (Monaco, CodeMirror, textarea fallbacks).
- Formats folder name as `XXXX-kebab-title` (zero-padded 4-digit ID).
- Creates `solution.<ext>` and `README.md` inside the folder.
- Uploads files to GitHub using the REST API (PUT /repos/{owner}/{repo}/contents/{path}).
- Avoids overwriting existing files unless you enable "Allow overwrite".
- Popup UI to review metadata, add notes, pick branch and provide token.
- Manifest v3, service worker background script, content script, and popup.

Files in this workspace
- manifest.json — Chrome extension manifest (v3)
- content.js — Content script that extracts problem data from LeetCode
- background.js — Background service worker that performs GitHub API calls
- popup.html — Popup UI shown when clicking extension icon
- popup.js — Popup logic (detect, build files, send upload request)
- README.md — This file
- pi.py — Example script showing LeetCode GraphQL usage (helper reference)

Quick architecture
1. popup → sends a message to the active tab content script (action: `getProblemData`).
2. content script responds with problem metadata and detected code.
3. popup builds the solution filename + README content and sends an `uploadFiles` message to background.
4. background queries GitHub for existing files (conflict detection) and uses PUT /repos/{owner}/{repo}/contents/{path} to create/update files (base64 content).

Security & token
- You must provide a GitHub personal access token (PAT) with the `repo` scope for private repos or the minimum scopes required for public repos.
- Optionally save the token in chrome.storage.local (encrypted by Chrome profile). Keep tokens private.
- The extension performs requests from the browser using your token; do not install third-party builds you don't trust.

Installation (Developer mode)
1. Open Chrome/Chromium (or Edge) and go to chrome://extensions.
2. Enable "Developer mode" (top-right).
3. Click "Load unpacked" and select the extension directory (this workspace).
4. The extension icon will appear in the toolbar.

Required files to include when loading
- manifest.json
- popup.html, popup.js
- content.js
- background.js
- icons/ (optional but referenced in manifest/background notifications). If you don't have icons, create an `icons` folder and add placeholder PNGs named icon16.png, icon48.png, icon128.png.

Usage
1. Open a LeetCode problem in the browser (problem page or editor page).
2. Click the extension icon to open the popup.
3. Click "Detect" — the popup will query the content script on the active tab and populate metadata.
4. Enter GitHub owner and repository, branch (default `main`), and your PAT.
5. Optionally write notes and choose "Allow overwrite" if you want updates to existing files.
6. Click "Save to GitHub".
7. The extension will upload `solution.<ext>` and `README.md` under a folder named `XXXX-kebab-title` (e.g. `0209-minimum-size-subarray-sum`).

Implementation notes & limits
- The extension converts Unicode strings to base64 before sending to GitHub. Files are created/updated via GitHub's contents API.
- Conflict handling: background first checks for existing files and will fail if files exist unless "Allow overwrite" is enabled.
- Branch: the extension writes to the branch you supply. The branch must exist.
- Rate limiting: GitHub has API rate limits; authenticated requests have higher limits. Network errors and API errors are surfaced in the popup status and as notifications.
- LeetCode GraphQL: content.js uses LeetCode's GraphQL endpoint to obtain metadata (title, id, difficulty, content, tags). If LeetCode changes page structure or GraphQL schema, detection may break.

Troubleshooting
- "No content script response": ensure you are on a leetcode.com page and content.js is loaded. Reload the LeetCode tab if needed.
- "Missing owner/repo/token": ensure fields are filled or saved token exists.
- "Conflicts" error: either rename folder/allow overwrite or disable overwrite and resolve manually.
- PUT errors: inspect the response message shown in the popup; token scope or repo permissions are common causes.

Developer notes for extension maintenance
- content.js tries multiple editor types (Monaco, CodeMirror, textarea) but may not capture every editor variant — extend detection heuristics as needed.
- background.js implements synchronous (sequential) uploads to simplify error handling; can be made parallel with appropriate retries.
- Consider adding an options page for permanent default owner/repo/branch, and OAuth web flow to avoid storing PATs.
- Consider adding a commit history file or CHANGELOG per-solution for versioning.

Contributing
- Open a PR with improvements. Keep code modular: extraction, UI and GitHub utilities should remain separate.

License
- This code is provided as-is. Review and modify to fit your security practices.
