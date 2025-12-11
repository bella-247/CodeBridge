// popup.js — ensure device code is clearly visible (removes 'hidden' class and adds prominent styling)
// Simplified and robust: toggles classes instead of relying on inline display to ensure visibility.

const $ = id => document.getElementById(id);

let lastProblemData = null;
let signInPending = false;
const SIGNIN_TIMEOUT_MS = 20000;

function updateStatus(msg, isError = false) {
  const el = $('status');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? '#9b2c2c' : '#1a202c';
  console.log('[popup] status:', msg);
}

function updateAuthStatus(msg) {
  const el = $('authStatus');
  if (!el) return;
  el.textContent = msg || '';
  console.log('[popup] authStatus:', msg);
}

// sanitize HTML -> text for README generation
function stripHtml(html) {
  if (!html) return '';
  try {
    const d = document.createElement('div');
    d.innerHTML = html;
    return d.textContent || d.innerText || '';
  } catch (e) {
    console.warn('stripHtml failed', e && e.message);
    return String(html);
  }
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

  const remember = !!$('rememberMe').checked;

  // warn user if they didn't opt to persist token
  if (!remember) {
    updateStatus('Warning: token will NOT be saved if you close this popup. Keep it open until authorization completes or check "Remember me".', true);
  }

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
          chrome.tabs.create({ url, active: false }, () => {});
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
  const saveBtn = $('saveBtn'); if (saveBtn) saveBtn.addEventListener('click', onSave);

  const help = $('helpLink'); if (help) help.addEventListener('click', (e) => {
    e.preventDefault();
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    else chrome.tabs.create({ url: chrome.runtime.getURL('src/DEVICE_FLOW_SETUP.md') });
  });
}

// Simple detection/upload stubs (unchanged)
function queryActiveTab() {
  return new Promise((resolve) => chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs)));
}

async function onDetect() {
  updateStatus('Detecting problem...');
  try {
    const tabs = await queryActiveTab();
    if (!tabs || tabs.length === 0) throw new Error('No active tab found');
    const tabId = tabs[0].id;
    try { await new Promise((resolve) => chrome.scripting.executeScript({ target: { tabId }, files: ['src/content.js'] }, () => resolve())); } catch (e) {}
    await new Promise(r => setTimeout(r, 250));
    chrome.tabs.sendMessage(tabId, { action: 'getProblemData' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.success) {
        updateStatus('Unable to detect problem on this tab.', true);
        showMeta(null);
        return;
      }
      showMeta(response.data);
      updateStatus('Problem detected. Click Save to upload.');
    });
  } catch (err) {
    updateStatus(err.message || 'Detect failed', true);
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

function buildReadme(problemData) {
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
  lines.push('---');
  lines.push('_Generated by CodeBridge extension_');
  return lines.join('\n');
}

function onSave() {
  updateStatus('Preparing upload...');
  if (!lastProblemData) { updateStatus('No detected problem. Click Detect first.', true); return; }
  const owner = $('owner').value.trim();
  const repo = $('repo').value.trim();
  const branch = $('branch').value.trim() || 'main';
  const allowUpdate = $('allowUpdate').checked;
  if (!owner || !repo) { updateStatus('Please provide GitHub owner and repository.', true); return; }

  // Persist current owner/repo/branch and language so user isn't asked again
  const langSel = document.getElementById('language');
  const chosenExt = (langSel && langSel.value) ? langSel.value : (lastProblemData.extension || 'txt');
  try {
    chrome.storage.local.set({ github_owner: owner, github_repo: repo, github_branch: branch, github_language: chosenExt }, () => {
      console.log('[popup] saved owner/repo/branch/language to storage');
    });
  } catch (e) {
    console.warn('[popup] failed to save defaults', e && e.message);
  }

  const folder = lastProblemData.folderName;
  const solutionName = `solution.${chosenExt}`;
  const solutionContent = lastProblemData.code || '';
  const readmeContent = buildReadme(lastProblemData);
  const payload = { action: 'uploadFiles', owner, repo, branch, folder, files: [
    { path: `${folder}/${solutionName}`, content: solutionContent, isBase64: false },
    { path: `${folder}/README.md`, content: readmeContent, isBase64: false }
  ], allowUpdate };

  chrome.runtime.sendMessage(payload, (resp) => {
    if (chrome.runtime.lastError) { updateStatus('Background request failed: ' + chrome.runtime.lastError.message, true); return; }
    if (!resp) { updateStatus('No response from background', true); return; }
    if (resp.success) {
      updateStatus('Upload succeeded');
      // remember user choices if they checked rememberMe (separate from token)
      if (!!$('rememberMe').checked) {
        chrome.storage.local.set({ github_owner: owner, github_repo: repo, github_branch: branch, remember_me: true });
      }
    } else {
      updateStatus('Upload failed: ' + (resp.message || 'unknown'), true);
    }
  });
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
        const remember = !!($('rememberMe') && $('rememberMe').checked);
        const allowUpdate = !!(document.getElementById('allowUpdate') && document.getElementById('allowUpdate').checked);
        chrome.storage.local.set({
          github_owner: owner,
          github_repo: repo,
          github_branch: branch,
          github_language: lang,
          remember_me: remember,
          allowUpdateDefault: allowUpdate
        }, () => {
          console.log('[popup] persisted settings');
        });
      } catch (e) { console.warn('[popup] persist failed', e && e.message); }
    }, 250);
  }

  // load defaults then check auth status (also restore language & allowUpdate preference)
  chrome.storage.local.get(['github_owner','github_repo','github_branch','remember_me','github_language','allowUpdateDefault'], (items) => {
    if (items) {
      if (items.github_owner) $('owner').value = items.github_owner;
      if (items.github_repo) $('repo').value = items.github_repo;
      if (items.github_branch) $('branch').value = items.github_branch;
      $('rememberMe').checked = !!items.remember_me;
      if (typeof items.allowUpdateDefault !== 'undefined' && document.getElementById('allowUpdate')) {
        document.getElementById('allowUpdate').checked = !!items.allowUpdateDefault;
      }
      if (items.github_language) {
        const sel = document.getElementById('language');
        if (sel) {
          try { sel.value = items.github_language; sel.dataset.userSet = '1'; } catch (e) { /* ignore */ }
        }
      }
    }

    // attach auto-save listeners so changes persist immediately
    try {
      const ownerEl = $('owner'); if (ownerEl) ownerEl.addEventListener('input', persistPopupSettings);
      const repoEl = $('repo'); if (repoEl) repoEl.addEventListener('input', persistPopupSettings);
      const branchEl = $('branch'); if (branchEl) branchEl.addEventListener('input', persistPopupSettings);
      const langEl = document.getElementById('language'); if (langEl) langEl.addEventListener('change', persistPopupSettings);
      const rememberEl = $('rememberMe'); if (rememberEl) rememberEl.addEventListener('change', persistPopupSettings);
      const allowEl = document.getElementById('allowUpdate'); if (allowEl) allowEl.addEventListener('change', persistPopupSettings);
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
      // auto-detect again once authenticated to ensure metadata is available
      try { onDetect(); } catch (e) { console.warn('auto-detect after auth failed', e && e.message); }
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
      // automatically detect problem after sign-in to prefill fields
      try { onDetect(); } catch (e) { console.warn('auto-detect after sign-in failed', e && e.message); }
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
      clearDeviceInfo();
      setSignInEnabled(true);
    }
  });
});
