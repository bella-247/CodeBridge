// Content script for LeetCode → GitHub Exporter
// Responsibilities:
// - Detect problem slug, id, title, difficulty, tags, content (description)
// - Attempt to extract user's solution code and language from the in-page editor
// - Respond to runtime messages (action: 'getProblemData') with gathered metadata
//
// Debug instrumentation: logs to page console and captures load/runtime errors so you can see if
// the content script was injected and if any runtime error prevents it from responding.
(function __lcgh_instrumentation() {
    try {
        console.log("[LC→GH] content script loaded:", location.href);
        // capture global errors in page console for easier debugging
        window.addEventListener("error", (e) => {
            console.error(
                "[LC→GH] page error:",
                e.message,
                "at",
                e.filename + ":" + e.lineno + ":" + e.colno
            );
        });
        window.addEventListener("unhandledrejection", (ev) => {
            console.error("[LC→GH] unhandledrejection:", ev.reason);
        });
    } catch (e) {
        console.error("[LC→GH] instrumentation failed", e);
    }
})();

// Utility: get slug from URL (/problems/<slug>/...)
function getSlugFromUrl() {
    try {
        const parts = location.pathname.split("/").filter(Boolean);
        // Typical LeetCode problem URL: /problems/<slug>/ or /problems/<slug>/description/
        const idx = parts.indexOf("problems");
        if (idx !== -1 && parts.length > idx + 1) return parts[idx + 1];
        // Fallback: last path segment
        return parts[parts.length - 1] || "";
    } catch (e) {
        return "";
    }
}

// Fetch metadata from LeetCode GraphQL endpoint
async function fetchQuestionGraphQL(slug) {
    if (!slug) return null;
    const url = "https://leetcode.com/graphql/";
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
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(query),
        });
        if (!res.ok) return null;
        const json = await res.json();
        return json?.data?.question || null;
    } catch (err) {
        console.error("LeetCode GraphQL fetch failed", err);
        return null;
    }
}

// Helper to retrieve code from page context (accessing window.monaco)
function getCodeFromPageContext() {
    return new Promise((resolve) => {
        // Always use background script execution (privileged access) as it is the most robust method
        // to bypass DOM virtualization and security restrictions.
        try {
            chrome.runtime.sendMessage(
                { action: "executeCodeExtraction" },
                (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn(
                            "Background code extraction failed:",
                            chrome.runtime.lastError.message
                        );
                        resolve(null);
                        return;
                    }
                    if (response && response.success && response.data) {
                        resolve(response.data);
                    } else {
                        resolve(null);
                    }
                }
            );
        } catch (e) {
            console.error("Message sending failed:", e);
            resolve(null);
        }
    });
}

/* Robust getEditorCode — collect candidates and pick the longest
   Rationale: some editor APIs or DOM extracts can appear truncated depending on which model/element is queried.
   Instead of returning the first found value, gather candidates from all known sources and choose the longest,
   while attempting to preserve any detected languageId from the source that provided the longest content.
*/
async function getEditorCode() {
    try {
        // Priority 1, 2, 3: Try to get code from page context via background script (Main World)
        // This covers Monaco, window.editor, and CodeMirror object access
        const pageContextCode = await getCodeFromPageContext();
        if (
            pageContextCode &&
            pageContextCode.code &&
            pageContextCode.code.trim().length > 0
        ) {
            return {
                code: pageContextCode.code,
                languageId: pageContextCode.languageId,
            };
        }

        // Priority 4: Hidden <textarea>
        try {
            const textarea = document.querySelector("textarea");
            if (
                textarea &&
                textarea.value &&
                textarea.value.trim().length > 0
            ) {
                return { code: textarea.value, languageId: null };
            }
        } catch (e) {
            /* ignore */
        }

        // Priority 5: Fallback: <pre><code> blocks
        try {
            const codeBlock = document.querySelector("pre code");
            if (
                codeBlock &&
                codeBlock.innerText &&
                codeBlock.innerText.trim().length > 0
            ) {
                return { code: codeBlock.innerText, languageId: null };
            }
        } catch (e) {
            /* ignore */
        }

        // Final rule: If all methods fail → return null (empty object here to match signature)
        return { code: "", languageId: null };
    } catch (err) {
        console.error("getEditorCode error", err);
        return { code: "", languageId: null };
    }
}

