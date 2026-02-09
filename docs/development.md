# Development

## Install dependencies

```bash
npm install
```

## Run locally

The extension runs directly from src/. Reload it in chrome://extensions after changes.

## Optional build (release packaging)

```bash
npm run build
```

This writes minified and obfuscated files to build/. The build output is optional and not used during local development.

## Logs

- Content script logs: open DevTools on the problem page
- Background logs: chrome://extensions -> Service worker -> Inspect

## Tests

There are no automated tests at the moment.
