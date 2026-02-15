# CodeBridge

CodeBridge is a Manifest V3 Chrome extension that syncs solved problems from LeetCode, Codeforces, and HackerRank to a GitHub repository. It detects the problem, extracts your solution, generates a README, and uploads everything via the GitHub API.

## Features

- Detects problem metadata (title, difficulty, tags, URL, ID/slug).
- Extracts solution code from in-page editors or accepted submissions.
- Supports folder or flat file layouts with customizable templates.
- Uses GitHub device flow for authentication.
- Works on LeetCode, Codeforces, and HackerRank.

## Quick start

1. Create a GitHub OAuth App and copy the Client ID.
2. Update src/background/constants.js with your Client ID.
3. Load the extension from chrome://extensions (Developer mode -> Load unpacked).
4. Open a supported problem page and click Detect.
5. Save to GitHub.

## Documentation

Full documentation is in docs/:

- docs/README.md
- docs/overview.md
- docs/architecture.md
- docs/project-structure.md
- docs/setup.md
- docs/configuration.md
- docs/development.md
- docs/security-privacy.md
- docs/troubleshooting.md

## Codeforces note

Codeforces loads accepted code on the submission page. When Detect runs on a
problem page, Code Bridge prompts you to open your last accepted submission.
You can enable "Don't ask again (Auto Redirect)" to skip the prompt next time.
You can also open the accepted submission manually (click the submission ID)
and open the popup there.

## Project structure

See docs/project-structure.md for the complete layout and module overview.

## Development

```bash
npm install
npm run build
```

The build output is optional and used only for release packaging.

## Security

Tokens are stored in chrome.storage.local only when you choose to persist them. See docs/security-privacy.md for details.

## License

ISC
