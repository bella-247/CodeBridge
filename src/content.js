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

// Content script for CodeBridge — Multi-Platform Support
// Responsibilities:
// - Detect platform and use appropriate adapter
// - Gather problem metadata (id, title, difficulty, etc.)
// - Extract code and language
// - Provide consistent data structure to background/popup

(function __codebridge_instrumentation() {
    try {
        console.log("[CodeBridge] content script loaded:", location.href);
    } catch (e) { }
})();

// --- Constants and Maps ---

const LANGUAGE_EXTENSION_MAP = {
    cpp: ".cpp", c: ".c", java: ".java", python: ".py", python3: ".py",
    csharp: ".cs", javascript: ".js", typescript: ".ts", ruby: ".rb",
    swift: ".swift", go: ".go", kotlin: ".kt", rust: ".rs", php: ".php",
    scala: ".scala", sql: ".sql", bash: ".sh", dart: ".dart", haskell: ".hs",
    lua: ".lua", perl: ".pl", rust: ".rs"
};

// --- Helper Functions ---

function normalizeLanguage(lang) {
    if (!lang) return null;
    return lang.replace(/[^A-Za-z0-9+#]+/g, "").toLowerCase();
}

function languageToExtension(lang) {
    const norm = normalizeLanguage(lang);
    return LANGUAGE_EXTENSION_MAP[norm] || ".txt";
}

function formatFolderName(id, title, prefix = "") {
    const pad = id && !isNaN(id) ? String(id).padStart(4, "0") : id || "0000";
    const kebab = title
        .toLowerCase()
        .replace(/[`~!@#$%^&*()+=\[\]{};:'"\\|<>\/?]/g, "")
        .replace(/\s+/g, "-")
        .replace(/--+/g, "-")
        .replace(/^-+|-+$/g, "");
    const name = `${pad}-${kebab}`;
    return prefix ? `${prefix}-${name}` : name;
}

// --- Platform Adapters ---

const LeetCodeAdapter = {
    name: "LeetCode",
    matches: () => location.hostname.includes("leetcode.com"),
    getSlug: () => {
        const parts = location.pathname.split("/").filter(Boolean);
        const idx = parts.indexOf("problems");
        return (idx !== -1 && parts.length > idx + 1) ? parts[idx + 1] : (parts[parts.length - 1] || "");
    },
    async gather() {
        const slug = this.getSlug();
        // Fetch via GraphQL
        const gql = await (async (s) => {
            const url = "https://leetcode.com/graphql/";
            const query = {
                query: `query getQuestionDetail($titleSlug: String!) { question(titleSlug: $titleSlug) { questionId title content difficulty topicTags { name } } }`,
                variables: { titleSlug: s },
            };
            try {
                const res = await fetch(url, {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(query),
                });
                if (!res.ok) return null;
                const json = await res.json();
                return json?.data?.question || null;
            } catch (err) { return null; }
        })(slug);

        const uiLang = (() => {
            const btn = document.querySelector('[data-cy="lang-select"] button span');
            if (btn) return btn.innerText.trim();
            const selected = document.querySelector(".ant-select-selection-item");
            return selected ? selected.innerText.trim() : null;
        })();

        const title = gql?.title || document.title || slug || "unknown";
        const id = gql?.questionId || null;

        return {
            platform: "LeetCode",
            slug,
            id,
            title,
            difficulty: gql?.difficulty || "Unknown",
            tags: (gql?.topicTags || []).map(t => t.name),
            contentHtml: gql?.content || "",
            language: uiLang || "",
            folderName: formatFolderName(id || slug, title)
        };
    }
};

const CodeforcesAdapter = {
    name: "Codeforces",
    matches: () => location.hostname.includes("codeforces.com"),
    async gather() {
        // Try standard problem page header first
        const titleEl = document.querySelector('.problem-statement .header .title');
        let rawTitle = titleEl ? titleEl.innerText.trim() : document.title;

        let id = "0";
        let title = rawTitle;

        // Pattern 1: Problem Page (e.g. "A. Waterberry")
        const idMatch = rawTitle.match(/^([A-Z0-9]+)\.\s+(.*)/);
        if (idMatch) {
            id = idMatch[1];
            title = idMatch[2];
        } else {
            // Pattern 2: Submission Page or Submit Page (Breadcrumbs / Links)
            const breadcrumbs = Array.from(document.querySelectorAll('.breadcrumb li a, .rtable tr td a[href*="/problem/"]'));
            const probLink = breadcrumbs.find(a => a.href.includes('/problem/'));
            if (probLink) {
                title = probLink.innerText.trim();
                const pathParts = probLink.pathname.split('/').filter(Boolean);
                id = pathParts[pathParts.length - 1] || "0";
            }
        }

        const tags = Array.from(document.querySelectorAll('.tag-box')).map(el => el.innerText.trim());
        const diffTag = tags.find(t => t.startsWith('*'));
        const difficulty = diffTag ? diffTag.replace('*', '') : "Unknown";

        const langSelect = document.querySelector('select[name="programTypeId"]');
        const language = langSelect ? langSelect.options[langSelect.selectedIndex].text.trim() : "";

        return {
            platform: "Codeforces",
            slug: id,
            id,
            title: title.replace(/^Submission\s+[0-9]+\s+for\s+/i, ""),
            difficulty,
            tags: tags.filter(t => !t.startsWith('*')),
            contentHtml: document.querySelector('.problem-statement')?.innerHTML || "",
            language,
            folderName: formatFolderName(id, title, "CF")
        };
    }
};

const HackerRankAdapter = {
    name: "HackerRank",
    matches: () => location.hostname.includes("hackerrank.com"),
    async gather() {
        const titleEl = document.querySelector('.challenge-title') || document.querySelector('h1.hr_header-title') || document.querySelector('.page-label');
        const title = titleEl ? titleEl.innerText.trim() : document.title;

        const diffEl = document.querySelector('.difficulty-label') || document.querySelector('.challenge-difficulty');
        const difficulty = diffEl ? diffEl.innerText.trim() : "Unknown";

        const tags = Array.from(document.querySelectorAll('.challenge-categories-list a, .breadcrumb-item a')).map(a => a.innerText.trim());

        const langEl = document.querySelector('.language-selector .ant-select-selection-item') || document.querySelector('.select-language');
        const language = langEl ? langEl.innerText.trim() : "";

        return {
            platform: "HackerRank",
            slug: location.pathname.split('/').filter(p => p && p !== 'challenges' && p !== 'submissions' && p !== 'show')[0] || "unknown",
            id: null,
            title: title.replace(/\s+Solution$/i, ""),
            difficulty,
            tags,
            contentHtml: (document.querySelector('.challenge-body-html') || document.querySelector('.problem-statement') || document.querySelector('.challenge-description'))?.innerHTML || "",
            language,
            folderName: formatFolderName(null, title, "HR")
        };
    }
};

const Adapters = [LeetCodeAdapter, CodeforcesAdapter, HackerRankAdapter];

// --- Core Logic ---

async function getEditorCode() {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({ action: "executeCodeExtraction" }, (response) => {
                if (chrome.runtime.lastError || !response || !response.success) {
                    resolve({ code: "", languageId: null });
                } else {
                    resolve(response.data);
                }
            });
        } catch (e) { resolve({ code: "", languageId: null }); }
    });
}

async function gatherProblemData() {
    const adapter = Adapters.find(a => a.matches());
    if (!adapter) return null;

    try {
        const data = await adapter.gather();
        const editor = await getEditorCode();

        const detectedLang = data.language || editor.languageId || "";
        const normLang = normalizeLanguage(detectedLang);
        const extWithDot = LANGUAGE_EXTENSION_MAP[normLang] || ".txt";

        return {
            ...data,
            code: editor.code || "",
            language: detectedLang,
            normalizedLanguage: normLang,
            suggestedExtension: extWithDot,
            extension: extWithDot.replace(/^\./, ""),
            url: location.href
        };
    } catch (err) {
        console.error("[CodeBridge] gather failed", err);
        return null;
    }
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
                "github_file_structure",
                "allowUpdateDefault",
            ],
            async (items) => {
                const owner = items && items.github_owner;
                const repo = items && items.github_repo;
                const branch = (items && items.github_branch) || "main";
                const token = items && items.github_token;
                const fileOrg = (items && items.github_file_structure) || "folder";
                const allowUpdate = !!(items && items.allowUpdateDefault);

                if (!owner || !repo || !token) {
                    console.warn(
                        "Auto-save aborted: missing owner/repo/token in options"
                    );
                    return;
                }

                // send to background to upload
                const payload = {
                    action: "prepareAndUpload",
                    problemData,
                    owner,
                    repo,
                    branch,
                    fileOrg,
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
        bubble.style.cursor = "pointer";
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
        // clickPrevent blocks click after a drag; moved tracks whether pointer moved enough to be considered a drag
        let clickPrevent = false;
        let moved = false;
        // prevent concurrent uploads
        let isProcessing = false;
        // how many pixels movement counts as a drag (increase to avoid false positives)
        const MOVE_THRESHOLD = 8;
        // synthetic click helpers to ensure taps trigger upload even when native click is suppressed
        let lastSyntheticClickAt = 0;
        let lastClickAt = 0;

        function onPointerDown(ev) {
            try {
                // ignore if clicking the close button
                if (ev.target && ev.target.id === "lcgh-bubble-close") return;
                // left-button or touch only
                if (ev.pointerType === "mouse" && ev.button !== 0) return;
                // Avoid calling preventDefault() here — allow click events to fire.
                pointerId = ev.pointerId;
                try {
                    wrapper.setPointerCapture &&
                        wrapper.setPointerCapture(pointerId);
                } catch (e) { }
                startX = ev.clientX;
                startY = ev.clientY;
                // reset moved flag at start of interaction
                moved = false;
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
                // do not set clickPrevent here; it will be set on up only if movement occurred
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
                // mark as moved if user dragged beyond small threshold
                if (!moved && (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD))
                    moved = true;
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
                if (moved) bubble.style.cursor = "grabbing";
            } catch (e) {
                /* ignore */
            }
        }

        function onPointerUp(ev) {
            try {
                if (pointerId === null || ev.pointerId !== pointerId) return;
                try {
                    wrapper.releasePointerCapture(pointerId);
                } catch (e) { }
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
                // only prevent click if we actually moved during the interaction
                clickPrevent = !!moved;
                // reset moved shortly after to allow subsequent clicks
                setTimeout(() => {
                    clickPrevent = false;
                    moved = false;
                }, 200);
                bubble.style.cursor = "pointer";
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
            // Use the globally exposed onBubbleClick function
            if (typeof window.__lcgh_onBubbleClick === "function") {
                window.__lcgh_onBubbleClick();
            } else {
                console.warn("lcgh: bubble clicked but __lcgh_onBubbleClick not available yet");
            }
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
                } catch (e) { }
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
//
// Provide: onBubbleClick (perform in-page upload) and runtime-controlled bubble visibility.
// - onBubbleClick will gather problem data and call background 'uploadFiles' automatically.
// - Respect chrome.storage.local.showBubble setting to show/hide the bubble.
// - Listen for storage changes so the popup setting takes effect immediately.
//
// Extra: listen for background messages (showUploadToast) and window.postMessage fallback
// Also attach a drag fallback to any injected bubble that may not have pointer handlers.
(function setupBubbleActionsAndFallback() {
    // Helper: minimal in-page toast used when showToast helper not present
    function minimalToast(message, success) {
        try {
            let t = document.getElementById("lcgh-toast");
            if (!t) {
                t = document.createElement("div");
                t.id = "lcgh-toast";
                document.body.appendChild(t);
            }
            t.textContent = message;
            t.style.position = "fixed";
            t.style.right = "18px";
            t.style.bottom = "190px";
            t.style.background = success
                ? "rgba(16,185,129,0.95)"
                : "rgba(203,36,42,0.95)";
            t.style.color = "#fff";
            t.style.padding = "10px 14px";
            t.style.borderRadius = "8px";
            t.style.zIndex = 2147483651;
            t.style.boxShadow = "0 8px 20px rgba(2,6,23,0.45)";
            t.style.maxWidth = "420px";
            t.style.fontSize = "13px";
            t.style.display = "block";
            if (t._hideTimeout) clearTimeout(t._hideTimeout);
            t._hideTimeout = setTimeout(() => (t.style.display = "none"), 6000);
        } catch (e) {
            /* ignore */
        }
    }

    // Build a README from problem data (simple version)
    function buildReadme(problemData) {
        try {
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
            lines.push("_Generated by LeetCode → GitHub Chrome extension_");
            return lines.join("\n");
        } catch (e) {
            return `# ${problemData.title || "Problem"}\n\n${problemData.url || ""
                }`;
        }
    }

    // Main click handler invoked when bubble is clicked
    async function onBubbleClick() {
        // avoid concurrent runs
        if (isProcessing) {
            try { console.log("lcgh: onBubbleClick ignored — already processing"); } catch (e) { }
            return;
        }
        isProcessing = true;
        // notify page bridge of processing state
        try { window.postMessage && window.postMessage({ lcghSetProcessing: true }, '*'); } catch (e) { }
        // show spinner UI immediately
        try {
            const wrapperEl = document.getElementById("lcgh-bubble");
            const innerEl = wrapperEl && wrapperEl.querySelector(".lcgh-bubble-inner");
            if (wrapperEl) wrapperEl.classList.add("lcgh-loading");
            if (innerEl && !innerEl._prevHTML) {
                innerEl._prevHTML = innerEl.innerHTML;
                innerEl.innerHTML = '<div class="lcgh-spinner"></div>';
            }
        } catch (e) { /* ignore UI errors */ }

        try {
            console.log("lcgh: onBubbleClick invoked");
            const data = await gatherProblemData();
            if (!data || !data.slug) {
                minimalToast("No problem detected on this page", false);
                return;
            }

            const items = await new Promise((resolve) => {
                try {
                    chrome.storage.local.get(
                        [
                            "github_owner",
                            "github_repo",
                            "github_branch",
                            "github_language",
                            "github_file_structure",
                            "allowUpdateDefault",
                            "showBubble",
                        ],
                        (res) => resolve(res || {})
                    );
                } catch (e) {
                    resolve({});
                }
            });

            const owner = (items && items.github_owner) || null;
            const repo = (items && items.github_repo) || null;
            const branch = (items && items.github_branch) || "main";
            const chosenExt = (items && items.github_language) || data.extension || "txt";
            const fileOrg = (items && items.github_file_structure) || "folder";
            const allowUpdate = !!(items && items.allowUpdateDefault);

            if (!owner || !repo) {
                minimalToast("Missing owner/repo in extension settings. Open popup to set them.", false);
                return;
            }



            try {
                if (typeof showToast === "function") showToast("Uploading solution to GitHub…", 0);
                else minimalToast("Uploading solution to GitHub…", true);
            } catch (e) { /* ignore */ }

            const problemData = {
                ...data,
                extension: chosenExt
            };

            const payload = {
                action: "prepareAndUpload",
                problemData,
                owner,
                repo,
                branch,
                fileOrg,
                allowUpdate,
            };

            const result = await new Promise((resolve) => {
                chrome.runtime.sendMessage(payload, (resp) => {
                    resolve({ resp, lastErr: chrome.runtime.lastError });
                });
            });

            const { resp, lastErr } = result || {};
            if (lastErr) {
                minimalToast("Upload failed: " + (lastErr && lastErr.message), false);
            } else if (!resp) {
                minimalToast("Upload failed: no response from background", false);
            } else if (resp.success) {
                minimalToast("Upload succeeded", true);
            } else {
                minimalToast("Upload failed: " + (resp.message || "unknown"), false);
            }
        } catch (e) {
            try { minimalToast("Upload error: " + (e && e.message), false); } catch (ex) { }
        } finally {
            // restore UI and processing state
            try {
                const wrapperEl = document.getElementById("lcgh-bubble");
                const innerEl = wrapperEl && wrapperEl.querySelector(".lcgh-bubble-inner");
                if (wrapperEl) wrapperEl.classList.remove("lcgh-loading");
                if (innerEl && innerEl._prevHTML) { innerEl.innerHTML = innerEl._prevHTML; innerEl._prevHTML = null; }
            } catch (e) { }
            try { window.postMessage && window.postMessage({ lcghSetProcessing: false }, '*'); } catch (e) { }
            try { isProcessing = false; } catch (e) { }
        }
    }

    // Expose onBubbleClick globally so other parts of the code (bubble click listener, postMessage handler) can access it
    window.__lcgh_onBubbleClick = onBubbleClick;

    // Inject a page-level bridge script (external file) so page scripts can call window.onBubbleClick().
    try {
        const _script = document.createElement('script');
        _script.src = chrome.runtime.getURL('src/bridge.js');
        _script.onload = function () {
            try { this.parentNode && this.parentNode.removeChild(this); } catch (e) { }
        };
        (document.documentElement || document.head || document.body).appendChild(_script);
    } catch (e) { }

    // Respect showBubble setting: hide bubble if disabled
    function applyShowBubbleSetting(val) {
        try {
            const wrapper = document.getElementById("lcgh-bubble");
            if (!wrapper) return;
            if (val === false || val === "false" || val === 0) {
                wrapper.classList.add("hidden");
            } else {
                wrapper.classList.remove("hidden");
            }
        } catch (e) { }
    }
    // load current setting
    try {
        chrome.storage.local.get(["showBubble"], (items) => {
            applyShowBubbleSetting(
                items && typeof items.showBubble !== "undefined"
                    ? items.showBubble
                    : true
            );
        });
    } catch (e) { }
    // listen for changes
    try {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== "local") return;
            if (changes.showBubble) {
                applyShowBubbleSetting(changes.showBubble.newValue);
            }
        });
    } catch (e) { }
})();

// inject spinner CSS for loading state
(function injectSpinnerStyles() {
    try {
        const css = `.lcgh-spinner{width:22px;height:22px;border:3px solid rgba(255,255,255,0.25);border-top-color:#fff;border-radius:50%;animation:lcgh-spin 1s linear infinite}.lcgh-loading{cursor:wait!important}.lcgh-loading .lcgh-bubble-inner{opacity:0.95}.lcgh-bubble-inner .lcgh-spinner{display:block;margin:0 auto}@keyframes lcgh-spin{to{transform:rotate(360deg)}}`;
        const s = document.createElement("style");
        s.id = "lcgh-spinner-styles";
        s.textContent = css;
        document.head && document.head.appendChild(s);
    } catch (e) { }
})();

(function fallbackToastAndDrag() {
    try {
        // Show upload toast from background
        chrome.runtime.onMessage.addListener((msg) => {
            try {
                if (!msg || msg.action !== "showUploadToast") return;
                const success = !!msg.success;
                const message =
                    msg.message ||
                    (success ? "Upload succeeded" : "Upload failed");
                // Use existing showToast if available
                try {
                    // adjust toast color for success/failure
                    const t = document.getElementById("lcgh-toast");
                    if (t) {
                        t.style.background = success
                            ? "rgba(16,185,129,0.95)"
                            : "rgba(203,36,42,0.95)";
                    }
                    showToast(message, 6000);
                } catch (e) {
                    // fallback minimal toast
                    try {
                        let t = document.getElementById("lcgh-toast");
                        if (!t) {
                            t = document.createElement("div");
                            t.id = "lcgh-toast";
                            document.body.appendChild(t);
                        }
                        t.textContent = message;
                        t.style.position = "fixed";
                        t.style.right = "18px";
                        t.style.bottom = "190px";
                        t.style.background = success
                            ? "rgba(16,185,129,0.95)"
                            : "rgba(203,36,42,0.95)";
                        t.style.color = "#fff";
                        t.style.padding = "10px 14px";
                        t.style.borderRadius = "8px";
                        t.style.zIndex = 2147483651;
                        t.style.boxShadow = "0 8px 20px rgba(2,6,23,0.45)";
                        t.style.maxWidth = "420px";
                        t.style.fontSize = "13px";
                        t.style.display = "block";
                        if (t._hideTimeout) clearTimeout(t._hideTimeout);
                        t._hideTimeout = setTimeout(
                            () => (t.style.display = "none"),
                            6000
                        );
                    } catch (ex) {
                        /* ignore toast failures */
                    }
                }
            } catch (e) {
                /* ignore message handler errors */
            }
        });

        // Accept postMessage from fallback bubble injected by background fallback
        window.addEventListener("message", (ev) => {
            try {
                const d = ev && ev.data;
                if (!d || d.lcghAction !== "bubbleClicked") return;
                // Use the globally exposed onBubbleClick function
                if (typeof window.__lcgh_onBubbleClick === "function") {
                    try {
                        window.__lcgh_onBubbleClick();
                    } catch (e) {
                        console.warn("lcgh: onBubbleClick error", e && e.message);
                    }
                } else {
                    console.log("lcgh: bubbleClicked received but __lcgh_onBubbleClick not available");
                }
            } catch (e) {
                /* ignore */
            }
        });

        // Attach drag handlers to an existing bubble if it was injected without handlers
        function attachDragToExistingBubble() {
            try {
                const wrapper = document.getElementById("lcgh-bubble");
                if (!wrapper) return;
                // avoid re-attaching
                if (wrapper.dataset.lcghDragAttached === "1") return;
                // simple pointer-based drag that updates left/top and persists to chrome.storage.local
                let pid = null;
                let sx = 0,
                    sy = 0,
                    startLeft = null,
                    startTop = null;
                const POS_KEY = "lcgh_bubble_pos";
                function clamp(n, min, max) {
                    return Math.max(min, Math.min(max, n));
                }
                function savePos(left, top) {
                    try {
                        chrome.storage.local.set({
                            [POS_KEY]: {
                                left: Math.round(left),
                                top: Math.round(top),
                            },
                        });
                    } catch (e) { }
                }
                function onDown(ev) {
                    try {
                        if (
                            ev.target &&
                            ev.target.classList &&
                            ev.target.classList.contains &&
                            ev.target.classList.contains("lcgh-close")
                        )
                            return;
                        if (ev.pointerType === "mouse" && ev.button !== 0)
                            return;
                        ev.preventDefault();
                        pid = ev.pointerId;
                        wrapper.setPointerCapture &&
                            wrapper.setPointerCapture(pid);
                        sx = ev.clientX;
                        sy = ev.clientY;
                        const cs = window.getComputedStyle(wrapper);
                        if (cs.left && cs.left !== "auto") {
                            startLeft = parseFloat(cs.left);
                            startTop = parseFloat(cs.top);
                        } else {
                            const r = wrapper.getBoundingClientRect();
                            startLeft = r.left;
                            startTop = r.top;
                            wrapper.style.left = startLeft + "px";
                            wrapper.style.top = startTop + "px";
                            wrapper.style.right = "auto";
                            wrapper.style.bottom = "auto";
                        }
                        wrapper.style.touchAction = "none";
                        wrapper.style.cursor = "grabbing";
                    } catch (e) { }
                }
                function onMove(ev) {
                    try {
                        if (pid === null || ev.pointerId !== pid) return;
                        ev.preventDefault();
                        const dx = ev.clientX - sx;
                        const dy = ev.clientY - sy;
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
                    } catch (e) { }
                }
                function onUp(ev) {
                    try {
                        if (pid === null || ev.pointerId !== pid) return;
                        try {
                            wrapper.releasePointerCapture &&
                                wrapper.releasePointerCapture(pid);
                        } catch (e) { }
                        pid = null;
                        wrapper.style.cursor = "grab";
                        const rect = wrapper.getBoundingClientRect();
                        savePos(rect.left, rect.top);
                    } catch (e) { }
                }
                wrapper.addEventListener("pointerdown", onDown, {
                    passive: false,
                });
                wrapper.addEventListener("pointermove", onMove, {
                    passive: false,
                });
                wrapper.addEventListener("pointerup", onUp, { passive: false });
                wrapper.addEventListener("pointercancel", onUp, {
                    passive: false,
                });
                wrapper.dataset.lcghDragAttached = "1";
            } catch (e) {
                /* ignore attachment failures */
            }
        }

        // run once now and also when DOM changes to catch injected fallback
        attachDragToExistingBubble();
        const mo = new MutationObserver(() => {
            attachDragToExistingBubble();
        });
        mo.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: false,
        });
    } catch (e) {
        /* ignore overall failure */
    }
})();
