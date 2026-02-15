import { $ } from "./popupDom.js";

const DIFF_ICONS = {
    easy: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="white"/></svg>`,
    medium: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
    hard: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    unknown: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
};

function togglePanel(id, show) {
    const el = $(id);
    if (!el) return;
    el.classList.toggle("hidden", !show);
}

export function createUi(state) {
    function updateStatus(msg, isError = false) {
        const el = $("status");
        if (!el) return;
        el.textContent = msg || "";
        el.style.color = isError ? "var(--error)" : "var(--text-muted)";
        console.log("[popup] status:", msg);
    }

    function updateAuthStatus(msg) {
        const el = $("authStatus");
        if (!el) return;
        el.textContent = msg || "";
        console.log("[popup] authStatus:", msg);
    }

    function setButtonState(button, busy, busyLabel) {
        if (!button) return;
        const labelEl = button.querySelector("span") || button;
        if (!button.dataset.defaultText) {
            button.dataset.defaultText = labelEl.textContent || "";
        }
        button.disabled = !!busy;
        button.classList.toggle("is-busy", !!busy);
        labelEl.textContent = busy
            ? busyLabel || "Working..."
            : button.dataset.defaultText;
    }

    function setSaveButtonsBusy(busy) {
        setButtonState($("saveBtn"), busy, "Saving...");
        setButtonState($("copyUrlBtn"), busy, "Saving...");
    }

    function setSignInEnabled(enabled) {
        const btn = $("signInBtn");
        if (!btn) return;
        btn.disabled = !enabled;
        btn.style.opacity = enabled ? "1" : "0.6";
        state.signInPending = !enabled;
        console.log("[popup] signInEnabled ->", enabled);
    }

    function showDeviceInfo(device) {
        if (!device) return;
        const url =
            device.verification_uri_complete || device.verification_uri || "";
        const code = device.user_code || "—";
        const deviceInfo = $("deviceInfo");
        const deviceUrl = $("deviceUrl");
        const deviceCode = $("deviceCode");

        if (!deviceInfo || !deviceUrl || !deviceCode) return;

        deviceUrl.textContent = url || "Open URL";
        deviceUrl.href = url || "#";
        deviceCode.textContent = code;
        deviceCode.classList.add("prominent");
        deviceInfo.classList.remove("hidden");

        updateAuthStatus("Code ready — paste into verification tab.");
        updateStatus(
            "A verification tab was opened in the background. Switch to it and paste the code.",
        );
    }

    function clearDeviceInfo() {
        const deviceInfo = $("deviceInfo");
        const deviceCode = $("deviceCode");
        const deviceUrl = $("deviceUrl");

        if (deviceInfo) deviceInfo.classList.add("hidden");
        if (deviceCode) {
            deviceCode.textContent = "—";
            deviceCode.classList.remove("prominent");
        }
        if (deviceUrl) {
            deviceUrl.textContent = "";
            deviceUrl.href = "#";
        }
    }

    function setSubmissionStatus(text, color) {
        const statusEl = $("submissionStatus");
        if (!statusEl) return;
        statusEl.textContent = text || "";
        statusEl.style.display = text ? "block" : "none";
        if (color) statusEl.style.color = color;
    }

    function setSubmissionStatusLink(text, href, color) {
        const statusEl = $("submissionStatus");
        if (!statusEl) return;
        statusEl.innerHTML = "";
        const label = document.createElement("span");
        label.textContent = text || "";
        statusEl.appendChild(label);

        if (href) {
            const link = document.createElement("a");
            link.href = href;
            link.target = "_blank";
            link.rel = "noopener";
            link.textContent = "View on GitHub";
            statusEl.appendChild(link);
        }

        statusEl.style.display = text ? "block" : "none";
        if (color) statusEl.style.color = color;
    }

    function clearSubmissionStatus() {
        setSubmissionStatus("", "");
    }

    function updateRepoSummary(items) {
        const summaryEl = $("repoSummary");
        const branchEl = $("repoBranch");
        if (!summaryEl) return;

        const owner = items && items.github_owner ? items.github_owner : "";
        const repo = items && items.github_repo ? items.github_repo : "";
        const branch = items && items.github_branch ? items.github_branch : "";
        const allowUpdate = !!(items && items.allowUpdateDefault);

        if (!owner || !repo) {
            summaryEl.textContent = "Not configured";
            if (branchEl) branchEl.textContent = "";
            return;
        }

        summaryEl.textContent = `${owner}/${repo}`;
        if (branchEl) {
            const parts = [];
            if (branch) parts.push(`Branch: ${branch}`);
            parts.push(allowUpdate ? "Overwrite enabled" : "Overwrite off");
            branchEl.textContent = parts.join(" • ");
        }
    }

    function setAuthUi({ authenticated, tokenMasked }) {
        if (authenticated) {
            updateAuthStatus(`Signed in • ${tokenMasked || ""}`);
            togglePanel("authPanel", false);
            togglePanel("workflowPanel", true);
            togglePanel("signOutBtn", true);
        } else {
            updateAuthStatus("Not signed in");
            togglePanel("authPanel", true);
            togglePanel("workflowPanel", false);
            togglePanel("signOutBtn", false);
        }
    }

    function showMeta(data) {
        const statusEl = $("submissionStatus");
        const diffIconEl = $("difficultyIcon");
        const metaBody = $("metaBody");

        if (statusEl) {
            statusEl.style.display = "none";
            statusEl.textContent = "";
        }

        if (!data) {
            if (diffIconEl) {
                diffIconEl.className = "diff-icon unknown";
                diffIconEl.innerHTML = DIFF_ICONS.unknown;
            }
            $("metaTitle").textContent = "No problem detected";
            if (metaBody) metaBody.classList.add("hidden");
            state.lastProblemData = null;
            return;
        }

        state.lastProblemData = data;
        if (metaBody) {
            metaBody.classList.remove("hidden");
            metaBody.classList.remove("pop-in");
            void metaBody.offsetWidth;
            metaBody.classList.add("pop-in");
        }

        $("metaTitle").textContent =
            `${data.id ? data.id + " — " : ""}${data.title}`;

        if ($("metaPlatform")) {
            $("metaPlatform").textContent = data.platform || "LeetCode";
            $("metaPlatform").style.display = "inline-block";
        }

        const rawDiff = (data.difficulty || "unknown").toLowerCase();
        const diffClass = ["easy", "medium", "hard"].includes(rawDiff)
            ? rawDiff
            : "unknown";

        if (diffIconEl) {
            diffIconEl.className = `diff-icon ${diffClass}`;
            diffIconEl.innerHTML = DIFF_ICONS[diffClass] || DIFF_ICONS.unknown;
        }

        $("metaDifficulty").textContent = data.difficulty || "Unknown";
        $("metaDifficulty").className = `badge ${diffClass}`;

        $("metaTags").innerHTML = (data.tags || [])
            .map((t) => `<span class="tag">${t}</span>`)
            .join(" ");

        $("detectedPath").textContent = `/${data.folderName}/`;

        const langSel = document.getElementById("language");
        if (langSel && !langSel.dataset.userSet) {
            const ext = data.extension || "txt";
            const hasOption = Array.from(langSel.options || []).some(
                (opt) => opt.value === ext,
            );
            if (hasOption) langSel.value = ext;
        }

        if (!data.code || data.code.trim().length === 0) {
            if (data.platform === "Codeforces" && !data.isSubmissionPage) {
                return;
            }
            const extra = data.codeError ? ` Cause: ${data.codeError}` : "";
            updateStatus(`Warning: No solution code detected!${extra}`, true);
        }
    }

    function promptCodeforcesSubmissionNotice() {
        return new Promise((resolve) => {
            const existing = document.getElementById(
                "cb-solution-fetch-modal",
            );
            if (existing) {
                existing.remove();
            }

            const overlay = document.createElement("div");
            overlay.id = "cb-solution-fetch-modal";
            overlay.className = "cb-modal-overlay";

            const card = document.createElement("div");
            card.className = "cb-modal-card";

            const title = document.createElement("div");
            title.className = "cb-modal-title";
            title.textContent = "Open the submission page";

            const body = document.createElement("div");
            body.className = "cb-modal-body";
            body.textContent =
                "Codeforces only exposes accepted code on the submission page. Open your accepted submission, then reopen the popup.";

            const checkboxWrap = document.createElement("label");
            checkboxWrap.className = "cb-modal-checkbox";
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = false;
            const checkboxText = document.createElement("span");
            checkboxText.textContent = "Don't ask again";
            checkboxWrap.appendChild(checkbox);
            checkboxWrap.appendChild(checkboxText);

            const actions = document.createElement("div");
            actions.className = "cb-modal-actions";

            function cleanup(action) {
                try {
                    overlay.remove();
                } catch (e) {}
                resolve({
                    action,
                    dontAskAgain: checkbox.checked,
                });
            }

            const closeBtn = document.createElement("button");
            closeBtn.type = "button";
            closeBtn.className = "btn primary";
            closeBtn.textContent = "Got it";

            closeBtn.addEventListener("click", () => cleanup("close"));
            overlay.addEventListener("click", (e) => {
                if (e.target === overlay) cleanup("close");
            });

            actions.appendChild(closeBtn);
            card.appendChild(title);
            card.appendChild(body);
            card.appendChild(checkboxWrap);
            card.appendChild(actions);
            overlay.appendChild(card);
            document.body.appendChild(overlay);
        });
    }

    function promptMissingRepoSettings() {
        return new Promise((resolve) => {
            const existing = document.getElementById("cb-repo-settings-modal");
            if (existing) existing.remove();

            const overlay = document.createElement("div");
            overlay.id = "cb-repo-settings-modal";
            overlay.className = "cb-modal-overlay";

            const card = document.createElement("div");
            card.className = "cb-modal-card";

            const title = document.createElement("div");
            title.className = "cb-modal-title";
            title.textContent = "Repository not configured";

            const body = document.createElement("div");
            body.className = "cb-modal-body";
            body.textContent =
                "Add your GitHub owner, repo, and branch in Settings before uploading.";

            const actions = document.createElement("div");
            actions.className = "cb-modal-actions";

            const cancelBtn = document.createElement("button");
            cancelBtn.type = "button";
            cancelBtn.className = "btn secondary";
            cancelBtn.textContent = "Cancel";

            const openBtn = document.createElement("button");
            openBtn.type = "button";
            openBtn.className = "btn primary";
            openBtn.textContent = "Open Settings";

            function cleanup(action) {
                try {
                    overlay.remove();
                } catch (e) {}
                resolve(action);
            }

            cancelBtn.addEventListener("click", () => cleanup("cancel"));
            openBtn.addEventListener("click", () => cleanup("open"));
            overlay.addEventListener("click", (e) => {
                if (e.target === overlay) cleanup("cancel");
            });

            actions.appendChild(cancelBtn);
            actions.appendChild(openBtn);
            card.appendChild(title);
            card.appendChild(body);
            card.appendChild(actions);
            overlay.appendChild(card);
            document.body.appendChild(overlay);
        });
    }

    return {
        updateStatus,
        updateAuthStatus,
        setButtonState,
        setSaveButtonsBusy,
        setSignInEnabled,
        showDeviceInfo,
        clearDeviceInfo,
        setSubmissionStatus,
        setSubmissionStatusLink,
        clearSubmissionStatus,
        updateRepoSummary,
        setAuthUi,
        showMeta,
        promptCodeforcesSubmissionNotice,
        promptMissingRepoSettings,
    };
}
