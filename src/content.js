// Content script for LeetCode → GitHub Exporter
// Responsibilities:
// - Detect problem slug, id, title, difficulty, tags, content (description)
// - Attempt to extract user's solution code and language from the in-page editor
// - Respond to runtime messages (action: 'getProblemData') with gathered metadata

// Utility: get slug from URL (/problems/<slug>/...)
function getSlugFromUrl() {
  try {
    const parts = location.pathname.split('/').filter(Boolean);
    // Typical LeetCode problem URL: /problems/<slug>/ or /problems/<slug>/description/
    const idx = parts.indexOf('problems');
    if (idx !== -1 && parts.length > idx + 1) return parts[idx + 1];
    // Fallback: last path segment
    return parts[parts.length - 1] || '';
  } catch (e) {
    return '';
  }
}

// Fetch metadata from LeetCode GraphQL endpoint
async function fetchQuestionGraphQL(slug) {
  if (!slug) return null;
  const url = 'https://leetcode.com/graphql/';
  const query = {
    query: `
      query getQuestionDetail($titleSlug: String!) {
        question(titleSlug: $titleSlug) {
          questionId
          title
          content
          difficulty
          topicTags {
            name
            slug
          }
        }
      }
    `,
    variables: { titleSlug: slug },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(query)
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data?.question || null;
  } catch (err) {
    console.error('LeetCode GraphQL fetch failed', err);
    return null;
  }
}

// Attempt to read user code from various editor implementations
function getEditorCode() {
  try {
    // 1) Monaco editor (preferred)
    if (window.monaco && window.monaco.editor) {
      try {
        const models = window.monaco.editor.getModels();
        if (models && models.length) {
          // Use the first non-empty model
          for (const m of models) {
            const val = m.getValue();
            if (val && val.trim().length > 0) return { code: val, languageId: m.getModeId ? m.getModeId() : (m.language || null) };
          }
          // Fallback to first model
          const v = models[0].getValue();
          return { code: v, languageId: models[0].getModeId ? models[0].getModeId() : null };
        }
      } catch (e) {
        // ignore
      }
    }

    // 2) CodeMirror (older LeetCode or other pages)
    // CodeMirror instances often exist as elements with class 'CodeMirror' and an associated editor
    const cmEls = document.querySelectorAll('.CodeMirror');
    if (cmEls && cmEls.length) {
      for (const el of cmEls) {
        // CodeMirror stores editor instance on element.CodeMirror
        const cm = el.CodeMirror || (el.nextSibling && el.nextSibling.CodeMirror);
        if (cm && typeof cm.getValue === 'function') {
          const val = cm.getValue();
          if (val && val.trim().length) return { code: val, languageId: cm.getOption ? cm.getOption('mode') : null };
        }
      }
    }

    // 3) Textarea fallback (find visible textarea in editor area)
    const textareas = Array.from(document.querySelectorAll('textarea')).filter(t => t.offsetParent !== null);
    if (textareas.length) {
      // prefer longer contents
      textareas.sort((a, b) => (b.value || '').length - (a.value || '').length);
      const v = textareas[0].value;
      if (v && v.trim().length) return { code: v, languageId: null };
    }

    // 4) Look for code content in pre/code elements inside editor containers
    const codeEls = document.querySelectorAll('.editor, .CodeArea, .react-monaco-editor-container pre, pre, code');
    for (const el of codeEls) {
      const txt = el.textContent || '';
      if (txt && txt.trim().length > 10) return { code: txt, languageId: null };
    }

    return { code: '', languageId: null };
  } catch (err) {
    console.error('getEditorCode error', err);
    return { code: '', languageId: null };
  }
}

// Attempt to detect selected language from UI
function detectLanguage() {
  try {
    // 1) Monaco model languageId from editor extraction
    if (window.monaco && window.monaco.editor) {
      const models = window.monaco.editor.getModels();
      if (models && models.length) {
        const id = models[0].getModeId ? models[0].getModeId() : null;
        if (id) return id;
      }
    }

    // 2) Look for select elements that choose language
    const selects = Array.from(document.querySelectorAll('select, .dropdown, [data-cy*="lang"], [aria-label*="Language"]'));
    for (const s of selects) {
      if (s.tagName === 'SELECT') {
        const val = s.value;
        if (val) return val.toLowerCase();
      } else {
        // try innerText
        const txt = s.innerText || s.textContent || '';
        if (txt && txt.length < 50) return txt.trim().toLowerCase();
      }
    }

    // 3) Buttons or active language markers
    const langBtn = document.querySelector('[data-cy="lang-select"], .lang-select, .language-select, .ant-select-selection-item');
    if (langBtn) {
      const t = langBtn.innerText || langBtn.textContent || '';
      if (t) return t.trim().toLowerCase();
    }

    return null;
  } catch (e) {
    return null;
  }
}

// Normalize language id to file extension
function languageToExtension(lang) {
  if (!lang) return 'txt';
  const s = String(lang).toLowerCase();
  if (s.includes('python')) return 'py';
  if (s.includes('py')) return 'py';
  if (s.includes('cpp') || s.includes('c++')) return 'cpp';
  if (s === 'c') return 'c';
  if (s.includes('java')) return 'java';
  if (s.includes('javascript') || s === 'js' || s.includes('node')) return 'js';
  if (s.includes('typescript') || s === 'ts') return 'ts';
  if (s.includes('csharp') || s === 'c#') return 'cs';
  if (s.includes('ruby')) return 'rb';
  if (s.includes('go')) return 'go';
  if (s.includes('rust')) return 'rs';
  if (s.includes('php')) return 'php';
  return 'txt';
}

