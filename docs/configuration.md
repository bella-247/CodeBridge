# Configuration

CodeBridge has two configuration surfaces:

- Popup settings: fast workflow defaults used during detection and uploads.
- Options page: template customization and defaults stored in chrome.storage.local.

## Popup settings

- Owner, repo, branch
- Language (file extension)
- File organization (folders or flat files)
- Overwrite toggle
- Show upload bubble

These values are stored automatically in chrome.storage.local for future sessions.

## Options page settings

- Default owner/repo/branch
- Commit message template
- File path template
- README template
- Solution header template
- Include problem statement toggle

## Template variables

Supported placeholders (see src/utils/templateEngine.js):

- [id]
- [title]
- [slug]
- [difficulty]
- [language]
- [ext]
- [platform]
- [description]
- [url]
- [tags]
- [folder]
- [time]

## File organization

- Folder strategy: creates {folder}/solution.ext and {folder}/README.md
- Flat strategy: creates a single file in the root or the custom path