// Attempt to detect selected language from UI (improved)
function getDetectedLanguage() {
    try {
        const btn = document.querySelector(
            '[data-cy="lang-select"] button span'
        );
        if (btn) return btn.innerText.trim();

        const selected = document.querySelector(".ant-select-selection-item");
        if (selected) return selected.innerText.trim();

        // Fallback to previous methods if specific selectors fail
        const selects = Array.from(
            document.querySelectorAll('select, [aria-label*="Language"]')
        );
        for (const s of selects) {
            if (s.tagName === "SELECT") {
                const val =
                    s.value ||
                    (s.options &&
                        s.options[s.selectedIndex] &&
                        s.options[s.selectedIndex].text);
                if (val) return String(val).trim();
            }
        }

        return null;
    } catch (e) {
        return null;
    }
}

// Normalize language name
function normalizeLanguage(lang) {
    if (!lang) return null;
    return lang.replace(/[^A-Za-z0-9+#]+/g, "").toLowerCase();
}

const LANGUAGE_EXTENSION_MAP = {
    cpp: ".cpp",
    c: ".c",
    java: ".java",
    python: ".py",
    python3: ".py",
    csharp: ".cs",
    javascript: ".js",
    typescript: ".ts",
    ruby: ".rb",
    swift: ".swift",
    go: ".go",
    kotlin: ".kt",
    rust: ".rs",
    php: ".php",
    scala: ".scala",
    racket: ".rkt",
    erlang: ".erl",
    elixir: ".ex",
    sql: ".sql",
    bash: ".sh",
    dart: ".dart",
    haskell: ".hs",
    lua: ".lua",
    perl: ".pl",
    ocaml: ".ml",
    fsharp: ".fs",
    scheme: ".scm",
    prolog: ".pl",
    fortran: ".f90",
    nim: ".nim",
};

// Normalize language id to file extension
function languageToExtension(lang) {
    const norm = normalizeLanguage(lang);
    return LANGUAGE_EXTENSION_MAP[norm] || ".txt";
}

// Build kebab-case title and zero-padded ID
function formatFolderName(id, title) {
    const pad = id ? String(id).padStart(4, "0") : "0000";
    const kebab = title
        .toLowerCase()
        .replace(/[`~!@#$%^&*()+=\[\]{};:'"\\|<>\/?]/g, "")
        .replace(/\s+/g, "-")
        .replace(/--+/g, "-")
        .replace(/^-+|-+$/g, "");
    return `${pad}-${kebab}`;
}

// Main gather function
async function gatherProblemData() {
    const slug = getSlugFromUrl();
    const gql = await fetchQuestionGraphQL(slug);
    const editor = await getEditorCode();

    // Detect language from UI first, fallback to editor languageId
    const uiLang = getDetectedLanguage();
    const detectedLang = uiLang || editor.languageId || null;
    const normalizedLang = normalizeLanguage(detectedLang);

    // Map to extension (remove dot for 'extension' field to match existing logic if needed,
    // but user asked for .ext in suggestedExtension. Existing logic uses 'extension' without dot in some places?
    // Looking at previous code: languageToExtension returned 'py', 'cpp' (no dot).
    // The new map has dots.
    // I will provide both formats to be safe for existing consumers.
    const extWithDot = LANGUAGE_EXTENSION_MAP[normalizedLang] || ".txt";
    const extNoDot = extWithDot.replace(/^\./, "");

    const title = gql?.title || document.title || slug || "unknown";
    const id = gql?.questionId || null;
    const difficulty = gql?.difficulty || null;
    const tags = (gql?.topicTags || []).map((t) => t.name);
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
        code: editor.code || "",
        language: detectedLang || "",
        normalizedLanguage: normalizedLang,
        suggestedExtension: extWithDot,
        extension: extNoDot, // Keep for backward compatibility
        folderName: formatFolderName(id || slug, title),
    };
}

// Expose via message listener for popup/background to request
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.action === "getProblemData") {
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
        chrome.storage.local.get(["autoSave"], (items) => {
            _autoSaveEnabled = !!(items && items.autoSave);
            if (_autoSaveEnabled) startSubmissionObserver();
        });
        // react to changes in options
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === "local" && changes.autoSave) {
                _autoSaveEnabled = !!changes.autoSave.newValue;
                if (_autoSaveEnabled) startSubmissionObserver();
            }
        });
    } catch (e) {
        // storage may not be available in some contexts; fail silently
        console.warn("Auto-save init error", e);
    }
}

let _submissionObserver = null;

function startSubmissionObserver() {
    if (_submissionObserver) return;
    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            // quick check: if any added node contains the text 'Accepted', trigger debounce
            for (const node of Array.from(m.addedNodes || [])) {
                try {
                    const txt = (node.textContent || "").trim();
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
            if (
                m.type === "characterData" &&
                m.target &&
                /\bAccepted\b/i.test(m.target.data || "")
            ) {
                debounceAutoSave();
                return;
            }
        }
    });

    _submissionObserver = observer;
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
    });
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
            console.warn("Auto-save gather error", e);
        }
    }, 1500);
}

// Perform upload using stored defaults
async function performAutoSave(problemData) {
    try {
        chrome.storage.local.get(
            [
                "github_owner",
                "github_repo",
                "github_branch",
                "github_token",
                "allowUpdateDefault",
            ],
            async (items) => {
                const owner = items && items.github_owner;
                const repo = items && items.github_repo;
                const branch = (items && items.github_branch) || "main";
                const token = items && items.github_token;
                const allowUpdate = !!(items && items.allowUpdateDefault);

                if (!owner || !repo || !token) {
                    console.warn(
                        "Auto-save aborted: missing owner/repo/token in options"
                    );
                    return;
                }

                const folder = problemData.folderName;
                const solutionName = `solution.${
                    problemData.extension || "txt"
                }`;
                const solutionContent = problemData.code || "";
                const readmeContent = (function buildReadmeInline() {
                    const title = problemData.title || "";
                    const url = problemData.url || "";
                    const tags = (problemData.tags || []).join(", ");
                    const difficulty = problemData.difficulty || "";
                    const description = (problemData.contentHtml || "")
                        .replace(/<[^>]+>/g, "")
                        .trim();
                    const lines = [];
                    lines.push(`# ${title}`);
                    lines.push("");
                    if (difficulty) lines.push(`**Difficulty:** ${difficulty}`);
                    if (tags) lines.push(`**Tags:** ${tags}`);
                    if (url) lines.push(`**URL:** ${url}`);
                    lines.push("");
                    if (description) {
                        lines.push("## Problem");
                        lines.push("");
                        lines.push(description);
                        lines.push("");
                    }
                    lines.push("---");
                    lines.push(
                        "_Generated by LeetCode → GitHub Chrome extension (auto-save)_"
                    );
                    return lines.join("\n");
                })();

                // send to background to upload
                const payload = {
                    action: "uploadFiles",
                    owner,
                    repo,
                    branch,
                    token,
                    folder,
                    files: [
                        {
                            path: `${folder}/${solutionName}`,
                            content: solutionContent,
                            isBase64: false,
                        },
                        {
                            path: `${folder}/README.md`,
                            content: readmeContent,
                            isBase64: false,
                        },
                    ],
                    allowUpdate,
                };

                chrome.runtime.sendMessage(payload, (resp) => {
                    if (chrome.runtime.lastError) {
                        console.warn(
                            "Auto-save background request failed",
                            chrome.runtime.lastError.message
                        );
                        return;
                    }
                    if (!resp) {
                        console.warn("Auto-save: no response from background");
                        return;
                    }
                    if (resp.success) {
                        console.info(
                            "Auto-save upload succeeded",
                            resp.message
                        );
                    } else {
                        console.warn("Auto-save upload failed", resp.message);
                    }
                });
            }
        );
    } catch (e) {
        console.warn("Auto-save perform error", e);
    }
}

