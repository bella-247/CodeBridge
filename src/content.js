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

// Create bubble and toast nodes (lazy create). Adds a small close (X) button that hides the bubble for this page session.
// The bubble reappears on page reload and whenever onSolutionAccepted() is called.
// This version uses Pointer Events for robust drag (mouse + touch), clamps to viewport, and persists position.
function ensureBubble() {
    if (document.getElementById("lcgh-bubble")) return;
    try {
        const wrapper = document.createElement("div");
        wrapper.id = "lcgh-bubble";
        wrapper.className = "hidden lcgh-wrapper";
        wrapper.title = "Upload solution to GitHub";
        wrapper.style.position = "fixed";
        wrapper.style.right = "18px";
        wrapper.style.bottom = "120px";
        wrapper.style.zIndex = "2147483647";
        wrapper.style.display = "flex";
        wrapper.style.alignItems = "center";
        wrapper.style.justifyContent = "center";
        wrapper.style.width = "56px";
        wrapper.style.height = "56px";
        // disable default touch gestures so pointer events work reliably
        wrapper.style.touchAction = "none";

        const bubble = document.createElement("div");
        bubble.className = "lcgh-bubble-inner";
        bubble.style.width = "56px";
        bubble.style.height = "56px";
        bubble.style.borderRadius = "50%";
        bubble.style.background = "#127c5a";
        bubble.style.color = "#fff";
        bubble.style.display = "flex";
        bubble.style.alignItems = "center";
        bubble.style.justifyContent = "center";
        bubble.style.boxShadow = "0 8px 20px rgba(10,20,30,0.25)";
        bubble.style.cursor = "grab";
        bubble.style.userSelect = "none";
        bubble.style.touchAction = "none";
        bubble.innerHTML =
            '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L12 22" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 9L12 2L19 9" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

        const closeBtn = document.createElement("button");
        closeBtn.id = "lcgh-bubble-close";
        closeBtn.title = "Hide upload bubble";
        closeBtn.style.position = "absolute";
        closeBtn.style.top = "6px";
        closeBtn.style.right = "6px";
        closeBtn.style.width = "20px";
        closeBtn.style.height = "20px";
        closeBtn.style.border = "none";
        closeBtn.style.borderRadius = "50%";
        closeBtn.style.background = "rgba(0,0,0,0.35)";
        closeBtn.style.color = "#fff";
        closeBtn.style.cursor = "pointer";
        closeBtn.style.display = "flex";
        closeBtn.style.alignItems = "center";
        closeBtn.style.justifyContent = "center";
        closeBtn.style.fontSize = "12px";
        closeBtn.textContent = "×";

        // toast node
        const toast = document.createElement("div");
        toast.id = "lcgh-toast";
        toast.className = "hidden";

        // internal helpers for position persistence and clamping
        const POS_KEY = "lcgh_bubble_pos";
        function clamp(n, min, max) {
            return Math.max(min, Math.min(max, n));
        }
        function savePosition(left, top, right, bottom) {
            try {
                const data = { left, top, right, bottom };
                chrome.storage.local.set({ [POS_KEY]: data });
            } catch (e) {
                /* ignore */
            }
        }
        function loadPosition(cb) {
            try {
                chrome.storage.local.get([POS_KEY], (items) => {
                    cb(items && items[POS_KEY] ? items[POS_KEY] : null);
                });
            } catch (e) {
                cb(null);
            }
        }

        // apply a saved position (supports left/top or right/bottom)
        function applySavedPosition(pos) {
            try {
                if (!pos) return;
                // prefer left/top if present (explicit pixel values)
                if (
                    typeof pos.left === "number" &&
                    typeof pos.top === "number"
                ) {
                    wrapper.style.left =
                        clamp(pos.left, 8, window.innerWidth - 64) + "px";
                    wrapper.style.top =
                        clamp(pos.top, 8, window.innerHeight - 64) + "px";
                    wrapper.style.right = "auto";
                    wrapper.style.bottom = "auto";
                } else if (
                    typeof pos.right === "number" &&
                    typeof pos.bottom === "number"
                ) {
                    wrapper.style.right =
                        clamp(pos.right, 8, window.innerWidth - 64) + "px";
                    wrapper.style.bottom =
                        clamp(pos.bottom, 8, window.innerHeight - 64) + "px";
                    wrapper.style.left = "auto";
                    wrapper.style.top = "auto";
                }
            } catch (e) {
                /* ignore */
            }
        }

        // pointer-based drag logic (works for mouse and touch)
        let pointerId = null;
        let startX = 0,
            startY = 0;
        let startLeft = null,
            startTop = null,
            startRight = null,
            startBottom = null;
        let clickPrevent = false;

        function onPointerDown(ev) {
            try {
                // ignore if clicking the close button
                if (ev.target && ev.target.id === "lcgh-bubble-close") return;
                // left-button or touch only
                if (ev.pointerType === "mouse" && ev.button !== 0) return;
                ev.preventDefault();
                pointerId = ev.pointerId;
                wrapper.setPointerCapture(pointerId);
                startX = ev.clientX;
                startY = ev.clientY;
                const cs = window.getComputedStyle(wrapper);
                if (cs.left && cs.left !== "auto") {
                    startLeft = parseFloat(cs.left);
                    startTop = parseFloat(cs.top);
                    startRight = null;
                    startBottom = null;
                } else {
                    const rect = wrapper.getBoundingClientRect();
                    startRight =
                        parseFloat(cs.right) || window.innerWidth - rect.right;
                    startBottom =
                        parseFloat(cs.bottom) ||
                        window.innerHeight - rect.bottom;
                    startLeft = null;
                    startTop = null;
                }
                clickPrevent = false;
            } catch (e) {
                /* ignore */
            }
        }

        function onPointerMove(ev) {
            try {
                if (pointerId === null || ev.pointerId !== pointerId) return;
                ev.preventDefault();
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;
                // if using left/top coordinates
                if (
                    typeof startLeft === "number" &&
                    typeof startTop === "number"
                ) {
                    const newLeft = clamp(
                        Math.round(startLeft + dx),
                        8,
                        window.innerWidth - 64
                    );
                    const newTop = clamp(
                        Math.round(startTop + dy),
                        8,
                        window.innerHeight - 64
                    );
                    wrapper.style.left = newLeft + "px";
                    wrapper.style.top = newTop + "px";
                    wrapper.style.right = "auto";
                    wrapper.style.bottom = "auto";
                } else {
                    const newRight = clamp(
                        Math.round(startRight - dx),
                        8,
                        window.innerWidth - 64
                    );
                    const newBottom = clamp(
                        Math.round(startBottom - dy),
                        8,
                        window.innerHeight - 64
                    );
                    wrapper.style.right = newRight + "px";
                    wrapper.style.bottom = newBottom + "px";
                    wrapper.style.left = "auto";
                    wrapper.style.top = "auto";
                }
                bubble.style.cursor = "grabbing";
            } catch (e) {
                /* ignore */
            }
        }

        function onPointerUp(ev) {
            try {
                if (pointerId === null || ev.pointerId !== pointerId) return;
                try {
                    wrapper.releasePointerCapture(pointerId);
                } catch (e) {}
                pointerId = null;
                // persist as left/top for stability across different pages
                try {
                    const rect = wrapper.getBoundingClientRect();
                    savePosition(
                        Math.round(rect.left),
                        Math.round(rect.top),
                        null,
                        null
                    );
                } catch (e) {
                    /* ignore */
                }
                clickPrevent = true;
                setTimeout(() => (clickPrevent = false), 200);
                bubble.style.cursor = "grab";
            } catch (e) {
                /* ignore */
            }
        }

        // prevent click during drag
        wrapper.addEventListener(
            "click",
            (e) => {
                if (clickPrevent) {
                    e.stopImmediatePropagation();
                    e.preventDefault();
                    return;
                }
            },
            true
        );

        // attach pointer handlers on wrapper so drag works even if inner layout changes
        wrapper.addEventListener("pointerdown", onPointerDown, {
            passive: false,
        });
        wrapper.addEventListener("pointermove", onPointerMove, {
            passive: false,
        });
        wrapper.addEventListener("pointerup", onPointerUp, { passive: false });
        wrapper.addEventListener("pointercancel", onPointerUp, {
            passive: false,
        });

        wrapper.appendChild(bubble);
        wrapper.appendChild(closeBtn);
        document.body.appendChild(wrapper);
        document.body.appendChild(toast);

        // restore saved position if any
        loadPosition((pos) => {
            applySavedPosition(pos);
        });

        // bubble click uploads (respect clickPrevent)
        bubble.addEventListener("click", (e) => {
            if (clickPrevent) return;
            onBubbleClick();
        });

        // close hides for this page session; reappears on reload or when accepted/submitted events fire
        closeBtn.addEventListener("click", (e) => {
            try {
                e.stopPropagation();
                sessionStorage.setItem("lcgh-bubble-hidden", "1");
                wrapper.classList.add("hidden");
                const t = document.getElementById("lcgh-toast");
                if (t) {
                    t.textContent =
                        "Upload bubble hidden for this page session";
                    t.classList.remove("hidden");
                    if (t._hideTimeout) clearTimeout(t._hideTimeout);
                    t._hideTimeout = setTimeout(
                        () => t.classList.add("hidden"),
                        3000
                    );
                }
            } catch (err) {
                /* ignore */
            }
        });

        // update persisted position when window resizes to keep bubble inside viewport
        window.addEventListener("resize", () => {
            try {
                const rect = wrapper.getBoundingClientRect();
                const newLeft = clamp(rect.left, 8, window.innerWidth - 64);
                const newTop = clamp(rect.top, 8, window.innerHeight - 64);
                wrapper.style.left = newLeft + "px";
                wrapper.style.top = newTop + "px";
                wrapper.style.right = "auto";
                wrapper.style.bottom = "auto";
                // persist
                try {
                    savePosition(
                        Math.round(newLeft),
                        Math.round(newTop),
                        null,
                        null
                    );
                } catch (e) {}
            } catch (e) {
                /* ignore */
            }
        });
    } catch (e) {
        console.warn("lcgh: failed to create bubble/toast", e && e.message);
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
