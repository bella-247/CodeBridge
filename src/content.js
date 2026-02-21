/**
 * CodeBridge Content Script
 *
 * Extreme Idempotency Guard:
 * We use a self-executing function and a window property check to ensure
 * that no logic runs twice and no variables are redeclared.
 */
(function () {
    if (window.__codebridge_injected) {
        console.log(
            "[CodeBridge] Content script already active. Skipping redundant initialization.",
        );
        return;
    }
    window.__codebridge_injected = true;

    console.log(
        "[CodeBridge] Initializing content script for:",
        location.hostname,
    );

    // Initialize session tracker (non-blocking)
    (async () => {
        try {
            const mod = await import(
                chrome.runtime.getURL("src/content/sessionTracker.js"),
            );
            if (mod && mod.initSessionTracker) {
                mod.initSessionTracker();
            }
        } catch (e) {
            console.warn("[CodeBridge] Session tracker init failed", e);
        }
    })();

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
        perl: ".pl",
    };

    // --- Internal State ---
    let _autoSaveEnabled = false;
    let _autoSaveDebounce = null;
    let _lastAutoSaved = null;
    let _submissionObserver = null;
    let _showBubble = true;
    let _adapterPromise = null;
    let _bubbleTemporarilyHidden = false;
    const ACCEPTED_RE = /\bAccepted\b/i;

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
        const safeTitle = title || "unknown";
        const isNumericId = id && !isNaN(id);
        const pad = (
            isNumericId ? String(id).padStart(4, "0") : id || "0000"
        ).trim();
        const kebab = safeTitle
            .toLowerCase()
            .replace(/[`~!@#$%^&*()+=\[\]{};:'"\\|<>\/?]/g, "")
            .replace(/\s+/g, "-")
            .replace(/--+/g, "-")
            .replace(/^-+|-+$/g, "")
            .trim();

        let name;
        const lowPad = pad.toLowerCase();
        if (
            !isNumericId &&
            (lowPad === kebab ||
                lowPad.includes(kebab) ||
                kebab.includes(lowPad))
        ) {
            name = lowPad.length >= kebab.length ? lowPad : kebab;
        } else {
            name = `${pad}-${kebab}`;
        }
        return prefix ? `${prefix}-${name}` : name;
    }

    function isElementVisible(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.opacity === "0"
        ) {
            return false;
        }
        return !!(el.getClientRects && el.getClientRects().length);
    }

    function readCodeTextFromElement(el) {
        if (!el) return "";

        const lineItems = el.querySelectorAll(
            "ol.linenums > li, ul.linenums > li, .linenums li",
        );
        if (lineItems && lineItems.length) {
            return Array.from(lineItems)
                .map((li) =>
                    (li.textContent || "")
                        .replace(/\u00a0/g, " ")
                        .replace(/\r\n/g, "\n")
                        .replace(/\r/g, "\n"),
                )
                .join("\n");
        }

        const textContent = typeof el.textContent === "string" ? el.textContent : "";
        const innerText =
            typeof el.innerText === "string" ? el.innerText : "";

        const hasLineBreaks = /\r|\n/.test(textContent);
        const raw = hasLineBreaks
            ? textContent
            : innerText && innerText.trim().length
                ? innerText
                : textContent;

        return raw
            .replace(/\u00a0/g, " ")
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n");
    }

    function extractCodeforcesDialogFromDom() {
        try {
            const dialogRoot =
                document.querySelector("#facebox") ||
                document.querySelector(".facebox");
            if (!dialogRoot || !isElementVisible(dialogRoot)) return null;

            const root = dialogRoot.querySelector(".content") || dialogRoot;
            const candidates = [];
            const primary =
                root.querySelector("#program-source-text") ||
                root.querySelector("pre.prettyprint");
            if (primary) candidates.push(primary);

            const pres = Array.from(root.querySelectorAll("pre"));
            for (const pre of pres) {
                if (!candidates.includes(pre)) candidates.push(pre);
            }

            let best = null;
            for (const el of candidates) {
                const text = readCodeTextFromElement(el);
                if (!text.trim()) continue;
                if (!best || text.length > best.text.length) {
                    best = { el, text };
                }
            }

            if (!best) return null;

            let language = "";
            const infoRows = root.querySelectorAll("table tr");
            for (const row of infoRows) {
                const cells = row.getElementsByTagName("td");
                if (cells.length > 1) {
                    const label = cells[0].innerText
                        .trim()
                        .toLowerCase()
                        .replace(/:$/, "");
                    if (
                        label === "lang" ||
                        label === "language" ||
                        label.includes("language") ||
                        label.includes("язык")
                    ) {
                        language = cells[1].innerText.trim();
                        break;
                    }
                }
            }

            let submissionUrl = "";
            const submissionLink = root.querySelector(
                'a[href*="/submission/"]',
            );
            if (submissionLink && submissionLink.getAttribute("href")) {
                try {
                    submissionUrl = new URL(
                        submissionLink.getAttribute("href"),
                        location.origin,
                    ).href;
                } catch (e) {}
            }

            let problemUrl = "";
            const problemLink =
                root.querySelector('a[href*="/problemset/problem/"]') ||
                root.querySelector('a[href*="/contest/"][href*="/problem/"]') ||
                root.querySelector('a[href*="/gym/"][href*="/problem/"]') ||
                root.querySelector('a[href*="/problem/"]');
            if (problemLink && problemLink.getAttribute("href")) {
                try {
                    problemUrl = new URL(
                        problemLink.getAttribute("href"),
                        location.origin,
                    ).href;
                } catch (e) {}
            }

            return {
                code: best.text,
                language,
                submissionUrl,
                problemUrl,
            };
        } catch (e) {
            return null;
        }
    }

    function extractCodeforcesSubmissionFromDom() {
        try {
            const codeEl =
                document.querySelector("#program-source-text") ||
                document.querySelector("pre.prettyprint");
            let code = codeEl ? readCodeTextFromElement(codeEl) : "";

            let language = "";
            const infoRows = document.querySelectorAll(".datatable table tr");
            for (const row of infoRows) {
                const cells = row.getElementsByTagName("td");
                if (cells.length > 1) {
                    const label = cells[0].innerText
                        .trim()
                        .toLowerCase()
                        .replace(/:$/, "");
                    if (
                        label === "lang" ||
                        label === "language" ||
                        label.includes("language") ||
                        label.includes("язык")
                    ) {
                        language = cells[1].innerText.trim();
                        break;
                    }
                }
            }

            return {
                code,
                language,
            };
        } catch (e) {
            return { code: "", language: "" };
        }
    }

    async function loadAdapter() {
        if (_adapterPromise) return _adapterPromise;

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

        _adapterPromise = (async () => {
            if (!moduleUrl) return null;
            try {
                const mod = await import(chrome.runtime.getURL(moduleUrl));
                return mod[adapterName] || null;
            } catch (e) {
                console.error("[CodeBridge] Failed to load adapter", e);
                _adapterPromise = null;
                return null;
            }
        })();

        return _adapterPromise;
    }

    async function getEditorCode() {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage(
                    { action: "executeCodeExtraction" },
                    (response) => {
                        if (
                            chrome.runtime.lastError ||
                            !response ||
                            !response.success
                        ) {
                            resolve({ code: "", languageId: null });
                        } else {
                            resolve(response.data);
                        }
                    },
                );
            } catch (e) {
                resolve({ code: "", languageId: null });
            }
        });
    }

    async function gatherProblemData(options = {}) {
        console.log("[CodeBridge] Gathering metadata...");
        const adapter = await loadAdapter();
        if (!adapter) throw new Error("No platform adapter found.");

        try {
            const { skipSolutionFetch = false } = options || {};
            const data = await adapter.gather();
            if (!data)
                throw new Error("Adapter failed to gather problem details.");

            const editor = await getEditorCode();
            let code = editor.code || "";
            let codeSource = code && code.trim() ? "editor" : "";
            const isCodeforces = adapter.name === "Codeforces";
            const isCfSubmissionPage =
                isCodeforces &&
                (location.pathname.includes("/submission/") ||
                    document.querySelector("#program-source-text"));

            if (isCodeforces && !isCfSubmissionPage) {
                const dialogRes = extractCodeforcesDialogFromDom();
                if (dialogRes && dialogRes.code && dialogRes.code.trim()) {
                    code = dialogRes.code;
                    codeSource = "dialog";
                    if (dialogRes.language) data.language = dialogRes.language;
                    if (dialogRes.submissionUrl)
                        data.submissionUrl = dialogRes.submissionUrl;
                    if (dialogRes.problemUrl && !data.url)
                        data.url = dialogRes.problemUrl;
                }
            }

            if (isCfSubmissionPage) {
                if (!code.trim()) {
                    const domRes = extractCodeforcesSubmissionFromDom();
                    if (domRes.code && domRes.code.trim()) {
                        code = domRes.code;
                        codeSource = "submission";
                    }
                    if (domRes.language) data.language = domRes.language;
                }
                data.submissionUrl = location.href;
                data.isSubmissionPage = true;
            }

            const shouldFetch =
                adapter.getSubmissionUrl &&
                !skipSolutionFetch &&
                !isCfSubmissionPage &&
                !code.trim() &&
                !isCodeforces;

            if (shouldFetch) {
                const subUrl = adapter.getSubmissionUrl();
                if (subUrl) {
                    console.log("[CodeBridge] Fetching submission:", subUrl);
                    let res = null;

                    if (adapter.fetchSolution) {
                        res = await adapter.fetchSolution(subUrl);
                    } else {
                        res = await new Promise((resolve) => {
                            chrome.runtime.sendMessage(
                                { action: "fetchSubmissionCode", url: subUrl },
                                resolve,
                            );
                        });
                    }

                    if (res && res.success && res.code) {
                        code = res.code;
                        if (res.language) data.language = res.language;
                        codeSource = "submission";
                    } else if (res && res.success && !res.code) {
                        data.codeError =
                            "Submission parsed but code was empty.";
                    } else if (res && !res.success && res.message) {
                        data.codeError = res.message;
                        if (res.kind) data.codeErrorKind = res.kind;
                    } else if (!res) {
                        data.codeError =
                            "Submission fetch did not return a response.";
                    }
                    data.submissionUrl = subUrl;
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
                folderName = formatFolderName(
                    data.id || data.slug,
                    data.title,
                    prefix,
                );
            }

            return {
                ...data,
                code: code,
                language: detectedLang,
                normalizedLanguage: normLang,
                suggestedExtension: extWithDot,
                extension: extWithDot.replace(/^\./, ""),
                url: data.url || location.href,
                folderName: folderName,
                codeSource: codeSource || (code && code.trim() ? "editor" : ""),
                isSubmissionPage: !!data.isSubmissionPage,
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
                        const data = await gatherProblemData(
                            message.options || {},
                        );
                        sendResponse({ success: true, data });
                    } catch (err) {
                        sendResponse({
                            success: false,
                            message: err.message || String(err),
                        });
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
                background: success
                    ? "rgba(16,185,129,0.95)"
                    : "rgba(239, 68, 68, 0.95)",
                color: "#fff",
                padding: "10px 16px",
                borderRadius: "10px",
                zIndex: "2147483651",
                boxShadow: "0 8px 25px rgba(0,0,0,0.4)",
                maxWidth: "380px",
                fontSize: "13px",
                fontFamily: "Inter, sans-serif",
                display: "block",
                transition: "opacity 0.3s ease",
            });
            if (t._hideTimeout) clearTimeout(t._hideTimeout);
            t._hideTimeout = setTimeout(() => (t.style.display = "none"), 6000);
        } catch (ex) {}
    }

    function showBubbleError(message) {
        try {
            const bubble = document.getElementById("cb-bubble");
            if (!bubble) {
                minimalToast(message, false);
                return;
            }

            let tip = document.getElementById("cb-bubble-error");
            if (!tip) {
                tip = document.createElement("div");
                tip.id = "cb-bubble-error";
                document.body.appendChild(tip);
            }

            tip.textContent = message;
            const rect = bubble.getBoundingClientRect();
            Object.assign(tip.style, {
                position: "fixed",
                left: `${rect.left + rect.width / 2}px`,
                top: `${Math.max(8, rect.top - 8)}px`,
                transform: "translate(-50%, -100%)",
                background: "rgba(239, 68, 68, 0.95)",
                color: "#fff",
                padding: "6px 10px",
                borderRadius: "8px",
                zIndex: "2147483652",
                fontSize: "12px",
                fontFamily: "Inter, sans-serif",
                boxShadow: "0 6px 16px rgba(0,0,0,0.3)",
                maxWidth: "280px",
                textAlign: "center",
                display: "block",
            });

            if (tip._hideTimeout) clearTimeout(tip._hideTimeout);
            tip._hideTimeout = setTimeout(() => {
                tip.style.display = "none";
            }, 4000);
        } catch (e) {
            minimalToast(message, false);
        }
    }

    function promptSolveTime() {
        return new Promise((resolve) => {
            if (document.getElementById("cb-solve-time-modal")) {
                resolve(null);
                return;
            }

            const overlay = document.createElement("div");
            overlay.id = "cb-solve-time-modal";
            Object.assign(overlay.style, {
                position: "fixed",
                inset: "0",
                background: "rgba(15, 23, 42, 0.55)",
                zIndex: "2147483653",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "16px",
            });

            const card = document.createElement("div");
            Object.assign(card.style, {
                width: "100%",
                maxWidth: "360px",
                background: "#0f172a",
                color: "#e2e8f0",
                borderRadius: "14px",
                padding: "16px",
                boxShadow: "0 18px 40px rgba(0,0,0,0.45)",
                border: "1px solid rgba(148,163,184,0.25)",
                fontFamily: "Inter, sans-serif",
                boxSizing: "border-box",
            });

            const title = document.createElement("div");
            title.textContent = "Time to solve";
            Object.assign(title.style, {
                fontSize: "14px",
                fontWeight: "600",
                marginBottom: "8px",
            });

            const hint = document.createElement("div");
            hint.textContent = "Add your solve time so it appears in the upload.";
            Object.assign(hint.style, {
                fontSize: "11px",
                color: "#94a3b8",
                marginBottom: "10px",
            });

            const fields = document.createElement("div");
            Object.assign(fields.style, {
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "10px",
                marginBottom: "10px",
            });

            const input = document.createElement("input");
            input.type = "text";
            input.placeholder = "e.g. 45 min";
            Object.assign(input.style, {
                width: "100%",
                maxWidth: "100%",
                padding: "10px 12px",
                borderRadius: "10px",
                border: "1px solid rgba(148,163,184,0.35)",
                background: "rgba(15,23,42,0.8)",
                color: "#e2e8f0",
                outline: "none",
                fontSize: "13px",
                boxSizing: "border-box",
            });

            const attemptsInput = document.createElement("input");
            attemptsInput.type = "number";
            attemptsInput.min = "0";
            attemptsInput.step = "1";
            attemptsInput.placeholder = "Attempts";
            Object.assign(attemptsInput.style, {
                width: "100%",
                maxWidth: "100%",
                padding: "10px 12px",
                borderRadius: "10px",
                border: "1px solid rgba(148,163,184,0.35)",
                background: "rgba(15,23,42,0.8)",
                color: "#e2e8f0",
                outline: "none",
                fontSize: "13px",
                boxSizing: "border-box",
            });

            const actions = document.createElement("div");
            Object.assign(actions.style, {
                display: "flex",
                gap: "8px",
                justifyContent: "flex-end",
            });

            const cancelBtn = document.createElement("button");
            cancelBtn.type = "button";
            cancelBtn.textContent = "Cancel";
            Object.assign(cancelBtn.style, {
                background: "transparent",
                color: "#94a3b8",
                border: "1px solid rgba(148,163,184,0.35)",
                padding: "8px 12px",
                borderRadius: "10px",
                cursor: "pointer",
            });

            const okBtn = document.createElement("button");
            okBtn.type = "button";
            okBtn.textContent = "Continue";
            Object.assign(okBtn.style, {
                background: "#10b981",
                color: "#fff",
                border: "none",
                padding: "8px 12px",
                borderRadius: "10px",
                cursor: "pointer",
            });

            function cleanup(result) {
                try {
                    overlay.remove();
                } catch (e) {}
                resolve(result);
            }

            const buildResult = () => {
                const solveTime = (input.value || "").trim();
                const attemptsRaw = (attemptsInput.value || "").trim();
                const attemptCount = attemptsRaw
                    ? parseInt(attemptsRaw, 10)
                    : null;
                return {
                    solveTime,
                    attemptCount:
                        Number.isFinite(attemptCount) && attemptCount >= 0
                            ? attemptCount
                            : null,
                };
            };

            cancelBtn.addEventListener("click", () => cleanup(null));
            okBtn.addEventListener("click", () => cleanup(buildResult()));
            overlay.addEventListener("click", (e) => {
                if (e.target === overlay) cleanup(null);
            });
            const onKey = (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    cleanup(buildResult());
                } else if (e.key === "Escape") {
                    e.preventDefault();
                    cleanup(null);
                }
            };
            input.addEventListener("keydown", onKey);
            attemptsInput.addEventListener("keydown", onKey);

            actions.appendChild(cancelBtn);
            actions.appendChild(okBtn);
            card.appendChild(title);
            card.appendChild(hint);
            fields.appendChild(input);
            fields.appendChild(attemptsInput);
            card.appendChild(fields);
            card.appendChild(actions);
            overlay.appendChild(card);
            document.body.appendChild(overlay);

            setTimeout(() => input.focus(), 0);
        });
    }

    function ensureBubble() {
        if (_bubbleTemporarilyHidden) return;
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
                transition: "transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)",
            });
            bubble.innerHTML =
                '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L12 22"/><path d="M5 9L12 2L19 9"/></svg>';

            const close = document.createElement("div");
            close.textContent = "×";
            Object.assign(close.style, {
                position: "absolute",
                top: "4px",
                right: "4px",
                width: "18px",
                height: "18px",
                borderRadius: "50%",
                background: "rgba(0,0,0,0.35)",
                color: "#fff",
                fontSize: "12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
            });
            close.addEventListener("click", (ev) => {
                ev.stopPropagation();
                bubble.style.display = "none";
                _bubbleTemporarilyHidden = true;
            });
            bubble.appendChild(close);

            bubble.addEventListener(
                "mouseenter",
                () => (bubble.style.transform = "scale(1.1)"),
            );
            bubble.addEventListener(
                "mouseleave",
                () => (bubble.style.transform = "scale(1)"),
            );
            bubble.addEventListener("click", async () => {
                if (bubble.dataset.processing === "1") return;
                try {
                    bubble.dataset.processing = "1";
                    bubble.style.opacity = "0.7";
                    const promptResult = await promptSolveTime();
                    const solveTimeRaw =
                        promptResult && typeof promptResult.solveTime === "string"
                            ? promptResult.solveTime
                            : "";
                    if (!solveTimeRaw) {
                        showBubbleError(
                            "Please enter time to solve before uploading.",
                        );
                        return;
                    }

                    const solveTime = /^\d+$/.test(solveTimeRaw)
                        ? `${solveTimeRaw} min`
                        : solveTimeRaw;

                    minimalToast("Syncing solution...", true);
                    const data = await gatherProblemData();
                    if (!data || !data.code) throw new Error("No code found.");
                    data.solveTime = solveTime;
                    if (
                        promptResult &&
                        Number.isFinite(promptResult.attemptCount)
                    ) {
                        data.attemptCount = promptResult.attemptCount;
                    }
                    await performAutoSave(data, { silent: false });
                } catch (err) {
                    minimalToast(err.message || "Sync failed", false);
                } finally {
                    bubble.dataset.processing = "0";
                    bubble.style.opacity = "1";
                }
            });

            document.body.appendChild(bubble);
        } catch (e) {}
    }

    function setBubbleVisible(show) {
        if (!show) {
            const bubble = document.getElementById("cb-bubble");
            if (bubble) bubble.style.display = "none";
            return;
        }
        if (_bubbleTemporarilyHidden) return;
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
                const foundAccepted = nodes.some((n) =>
                    ACCEPTED_RE.test(n.textContent || ""),
                );
                if (
                    foundAccepted ||
                    (m.type === "characterData" &&
                        ACCEPTED_RE.test(m.target.data || ""))
                ) {
                    debounceAutoSync();
                    if (_showBubble) setBubbleVisible(true);
                }
            }
        });
        _submissionObserver.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
        });
    }

    function stopSubmissionObserver() {
        if (!_submissionObserver) return;
        try {
            _submissionObserver.disconnect();
        } catch (e) {}
        _submissionObserver = null;
    }

    function updateSubmissionObserver() {
        if (_autoSaveEnabled || _showBubble) {
            startSubmissionObserver();
        } else {
            stopSubmissionObserver();
        }
    }

    function debounceAutoSync() {
        if (!_autoSaveEnabled) return;
        if (_autoSaveDebounce) return;
        _autoSaveDebounce = setTimeout(async () => {
            _autoSaveDebounce = null;
            try {
                const data = await gatherProblemData();
                if (!data) return;
                const platform = data.platform || "";
                const slug = data.slug || "";
                const id = data.id || "";
                const title = data.title || "";
                const url = data.url || "";
                const identifier =
                    slug ||
                    id ||
                    `${platform}:${id || slug || title || url}` ||
                    null;
                if (!identifier || _lastAutoSaved === identifier) return;
                _lastAutoSaved = identifier;
                performAutoSave(data, { silent: true });
            } catch (e) {
                console.error(
                    "[CodeBridge] debounceAutoSync failed during gatherProblemData/performAutoSave",
                    e,
                );
            }
        }, 2000);
    }

    async function performAutoSave(problemData, { silent = false } = {}) {
        chrome.storage.local.get(
            [
                "github_owner",
                "github_repo",
                "github_branch",
                "github_token",
                "github_file_structure",
                "allowUpdateDefault",
            ],
            (items) => {
                const {
                    github_owner: owner,
                    github_repo: repo,
                    github_token: token,
                } = items;
                const branch = items.github_branch || "main";
                if (!owner || !repo || !token) {
                    if (!silent)
                        minimalToast(
                            "Missing GitHub config. Open popup to set owner/repo.",
                            false,
                        );
                    return;
                }

                chrome.runtime.sendMessage(
                    {
                        action: "prepareAndUpload",
                        problemData,
                        owner,
                        repo,
                        branch,
                        fileOrg: items.github_file_structure || "folder",
                        allowUpdate: !!items.allowUpdateDefault,
                    },
                    (resp) => {
                        if (chrome.runtime.lastError) {
                            if (!silent)
                                minimalToast(
                                    "Upload failed: " +
                                        chrome.runtime.lastError.message,
                                    false,
                                );
                            return;
                        }
                        if (!silent && resp && resp.success) {
                            minimalToast("Uploaded to GitHub", true);
                        } else if (!silent && resp && !resp.success) {
                            minimalToast(
                                resp.message || "Upload failed",
                                false,
                            );
                        }
                    },
                );
            },
        );
    }

    // Initialize
    chrome.storage.local.get(["autoSave", "showBubble"], (items) => {
        _autoSaveEnabled = !!(items && items.autoSave);
        _showBubble =
            items && typeof items.showBubble !== "undefined"
                ? !!items.showBubble
                : true;
        setBubbleVisible(_showBubble);
        updateSubmissionObserver();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;

        if (changes.autoSave) {
            _autoSaveEnabled = !!changes.autoSave.newValue;
            updateSubmissionObserver();
        }

        if (changes.showBubble) {
            _showBubble = !!changes.showBubble.newValue;
            setBubbleVisible(_showBubble);
            updateSubmissionObserver();
        }
    });
})();