// Initialize auto-save observer on script load
initAutoSave();

// --- Floating bubble + onSolutionAccepted integration ---
// Inject minimal styles for bubble and toast
(function injectBubbleStyles() {
    try {
        const css = `
       #lcgh-bubble {
         position: fixed;
         right: 18px;
         bottom: 120px;
         width: 56px;
         height: 56px;
         border-radius: 50%;
         background: #127c5a;
         color: #fff;
         display: flex;
         align-items: center;
         justify-content: center;
         box-shadow: 0 8px 20px rgba(10,20,30,0.25);
         z-index: 2147483647;
         cursor: pointer;
       }
       #lcgh-bubble.hidden { display: none; }
       #lcgh-toast {
         position: fixed;
         right: 18px;
         bottom: 190px;
         background: rgba(17,24,39,0.95);
         color: #fff;
         padding: 10px 14px;
         border-radius: 8px;
         font-size: 13px;
         z-index: 2147483647;
         box-shadow: 0 8px 20px rgba(2,6,23,0.45);
         max-width: 340px;
       }
       #lcgh-toast.hidden { display:none; }
     `;
        const s = document.createElement("style");
        s.id = "lcgh-styles";
        s.textContent = css;
        document.head && document.head.appendChild(s);
    } catch (e) {
        /* ignore style injection failures */
    }
})();

