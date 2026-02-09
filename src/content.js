/**
 * CodeBridge Content Script
 * 
 * Extreme Idempotency Guard: 
 * We use a self-executing function and a window property check to ensure 
 * that no logic runs twice and no variables are redeclared.
 */
(function () {
    if (window.__codebridge_injected) {
        console.log("[CodeBridge] Content script already active. Skipping redundant initialization.");
        return;
    }
    window.__codebridge_injected = true;

    console.log("[CodeBridge] Initializing content script for:", location.hostname);

    // --- Constants and Maps ---
    const LANGUAGE_EXTENSION_MAP = {
        cpp: ".cpp",
        "c++": ".cpp",
        c: ".c",
        java: ".java",
        python: ".py",
        python3: ".py",
        py: ".py",
        csharp: ".cs",
        "c#": ".cs",
        javascript: ".js",
        js: ".js",
        typescript: ".ts",
        ts: ".ts",
        ruby: ".rb",
        swift: ".swift",
        go: ".go",
        golang: ".go",
        kotlin: ".kt",
        rust: ".rs",
        php: ".php",
        scala: ".scala",
        sql: ".sql",
        bash: ".sh",
        sh: ".sh",
        shell: ".sh",
        dart: ".dart",
        haskell: ".hs",
        lua: ".lua",
        perl: ".pl"
    };

    // --- Internal State ---
    let _autoSaveEnabled = false;
    let _autoSaveDebounce = null;
    let _lastAutoSaved = null;
    let _submissionObserver = null;

    // --- Helper Functions ---
    function normalizeLanguage(lang) {
        if (!lang) return null;
        let norm = lang.replace(/[^A-Za-z0-9+#]+/g, "").toLowerCase();
        if (norm === "c++") norm = "cpp";
        if (norm === "c#") norm = "csharp";
        if (norm === "golang") norm = "go";
        if (norm === "nodejs") norm = "javascript";
        return norm;
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
        const lowPad = pad.toLowerCase();
        if (!isNumericId && (lowPad === kebab || lowPad.includes(kebab) || kebab.includes(lowPad))) {
            name = lowPad.length >= kebab.length ? lowPad : kebab;
        } else {
            name = `${pad}-${kebab}`;
        }
        return prefix ? `${prefix}-${name}` : name;
    }

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
            const mod = await import(chrome.runtime.getURL(moduleUrl));
            return mod[adapterName];
        } catch (e) {
            console.error("[CodeBridge] Failed to load adapter", e);
            return null;
        }
    }

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
        console.log("[CodeBridge] Gathering metadata...");
        const adapter = await loadAdapter();
        if (!adapter) throw new Error("No platform adapter found.");

        try {
            const data = await adapter.gather();
            if (!data) throw new Error("Adapter failed to gather problem details.");

            const editor = await getEditorCode();
            let code = editor.code || "";
            const isCodeforces = adapter.name === "Codeforces";

            const shouldFetch = (isCodeforces && adapter.getSubmissionUrl) || (!code.trim() && adapter.getSubmissionUrl);

            if (shouldFetch) {
                const subUrl = adapter.getSubmissionUrl();
                if (subUrl) {
                    console.log("[CodeBridge] Fetching submission:", subUrl);
                    let res = null;

                    if (isCodeforces && adapter.fetchSolution) {
                        res = await adapter.fetchSolution(subUrl);
                    } else {
                        res = await new Promise(resolve => {
                            chrome.runtime.sendMessage({ action: "fetchSubmissionCode", url: subUrl }, resolve);
                        });
                    }

                    if (res && res.success && res.code) {
                        code = res.code;
                        if (res.language) data.language = res.language;
                    }
                }
            }

            const detectedLang = data.language || editor.languageId || "";
            const normLang = normalizeLanguage(detectedLang);
            const extWithDot = LANGUAGE_EXTENSION_MAP[normLang] || ".txt";

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
            console.error("[CodeBridge] gatherProblemData failed", err);
            throw err;
        }
    }

    // --- Message handling ---
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message) return;

        switch (message.action) {
            case "ping":
                sendResponse({ success: true });
                break;
            case "getProblemData":
                (async () => {
                    try {
                        const data = await gatherProblemData();
                        sendResponse({ success: true, data });
                    } catch (err) {
                        sendResponse({ success: false, message: err.message || String(err) });
                    }
                })();
                return true;
            case "showUploadToast":
                minimalToast(message.message, message.success);
                break;
        }
    });

    // --- UI Logic (Bubble & Toast) ---
    function minimalToast(message, success) {
        try {
            let t = document.getElementById("cb-toast");
            if (!t) {
                t = document.createElement("div");
                t.id = "cb-toast";
                document.body.appendChild(t);
            }
            t.textContent = message;
            Object.assign(t.style, {
                position: "fixed",
                right: "18px",
                bottom: "190px",
                background: success ? "rgba(16,185,129,0.95)" : "rgba(239, 68, 68, 0.95)",
                color: "#fff",
                padding: "10px 16px",
                borderRadius: "10px",
                zIndex: "2147483651",
                boxShadow: "0 8px 25px rgba(0,0,0,0.4)",
                maxWidth: "380px",
                fontSize: "13px",
                fontFamily: "Inter, sans-serif",
                display: "block",
                transition: "opacity 0.3s ease"
            });
            if (t._hideTimeout) clearTimeout(t._hideTimeout);
            t._hideTimeout = setTimeout(() => (t.style.display = "none"), 6000);
        } catch (ex) { }
    }

    function ensureBubble() {
        if (document.getElementById("cb-bubble")) return;
        try {
            const bubble = document.createElement("div");
            bubble.id = "cb-bubble";
            bubble.title = "Save to GitHub";
            Object.assign(bubble.style, {
                position: "fixed",
                right: "24px",
                bottom: "120px",
                width: "56px",
                height: "56px",
                borderRadius: "50%",
                background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 8px 20px rgba(0,0,0,0.3)",
                zIndex: "2147483647",
                cursor: "pointer",
                transition: "transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)"
            });
            bubble.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L12 22"/><path d="M5 9L12 2L19 9"/></svg>';

            bubble.addEventListener("mouseenter", () => bubble.style.transform = "scale(1.1)");
            bubble.addEventListener("mouseleave", () => bubble.style.transform = "scale(1)");
            bubble.addEventListener("click", async () => {
                if (bubble.dataset.processing === "1") return;
                try {
                    bubble.dataset.processing = "1";
                    bubble.style.opacity = "0.7";
                    minimalToast("Syncing solution...", true);
                    const data = await gatherProblemData();
                    if (!data || !data.code) throw new Error("No code found.");
                    await performAutoSave(data);
                } catch (err) {
                    minimalToast(err.message || "Sync failed", false);
                } finally {
                    bubble.dataset.processing = "0";
                    bubble.style.opacity = "1";
                }
            });

            document.body.appendChild(bubble);
        } catch (e) { }
    }

    function setBubbleVisible(show) {
        if (!show) {
            const bubble = document.getElementById("cb-bubble");
            if (bubble) bubble.style.display = "none";
            return;
        }
        ensureBubble();
        const bubble = document.getElementById("cb-bubble");
        if (bubble) bubble.style.display = "flex";
    }

    // --- Auto-Sync Logic ---
    function startSubmissionObserver() {
        if (_submissionObserver) return;
        _submissionObserver = new MutationObserver((mutations) => {
            for (const m of mutations) {
                const nodes = Array.from(m.addedNodes || []);
                const foundAccepted = nodes.some(n => /\bAccepted\b/i.test(n.textContent || ""));
                if (foundAccepted || (m.type === "characterData" && /\bAccepted\b/i.test(m.target.data || ""))) {
                    debounceAutoSync();
                    ensureBubble(); // Show bubble when success detected
                }
            }
        });
        _submissionObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    }

    function stopSubmissionObserver() {
        if (!_submissionObserver) return;
        try {
            _submissionObserver.disconnect();
        } catch (e) { }
        _submissionObserver = null;
    }

    function debounceAutoSync() {
        if (!_autoSaveEnabled) return;
        if (_autoSaveDebounce) return;
        _autoSaveDebounce = setTimeout(async () => {
            _autoSaveDebounce = null;
            try {
                const data = await gatherProblemData();
                if (!data || !data.slug || _lastAutoSaved === data.slug) return;
                _lastAutoSaved = data.slug;
                performAutoSave(data);
            } catch (e) { }
        }, 2000);
    }

    async function performAutoSave(problemData) {
        chrome.storage.local.get(["github_owner", "github_repo", "github_branch", "github_token", "github_file_structure", "allowUpdateDefault"], (items) => {
            const { github_owner: owner, github_repo: repo, github_token: token } = items;
            const branch = items.github_branch || "main";
            if (!owner || !repo || !token) return;

            chrome.runtime.sendMessage({
                action: "prepareAndUpload",
                problemData,
                owner, repo, branch,
                fileOrg: items.github_file_structure || "folder",
                allowUpdate: !!items.allowUpdateDefault
            }, (resp) => {
                if (resp && resp.success) minimalToast("Auto-synced to GitHub!", true);
            });
        });
    }

    // Initialize
    chrome.storage.local.get(["autoSave", "showBubble"], (items) => {
        _autoSaveEnabled = !!(items && items.autoSave);
        if (_autoSaveEnabled) startSubmissionObserver();

        const showBubble = items && typeof items.showBubble !== "undefined" ? !!items.showBubble : true;
        setBubbleVisible(showBubble);
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;

        if (changes.autoSave) {
            _autoSaveEnabled = !!changes.autoSave.newValue;
            if (_autoSaveEnabled) startSubmissionObserver();
            else stopSubmissionObserver();
        }

        if (changes.showBubble) {
            setBubbleVisible(!!changes.showBubble.newValue);
        }
    });

})();
