/**
 * options.js - Configuration management for CodeBridge
 */

const $ = (id) => document.getElementById(id);

function loadOptions() {
    chrome.storage.local.get([
        "github_owner",
        "github_repo",
        "github_branch",
        "template_commit",
        "template_path",
        "template_readme"
    ], (items) => {
        if (items) {
            if (items.github_owner) $("owner").value = items.github_owner;
            if (items.github_repo) $("repo").value = items.github_repo;
            if (items.github_branch) $("branch").value = items.github_branch;

            if (items.template_commit) $("templateCommit").value = items.template_commit;
            if (items.template_path) $("templatePath").value = items.template_path;
            if (items.template_readme) $("templateReadme").value = items.template_readme;
        }
    });
}

function saveOptions() {
    const owner = $("owner").value.trim();
    const repo = $("repo").value.trim();
    const branch = $("branch").value.trim();

    const templateCommit = $("templateCommit").value.trim();
    const templatePath = $("templatePath").value.trim();
    const templateReadme = $("templateReadme").value.trim();

    const toSave = {
        github_owner: owner,
        github_repo: repo,
        github_branch: branch,
        template_commit: templateCommit,
        template_path: templatePath,
        template_readme: templateReadme
    };

    chrome.storage.local.set(toSave, () => {
        const status = $("status");
        status.textContent = "Configuration saved successfully!";
        status.style.color = "var(--accent)";
        setTimeout(() => (status.textContent = ""), 3000);
    });
}

function resetTemplates() {
    if (confirm("Restore all templates to default?")) {
        $("templateCommit").value = "Solved [id] - [title] ([difficulty])";
        $("templatePath").value = "[id]-[slug]/solution.[ext]";
        $("templateReadme").value = "# [title]\n\n**Difficulty:** [difficulty]\n\n**URL:** [url]\n\n## Problem\n\n[description]";
        saveOptions();
    }
}

function clearExtensionStorage() {
    if (confirm("This will clear ALL settings and sign you out. Are you sure?")) {
        chrome.storage.local.clear(() => {
            alert("Storage cleared.");
            location.reload();
        });
    }
}

document.addEventListener("DOMContentLoaded", () => {
    loadOptions();
    $("saveBtn").addEventListener("click", saveOptions);
    $("resetTemplates").addEventListener("click", resetTemplates);
    $("clearStorageBtn").addEventListener("click", clearExtensionStorage);
});
