// popup.js — ensure device code is clearly visible (removes 'hidden' class and adds prominent styling)
// Simplified and robust: toggles classes instead of relying on inline display to ensure visibility.

const $ = id => document.getElementById(id);

let lastProblemData = null;
let signInPending = false;
const SIGNIN_TIMEOUT_MS = 20000;
let detectInFlight = false;
let autoDetectedOnce = false;

function updateStatus(msg, isError = false) {
  const el = $('status');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? 'var(--error)' : 'var(--text-muted)';
  console.log('[popup] status:', msg);
}

function updateAuthStatus(msg) {
  const el = $('authStatus');
  if (!el) return;
  el.textContent = msg || '';
  console.log('[popup] authStatus:', msg);
}

function setButtonState(button, busy, busyLabel) {
  if (!button) return;
  const labelEl = button.querySelector('span') || button;
  if (!button.dataset.defaultText) {
    button.dataset.defaultText = labelEl.textContent || '';
  }
  button.disabled = !!busy;
  button.classList.toggle('is-busy', !!busy);
  labelEl.textContent = busy ? (busyLabel || 'Working...') : button.dataset.defaultText;
}

function setSignInEnabled(enabled) {
  const btn = $('signInBtn');
  if (!btn) return;
  btn.disabled = !enabled;
  btn.style.opacity = enabled ? '1' : '0.6';
  signInPending = !enabled;
  console.log('[popup] signInEnabled ->', enabled);
}

// Show device info by removing the 'hidden' class and adding a prominent class to the code element
function showDeviceInfo(device) {
  if (!device) return;
  const url = device.verification_uri_complete || device.verification_uri || '';
  const code = device.user_code || '—';
  const deviceInfo = $('deviceInfo');
  const deviceUrl = $('deviceUrl');
  const deviceCode = $('deviceCode');

  if (!deviceInfo || !deviceUrl || !deviceCode) return;

  deviceUrl.textContent = url || 'Open URL';
  deviceUrl.href = url || '#';

  deviceCode.textContent = code;

  // Make code visually prominent via class toggle (styles defined in styles.css)
  deviceCode.classList.add('prominent');

  // Ensure the deviceInfo panel is visible by removing the utility 'hidden' class
  deviceInfo.classList.remove('hidden');

  updateAuthStatus('Code ready — paste into verification tab.');
  updateStatus('A verification tab was opened in the background. Switch to it and paste the code.');
}

// Hide device info by adding the 'hidden' class and removing prominence
function clearDeviceInfo() {
  const deviceInfo = $('deviceInfo');
  const deviceCode = $('deviceCode');
  const deviceUrl = $('deviceUrl');

  if (deviceInfo) deviceInfo.classList.add('hidden');
  if (deviceCode) {
    deviceCode.textContent = '—';
    deviceCode.classList.remove('prominent');
  }
  if (deviceUrl) {
    deviceUrl.textContent = '';
    deviceUrl.href = '#';
  }
}

// Start device flow and show prominent code; open verification tab in background
function startDeviceFlow() {
  if (signInPending) return;
  setSignInEnabled(false);
  updateAuthStatus('Starting authorization...');
  updateStatus('Requesting sign-in code...');

  // Always remember the token by default (no checkbox needed)
  const remember = true;

  // show placeholder immediately
  showDeviceInfo({ user_code: 'Waiting…', verification_uri: '', verification_uri_complete: '' });

  let didRespond = false;
  const timeoutId = setTimeout(() => {
    if (!didRespond) {
      updateStatus('No response from background. Try again.', true);
      setSignInEnabled(true);
      clearDeviceInfo();
    }
  }, SIGNIN_TIMEOUT_MS);

  try {
    chrome.runtime.sendMessage({ action: 'startDeviceFlow', remember }, (resp) => {
      didRespond = true;
      clearTimeout(timeoutId);
      if (chrome.runtime.lastError) {
        updateStatus('Background error: ' + chrome.runtime.lastError.message, true);
        setSignInEnabled(true);
        clearDeviceInfo();
        return;
      }
      if (!resp || !resp.success) {
        updateStatus('Failed to start device flow: ' + (resp && resp.message ? resp.message : 'unknown'), true);
        setSignInEnabled(true);
        clearDeviceInfo();
        return;
      }

      // show real device info and open verification tab in background
      showDeviceInfo(resp.device);
      const url = resp.device.verification_uri_complete || resp.device.verification_uri || '';
      if (url) {
        try {
          chrome.tabs.create({ url, active: false }, () => { });
        } catch (e) {
          // ignore
        }
      }
      // keep sign-in disabled while waiting for background success/error
    });
  } catch (err) {
    clearTimeout(timeoutId);
    updateStatus('Failed to send start request: ' + (err && err.message), true);
    setSignInEnabled(true);
    clearDeviceInfo();
  }
}

