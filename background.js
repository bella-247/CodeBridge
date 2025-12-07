// background.js — service worker (module) for LeetCode → GitHub exporter
// Responsibilities:
// - Receive upload requests from popup
// - Interact with GitHub REST API to create/update files using PUT /repos/{owner}/{repo}/contents/{path}
// - Handle conflicts (existing files/folders) according to allowUpdate flag
// - Provide structured responses back to popup and show desktop notifications
//
// Notes:
// - This file contains the GitHub upload utilities inline so the service worker is self-contained.
// - Uses async/await and fetch. The popup sends a payload with owner, repo, branch, token, files (path/content/isBase64), allowUpdate.
//
// Example message from popup:
// {
//   action: 'uploadFiles',
//   owner, repo, branch, token, folder,
//   files: [{ path: '0209-minimum-size-subarray-sum/solution.py', content: 'print(1)', isBase64: false }, ...],
//   allowUpdate: true|false
// }

const GITHUB_API_BASE = 'https://api.github.com';

function base64EncodeUnicode(str) {
  // Properly encode Unicode to base64
  return btoa(unescape(encodeURIComponent(str)));
}

async function githubGetFile(owner, repo, path, token, branch) {
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json'
    }
  });
  if (res.status === 200) {
    const json = await res.json();
    return { exists: true, json };
  }
  if (res.status === 404) return { exists: false };
  // some other error
  const text = await res.text();
  throw new Error(`GitHub GET error ${res.status}: ${text}`);
}

async function githubPutFile(owner, repo, path, base64Content, token, branch, message, sha = undefined) {
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}`;
  const body = {
    message,
    content: base64Content,
    branch
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  if (res.ok) return { success: true, json };
  // GitHub returns useful message in json.message
  throw new Error(`GitHub PUT failed ${res.status}: ${json && json.message ? json.message : JSON.stringify(json)}`);
}

async function uploadFilesToRepo({ owner, repo, branch = 'main', token, files = [], folder, allowUpdate = false }) {
  if (!owner || !repo || !token || !files || files.length === 0) {
    return { success: false, message: 'Missing required parameters' };
  }

  // Normalize branch
  branch = branch || 'main';

  // First: check for conflicting existing files
  const conflicts = [];
  const existingMap = {}; // path -> sha

  for (const f of files) {
    try {
      const getRes = await githubGetFile(owner, repo, f.path, token, branch);
      if (getRes.exists) {
        const sha = getRes.json.sha;
        existingMap[f.path] = sha;
        conflicts.push(f.path);
      }
    } catch (err) {
      // If GET fails with non-404, bubble up
      return { success: false, message: `Failed to check existing file ${f.path}: ${err.message}` };
    }
  }

  if (conflicts.length > 0 && !allowUpdate) {
    return { success: false, message: `Conflicts: the following files already exist. Enable 'Allow overwrite' to update them: ${conflicts.join(', ')}` };
  }

  // Now perform create/update per file (sequentially to simplify error handling)
  const results = [];
  for (const f of files) {
    try {
      const contentBase64 = f.isBase64 ? f.content : base64EncodeUnicode(f.content || '');
      const message = `Add/update LeetCode solution: ${folder || ''} / ${f.path}`;
      const sha = existingMap[f.path]; // may be undefined
      const putRes = await githubPutFile(owner, repo, f.path, contentBase64, token, branch, message, sha);
      results.push({ path: f.path, success: true, url: putRes.json.content && putRes.json.content.html_url ? putRes.json.content.html_url : null });
    } catch (err) {
      // Stop on first error and report
      return { success: false, message: `Failed to upload ${f.path}: ${err.message}` };
    }
  }

  return { success: true, message: `Uploaded ${results.length} files`, results };
}

// Notification helper
function notify(title, message) {
  try {
    // Use chrome.notifications if available
    if (chrome && chrome.notifications && chrome.notifications.create) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title,
        message
      });
    }
  } catch (e) {
    // ignore
  }
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.action !== 'uploadFiles') return;

  (async () => {
    const { owner, repo, branch, token, files, folder, allowUpdate } = message;

    try {
      // Validate basic inputs
      if (!owner || !repo || !token) {
        sendResponse({ success: false, message: 'Missing owner/repo/token' });
        return;
      }
      // Sanitize file paths: ensure no leading slash
      const sanitizedFiles = (files || []).map(f => ({
        path: String(f.path).replace(/^\/+/, ''),
        content: f.content || '',
        isBase64: !!f.isBase64
      }));

      const res = await uploadFilesToRepo({
        owner,
        repo,
        branch,
        token,
        files: sanitizedFiles,
        folder,
        allowUpdate
      });

      if (res.success) {
        notify('LeetCode → GitHub', `Upload succeeded: ${res.message}`);
        sendResponse({ success: true, message: res.message, results: res.results || [] });
      } else {
        notify('LeetCode → GitHub', `Upload failed: ${res.message}`);
        sendResponse({ success: false, message: res.message });
      }
    } catch (err) {
      notify('LeetCode → GitHub', `Upload error: ${err.message}`);
      sendResponse({ success: false, message: `Unexpected error: ${err.message}` });
    }
  })();

  // Return true to indicate we'll call sendResponse asynchronously
  return true;
});