// Create bubble and toast nodes (lazy create)
function ensureBubble() {
    if (document.getElementById("lcgh-bubble")) return;
    try {
        const bubble = document.createElement("div");
        bubble.id = "lcgh-bubble";
        bubble.className = "hidden";
        bubble.title = "Upload solution to GitHub";
        bubble.innerHTML =
            '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L12 22" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 9L12 2L19 9" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        document.body.appendChild(bubble);

        const toast = document.createElement("div");
        toast.id = "lcgh-toast";
        toast.className = "hidden";
        document.body.appendChild(toast);

        bubble.addEventListener("click", onBubbleClick);
    } catch (e) {
        console.warn("lcgh: failed to create bubble/toast", e && e.message);
    }
}

function showToast(msg, timeout = 4500) {
    try {
        ensureBubble();
        const t = document.getElementById("lcgh-toast");
        if (!t) return;
        t.textContent = msg;
        t.classList.remove("hidden");
        if (t._hideTimeout) clearTimeout(t._hideTimeout);
        t._hideTimeout = setTimeout(() => {
            t.classList.add("hidden");
        }, timeout);
    } catch (e) {
        /* ignore toast errors */
    }
}

function showBubble() {
    try {
        ensureBubble();
        const b = document.getElementById("lcgh-bubble");
        if (b) b.classList.remove("hidden");
    } catch (e) {
        /* ignore */
    }
}

function hideBubble() {
    try {
        const b = document.getElementById("lcgh-bubble");
        if (b) b.classList.add("hidden");
    } catch (e) {
        /* ignore */
    }
}

// Called when a solution is accepted (either via observer or other detection)
async function onSolutionAccepted() {
    try {
        // show floating bubble so user can upload with one click
        showBubble();
        // Optionally, if user enabled fully automatic uploads, trigger performAutoSave path
        chrome.storage.local.get(["autoSave", "autoSaveSilent"], (items) => {
            if (items && items.autoSave && items.autoSaveSilent) {
                // trigger immediate performAutoSave flow (will check stored owner/repo/token)
                debounceAutoSave();
                showToast("Auto-upload triggered for accepted solution");
            } else {
                showToast(
                    "Solution accepted — click the bubble to upload to GitHub"
                );
            }
        });
    } catch (e) {
        console.warn("onSolutionAccepted error", e && e.message);
    }
}

