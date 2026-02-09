# Setup

## Prerequisites

- Chrome or Edge (Manifest V3 compatible)
- A GitHub account
- A GitHub OAuth App client ID (for device flow)

## Configure GitHub OAuth

1. Create a GitHub OAuth App
    - GitHub -> Settings -> Developer settings -> OAuth Apps -> New OAuth App
    - Authorization callback URL can be any placeholder (device flow does not use it)
2. Copy the Client ID
3. Update the extension constant
    - Edit src/background/constants.js and set CLIENT_ID to your OAuth App client ID

## Load the extension (unpacked)

1. Open chrome://extensions (or edge://extensions)
2. Enable Developer mode
3. Click "Load unpacked"
4. Select the repository root (the folder that contains manifest.json)

## First run

1. Open a supported problem page
2. Click the extension icon
3. Sign in with GitHub (device flow)
4. Detect the problem
5. Save to GitHub