// Minimal UI binding and flow for detect/save (kept unchanged)
function bindUI() {
  const signInBtn = $('signInBtn'); if (signInBtn) signInBtn.addEventListener('click', startDeviceFlow);
  const copyBtn = $('copyCodeBtn'); if (copyBtn) copyBtn.addEventListener('click', () => {
    const code = $('deviceCode').textContent || '';
    if (!code || code === '—') { updateStatus('No code to copy', true); return; }
    navigator.clipboard.writeText(code).then(() => updateStatus('Code copied'), () => updateStatus('Copy failed', true));
  });
  const openBtn = $('openUrlBtn'); if (openBtn) openBtn.addEventListener('click', () => {
    const url = $('deviceUrl').href || '';
    if (!url || url === '#') { updateStatus('No URL', true); return; }
    try { chrome.tabs.create({ url, active: true }); } catch (e) { window.open(url, '_blank', 'noopener'); }
  });

  const signOutBtn = $('signOutBtn'); if (signOutBtn) signOutBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'signOut' }, () => {
      updateAuthStatus('Signed out');
      clearDeviceInfo();
      updateStatus('');
      setSignInEnabled(true);
    });
  });

  const detectBtn = $('detectBtn'); if (detectBtn) detectBtn.addEventListener('click', onDetect);
  const saveBtn = $('saveBtn'); if (saveBtn) saveBtn.addEventListener('click', () => onSave({ copyAfter: false }));
  const copyUrlBtn = $('copyUrlBtn'); if (copyUrlBtn) copyUrlBtn.addEventListener('click', () => onSave({ copyAfter: true }));

  const help = $('helpLink'); if (help) help.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('src/help.html') });
  });
}

// Simple detection/upload stubs (unchanged)
function queryActiveTab() {
  return new Promise((resolve) => chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs)));
}

/**
 * Intelligent Problem Detection
 * Leverages the content script (injected via manifest) to gather problem details.
 */
