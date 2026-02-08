# Code Bridge

Code Bridge is a powerful Chrome extension that effortlessly bridges your coding progress by syncing solved problems from LeetCode, Codeforces, and HackerRank directly to your GitHub repository. It automatically organizes your solutions into well-structured folders with solution files and detailed READMEs.

## Quick summary
- Detects problem metadata on LeetCode (ID, title, URL, difficulty, tags, description).
- Extracts your solution code from the in-page editor (Monaco, CodeMirror, textarea fallbacks).
- Formats folder name as `XXXX-kebab-title` (zero-padded 4-digit ID).
- Creates `solution.<ext>` and `README.md` inside the folder.
- Uploads files to GitHub using the REST API (PUT /repos/{owner}/{repo}/contents/{path}).
- Avoids overwriting existing files unless you enable "Allow overwrite".
- Manifest v3 with service worker; source files are under `src/`.

## Files layout
- manifest.json
- src/
  - content.js — content script injected into LeetCode pages
  - popup.html — popup UI
  - popup.js — popup logic
  - background.js — service worker (handles GitHub API)
- icons/icon.png (icon referenced by manifest)

## Run locally & "Load unpacked" (clear steps)

1. Prepare workspace
   - Ensure the repository folder contains: `manifest.json`, `src/` and `icons/icon.png`.
   - If you don't have icons, add placeholder PNGs at `icons/icon.png` (recommended sizes 128×128, 48×48, 16×16).

2. Open Chrome/Edge and go to the extensions page
   - Address bar: chrome://extensions (or edge://extensions)

3. Enable Developer mode
   - Toggle "Developer mode" ON (top-right).

4. Load the extension (unpacked)
   - Click "Load unpacked".
   - In the file picker select the extension root folder (the folder that contains `manifest.json`). Example on Windows:
     - c:\Users\<you>\Desktop\CodeBridge
   - Chrome will read `manifest.json` and register the extension.

5. Inspect the extension
   - The extension will appear in the list. You can:
     - Click "Details" → toggle "Allow in incognito" if you want incognito testing.
     - Use "Inspect views" → Service worker (under the entry) to open DevTools for the background service worker.
     - Use the extension toolbar icon to open the popup (or pin the extension).

6. Test on LeetCode
   - Open a LeetCode problem page (URL example: https://leetcode.com/problems/two-sum/).
   - Click the extension icon → popup opens.
   - Click "Detect" — the popup will query the content script running on the active tab and populate metadata.
   - Fill GitHub Owner and Repository, branch (must exist), and your Personal Access Token (PAT) with repo scope.
   - Optionally add notes and check "Allow overwrite" to permit updates to existing files.
   - Click "Save to GitHub". The popup will call the background service worker to upload files.

7. Reload / apply changes during development
   - If you edit files under `src/` or `manifest.json`, go back to chrome://extensions and click "Reload" on the extension card.
   - Alternatively, remove and "Load unpacked" again.
   - After reloading, re-open the target LeetCode tab and click the popup Detect again.

## Debugging tips
- Content script logs:
  - Open the LeetCode page DevTools (F12) → Console to see logs or errors from `src/content.js`.
- Background/service-worker logs:
  - chrome://extensions → find extension → click "Service worker" → "Inspect" to open Service Worker DevTools console and network panel.
- If popup cannot contact content script:
  - Confirm the active tab is on a `https://leetcode.com/*` URL.
  - Ensure `tabs` permission is present in `manifest.json`.
  - Reload the LeetCode tab and click Detect again.
- GitHub API errors:
  - Check popup status message and service worker console for detailed messages (permission, token scope, non-existent branch).

## Security & token
- Use a GitHub PAT with `repo` scope for private repositories or minimal scopes required for public repos.
- You may optionally save the token in chrome.storage.local via the popup; that storage is tied to your Chrome profile.
- Keep PATs private and avoid publishing them.

## Common problems & fixes
- "No content script response": make sure you are on `leetcode.com` and the content script is loaded. Reload the tab and extension.
- "Conflicts" error: either enable "Allow overwrite" in the popup or manually remove/rename existing files in the repo first.
- Branch errors: ensure the branch you selected exists in the target repo.

## Next steps / improvements
- Add an Options page for persistent defaults (owner/repo/branch).
- Add OAuth flow to avoid storing PATs.
- Improve editor detection heuristics if LeetCode updates their editor implementation.

## Contact / contribution
- Modify code in `src/`, reload the extension in Developer mode to test changes.
- Pull requests are welcome; keep extraction, UI, and GitHub utilities modular.
