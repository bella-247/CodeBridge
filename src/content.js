// Content script for LeetCode → GitHub Exporter
// Responsibilities:
// - Detect problem slug, id, title, difficulty, tags, content (description)
// - Attempt to extract user's solution code and language from the in-page editor
// - Respond to runtime messages (action: 'getProblemData') with gathered metadata
//
// Debug instrumentation: logs to page console and captures load/runtime errors so you can see if
// the content script was injected and if any runtime error prevents it from responding.

// Idempotency guard: Ensure the script only runs once per page load cycle
(function () {
    // Idempotency guard: Ensure the script only runs once per page load cycle
    if (window.__codebridge_content_script_loaded) {
        console.log("[CodeBridge] Content script already loaded, skipping re-initialization.");
        return;
    }
    window.__codebridge_content_script_loaded = true;

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
        const isNumericId = id && !isNaN(id);
        const pad = (isNumericId ? String(id).padStart(4, "0") : id || "0000").trim();
        const kebab = title
            .toLowerCase()
            .replace(/[`~!@#$%^&*()+=\[\]{};:'"\\|<>\/?]/g, "")
            .replace(/\s+/g, "-")
            .replace(/--+/g, "-")
            .replace(/^-+|-+$/g, "")
            .trim();

        let name;
        // If ID is the same as kebab title, or one contains the other (non-numeric), don't duplicate
        const lowPad = pad.toLowerCase();
        if (!isNumericId && (lowPad === kebab || lowPad.includes(kebab) || kebab.includes(lowPad))) {
            name = lowPad.length >= kebab.length ? lowPad : kebab;
        } else {
            name = `${pad}-${kebab}`;
        }

        return prefix ? `${prefix}-${name}` : name;
    }

    // --- Adapter Loading logic ---

    async function loadAdapter() {
        const hostname = location.hostname;
        let moduleUrl = null;
        let adapterName = null;

        if (hostname.includes("leetcode.com")) {
            moduleUrl = "src/adapters/leetcode.js";
            adapterName = "LeetCodeAdapter";
        } else if (hostname.includes("codeforces.com")) {
            moduleUrl = "src/adapters/codeforces.js";
            adapterName = "CodeforcesAdapter";
        } else if (hostname.includes("hackerrank.com")) {
            moduleUrl = "src/adapters/hackerrank.js";
            adapterName = "HackerRankAdapter";
        }

        if (!moduleUrl) return null;

        try {
            // Dynamic import from extension resources
            const mod = await import(chrome.runtime.getURL(moduleUrl));
            return mod[adapterName];
        } catch (e) {
            console.error("[CodeBridge] Failed to load adapter", e);
            return null;
        }
    }

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
        console.log("[CodeBridge] --- Gathering Problem Data ---");
        const adapter = await loadAdapter();
        if (!adapter) {
            console.warn("[CodeBridge] No matching adapter found for this hostname.");
            return null;
        }
        console.log(`[CodeBridge] Using ${adapter.name} adapter.`);

        try {
            const data = await adapter.gather();
            if (!data) {
                console.warn(`[CodeBridge] ${adapter.name} adapter failed to gather metadata.`);
                return null;
            }
            console.log(`[CodeBridge] Metadata gathered for: ${data.title} (ID: ${data.id})`);

            const editor = await getEditorCode();

            let code = editor.code || "";
            const isCodeforces = adapter.name === "Codeforces";

            // Strategy: prefer "Silent Scraping" for Codeforces to ensure we get the submitted version
            // For others, use it as fallback if editor is empty
            const shouldFetch = (isCodeforces && adapter.getSubmissionUrl) || (!code.trim() && adapter.getSubmissionUrl);

            if (shouldFetch) {
                const subUrl = adapter.getSubmissionUrl();
                if (subUrl) {
                    console.log("[CodeBridge] Attempting to fetch submission for:", subUrl);
                    let res = null;

                    if (isCodeforces && adapter.fetchSolution) {
                        // For Codeforces, use the adapter's direct fetchSolution in the content script
                        // This leverages the content script's access to the page's DOM and cookies
                        console.log("[CodeBridge] Using adapter.fetchSolution for Codeforces.");
                        res = await adapter.fetchSolution(subUrl);
                    } else {
                        // For other platforms or as a fallback, send message to background script
                        console.log("[CodeBridge] Sending fetchSubmissionCode to background script.");
                        res = await new Promise(resolve => {
                            chrome.runtime.sendMessage({ action: "fetchSubmissionCode", url: subUrl }, resolve);
                        });
                    }

                    if (res && res.success && res.code) {
                        code = res.code; // Override editor code with legitimate submission
                        if (res.language) data.language = res.language; // Update language from submission page
                    } else {
                        console.warn("[CodeBridge] Failed to fetch solution:", res ? res.message : "unknown error");
                    }
                }
            }

            const detectedLang = data.language || editor.languageId || "";
            const normLang = normalizeLanguage(detectedLang);
            const extWithDot = LANGUAGE_EXTENSION_MAP[normLang] || ".txt";

            // Helper to format folder name since it's now internal to content.js or reused
            // We reuse the local formatFolderName function (ensure it exists in content.js or adapter)
            // The adapter might return empty folderName if it relies on us. 
            // We will stick to the Adapter returning basic data and we format here if needed, 
            // OR we trust the adapter does it. 
            // In the files I created, I left folderName: "" to be "generated by core logic".
            // Let's ensure formatFolderName is used here if adapter didn't provide it.

            let folderName = data.folderName;
            if (!folderName) {
                let prefix = "";
                if (adapter.name === "Codeforces") prefix = "CF";
                if (adapter.name === "HackerRank") prefix = "HR";
                folderName = formatFolderName(data.id || data.slug, data.title, prefix);
            }

            return {
                ...data,
                code: code,
                language: detectedLang,
                normalizedLanguage: normLang,
                suggestedExtension: extWithDot,
                extension: extWithDot.replace(/^\./, ""),
                url: location.href,
                folderName: folderName
            };
        } catch (err) {
            console.error("[CodeBridge] gather failed", err);
            return null;
        }
    }



    // Expose via message listener for popup/background to request
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message && message.action === "ping") {
            sendResponse({ success: true });
            return;
        }
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
        if (!problemData || !problemData.code || problemData.code.trim().length === 0) {
            console.warn("Auto-save aborted: No solution code detected.");
            return;
        }
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
                        wrapper.releasePointerCapture &&
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

            // close hides for this page session; reappears on page reload or when accepted/submitted events fire
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

    /**
     * Shows the upload bubble. Called when an 'Accepted' submission is detected.
     */
    function onSolutionAccepted() {
        try {
            const wrapper = document.getElementById("lcgh-bubble");
            if (wrapper) {
                wrapper.classList.remove("hidden");
            } else {
                ensureBubble();
                const wrapperNew = document.getElementById("lcgh-bubble");
                if (wrapperNew) wrapperNew.classList.remove("hidden");
            }
        } catch (e) {
            console.warn("[CodeBridge] Failed to show bubble", e);
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
            // update internal usage point: swap debounceAutoSave reference
            debounceAutoSave = wrappedDebounce;
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
        // Helper: minimal in-page toast
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
                t.style.background = success ? "rgba(16,185,129,0.95)" : "rgba(203,36,42,0.95)";
                t.style.color = "#fff";
                t.style.padding = "10px 14px";
                t.style.borderRadius = "8px";
                t.style.zIndex = "2147483651";
                t.style.boxShadow = "0 8px 20px rgba(2,6,23,0.45)";
                t.style.maxWidth = "420px";
                t.style.fontSize = "13px";
                t.style.display = "block";
                if (t._hideTimeout) clearTimeout(t._hideTimeout);
                t._hideTimeout = setTimeout(() => (t.style.display = "none"), 6000);
            } catch (ex) { /* ignore */ }
        }

        // Listen for messages from background (like showUploadToast)
        chrome.runtime.onMessage.addListener((message) => {
            try {
                if (message && message.action === "showUploadToast") {
                    minimalToast(message.message, message.success);
                }
            } catch (e) { /* ignore */ }
        });

        // Define the bubble click behavior
        window.__lcgh_onBubbleClick = async () => {
            const wrapper = document.getElementById("lcgh-bubble");
            if (wrapper && wrapper.classList.contains("processing")) return;

            try {
                if (wrapper) wrapper.classList.add("processing");
                minimalToast("Gathering problem data...", true);

                const data = await gatherProblemData();
                if (!data) {
                    minimalToast("Failed to gather problem data. Are you on a supported problem page?", false);
                    return;
                }

                if (!data.code || data.code.trim().length === 0) {
                    minimalToast("Solution code not found! Make sure you have code in the editor or a valid submission.", false);
                    return;
                }

                minimalToast("Uploading to GitHub...", true);
                // We use the same performAutoSave logic but it's manual here
                await performAutoSave(data);
            } catch (err) {
                minimalToast("Upload failed: " + (err.message || String(err)), false);
            } finally {
                if (wrapper) wrapper.classList.remove("processing");
            }
        };
    })();

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
})();