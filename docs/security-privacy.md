# Security and privacy

## Token storage

- GitHub tokens are stored in chrome.storage.local when you choose to persist them.
- Tokens are never logged intentionally, and only a masked token is shown in the UI.

## Token scopes

- Device flow uses the repo scope to create or update files.
- Use a least-privilege token where possible.

## Data handling

- Problem metadata and solution code are processed locally.
- Uploads are sent directly to the GitHub API.

## Revoking access

- Revoke the OAuth app in GitHub settings to invalidate the token.
- Clear the extension storage from the options page if needed.
