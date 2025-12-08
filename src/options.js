// options.js — saves extension defaults and auto-save preference to chrome.storage.local

const $ = id => document.getElementById(id);
const statusEl = () => document.getElementById('status');

function loadOptions() {
  chrome.storage.local.get(['github_owner','github_repo','github_branch','github_token','save_token','autoSave'], (items) => {
    if (items) {
      if (items.github_owner) $('owner').value = items.github_owner;
      if (items.github_repo) $('repo').value = items.github_repo;
      if (items.github_branch) $('branch').value = items.github_branch;
      if (items.github_token) $('token').value = items.github_token;
      if (items.save_token) $('saveToken').checked = true;
      if (items.autoSave) $('autoSave').checked = true;
    }
  });
}

function saveOptions() {
  const owner = $('owner').value.trim();
  const repo = $('repo').value.trim();
  const branch = $('branch').value.trim();
  const token = $('token').value.trim();
  const saveToken = $('saveToken').checked;
  const autoSave = $('autoSave').checked;

  const toSave = {
    github_owner: owner || '',
    github_repo: repo || '',
    github_branch: branch || '',
    autoSave: !!autoSave,
    save_token: !!saveToken
  };
  if (saveToken && token) {
    toSave.github_token = token;
  } else {
    // remove token if user doesn't want to save it
    chrome.storage.local.remove('github_token', () => {});
  }

  chrome.storage.local.set(toSave, () => {
    statusEl().textContent = 'Options saved';
    setTimeout(() => statusEl().textContent = '', 2500);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadOptions();
  $('saveBtn').addEventListener('click', saveOptions);
});
