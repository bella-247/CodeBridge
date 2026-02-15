# Overview

CodeBridge is a Manifest V3 Chrome extension that syncs solved problems from coding platforms to a GitHub repository. It detects the problem, extracts your solution, builds README content, and uploads the files using the GitHub API.

## Supported platforms

- LeetCode
- Codeforces
- HackerRank

## What it does

- Detects problem metadata (title, difficulty, tags, URL, ID/slug).
- Extracts solution code from the editor or accepted submissions.
- Builds a folder name and file paths.
- Generates a README and an optional solution header.
- Uploads files to GitHub with an authenticated device-flow token.

## High-level flow

1. Popup requests detection from the active tab.
2. Content script gathers metadata and code.
3. Background service worker formats files and uploads them to GitHub.
4. Content script shows a toast with the result.