async function onDetect() {
  if (detectInFlight) return;
  detectInFlight = true;
  updateStatus('Detecting problem...');
  const detectBtn = $('detectBtn');
  setButtonState(detectBtn, true, 'Detecting...');
  try {
    const tabs = await queryActiveTab();
    if (!tabs || tabs.length === 0) throw new Error('No active tab found');
    const tab = tabs[0];
    const tabId = tab.id;

    const isSupportedUrl = (url) => {
      if (!url) return false;
      return /leetcode\.com|codeforces\.com|hackerrank\.com/i.test(url);
    };

    const sendProblemRequest = () => new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: 'getProblemData' }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError });
        } else {
          resolve({ response });
        }
      });
    });

    const injectContentScript = () => new Promise((resolve) => {
      try {
        chrome.scripting.executeScript({
          target: { tabId },
          files: ['src/content.js']
        }, () => {
          if (chrome.runtime.lastError) resolve(false);
          else resolve(true);
        });
      } catch (e) {
        resolve(false);
      }
    });

    if (!isSupportedUrl(tab.url)) {
      updateStatus('Open a LeetCode, Codeforces, or HackerRank problem page to detect.', true);
      showMeta(null);
      return;
    }

    let result = await sendProblemRequest();

    // If message fails, attempt a one-time injection + retry (helps after extension reloads)
    if (result.error) {
      console.warn('[popup] detected message error:', result.error.message);
      if (isSupportedUrl(tab.url)) {
        const injected = await injectContentScript();
        if (injected) await new Promise(r => setTimeout(r, 300));
        result = await sendProblemRequest();
      }
    }

    if (result.error) {
      const errorMsg = 'Script not ready. Try re-opening the popup or refreshing this page.';
      updateStatus(errorMsg, true);
      showMeta(null);
      return;
    }

    const response = result.response;
    if (!response || !response.success || !response.data || !response.data.title) {
      const errorMsg = (response && response.message) || 'Unable to detect problem. Check if you are on a problem page.';
      updateStatus(errorMsg, true);
      showMeta(null);
      return;
    }

    showMeta(response.data);
    updateStatus('Problem detected.');
    autoDetectedOnce = true;
  } catch (err) {
    updateStatus(err.message || 'Detect failed', true);
  } finally {
    setButtonState(detectBtn, false);
    detectInFlight = false;
  }
}

