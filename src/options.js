// options.js — saves extension defaults and provides storage-clear utilities
// Matches updated options.html: no PAT input, simple defaults + autoSave
// Note: this file stays focused on storage; instructions live in the options page.

const $ = (id) => document.getElementById(id);
const statusEl = () => document.getElementById("status");
const clearStatusEl = () => document.getElementById("clearStatus");

function loadOptions() {
    chrome.storage.local.get(
        ["github_owner", "github_repo", "github_branch", "autoSave"],
        (items) => {
            if (items) {
                if (items.github_owner) $("owner").value = items.github_owner;
                if (items.github_repo) $("repo").value = items.github_repo;
                if (items.github_branch)
                    $("branch").value = items.github_branch;
                if (items.autoSave) $("autoSave").checked = true;
            }
        }
    );
}

function saveOptions() {
    const owner = $("owner").value.trim();
    const repo = $("repo").value.trim();
    const branch = $("branch").value.trim();
    const autoSave = !!$("autoSave").checked;

    const toSave = {
        github_owner: owner || "",
        github_repo: repo || "",
        github_branch: branch || "",
        autoSave: !!autoSave,
    };

    chrome.storage.local.set(toSave, () => {
        statusEl().textContent = "Options saved";
        setTimeout(() => (statusEl().textContent = ""), 2500);
    });
}

function clearExtensionStorage() {
    // remove only the extension-related keys to avoid unexpected data loss
    const keys = [
        "github_owner",
        "github_repo",
        "github_branch",
        "github_token",
        "remember_me",
        "autoSave",
        "device_flow_state",
    ];
    chrome.storage.local.remove(keys, () => {
        clearStatusEl().textContent = "Extension storage cleared";
        // notify background/popup about sign-out
        try {
            chrome.runtime.sendMessage({ action: "signedOut" });
        } catch (e) {}
        setTimeout(() => (clearStatusEl().textContent = ""), 3000);
    });
}

document.addEventListener("DOMContentLoaded", () => {
    loadOptions();
    $("saveBtn").addEventListener("click", saveOptions);
    const clearBtn = document.getElementById("clearStorageBtn");
    if (clearBtn) clearBtn.addEventListener("click", clearExtensionStorage);
});
