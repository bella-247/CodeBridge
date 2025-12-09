# Device Flow Setup & Troubleshooting

Why you saw "Failed to start device flow"
- The background service worker rejects the start when the CLIENT_ID placeholder is still present in `src/background.js`. The guard throws:
  ```javascript
  if (!CLIENT_ID || CLIENT_ID.startsWith('<')) {
    throw new Error('CLIENT_ID not set in background.js. Set your GitHub OAuth App client id.');
  }
  ```

Quick steps to fix and test (no PAT required)
1. Create a GitHub OAuth App
   - GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
   - Name: e.g. "LeetCode → GitHub Exporter"
   - Homepage URL: your choice (can be your repo URL)
   - Authorization callback URL: not required for Device Flow (you can set `http://localhost`)
   - Click "Register application"; copy the Client ID

2. Update `src/background.js`
   - Open the file and replace the placeholder line:
     ```javascript
     // Replace with your GitHub OAuth App client id
     const CLIENT_ID = '<YOUR_GITHUB_OAUTH_CLIENT_ID>';
     ```
     with (example)
     ```javascript
     const CLIENT_ID = 'your_actual_github_oauth_client_id_here';
     ```
   - Do NOT add any client secret. Device Flow does not use a client secret in the client.

3. Reload the extension
   - Open chrome://extensions (or edge://extensions)
   - Enable Developer mode
   - Click "Reload" for the unpacked extension (or "Load unpacked" and pick `c:\Users\ms\Desktop\CodeBridge`)

4. Start Device Flow from the popup
   - Open extension popup
   - Check "Remember me" if you want token saved in chrome.storage.local
   - Click "Sign in with GitHub"
   - The popup will display:
     - verification_uri or verification_uri_complete (clickable)
     - user_code
   - Open the verification link and enter the code, or open `verification_uri_complete`

5. If you still see errors — inspect the service worker console
   - On chrome://extensions find the extension → click "Service worker" / "Inspect views: service worker"
   - In the console run:
     ```javascript
     chrome.runtime.sendMessage({ action: 'startDeviceFlow', remember: true }, resp => console.log(resp));
     ```
   - Or trigger from popup and watch console logs / network errors.
   - Look for thrown error messages (e.g. network failure, invalid client_id, JSON parse error)

6. Common issues
   - client_id incorrect or accidentally includes angle brackets — ensure exact Client ID string.
   - Network blocked to github.com — ensure network allows requests to github.com/login/device/code and github.com/login/oauth/access_token.
   - Browser caching: after editing files, always Reload the extension.

7. Next steps after sign-in
   - Detect a LeetCode problem, fill owner/repo, click Save to GitHub.
   - The background will auto-create the repo if it does not exist and upload the files using Bearer Authorization.

Progress checklist
- [x] Investigated cause of "Failed to start device flow"
- [x] Confirmed CLIENT_ID placeholder is present
- [ ] Replace CLIENT_ID in src/background.js with your OAuth App client id
- [ ] Reload extension and perform Device Flow sign-in
- [ ] Verify uploads to GitHub

If you want, I can also:
- Update background.js to surface the exact HTTP response from the device endpoint (for easier debugging). Request me to make that change and I will update the file.