// Bubble click handler: gather data and ask background to upload
async function onBubbleClick() {
    try {
        showToast("Collecting solution — preparing upload...");
        const data = await gatherProblemData();
        if (!data || !data.slug) {
            showToast("Failed to collect problem data", 5000);
            return;
        }

        // attach chosen extension if user has language preference in popup storage
        chrome.storage.local.get(
            [
                "github_owner",
                "github_repo",
                "github_branch",
                "github_language",
                "allowUpdateDefault",
            ],
            (items) => {
                const owner = items && items.github_owner;
                const repo = items && items.github_repo;
                const branch = (items && items.github_branch) || "main";
                const chosenExt =
                    (items && items.github_language) || data.extension || "txt";
                const allowUpdate = !!(items && items.allowUpdateDefault);

                if (!owner || !repo) {
                    showToast(
                        "Please configure repository in the extension popup first",
                        7000
                    );
                    return;
                }

                const folder = data.folderName;
                const solutionName = `solution.${chosenExt}`;
                const solutionContent = data.code || "";
                const readmeContent = (function buildReadmeInline() {
                    const title = data.title || "";
                    const url = data.url || "";
                    const tags = (data.tags || []).join(", ");
                    const difficulty = data.difficulty || "";
                    const description = (data.contentHtml || "")
                        .replace(/<[^>]+>/g, "")
                        .trim();
                    const lines = [];
                    lines.push(`# ${title}`);
                    lines.push("");
                    if (difficulty) lines.push(`**Difficulty:** ${difficulty}`);
                    if (tags) lines.push(`**Tags:** ${tags}`);
                    if (url) lines.push(`**URL:** ${url}`);
                    lines.push("");
                    if (description) {
                        lines.push("## Problem");
                        lines.push("");
                        lines.push(description);
                        lines.push("");
                    }
                    lines.push("---");
                    lines.push("_Generated by CodeBridge extension_");
                    return lines.join("\n");
                })();

                // send upload request to background
                chrome.runtime.sendMessage(
                    {
                        action: "uploadFiles",
                        owner,
                        repo,
                        branch,
                        folder,
                        files: [
                            {
                                path: `${folder}/${solutionName}`,
                                content: solutionContent,
                                isBase64: false,
                            },
                            {
                                path: `${folder}/README.md`,
                                content: readmeContent,
                                isBase64: false,
                            },
                        ],
                        allowUpdate,
                    },
                    (resp) => {
                        if (chrome.runtime.lastError) {
                            showToast(
                                "Upload failed: " +
                                    chrome.runtime.lastError.message,
                                7000
                            );
                            return;
                        }
                        if (!resp) {
                            showToast("Upload failed: no response", 7000);
                            return;
                        }
                        if (resp.success) {
                            showToast("Upload succeeded");
                            // hide bubble after successful upload
                            hideBubble();
                        } else {
                            showToast(
                                "Upload failed: " + (resp.message || "unknown"),
                                8000
                            );
                        }
                    }
                );
            }
        );
    } catch (e) {
        console.warn("bubble click error", e && e.message);
        showToast("Error preparing upload", 7000);
    }
}

// Enhance submission observer to call onSolutionAccepted() when Accepted is detected
(function patchSubmissionObserver() {
    try {
        const originalDebounce = debounceAutoSave;
        // override debounceAutoSave to also call onSolutionAccepted when auto-save is disabled
        const wrappedDebounce = function () {
            try {
                // call original behavior (which performs auto-save only if enabled)
                originalDebounce();
                // always show bubble when Accepted detected
                onSolutionAccepted();
            } catch (e) {
                /* ignore */
            }
        };
        // replace function used by observer
        if (typeof window !== "undefined") {
            // replace local debounce function reference used in observer by reassigning name
            // (we purposely shadow the global name used above)
            window.__lcgh_debounce_override = wrappedDebounce;
            // update internal usage point: swap debounceAutoSave reference
            debounceAutoSave = wrappedDebounce;
        }
    } catch (e) {
        /* ignore patch errors */
    }
})();

// End of enhancements
