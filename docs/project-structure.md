# Project structure

Top-level layout and the purpose of each directory.

```
.
├─ manifest.json          # Extension manifest
├─ src/                   # Source files (MV3)
│  ├─ background/          # Service worker modules
│  ├─ adapters/            # Platform-specific DOM adapters
│  ├─ scrapers/            # Platform-specific HTML scrapers
│  ├─ utils/               # Templates and file generation
│  ├─ content.js           # Content script entry
│  ├─ popup.html           # Popup UI
│  ├─ popup.js             # Popup logic
│  ├─ options.html         # Options page UI
│  ├─ options.js           # Options page logic
│  ├─ styles.css           # Shared UI styles
│  └─ help.html            # In-extension help
├─ icons/                 # Extension icons
├─ docs/                  # Project documentation
├─ build.js               # Optional build script for release packaging
└─ package.json
```

## Source areas

- src/background: service worker modules for auth, messaging, and GitHub uploads.
- src/adapters: DOM adapters for each platform.
- src/scrapers: fetch-and-parse logic for pages like Codeforces submissions.
- src/utils: template rendering and file strategy helpers.