const DIFF_ICONS = {
  easy: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="white"/></svg>`,
  medium: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
  hard: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  unknown: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
};

function showMeta(data) {
  const statusEl = $('submissionStatus');
  const diffIconEl = $('difficultyIcon');
  const metaBody = $('metaBody');

  if (statusEl) {
    statusEl.style.display = 'none';
    statusEl.textContent = '';
  }

  if (!data) {
    if (diffIconEl) {
      diffIconEl.className = 'diff-icon unknown';
      diffIconEl.innerHTML = DIFF_ICONS.unknown;
    }
    $('metaTitle').textContent = 'No problem detected';
    if (metaBody) metaBody.classList.add('hidden');
    lastProblemData = null;
    return;
  }

  lastProblemData = data;
  if (metaBody) {
    metaBody.classList.remove('hidden');
    metaBody.classList.remove('pop-in');
    void metaBody.offsetWidth; // force reflow
    metaBody.classList.add('pop-in');
  }

  // Handle Title
  $('metaTitle').textContent = `${data.id ? data.id + ' — ' : ''}${data.title}`;

  // Handle Platform
  if ($('metaPlatform')) {
    $('metaPlatform').textContent = data.platform || 'LeetCode';
    $('metaPlatform').style.display = 'inline-block';
  }

  // Handle Difficulty & Icon
  const rawDiff = (data.difficulty || 'unknown').toLowerCase();
  const diffClass = ['easy', 'medium', 'hard'].includes(rawDiff) ? rawDiff : 'unknown';

  if (diffIconEl) {
    diffIconEl.className = `diff-icon ${diffClass}`;
    diffIconEl.innerHTML = DIFF_ICONS[diffClass] || DIFF_ICONS.unknown;
  }

  $('metaDifficulty').textContent = data.difficulty || 'Unknown';
  $('metaDifficulty').className = `badge ${diffClass}`;

  // Handle Tags
  $('metaTags').innerHTML = (data.tags || []).map(t => `<span class="tag">${t}</span>`).join(' ');

  // Path
  $('detectedPath').textContent = `/${data.folderName}/`;

  // Update language selection if user hasn't explicitly set it
  const langSel = document.getElementById('language');
  if (langSel && !langSel.dataset.userSet) {
    const ext = data.extension || 'txt';
    const hasOption = Array.from(langSel.options || []).some(opt => opt.value === ext);
    if (hasOption) langSel.value = ext;
  }

  // Check if solution code exists
  if (!data.code || data.code.trim().length === 0) {
    updateStatus('Warning: No solution code detected! Extraction failed.', true);
  }

  // Check GitHub for existing submission
  const owner = ($('owner') && $('owner').value.trim()) || '';
  const repo = ($('repo') && $('repo').value.trim()) || '';
  const branch = ($('branch') && $('branch').value.trim()) || 'main';
  const fileOrg = (document.getElementById('fileOrg') && document.getElementById('fileOrg').value) || 'folder';

  if (owner && repo && data.id) {
    if (statusEl) {
      statusEl.textContent = 'Checking GitHub...';
      statusEl.style.display = 'block';
      statusEl.style.color = 'var(--text-muted)';
    }

    const langSel = document.getElementById('language');
    const chosenExt = (langSel && langSel.value) ? langSel.value : (data.extension || 'txt');
    const checkData = { ...data, extension: chosenExt };

    chrome.runtime.sendMessage({
      action: 'checkSubmission',
      problemData: checkData,
      owner,
      repo,
      branch,
      fileOrg
    }, (resp) => {
      if (!statusEl) return;
      if (chrome.runtime.lastError) {
        statusEl.style.display = 'none';
        return;
      }
      // If we are still viewing the same problem (race condition check)
      if (lastProblemData && lastProblemData.id === data.id) {
        if (resp && resp.success && resp.exists) {
          statusEl.textContent = `✓ Solution exists in ${resp.repo}`;
          statusEl.style.color = 'var(--accent)';
          statusEl.style.display = 'block';
        } else {
          statusEl.style.display = 'none';
        }
      }
    });
  }
}



function setSaveButtonsBusy(busy) {
  const saveBtn = $('saveBtn');
  const copyUrlBtn = $('copyUrlBtn');
  setButtonState(saveBtn, busy, 'Saving...');
  setButtonState(copyUrlBtn, busy, 'Saving...');
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (err) {
      return false;
    }
  }
}

function onSave({ copyAfter = false } = {}) {
  updateStatus('Preparing upload...');
  if (!lastProblemData) { updateStatus('No detected problem. Click Detect first.', true); return; }

  if (!lastProblemData.code || lastProblemData.code.trim().length === 0) {
    updateStatus('Error: Solution code not found. Cannot upload.', true);
    return;
  }
  const owner = $('owner').value.trim();
  const repo = $('repo').value.trim();
  const branch = $('branch').value.trim() || 'main';
  const allowUpdate = $('allowUpdate').checked;
  if (!owner || !repo) { updateStatus('Please provide GitHub owner and repository.', true); return; }



  // Determine file organization
  const fileOrg = (document.getElementById('fileOrg') && document.getElementById('fileOrg').value) || 'folder';

  // Use user-selected extension if available, otherwise detected
  const langSel = document.getElementById('language');
  const chosenExt = (langSel && langSel.value) ? langSel.value : (lastProblemData.extension || 'txt');
  const solveTimeEl = document.getElementById('solveTime');
  const solveTimeRaw = solveTimeEl ? (solveTimeEl.value || '').trim() : '';
  if (!solveTimeRaw) {
    updateStatus('Please enter time to solve (e.g., 45 min).', true);
    if (solveTimeEl) solveTimeEl.focus();
    return;
  }
  const solveTime = (() => {
    if (/^\d+$/.test(solveTimeRaw)) return `${solveTimeRaw} min`;
    return solveTimeRaw;
  })();

  const problemData = {
    ...lastProblemData,
    extension: chosenExt,
    solveTime
  };

  const payload = {
    action: 'prepareAndUpload',
    problemData,
    owner,
    repo,
    branch,
    fileOrg,
    allowUpdate
  };

  setSaveButtonsBusy(true);
  try {
    chrome.runtime.sendMessage(payload, (resp) => {
      setSaveButtonsBusy(false);
      if (chrome.runtime.lastError) { updateStatus('Background request failed: ' + chrome.runtime.lastError.message, true); return; }
      if (!resp) { updateStatus('No response from background', true); return; }
      if (resp.success) {
        const uploadedUrl = resp && resp.results && resp.results[0] && resp.results[0].url ? resp.results[0].url : null;
        if (copyAfter) {
          const urlToCopy = uploadedUrl || `https://github.com/${owner}/${repo}`;
          copyTextToClipboard(urlToCopy).then((ok) => {
            updateStatus(ok ? 'Upload succeeded. URL copied.' : 'Upload succeeded, but failed to copy URL.', !ok);
          });
        } else {
          updateStatus('Upload succeeded');
        }
        // Refresh meta view to show the new "Submitted" status immediately
        if (lastProblemData) showMeta(lastProblemData);
        // settings are auto-saved by persistPopupSettings
      } else {
        updateStatus('Upload failed: ' + (resp.message || 'unknown'), true);
      }
    });
  } catch (err) {
    setSaveButtonsBusy(false);
    updateStatus('Upload failed: ' + (err && err.message ? err.message : 'unknown error'), true);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  bindUI();
  // default: hide device panel until auth flow starts/shows it
  clearDeviceInfo();

  // helper: persist popup settings with debounce to avoid excessive writes
  let _saveOptsTimer = null;
  function persistPopupSettings() {
    if (_saveOptsTimer) clearTimeout(_saveOptsTimer);
    _saveOptsTimer = setTimeout(() => {
      try {
        const owner = ($('owner') && $('owner').value.trim()) || '';
        const repo = ($('repo') && $('repo').value.trim()) || '';
        const branch = ($('branch') && $('branch').value.trim()) || '';
        const langSel = document.getElementById('language');
        const lang = (langSel && langSel.value) ? langSel.value : '';
        const fileOrgSel = document.getElementById('fileOrg');
        const fileOrg = (fileOrgSel && fileOrgSel.value) ? fileOrgSel.value : 'folder';
        const allowUpdate = !!(document.getElementById('allowUpdate') && document.getElementById('allowUpdate').checked);
        const showBubble = !!(document.getElementById('showBubble') && document.getElementById('showBubble').checked);
        chrome.storage.local.set({
          github_owner: owner,
          github_repo: repo,
          github_branch: branch,
          github_language: lang,
          github_file_structure: fileOrg,
          allowUpdateDefault: allowUpdate,
          showBubble: showBubble
        }, () => {
          console.log('[popup] persisted settings');
        });
      } catch (e) { console.warn('[popup] persist failed', e && e.message); }
    }, 250);
  }

  // load defaults then check auth status (also restore language & allowUpdate preference)
  chrome.storage.local.get(['github_owner', 'github_repo', 'github_branch', 'github_language', 'github_file_structure', 'allowUpdateDefault', 'showBubble'], (items) => {
    if (items) {
      if (items.github_owner) $('owner').value = items.github_owner;
      if (items.github_repo) $('repo').value = items.github_repo;
      if (items.github_branch) $('branch').value = items.github_branch;
      if (typeof items.allowUpdateDefault !== 'undefined' && document.getElementById('allowUpdate')) {
        document.getElementById('allowUpdate').checked = !!items.allowUpdateDefault;
      }
      if (typeof items.showBubble !== 'undefined' && document.getElementById('showBubble')) {
        try { document.getElementById('showBubble').checked = !!items.showBubble; } catch (e) { }
      }
      if (items.github_language) {
        const sel = document.getElementById('language');
        if (sel) {
          try { sel.value = items.github_language; sel.dataset.userSet = '1'; } catch (e) { /* ignore */ }
        }
      }
      if (items.github_file_structure) {
        const sel = document.getElementById('fileOrg');
        if (sel) {
          try { sel.value = items.github_file_structure; } catch (e) { /* ignore */ }
        }
      }
    }

    // attach auto-save listeners so changes persist immediately
    try {
      const ownerEl = $('owner'); if (ownerEl) ownerEl.addEventListener('input', () => { persistPopupSettings(); if (lastProblemData) showMeta(lastProblemData); });
      const repoEl = $('repo'); if (repoEl) repoEl.addEventListener('input', () => { persistPopupSettings(); if (lastProblemData) showMeta(lastProblemData); });
      const branchEl = $('branch'); if (branchEl) branchEl.addEventListener('input', () => { persistPopupSettings(); if (lastProblemData) showMeta(lastProblemData); });
      const langEl = document.getElementById('language'); if (langEl) langEl.addEventListener('change', () => { langEl.dataset.userSet = '1'; persistPopupSettings(); if (lastProblemData) showMeta(lastProblemData); });
      const fileOrgEl = document.getElementById('fileOrg'); if (fileOrgEl) fileOrgEl.addEventListener('change', () => { persistPopupSettings(); if (lastProblemData) showMeta(lastProblemData); });
      const allowEl = document.getElementById('allowUpdate'); if (allowEl) allowEl.addEventListener('change', persistPopupSettings);
      const showEl = document.getElementById('showBubble'); if (showEl) showEl.addEventListener('change', persistPopupSettings);
    } catch (e) { /* ignore */ }

    // Try to auto-detect the problem immediately when popup opens to reduce clicks.
    // This runs regardless of auth state and will populate metadata if the active tab is a LeetCode problem.
    try { onDetect(); } catch (e) { console.warn('auto-detect on popup open failed', e && e.message); }

    chrome.runtime.sendMessage({ action: 'getAuthStatus' }, (resp) => {
      if (!resp || !resp.success || !resp.authenticated) {
        updateAuthStatus('Not signed in');
        // workflow panel remains hidden until signed in
        return;
      }
      updateAuthStatus('Signed in • ' + (resp.tokenMasked || ''));
      // reveal workflow UI when signed in
      document.getElementById('authPanel') && document.getElementById('authPanel').classList.add('hidden');
      document.getElementById('workflowPanel') && document.getElementById('workflowPanel').classList.remove('hidden');
      document.getElementById('signOutBtn') && document.getElementById('signOutBtn').classList.remove('hidden');
      // auto-detect again once authenticated to ensure metadata is available
      if (!lastProblemData && !autoDetectedOnce) {
        try { onDetect(); } catch (e) { console.warn('auto-detect after auth failed', e && e.message); }
      }
    });
  });

  // listen for background messages
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || !message.action) return;
    if (message.action === 'deviceFlowSuccess') {
      updateAuthStatus('Signed in • ' + (message.tokenMasked || ''));
      clearDeviceInfo();
      // show workflow panel
      document.getElementById('authPanel') && document.getElementById('authPanel').classList.add('hidden');
      document.getElementById('workflowPanel') && document.getElementById('workflowPanel').classList.remove('hidden');
      document.getElementById('signOutBtn') && document.getElementById('signOutBtn').classList.remove('hidden');
      // automatically detect problem after sign-in to prefill fields
      if (!lastProblemData && !autoDetectedOnce) {
        try { onDetect(); } catch (e) { console.warn('auto-detect after sign-in failed', e && e.message); }
      }
    } else if (message.action === 'deviceFlowError') {
      updateAuthStatus('Authorization error');
      updateStatus(message.message || 'Authorization error', true);
      clearDeviceInfo();
      setSignInEnabled(true);
    } else if (message.action === 'deviceFlowExpired') {
      updateAuthStatus('Device flow expired');
      updateStatus('Device flow expired. Please retry sign in.', true);
      clearDeviceInfo();
      setSignInEnabled(true);
    } else if (message.action === 'deviceFlowDenied') {
      updateAuthStatus('Authorization denied');
      updateStatus('Authorization denied by user.', true);
      clearDeviceInfo();
      setSignInEnabled(true);
    } else if (message.action === 'signedOut') {
      updateAuthStatus('Signed out');
      document.getElementById('authPanel') && document.getElementById('authPanel').classList.remove('hidden');
      document.getElementById('workflowPanel') && document.getElementById('workflowPanel').classList.add('hidden');
      document.getElementById('signOutBtn') && document.getElementById('signOutBtn').classList.add('hidden');
      clearDeviceInfo();
      setSignInEnabled(true);
    }
  });
});
