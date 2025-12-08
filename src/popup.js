// popup.js — UI logic for LeetCode → GitHub extension
// Enhancements:
// - Prefill owner/repo/branch/token from chrome.storage.local (options)
// - Show auto-save status when enabled in options
// - Provide link to Options page (opens extension options)

const $ = id => document.getElementById(id);

let lastProblemData = null;

async function init() {
  bindEvents();
  // restore saved settings (owner, repo, branch, token, autoSave)
  chrome.storage.local.get(['github_token', 'github_owner', 'github_repo', 'github_branch', 'autoSave'], (items) => {
    if (items) {
      if (items.github_token) {
        $('token').value = items.github_token;
        $('saveToken').checked = true;
      }
      if (items.github_owner) $('owner').value = items.github_owner;
      if (items.github_repo) $('repo').value = items.github_repo;
      if (items.github_branch) $('branch').value = items.github_branch;
      if (items.autoSave) {
        updateStatus('Auto-save enabled in Options — solutions may be pushed automatically.', false);
      }
    }
  });
  updateStatus('');
  // small UX: add options link
  addOptionsLink();
}

function addOptionsLink() {
  const link = document.createElement('div');
  link.style.marginTop = '8px';
  link.className = 'muted';
  link.innerHTML = '<a id="openOptions" href="#" style="font-size:12px">Open Options</a>';
  document.body.appendChild(link);
  document.getElementById('openOptions').addEventListener('click', (e) => {
    e.preventDefault();
    // open options page
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      // fallback: open options.html directly in a new tab
      chrome.tabs.create({ url: chrome.runtime.getURL('src/options.html') });
    }
  });
}

function bindEvents() {
  $('detectBtn').addEventListener('click', onDetect);
  $('saveBtn').addEventListener('click', onSave);
}

function updateStatus(msg, isError = false) {
  const el = $('status');
  el.textContent = msg || '';
  el.style.color = isError ? '#9b2c2c' : '#1a202c';
}

// Strip HTML safely for README
function stripHtml(html) {
  if (!html) return '';
  try {
    const d = document.createElement('div');
    d.innerHTML = html;
    return d.textContent || d.innerText || '';
  } catch {
    return html;
  }
}

function showMeta(data) {
  if (!data) {
    $('metaTitle').textContent = 'No problem detected';
    $('metaIdUrl').textContent = '';
    $('metaDifficulty').textContent = '';
    $('metaTags').innerHTML = '';
    $('metaLangExt').textContent = '';
    $('detectedPath').textContent = '/0000-unknown/';
    lastProblemData = null;
    return;
  }
  lastProblemData = data;
  $('metaTitle').textContent = `${data.id || '0000'} — ${data.title}`;
  $('metaIdUrl').textContent = data.url || '';
  $('metaDifficulty').textContent = data.difficulty ? `Difficulty: ${data.difficulty}` : '';
  $('metaTags').innerHTML = (data.tags || []).map(t => `<span class="tag">${t}</span>`).join(' ');
  $('metaLangExt').textContent = `Detected language: ${data.language || 'unknown'} — .${data.extension || 'txt'}`;
  $('detectedPath').textContent = `/${data.folderName}/`;
}

// Detect current page's problem by messaging content script
async function onDetect() {
  updateStatus('Detecting problem on active tab...');
  try {
    const tabs = await queryActiveTab();
    if (!tabs || tabs.length === 0) throw new Error('No active tab found');
    const tabId = tabs[0].id;
    chrome.tabs.sendMessage(tabId, { action: 'getProblemData' }, (response) => {
      if (chrome.runtime.lastError) {
        updateStatus('No content script response. Make sure you are on a leetcode.com problem page.', true);
        showMeta(null);
        return;
      }
      if (!response || !response.success) {
        updateStatus('Failed to detect problem data.', true);
        showMeta(null);
        return;
      }
      const d = response.data;
      showMeta(d);
      updateStatus('Problem detected. Review fields and click "Save to GitHub".');
    });
  } catch (err) {
    updateStatus(err.message || 'Detection failed', true);
  }
}

function queryActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs));
  });
}

function buildReadme(problemData, notes) {
  const title = problemData.title || '';
  const url = problemData.url || '';
  const tags = (problemData.tags || []).join(', ');
  const difficulty = problemData.difficulty || '';
  const description = stripHtml(problemData.contentHtml || '').trim();

  const lines = [];
  lines.push(`# ${title}`);
  lines.push('');
  if (difficulty) lines.push(`**Difficulty:** ${difficulty}`);
  if (tags) lines.push(`**Tags:** ${tags}`);
  if (url) lines.push(`**URL:** ${url}`);
  lines.push('');
  if (description) {
    lines.push('## Problem');
    lines.push('');
    lines.push(description);
    lines.push('');
  }
  if (notes && notes.trim()) {
    lines.push('## My notes');
    lines.push('');
    lines.push(notes.trim());
    lines.push('');
  }
  lines.push('---');
  lines.push('_Generated by LeetCode → GitHub Chrome extension_');
  return lines.join('\n');
}

async function onSave() {
  updateStatus('Preparing files...');
  try {
    if (!lastProblemData) {
      updateStatus('No detected problem data. Click Detect first.', true);
      return;
    }
    const owner = $('owner').value.trim();
    const repo = $('repo').value.trim();
    const branch = $('branch').value.trim() || 'main';
    let token = $('token').value.trim();
    const saveToken = $('saveToken').checked;
    const notes = $('notes').value || '';
    const allowUpdate = $('allowUpdate').checked;

    if (!owner || !repo) {
      updateStatus('Please provide GitHub owner and repository.', true);
      return;
    }
    if (!token) {
      // try stored token
      const items = await new Promise(resolve => chrome.storage.local.get(['github_token'], resolve));
      token = items && items.github_token ? items.github_token : '';
      if (!token) {
        updateStatus('No token provided. Enter a GitHub personal access token with repo scope.', true);
        return;
      }
    }
    if (saveToken) {
      chrome.storage.local.set({ github_token: token });
    } else {
      chrome.storage.local.remove('github_token');
    }

    // Prepare files
    const folder = lastProblemData.folderName;
    const solutionName = `solution.${lastProblemData.extension || 'txt'}`;
    const solutionContent = lastProblemData.code || '';
    const readmeContent = buildReadme(lastProblemData, notes);

    // Send upload request to background
    updateStatus('Uploading to GitHub...');
    const payload = {
      action: 'uploadFiles',
      owner,
      repo,
      branch,
      token,
      folder,
      files: [
        { path: `${folder}/${solutionName}`, content: solutionContent, isBase64: false },
        { path: `${folder}/README.md`, content: readmeContent, isBase64: false }
      ],
      allowUpdate
    };

    chrome.runtime.sendMessage(payload, (resp) => {
      if (chrome.runtime.lastError) {
        updateStatus('Background request failed: ' + chrome.runtime.lastError.message, true);
        return;
      }
      if (!resp) {
        updateStatus('No response from background.', true);
        return;
      }
      if (resp.success) {
        updateStatus('Upload succeeded: ' + (resp.message || ''), false);
      } else {
        updateStatus('Upload failed: ' + (resp.message || 'unknown error'), true);
      }
    });

  } catch (err) {
    updateStatus(err.message || 'Save failed', true);
  }
}

// initialize when DOM loaded
document.addEventListener('DOMContentLoaded', init);