// Build kebab-case title and zero-padded ID
function formatFolderName(id, title) {
  const pad = id ? String(id).padStart(4, '0') : '0000';
  const kebab = title
    .toLowerCase()
    .replace(/[`~!@#$%^&*()+=\[\]{};:'"\\|<>\/?]/g, '')
    .replace(/\s+/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${pad}-${kebab}`;
}

// Main gather function
async function gatherProblemData() {
  const slug = getSlugFromUrl();
  const gql = await fetchQuestionGraphQL(slug);
  const editor = getEditorCode();
  const detectedLang = detectLanguage() || editor.languageId || null;
  const ext = languageToExtension(detectedLang);

  const title = gql?.title || document.title || slug || 'unknown';
  const id = gql?.questionId || null;
  const difficulty = gql?.difficulty || null;
  const tags = (gql?.topicTags || []).map(t => t.name);
  const contentHtml = gql?.content || null;
  const url = location.href;

  return {
    slug,
    id,
    title,
    url,
    difficulty,
    tags,
    contentHtml,
    code: editor.code || '',
    language: detectedLang || '',
    extension: ext,
    folderName: formatFolderName(id || slug, title)
  };
}

 // Expose via message listener for popup/background to request
 chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
   if (message && message.action === 'getProblemData') {
     (async () => {
       const data = await gatherProblemData();
       sendResponse({ success: true, data });
     })();
     return true; // keep channel open for async response
   }
   // allow other messages
 });

/*
  Auto-save (experimental)
  - Observes the page for submission/result updates that include the word "Accepted".
  - When autoSave is enabled (via options), the content script will automatically
    collect problem data and ask the background service worker to upload files
    using saved defaults (github_owner, github_repo, github_branch, github_token).
  - This is best-effort and intentionally conservative to avoid accidental uploads.
*/

let _autoSaveEnabled = false;
let _autoSaveDebounce = null;
let _lastAutoSaved = null;

// Check stored preference and initialize observer if enabled
function initAutoSave() {
  try {
    chrome.storage.local.get(['autoSave'], (items) => {
      _autoSaveEnabled = !!(items && items.autoSave);
      if (_autoSaveEnabled) startSubmissionObserver();
    });
    // react to changes in options
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.autoSave) {
        _autoSaveEnabled = !!changes.autoSave.newValue;
        if (_autoSaveEnabled) startSubmissionObserver();
      }
    });
  } catch (e) {
    // storage may not be available in some contexts; fail silently
    console.warn('Auto-save init error', e);
  }
}

let _submissionObserver = null;

function startSubmissionObserver() {
  if (_submissionObserver) return;
  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      // quick check: if any added node contains the text 'Accepted', trigger debounce
      for (const node of Array.from(m.addedNodes || [])) {
        try {
          const txt = (node.textContent || '').trim();
          if (!txt) continue;
          // look for the word 'Accepted' (case-insensitive) - conservative match
          if (/\bAccepted\b/i.test(txt)) {
            debounceAutoSave();
            return;
          }
        } catch (e) {
          // ignore
        }
      }
      // also check for attribute changes that carry status text
      if (m.type === 'characterData' && m.target && /\bAccepted\b/i.test(m.target.data || '')) {
        debounceAutoSave();
        return;
      }
    }
  });

  _submissionObserver = observer;
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

// Debounce to avoid duplicate triggers
function debounceAutoSave() {
  if (!_autoSaveEnabled) return;
  if (_autoSaveDebounce) return;
  _autoSaveDebounce = setTimeout(async () => {
    _autoSaveDebounce = null;
    try {
      const data = await gatherProblemData();
      // prevent repeated uploads for same problem in quick succession
      if (!data || !data.slug) return;
      if (_lastAutoSaved === data.slug) return;
      _lastAutoSaved = data.slug;
      performAutoSave(data);
    } catch (e) {
      console.warn('Auto-save gather error', e);
    }
  }, 1500);
}

// Perform upload using stored defaults
async function performAutoSave(problemData) {
  try {
    chrome.storage.local.get(['github_owner','github_repo','github_branch','github_token','allowUpdateDefault'], async (items) => {
      const owner = items && items.github_owner;
      const repo = items && items.github_repo;
      const branch = (items && items.github_branch) || 'main';
      const token = items && items.github_token;
      const allowUpdate = !!(items && items.allowUpdateDefault);

      if (!owner || !repo || !token) {
        console.warn('Auto-save aborted: missing owner/repo/token in options');
        return;
      }

      const folder = problemData.folderName;
      const solutionName = `solution.${problemData.extension || 'txt'}`;
      const solutionContent = problemData.code || '';
      const readmeContent = (function buildReadmeInline() {
        const title = problemData.title || '';
        const url = problemData.url || '';
        const tags = (problemData.tags || []).join(', ');
        const difficulty = problemData.difficulty || '';
        const description = (problemData.contentHtml || '').replace(/<[^>]+>/g, '').trim();
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
        lines.push('_Generated by LeetCode → GitHub Chrome extension (auto-save)_');
        return lines.join('\n');
      })();

      // send to background to upload
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
          console.warn('Auto-save background request failed', chrome.runtime.lastError.message);
          return;
        }
        if (!resp) {
          console.warn('Auto-save: no response from background');
          return;
        }
        if (resp.success) {
          console.info('Auto-save upload succeeded', resp.message);
        } else {
          console.warn('Auto-save upload failed', resp.message);
        }
      });
    });
  } catch (e) {
    console.warn('Auto-save perform error', e);
  }
}

// Initialize auto-save observer on script load
initAutoSave();
